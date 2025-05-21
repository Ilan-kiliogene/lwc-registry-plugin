import fs from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import fetch from 'node-fetch';
import inquirer from 'inquirer';
import { SfCommand } from '@salesforce/sf-plugins-core';
// eslint-disable-next-line import/no-extraneous-dependencies
import FormData from 'form-data';

const FORBIDDEN_EXTENSIONS = [
  '.sh',
  '.bash',
  '.zsh',
  '.bat',
  '.cmd',
  '.ps1',
  '.exe',
  '.scr',
  '.vbs',
  '.msi',
  '.php',
  '.py',
  '.pl',
  '.rb',
  '.jar',
  '.com',
  '.wsf',
];

const STATICRES_DIR = 'force-app/main/default/staticresources';

type DeployType = 'component' | 'class';

type MetadataBase = { description: string };

type ItemType = 'component' | 'class';
type RegistryDep = Readonly<{
  name: string;
  type: ItemType;
  dependencies: Array<{ name: string; type: ItemType }>;
}>;

export default class RegistryDeploy extends SfCommand<void> {
  public static readonly summary =
    'Déploie un composant LWC ou une classe Apex (et ses dépendances récursives) sur le registre externe';
  public static readonly examples = ['$ sf registry deploy'];

  public async run(): Promise<void> {
    const server = 'https://registry.kiliogene.com';

    // 1. Sélection du type à déployer
    const { type } = await inquirer.prompt<{ type: DeployType }>([
      {
        name: 'type',
        type: 'list',
        message: 'Que veux-tu déployer ?',
        choices: ['component', 'class'],
      },
    ]);

    const basePathLwc = 'force-app/main/default/lwc';
    const basePathApex = 'force-app/main/default/classes';

    // 2. Listing des composants/classes disponibles
    const allComponents = safeListDirNames(basePathLwc);

    // On crée la vraie liste des classes depuis tous les .cls
    const { allClasses, classNameToDir } = findAllClasses(basePathApex);

    const items = type === 'component' ? allComponents : allClasses;
    if (items.length === 0) {
      this.error(`❌ Aucun ${type} trouvé dans ${type === 'component' ? basePathLwc : basePathApex}`);
    }

    // 3. Sélection de l’item à déployer
    const { name } = await inquirer.prompt<{ name: string }>([
      {
        name: 'name',
        type: 'list',
        message: `Quel ${type} veux-tu déployer ?`,
        choices: items,
      },
    ]);

    // 4. Description
    const answers = await inquirer.prompt([
      {
        name: 'description',
        message: 'Description ?',
        type: 'input',
        validate: (input) => input.trim() !== '' || 'La description est requise.',
      },
    ]);
    const metadata = answers as MetadataBase;

    const zip = new AdmZip();
    const tmpDir = '/tmp';
    await mkdir(tmpDir, { recursive: true });

    // 5. Dépendances récursives + ajout des fichiers au ZIP
    const added = new Set<string>();
    const itemsToZip: RegistryDep[] = [];

    const staticResourcesUsed = new Set<string>();

    const getItemDependencies = (depName: string, depType: ItemType): Array<{ name: string; type: ItemType }> => {
      if (depType === 'component') {
        const compDir = path.join(basePathLwc, depName);

        // Collecte aussi les staticresources dans les .ts et .js
        findStaticResourcesUsed(compDir, staticResourcesUsed);

        const htmlDeps = extractHTMLDependencies(path.join(compDir, `${depName}.html`));
        const tsLwcDeps = extractTsJsLwcDependencies(path.join(compDir, `${depName}.ts`));
        const jsLwcDeps = extractTsJsLwcDependencies(path.join(compDir, `${depName}.js`));
        const tsApexDeps = extractTsJsApexDependencies(path.join(compDir, `${depName}.ts`));
        const jsApexDeps = extractTsJsApexDependencies(path.join(compDir, `${depName}.js`));
        const result: Array<{ name: string; type: ItemType }> = [];
        for (const lwcDep of [...htmlDeps, ...tsLwcDeps, ...jsLwcDeps]) {
          if (allComponents.includes(lwcDep)) result.push({ name: lwcDep, type: 'component' });
        }
        for (const apexDep of [...tsApexDeps, ...jsApexDeps]) {
          if (allClasses.includes(apexDep)) result.push({ name: apexDep, type: 'class' });
        }
        return result;
      } else {
        // classe Apex
        const dir = classNameToDir[depName];
        const mainClsFile = dir ? path.join(dir, `${depName}.cls`) : '';
        const apexDeps = extractApexDependencies(mainClsFile, allClasses, depName);
        return apexDeps
          .filter((dep) => allClasses.includes(dep))
          .map((dep) => ({
            name: dep,
            type: 'class' as ItemType,
          }));
      }
    };

    const addWithDependencies = (depName: string, depType: ItemType): void => {
      const key = `${depType}:${depName}`;
      if (added.has(key)) return;
      added.add(key);

      const dirToAdd = depType === 'component' ? path.join(basePathLwc, depName) : classNameToDir[depName];

      // Vérification blacklist avant ajout
      for (const filePath of walkDir(dirToAdd)) {
        if (isForbiddenFile(filePath)) {
          this.error(`❌ Fichier interdit détecté : ${filePath}. Extension refusée : ${path.extname(filePath)}`);
        }
      }

      zip.addLocalFolder(dirToAdd, depName);

      const thisDeps = getItemDependencies(depName, depType);

      itemsToZip.push({
        name: depName,
        type: depType,
        dependencies: thisDeps,
      });

      for (const dep of thisDeps) {
        addWithDependencies(dep.name, dep.type);
      }
    };

    addWithDependencies(name, type);

    // --------- STATIC RESOURCES ---------
    if (staticResourcesUsed.size > 0) {
      const staticResDest = path.join(tmpDir, 'staticresources');
      await mkdir(staticResDest, { recursive: true });
      for (const resName of staticResourcesUsed) {
        // Trouve le fichier principal de la ressource (ex : zip, js, png...)
        const mainFile = findStaticResourceFile(STATICRES_DIR, resName);
        if (!mainFile) {
          this.error(
            `❌ Ressource statique "${resName}" manquante dans ${STATICRES_DIR}. (Tu dois avoir le fichier principal, pas uniquement le .resource-meta.xml)`
          );
        }
        // Copie le fichier principal
        fs.copyFileSync(mainFile, path.join(staticResDest, path.basename(mainFile)));

        // Copie le .resource-meta.xml s’il existe
        const metaFile = path.join(STATICRES_DIR, `${resName}.resource-meta.xml`);
        if (fs.existsSync(metaFile) && fs.statSync(metaFile).isFile()) {
          fs.copyFileSync(metaFile, path.join(staticResDest, `${resName}.resource-meta.xml`));
        }
      }
      zip.addLocalFolder(staticResDest, 'staticresources');
    }
    // ------------------------------------

    // 6. Ajoute le JSON des dépendances
    const depsJsonPath = path.join(tmpDir, `${name}-registry-deps.json`);
    fs.writeFileSync(depsJsonPath, JSON.stringify(itemsToZip, null, 2));
    zip.addLocalFile(depsJsonPath, '', 'registry-deps.json');

    // 7. Écriture du ZIP et upload
    const zipPath = path.join(tmpDir, `${name}-${Date.now()}.zip`);
    zip.writeZip(zipPath);

    this.log(`📦 ZIP créé : ${zipPath}`);
    this.log(`📁 Contenu : ${zip.getEntries().length} fichier(s)`);

    // Upload vers serveur
    const form = new FormData();
    form.append('componentZip', fs.createReadStream(zipPath));
    form.append('name', name);
    form.append('description', metadata.description);
    form.append('type', type);

    this.log(`📤 Envoi de ${name} (${type}) vers ${server}/deploy...`);

    try {
      const res = await fetch(`${server}/deploy`, {
        method: 'POST',
        body: form,
        headers: form.getHeaders(),
      });
      const resultText = await res.text();
      if (!res.ok) {
        this.error(`❌ Échec HTTP ${res.status} : ${resultText}`);
      }
      this.log(`✅ Serveur : ${resultText}`);
    } catch (err) {
      this.error(`❌ Erreur réseau : ${(err as Error).message}`);
    } finally {
      await rm(zipPath, { force: true });
      await rm(depsJsonPath, { force: true });
    }
  }
}

