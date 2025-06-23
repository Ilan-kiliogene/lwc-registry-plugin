import { createReadStream, createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { finished } from 'node:stream/promises';
import archiver from 'archiver';
import { SfCommand } from '@salesforce/sf-plugins-core';
import { SERVER_URL, FORBIDDEN_EXTENSIONS, PATHS, FILENAMES, registryMetaFileSchema } from '../../utils/constants.js';
import {
  promptComponentOrClass,
  promptSelectName,
  promptVersionToEnter,
  promptDescriptionToEnter,
} from '../../utils/prompts.js';
import { findProjectRoot, getCleanTypeLabel, fileExistsAndIsFile, authedFetch } from '../../utils/functions.js';
import { AuthError } from '../../utils/errors.js';
import { ItemType, RegistryDep } from '../../utils/types.js';


export default class RegistryDeploy extends SfCommand<void> {
  // eslint-disable-next-line sf-plugin/no-hardcoded-messages-commands
  public static readonly summary = 'Déploie un composant LWC ou une classe Apex sur le registre externe';
  public static readonly examples = ['$ sf registry deploy'];

  private projectRoot!: string;
  private basePathLwc!: string;
  private basePathApex!: string

  public async run(): Promise<void> {
    try {
      this.projectRoot = findProjectRoot(process.cwd());
      this.basePathLwc = path.join(this.projectRoot, PATHS.LWC);
      this.basePathApex = path.join(this.projectRoot, PATHS.APEX);
      const { allComponents, allClasses, classNameToDir } = await this.scanProject();
      const userInput = await this.gatherUserInput(allComponents, allClasses, classNameToDir);
      const analysisParams = { allComponents, allClasses, classNameToDir, version: userInput.version };
      const itemsToZip = await this.collectDependencies(userInput.name, userInput.type, analysisParams);
      const staticResources = new Set(itemsToZip.flatMap((item) => item.staticresources));
      await this.validateStaticResources(staticResources);
      const zipFilePath = await this.createDeploymentPackage(itemsToZip, staticResources, userInput, classNameToDir);
      await this.sendPackage(zipFilePath);
      await fs.unlink(zipFilePath);
      this.log('✅ Déploiement terminé avec succès !');
    } catch (error) {
      this.error(`❌ Le déploiement a échoué : ${(error as Error).message}`);
    }
  }

  private async gatherUserInput(
    allComponents: string[],
    allClasses: string[],
    classNameToDir: Record<string, string>
  ): Promise<{
    name: string;
    type: 'component' | 'class';
    version: string;
    description: string;
  }> {
    const type = await promptComponentOrClass('Que voulez vous déployer ?');
    const cleanType = getCleanTypeLabel(type, false);
    const items = type === 'component' ? allComponents : allClasses;
    if (items.length === 0) {
      this.error(`❌ Aucun ${cleanType} trouvé.`);
    }
    const name = await promptSelectName(`Quel ${cleanType} voulez-vous déployer ?`, items);
    let version: string;
    let description: string;
    const meta = await this.tryReadRegistryMeta(type, name, classNameToDir);
    if (meta) {
      this.log(`ℹ️ Fichier ${FILENAMES.REGISTRY_META} trouvé et valide. Utilisation des valeurs...`);
      version = meta.version;
      description = meta.description;
    } else {
      this.log(`ℹ️ Fichier ${FILENAMES.REGISTRY_META} non trouvé ou invalide. Passage en mode interactif...`);
      version = await promptVersionToEnter();
      description = await promptDescriptionToEnter();
    }
    return { name, type, version, description };
  }

  private async scanProject(): Promise<{
    allComponents: string[];
    allClasses: string[];
    classNameToDir: Record<string, string>;
  }> {
    try {
      const [allComponents, { allClasses, classNameToDir }] = await Promise.all([
        safeListDirNamesAsync(this.basePathLwc),
        this.findAllClassesAsync(this.basePathApex),
      ]);
      return { allComponents, allClasses, classNameToDir };
    } catch (error) {
      this.error(`❌ Une erreur est survenue lors de l'analyse du projet : ${(error as Error).message}`);
    }
  }

  private async validateStaticResources(resources: Set<string>): Promise<void> {
    const checks = Array.from(resources).map(async (resName) => {
      const resourceDir = path.join(this.projectRoot, PATHS.STATIC_RESOURCES);
      const metaFile = path.join(resourceDir, `${resName}.resource-meta.xml`);
      if (!(await findStaticResourceFileAsync(resourceDir, resName))) {
        throw new Error(`Ressource statique "${resName}" référencée mais introuvable.`);
      }
      if (!(await fileExistsAndIsFile(metaFile))) {
        throw new Error(`Fichier .resource-meta.xml manquant pour la ressource statique "${resName}".`);
      }
    });
    try {
      await Promise.all(checks);
    } catch (err) {
      this.error(
        `❌ Erreur de validation des ressources statiques : ${(err as Error).message}\nAbandon du déploiement.`
      );
    }
  }

  private async createDeploymentPackage(
    itemsToZip: RegistryDep[],
    staticResources: Set<string>,
    metadata: { name: string; description: string; type: ItemType; version: string },
    classNameToDir: Record<string, string>
  ): Promise<string> {
    const tmpFile = path.join(os.tmpdir(), `sf-deploy-${Date.now()}.zip`);
    const output = createWriteStream(tmpFile);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(output);

    for (const item of itemsToZip) {
      const dirToAdd = item.type === 'component' ? path.join(this.basePathLwc, item.name) : classNameToDir[item.name];
      archive.directory(dirToAdd, item.name);
    }

    const resourceDir = path.join(this.projectRoot, PATHS.STATIC_RESOURCES);

    const resourcePromises = Array.from(staticResources).map(async (resName) => {
      const mainFile = await findStaticResourceFileAsync(resourceDir, resName);
      const metaFile = path.join(resourceDir, `${resName}.resource-meta.xml`);
      return { mainFile, metaFile };
    });

    const resolvedResources = await Promise.all(resourcePromises);

    for (const { mainFile, metaFile } of resolvedResources) {
      if (mainFile) {
        archive.file(mainFile, { name: path.join('staticresources', path.basename(mainFile)) });
      }
      archive.file(metaFile, { name: path.join('staticresources', path.basename(metaFile)) });
    }

    archive.append(JSON.stringify(metadata, null, 2), { name: FILENAMES.METADATA });
    archive.append(JSON.stringify(itemsToZip, null, 2), { name: FILENAMES.DEPS });

    await archive.finalize();
    await finished(output);

    return tmpFile;
  }

  private async sendPackage(zipFilePath: string): Promise<void> {
    try {
      const stats = await fs.stat(zipFilePath);
      const res = await authedFetch.call(this,`${SERVER_URL}/deploy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/zip',
          'Content-Length': stats.size.toString(),
        },
        body: createReadStream(zipFilePath),
      });
      const resultText = await res.text();
      if (!res.ok) {
        this.error(`❌ Échec HTTP ${res.status} : ${resultText}`);
      }
    } catch (error) {
      if (error instanceof AuthError) {
        this.error(error.message);
      }
      this.error(`❌ Erreur réseau : ${(error as Error).message}`);
    }
  }

  private async collectDependencies(
    dependenceName: string,
    dependenceType: ItemType,
    params: {
      allComponents: string[];
      allClasses: string[];
      classNameToDir: Record<string, string>;
      version?: string;
    },
    seen = new Set<string>()
  ): Promise<RegistryDep[]> {
    const key = `${dependenceType}:${dependenceName}`;
    if (seen.has(key)) return [];
    seen.add(key);

    const directoryPath =
      dependenceType === 'component'
        ? path.join(this.basePathLwc, dependenceName)
        : params.classNameToDir[dependenceName];

    await this.checkForbiddenFiles(directoryPath);

    const [dependencies, staticresources] = await Promise.all([
      this.getItemDependencies(dependenceName, dependenceType, params),
      dependenceType === 'component' ? findStaticResourcesForComponent(directoryPath) : Promise.resolve([]),
    ]);

    const isFirstItem = seen.size === 1;
    const item: RegistryDep = {
      name: dependenceName,
      type: dependenceType,
      dependencies,
      staticresources,
      ...(isFirstItem && params.version ? { version: params.version } : {}),
    };

    const subDeps = await Promise.all(
      dependencies.map((dependence) => this.collectDependencies(dependence.name, dependence.type, params, seen))
    );

    return [item, ...subDeps.flat()];
  }

  private async getItemDependencies(
    name: string,
    type: ItemType,
    params: { allComponents: string[]; allClasses: string[]; classNameToDir: Record<string, string> }
  ): Promise<Array<{ name: string; type: ItemType }>> {
    if (type === 'component') {
      return this.getLwcDependencies(name, params);
    }
    const dirClass = params.classNameToDir[name];
    if (!dirClass) throw new Error(`Dossier introuvable pour la classe Apex "${name}".`);

    const clsFile = path.join(dirClass, `${name}.cls`);
    const apexDeps = await extractApexDependencies(clsFile, params.allClasses, name);
    return apexDeps.map((depName) => ({ name: depName, type: 'class' }));
  }

  private async getLwcDependencies(
    name: string,
    params: { allComponents: string[]; allClasses: string[] }
  ): Promise<Array<{ name: string; type: ItemType }>> {
    const compDir = path.join(this.basePathLwc, name);
    const htmlFile = path.join(compDir, `${name}.html`);
    const tsFile = path.join(compDir, `${name}.ts`);
    const jsFile = path.join(compDir, `${name}.js`);

    const [htmlDeps, tsLwcDeps, jsLwcDeps, tsApexDeps, jsApexDeps] = await Promise.all([
      extractDependenciesFromFile(htmlFile, /<c-([a-zA-Z0-9_]+)[\s>]/g),
      extractDependenciesFromFile(tsFile, /import\s+\w+\s+from\s+["']c\/([a-zA-Z0-9_]+)["']/g),
      extractDependenciesFromFile(jsFile, /import\s+\w+\s+from\s+["']c\/([a-zA-Z0-9_]+)["']/g),
      extractDependenciesFromFile(tsFile, /import\s+\w+\s+from\s+['"]@salesforce\/apex\/([a-zA-Z0-9_]+)\.[^'"]+['"]/g),
      extractDependenciesFromFile(jsFile, /import\s+\w+\s+from\s+['"]@salesforce\/apex\/([a-zA-Z0-9_]+)\.[^'"]+['"]/g),
    ]);

    const uniqueDependencies = new Map<string, { name: string; type: ItemType }>();

    const allLwcDeps = [...htmlDeps, ...tsLwcDeps, ...jsLwcDeps];
    for (const depName of allLwcDeps) {
      if (params.allComponents.includes(depName)) {
        uniqueDependencies.set(`component:${depName}`, { name: depName, type: 'component' });
      }
    }

    const allApexDeps = [...tsApexDeps, ...jsApexDeps];
    for (const depName of allApexDeps) {
      if (params.allClasses.includes(depName)) {
        uniqueDependencies.set(`class:${depName}`, { name: depName, type: 'class' });
      }
    }
    return Array.from(uniqueDependencies.values());
  }

  private async findAllClassesAsync(
    basePathApex: string
  ): Promise<{ allClasses: string[]; classNameToDir: Record<string, string> }> {
    try {
      const allClasses: string[] = [];
      const classNameToDir: Record<string, string> = {};
      const classDirs = await safeListDirNamesAsync(basePathApex);

      const filesByDir = await Promise.all(
        classDirs.map(async (dirName) => {
          const dirPath = path.join(basePathApex, dirName);
          const files = await fs.readdir(dirPath);
          return { dirPath, files };
        })
      );

      for (const { dirPath, files } of filesByDir) {
        for (const file of files) {
          if (file.endsWith('.cls') && !file.endsWith('.cls-meta.xml')) {
            const className = path.basename(file, '.cls');
            allClasses.push(className);
            classNameToDir[className] = dirPath;
          }
        }
      }
      return { allClasses, classNameToDir };
    } catch (error) {
      this.error(`❌ Erreur lors de la recherche des classes Apex: ${(error as Error).message}`);
    }
  }

  private async checkForbiddenFiles(directoryPath: string): Promise<void> {
    for await (const filePath of this.walkDirAsync(directoryPath)) {
      const extension = path.extname(filePath).toLowerCase();
      if (FORBIDDEN_EXTENSIONS.includes(extension)) {
        this.error(`❌ Fichier interdit détecté : ${filePath}. Extension refusée : ${extension}`);
      }
    }
  }

  private async *walkDirAsync(dir: string): AsyncGenerator<string> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        yield* this.walkDirAsync(entryPath);
      } else {
        yield entryPath;
      }
    }
  }

  private async tryReadRegistryMeta(
    type: ItemType,
    name: string,
    classNameToDir: Record<string, string>
  ): Promise<{ version: string; description: string } | null> {
    const componentDir = type === 'component' ? path.join(this.basePathLwc, name) : classNameToDir[name];
    if (!componentDir) return null;

    const metaFilePath = path.join(componentDir, FILENAMES.REGISTRY_META);

    try {
      const fileContent = await fs.readFile(metaFilePath, 'utf8');
      const result = registryMetaFileSchema.safeParse(JSON.parse(fileContent));

      if (!result.success) {
        this.warn(
          `Fichier ${FILENAMES.REGISTRY_META} invalide : ${result.error.issues.map((i) => i.message).join(', ')}`
        );
        return null;
      }

      return result.data; 
    } catch (error) {
      return null;
    }
  }
}

async function extractApexDependencies(
  clsFilePath: string,
  allClassNames: string[],
  selfClassName: string
): Promise<string[]> {
  const code = await fs.readFile(clsFilePath, 'utf8');
  // Utilise un mot-clé (boundary `\b`) pour éviter les correspondances partielles (ex: `MyClass` dans `MyClassName`)
  return allClassNames.filter(
    (className) => className !== selfClassName && new RegExp(`\\b${className}\\b`).test(code)
  );
}

async function findStaticResourcesForComponent(componentDir: string): Promise<string[]> {
  const regex = /import\s+\w+\s+from\s+["']@salesforce\/resourceUrl\/([a-zA-Z0-9_]+)["']/g;
  const baseName = path.basename(componentDir);
  const tsFile = path.join(componentDir, `${baseName}.ts`);
  const jsFile = path.join(componentDir, `${baseName}.js`);

  const [tsResults, jsResults] = await Promise.all([
    extractDependenciesFromFile(tsFile, regex),
    extractDependenciesFromFile(jsFile, regex),
  ]);

  return [...new Set([...tsResults, ...jsResults])];
}

async function findStaticResourceFileAsync(resourceDir: string, resName: string): Promise<string | null> {
  try {
    const files = await fs.readdir(resourceDir);
    const foundFile = files.find(
      (file) =>
        (file === resName || file.startsWith(resName + '.')) &&
        !file.endsWith('.resource-meta.xml')
    );
    return foundFile ? path.join(resourceDir, foundFile) : null;
  } catch {
    return null;
  }
}

async function extractDependenciesFromFile(filePath: string, regex: RegExp): Promise<string[]> {
  try {
    const code = await fs.readFile(filePath, 'utf8');
    const matches = [...code.matchAll(regex)];
    return [...new Set(matches.map((match) => match[1]))];
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function safeListDirNamesAsync(base: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(base, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (error) {
    throw new Error(`Erreur lors de la lecture du dossier "${base}" : ${(error as Error).message}`);
  }
}
