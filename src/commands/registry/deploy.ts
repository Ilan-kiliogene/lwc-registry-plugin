import { promises as fs } from 'node:fs';
import path from 'node:path';
import fsSync from 'node:fs';
import os from 'node:os';
import archiver from 'archiver';
import fetch from 'node-fetch';
import { SfCommand } from '@salesforce/sf-plugins-core';
import { SERVER_URL, FORBIDDEN_EXTENSIONS } from '../../utils/constants.js';
import { promptComponentOrClass, promptSelectName, promptVersionToEnter, promptDescriptionToEnter } from '../../utils/prompts.js';
import { findProjectRoot, getCleanTypeLabel } from '../../utils/functions.js';

const STATICRES_DIR = 'force-app/main/default/staticresources';

type ItemType = 'component' | 'class';

type RegistryDep = Readonly<{
  name: string;
  type: ItemType;
  dependencies: Array<{ name: string; type: ItemType }>;
  staticresources: string[];
  version?: string;
}>;

export default class RegistryDeploy extends SfCommand<void> {
  // eslint-disable-next-line sf-plugin/no-hardcoded-messages-commands
  public static readonly summary ='Déploie un composant LWC ou une classe Apex (et ses dépendances récursives) sur le registre externe';
  public static readonly examples = ['$ sf registry deploy'];