// ===== Utilitaires robustes et typés =====

// Liste tous les dossiers immédiats (sécurité et compatibilité cross-OS)
function safeListDirNames(base: string): string[] {
  try {
    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Recherche tous les noms de classes Apex dans force-app/main/default/classes,
 * peu importe le nom du dossier parent.
 */
function findAllClasses(basePathApex: string): { allClasses: string[]; classNameToDir: Record<string, string> } {
  const allClasses: string[] = [];
  const classNameToDir: Record<string, string> = {};
  try {
    const classDirs = fs.readdirSync(basePathApex, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const dir of classDirs) {
      const dirPath = path.join(basePathApex, dir.name);
      for (const file of fs.readdirSync(dirPath)) {
        if (file.endsWith('.cls') && !file.endsWith('.cls-meta.xml')) {
          const className = file.replace(/\.cls$/, '');
          allClasses.push(className);
          classNameToDir[className] = dirPath;
        }
      }
    }
  } catch {
    /* ignore */
  }
  return { allClasses, classNameToDir };
}

// Dépendances LWC depuis HTML
function extractHTMLDependencies(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const html = fs.readFileSync(filePath, 'utf8');
  const regex = /<c-([a-zA-Z0-9_]+)[\s>]/g;
  const dependencies = new Set<string>();
  let match;
  while ((match = regex.exec(html))) {
    dependencies.add(match[1]);
  }
  return [...dependencies];
}
function extractTsJsLwcDependencies(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const code = fs.readFileSync(filePath, 'utf8');
  const lwcDeps = new Set<string>();
  const lwcRegex = /import\s+\w+\s+from\s+["']c\/([a-zA-Z0-9_]+)["']/g;
  let match;
  while ((match = lwcRegex.exec(code))) {
    lwcDeps.add(match[1]);
  }
  return [...lwcDeps];
}
function extractTsJsApexDependencies(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const code = fs.readFileSync(filePath, 'utf8');
  const apexDeps = new Set<string>();
  const apexRegex = /import\s+\w+\s+from\s+['"]@salesforce\/apex\/([a-zA-Z0-9_]+)\.[^'"]+['"]/g;
  let match;
  while ((match = apexRegex.exec(code))) {
    apexDeps.add(match[1]);
  }
  return [...apexDeps];
}
function extractApexDependencies(clsFilePath: string, allClassNames: string[], selfClassName: string): string[] {
  if (!fs.existsSync(clsFilePath)) return [];
  const code = fs.readFileSync(clsFilePath, 'utf8');
  return allClassNames.filter((className) => className !== selfClassName && code.includes(className));
}

function isForbiddenFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return FORBIDDEN_EXTENSIONS.includes(ext);
}

function* walkDir(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkDir(entryPath);
    } else {
      yield entryPath;
    }
  }
}

// === Nouvel utilitaire pour détecter les static resources dans ts/js ===
function findStaticResourcesUsed(componentDir: string, staticResSet: Set<string>): void {
  for (const ext of ['.ts', '.js']) {
    const filePath = path.join(componentDir, path.basename(componentDir) + ext);
    if (!fs.existsSync(filePath)) continue;
    const code = fs.readFileSync(filePath, 'utf8');
    const regex = /import\s+\w+\s+from\s+["']@salesforce\/resourceUrl\/([a-zA-Z0-9_]+)["']/g;
    let match;
    while ((match = regex.exec(code))) {
      staticResSet.add(match[1]);
    }
  }
}

// === Recherche la vraie staticresource avec ou sans extension ===
function findStaticResourceFile(resourceDir: string, resName: string): string | null {
  const files = fs.readdirSync(resourceDir);
  for (const file of files) {
    if (file === resName || file.startsWith(resName + '.')) {
      return path.join(resourceDir, file);
    }
  }
  return null;
}