  public async run(): Promise<void> {
    const type = await promptComponentOrClass('Que voulez vous déployer ?');
    const projectRoot = findProjectRoot(process.cwd());
    const basePathLwc = path.join(projectRoot, 'force-app/main/default/lwc');
    const basePathApex = path.join(projectRoot, 'force-app/main/default/classes');
    const cleanType = getCleanTypeLabel(type, false);
    const allComponents = await this.safeListDirNamesAsync(basePathLwc);
    const { allClasses, classNameToDir } = await this.findAllClassesAsync(basePathApex);
    const items = this.getItems(type, allComponents, allClasses, basePathLwc, basePathApex);
    const name = await promptSelectName(`Quel ${cleanType} voulez-vous déployer ?`, items);
    const version = await promptVersionToEnter();
    const description = await promptDescriptionToEnter();




    // 2. Analyse dépendances et structure à zipper
    const params = { basePathLwc, allComponents, allClasses, classNameToDir, version };
    const itemsToZip = await this.collectDepsToZipAsync(name, type, true, params);

    // 3. Collecte des ressources statiques utilisées
    const staticResourcesUsed = new Set(itemsToZip.flatMap(item => item.staticresources));

    // 1. Création de toutes les promesses de vérification en parallèle
    const staticResourceChecks = Array.from(staticResourcesUsed).map(async (resName) => {
      const mainFile = await this.findStaticResourceFileAsync(STATICRES_DIR, resName);
      const metaFile = path.join(STATICRES_DIR, `${resName}.resource-meta.xml`);
      const hasMeta = await this.fileExistsAsync(metaFile);

      if (!mainFile) {
        // Arrête tout si un fichier principal manque
        throw new Error(
          `❌ Ressource statique "${resName}" référencée mais introuvable dans "${STATICRES_DIR}".\nAbandon du déploiement.`
        );
      }
      if (!hasMeta) {
        // Ici, tu peux soit lever une erreur stricte, soit juste log/warn
        throw new Error(
          `❌ Fichier .resource-meta.xml manquant pour la ressource statique "${resName}".\nAbandon du déploiement.`
        );
        // ou bien juste warn :
        // this.warn(`⚠️ .resource-meta.xml manquant pour "${resName}"`);
      }
    });

    // 2. Attente collective: si une ressource pose problème, l’erreur est immédiatement levée.
    try {
      await Promise.all(staticResourceChecks);
    } catch (err) {
      this.error(String(err));
    }


    // 4. Crée un ZIP sur disque (fichier temporaire)
    const tmpFile = path.join(os.tmpdir(), `lwc-deploy-${Date.now()}.zip`);
    const output = fsSync.createWriteStream(tmpFile);
    const archive = archiver('zip', { zlib: { level: 9 } });

    const archivePromise = new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
    });

    archive.pipe(output);

    // 4a. Ajoute les dossiers (composants/classes)
    for (const item of itemsToZip) {
      const dirToAdd = item.type === 'component'
        ? path.join(basePathLwc, item.name)
        : params.classNameToDir[item.name];
      archive.directory(dirToAdd, item.name);
    }

    // 4b. Ajoute les ressources statiques
    const staticResourcePromises = Array.from(staticResourcesUsed).map(async (resName) => {
      const mainFile = await this.findStaticResourceFileAsync(STATICRES_DIR, resName);
      if (mainFile) {
        archive.append(fsSync.createReadStream(mainFile), {
          name: path.join('staticresources', path.basename(mainFile)),
        });
      }
      const metaFile = path.join(STATICRES_DIR, `${resName}.resource-meta.xml`);
      try {
        const stat = await fs.stat(metaFile);
        if (stat.isFile()) {
          archive.append(fsSync.createReadStream(metaFile), {
            name: path.join('staticresources', path.basename(metaFile)),
          });
        }
      } catch {
        // ignore, file does not exist
      }
    });
    
    // On lance toutes les promesses en parallèle et attend la fin
    await Promise.all(staticResourcePromises);

    // 4c. Ajoute les métadonnées dans le ZIP (metadata.json)
    const metadata = { name, description, type, version };
    archive.append(JSON.stringify(metadata, null, 2), { name: 'metadata.json' });

    // 4d. Ajoute le JSON des dépendances
    archive.append(JSON.stringify(itemsToZip, null, 2), { name: 'registry-deps.json' });

    await archive.finalize();
    await archivePromise;

    // 5. Envoie le ZIP directement en HTTP (content-type: application/zip)
    this.log(`📤 Envoi de ${tmpFile} (${type}) vers ${SERVER_URL}/deploy...`);
    try {
      const res = await fetch(`${SERVER_URL}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: fsSync.createReadStream(tmpFile),
      });
      const resultText = await res.text();
      if (!res.ok) {
        this.error(`❌ Échec HTTP ${res.status} : ${resultText}`);
      }
      this.log(`✅ Serveur : ${resultText}`);
    } catch (err) {
      this.error(`❌ Erreur réseau : ${(err as Error).message}`);
    } finally {
      fsSync.unlink(tmpFile, () => {}); // Nettoyage du fichier temporaire
    }
  }







  private getItems(
    type: 'component' | 'class',
    allComponents: string[],
    allClasses: string[],
    basePathLwc: string,
    basePathApex: string
  ): string[] {
    const items = type === 'component' ? allComponents : allClasses;
    if (items.length === 0) {
      this.error(`❌ Aucun ${type} trouvé dans ${type === 'component' ? basePathLwc : basePathApex}`);
    }
    return items;
  }

  private async collectDepsToZipAsync(
    depName: string,
    depType: ItemType,
    isRoot: boolean,
    params: {
      basePathLwc: string;
      allComponents: string[];
      allClasses: string[];
      classNameToDir: Record<string, string>;
      version?: string;
    },
    seen = new Set<string>()
  ): Promise<RegistryDep[]> {
  
    try {
      const key = `${depType}:${depName}`;
      if (seen.has(key)) return [];
      const newSeen = new Set(seen);
      newSeen.add(key);
    
      const dirToAdd =
        depType === 'component'
          ? path.join(params.basePathLwc, depName)
          : params.classNameToDir[depName];
    
      this.CheckForbiddenFile(dirToAdd)
    
      const [thisDeps, staticResources] = await Promise.all([
        this.getItemDependenciesAsync(depName, depType, params),
        depType === 'component'
          ? this.findStaticResourcesUsedForComponentAsync(dirToAdd)
          : [],
      ]);
    
      const item: RegistryDep = {
        name: depName,
        type: depType,
        dependencies: thisDeps,
        staticresources: staticResources,
        ...(isRoot ? { version: params.version } : {}),
      };
    
      // Résolution récursive asynchrone des dépendances
      const subDepsArrays = await Promise.all(
        thisDeps.map((dep) =>
          this.collectDepsToZipAsync(dep.name, dep.type, false, params, newSeen)
        )
      );
    
      return [item, ...subDepsArrays.flat()];
    } catch (error) {
      this.error(`❌ Erreur lors du déploiement : ${error instanceof Error ? error.message : String(error)}`);
    }
  }




private async safeListDirNamesAsync(base: string): Promise<string[]> {
    try {
      const files = await fs.readdir(base);
      // Pour chaque fichier, crée une Promise qui résout en le nom s'il s'agit d'un dossier
      const checks = files.map(async (file) => {
        const stat = await fs.stat(path.join(base, file));
        return stat.isDirectory() ? file : null;
      });
      // On attend que toutes les Promises soient résolues en parallèle
      const onlyDirs = (await Promise.all(checks)).filter((f): f is string => !!f);
      return onlyDirs;
    } catch (error) {
      this.error(`❌ Erreur lors de la lecture du dossier "${base}" : ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async findAllClassesAsync(basePathApex: string): Promise<{ allClasses: string[]; classNameToDir: Record<string, string> }> {
    const allClasses: string[] = [];
    const classNameToDir: Record<string, string> = {};
    try {
      // 1. Lis tous les dossiers dans le dossier Apex
      const classDirs = (await fs.readdir(basePathApex, { withFileTypes: true }))
        .filter(e => e.isDirectory());
      
        // 2. Lance en parallèle tous les readdir sur chaque dossier
      const filesByDir = await Promise.all(
        classDirs.map(async dir => {
          const dirPath = path.join(basePathApex, dir.name);
          const files = await fs.readdir(dirPath);
          return { dirPath, files };
        })
      );

      // 3. Parcours chaque résultat
      for (const { dirPath, files } of filesByDir) {
        for (const file of files) {
          if (file.endsWith('.cls') && !file.endsWith('.cls-meta.xml')) {
            const className = file.replace(/\.cls$/, '');
            allClasses.push(className);
            classNameToDir[className] = dirPath;
          }
        }    
      }
      
    } catch (error) {
      this.error(`❌ Erreur lors de la lecture du dossier "${basePathApex}" : ${error instanceof Error ? error.message : String(error)}`);
    }
    return { allClasses, classNameToDir };
  }

  private async fileExistsAsync(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async extractHTMLDependenciesAsync(filePath: string): Promise<string[]> {
    if (!(await fileExistsAsync(filePath))) return [];
    const regex = /<c-([a-zA-Z0-9_]+)[\s>]/g
    const code = await fs.readFile(filePath, 'utf8');
    const matches = [...code.matchAll(regex)];
    const dependencies = matches.map(match => match[1]);
    return [...new Set(dependencies)];
  }

  private async extractTsJsLwcDependenciesAsync(filePath: string): Promise<string[]> {
    if (!(await fileExistsAsync(filePath))) return [];
    const regex = /import\s+\w+\s+from\s+["']c\/([a-zA-Z0-9_]+)["']/g
    const code = await fs.readFile(filePath, 'utf8');
    const matches = [...code.matchAll(regex)]
    const dependencies = matches.map(match => match[1])
    return [...new Set(dependencies)]; 
  }

  private async extractTsJsApexDependenciesAsync(filePath: string): Promise<string[]> {
    if (!(await fileExistsAsync(filePath))) return [];
    const regex = /import\s+\w+\s+from\s+['"]@salesforce\/apex\/([a-zA-Z0-9_]+)\.[^'"]+['"]/g
    const code = await fs.readFile(filePath, 'utf8');
    const matches = [...code.matchAll(regex)]
    const dependencies = matches.map(match => match[1])
    return [...new Set(dependencies)]; 
  }

  private async extractApexDependenciesAsync(
    clsFilePath: string,
    allClassNames: string[],
    selfClassName: string
  ): Promise<string[]> {
    if (!(await fileExistsAsync(clsFilePath))) return [];
    const code = await fs.readFile(clsFilePath, 'utf8');
    return allClassNames.filter(
      (className) => className !== selfClassName && code.includes(className)
    );
  }

  private async findStaticResourcesUsedForComponentAsync(
    componentDir: string
  ): Promise<string[]> {
    const exts = ['.ts', '.js'];
    const regex = /import\s+\w+\s+from\s+["']@salesforce\/resourceUrl\/([a-zA-Z0-9_]+)["']/g;
    const results = await Promise.all(exts.map(async ext => {
      const filePath = path.join(componentDir, path.basename(componentDir) + ext);
      if (!(await fileExistsAsync(filePath))) return [];
      const code = await fs.readFile(filePath, { encoding: 'utf8' });
      return Array.from(code.matchAll(regex), match => match[1]);
    }));
    return Array.from(new Set(results.flat()));
  }

  private async findStaticResourceFileAsync(
    resourceDir: string,
    resName: string
  ): Promise<string | null> {
    try {
      const files = await fs.readdir(resourceDir);
      for (const file of files) {
        if (file === resName || file.startsWith(resName + '.')) {
          return path.join(resourceDir, file);
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  

  private* walkDirSync(dir: string): Generator<string> {
    const entries = fsSync.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        yield* this.walkDirSync(entryPath);
      } else {
        yield entryPath;
      }
    }
  }

  // ============= DÉTECTION ET RÉSOLUTION DES DÉPENDANCES ASYNCHRONE ============

  private async getItemDependenciesAsync(
    depName: string,
    depType: ItemType,
    params: {
      basePathLwc: string;
      allComponents: string[];
      allClasses: string[];
      classNameToDir: Record<string, string>;
    }
  ): Promise<Array<{ name: string; type: ItemType }>> {
    const { basePathLwc, allComponents, allClasses, classNameToDir } = params;

    if (depType === 'component') {
      const compDir = path.join(basePathLwc, depName);

      const [
        htmlDeps,
        tsLwcDeps,
        jsLwcDeps,
        tsApexDeps,
        jsApexDeps,
      ] = await Promise.all([
        this.extractHTMLDependenciesAsync(path.join(compDir, `${depName}.html`)),
        this.extractTsJsLwcDependenciesAsync(path.join(compDir, `${depName}.ts`)),
        this.extractTsJsLwcDependenciesAsync(path.join(compDir, `${depName}.js`)),
        this.extractTsJsApexDependenciesAsync(path.join(compDir, `${depName}.ts`)),
        this.extractTsJsApexDependenciesAsync(path.join(compDir, `${depName}.js`)),
      ]);

      const lwcDeps = [...htmlDeps, ...tsLwcDeps, ...jsLwcDeps]
        .filter(dep => allComponents.includes(dep))
        .map(name => ({ name, type: 'component' as ItemType }));

      const apexDeps = [...tsApexDeps, ...jsApexDeps]
        .filter(dep => allClasses.includes(dep))
        .map(name => ({ name, type: 'class' as ItemType }));

      return [...lwcDeps, ...apexDeps];
    }

    // Cas "class"
    const dirClass = classNameToDir[depName];
    if (!dirClass) {
      throw new Error(`❌ Dossier introuvable pour la classe Apex "${depName}".`);
    }
    const mainClsFile = path.join(dirClass, `${depName}.cls`);  
    const apexDeps = await this.extractApexDependenciesAsync(mainClsFile, allClasses, depName);

    return apexDeps
      .filter(dep => allClasses.includes(dep))
      .map(name => ({ name, type: 'class' as ItemType }));
    }




  private CheckForbiddenFile(dirPath: string): void {
    for (const filePath of this.walkDirSync(dirPath)) {
      const ext = path.extname(filePath).toLowerCase();
      if (FORBIDDEN_EXTENSIONS.includes(ext)) {
        this.error(`❌ Fichier interdit détecté : ${filePath}. Extension refusée : ${ext}`);
      }
    }
  }
}