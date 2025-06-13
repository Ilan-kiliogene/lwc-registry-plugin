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
class RegistryDeploy extends SfCommand {
    async run() {
        // 1. Récupère les infos du composant
        const type = await promptComponentOrClass('Que voulez vous déployer ?');
        const projectRoot = findProjectRoot(process.cwd());
        const basePathLwc = path.join(projectRoot, 'force-app/main/default/lwc');
        const basePathApex = path.join(projectRoot, 'force-app/main/default/classes');
        const cleanType = getCleanTypeLabel(type, false);
        const allComponents = await safeListDirNamesAsync(basePathLwc);
        const { allClasses, classNameToDir } = await findAllClassesAsync(basePathApex);
        const items = this.getItems(type, allComponents, allClasses, basePathLwc, basePathApex);
        const name = await promptSelectName(`Quel ${cleanType} voulez-vous déployer ?`, items);
        const version = await promptVersionToEnter();
        const description = await promptDescriptionToEnter();
        // 2. Analyse dépendances et structure à zipper
        const params = { basePathLwc, allComponents, allClasses, classNameToDir, version };
        const itemsToZip = await collectDepsToZipAsync(name, type, true, params);
        // 3. Collecte des ressources statiques utilisées
        const staticResourcesUsed = new Set();
        for (const item of itemsToZip) {
            for (const res of item.staticresources)
                staticResourcesUsed.add(res);
        }
        // 1. Création de toutes les promesses de vérification en parallèle
        const staticResourceChecks = Array.from(staticResourcesUsed).map(async (resName) => {
            const mainFile = await findStaticResourceFileAsync(STATICRES_DIR, resName);
            const metaFile = path.join(STATICRES_DIR, `${resName}.resource-meta.xml`);
            const hasMeta = await fileExistsAsync(metaFile);
            if (!mainFile) {
                // Arrête tout si un fichier principal manque
                throw new Error(`❌ Ressource statique "${resName}" référencée mais introuvable dans "${STATICRES_DIR}".\nAbandon du déploiement.`);
            }
            if (!hasMeta) {
                // Ici, tu peux soit lever une erreur stricte, soit juste log/warn
                throw new Error(`❌ Fichier .resource-meta.xml manquant pour la ressource statique "${resName}".\nAbandon du déploiement.`);
                // ou bien juste warn :
                // this.warn(`⚠️ .resource-meta.xml manquant pour "${resName}"`);
            }
        });
        // 2. Attente collective: si une ressource pose problème, l’erreur est immédiatement levée.
        try {
            await Promise.all(staticResourceChecks);
        }
        catch (err) {
            this.error(String(err));
        }
        // 4. Crée un ZIP sur disque (fichier temporaire)
        const tmpFile = path.join(os.tmpdir(), `lwc-deploy-${Date.now()}.zip`);
        const output = fsSync.createWriteStream(tmpFile);
        const archive = archiver('zip', { zlib: { level: 9 } });
        const archivePromise = new Promise((resolve, reject) => {
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
            const mainFile = await findStaticResourceFileAsync(STATICRES_DIR, resName);
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
            }
            catch {
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
        }
        catch (err) {
            this.error(`❌ Erreur réseau : ${err.message}`);
        }
        finally {
            fsSync.unlink(tmpFile, () => { }); // Nettoyage du fichier temporaire
        }
    }
    getItems(type, allComponents, allClasses, basePathLwc, basePathApex) {
        const items = type === 'component' ? allComponents : allClasses;
        if (items.length === 0) {
            this.error(`❌ Aucun ${type} trouvé dans ${type === 'component' ? basePathLwc : basePathApex}`);
        }
        return items;
    }
}
// eslint-disable-next-line sf-plugin/no-hardcoded-messages-commands
RegistryDeploy.summary = 'Déploie un composant LWC ou une classe Apex (et ses dépendances récursives) sur le registre externe';
RegistryDeploy.examples = ['$ sf registry deploy'];
export default RegistryDeploy;
// ====== UTILITAIRES ASYNC ======
async function safeListDirNamesAsync(base) {
    try {
        const files = await fs.readdir(base);
        // Pour chaque fichier, crée une Promise qui résout en le nom s'il s'agit d'un dossier
        const checks = files.map(async (file) => {
            const stat = await fs.stat(path.join(base, file));
            return stat.isDirectory() ? file : null;
        });
        // On attend que toutes les Promises soient résolues en parallèle
        const onlyDirs = (await Promise.all(checks)).filter((f) => !!f);
        return onlyDirs;
    }
    catch {
        return [];
    }
}
async function findAllClassesAsync(basePathApex) {
    const allClasses = [];
    const classNameToDir = {};
    try {
        // 1. Lis tous les dossiers dans le dossier Apex
        const classDirs = (await fs.readdir(basePathApex, { withFileTypes: true }))
            .filter(e => e.isDirectory());
        // 2. Lance en parallèle tous les readdir sur chaque dossier
        const filesByDir = await Promise.all(classDirs.map(async (dir) => {
            const dirPath = path.join(basePathApex, dir.name);
            const files = await fs.readdir(dirPath);
            return { dirPath, files };
        }));
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
    }
    catch {
        /* ignore */
    }
    return { allClasses, classNameToDir };
}
async function fileExistsAsync(filePath) {
    try {
        await fs.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
async function extractHTMLDependenciesAsync(filePath) {
    if (!(await fileExistsAsync(filePath)))
        return [];
    const html = await fs.readFile(filePath, 'utf8');
    const regex = /<c-([a-zA-Z0-9_]+)[\s>]/g;
    const dependencies = new Set();
    let match;
    while ((match = regex.exec(html)))
        dependencies.add(match[1]);
    return [...dependencies];
}
async function extractTsJsLwcDependenciesAsync(filePath) {
    if (!(await fileExistsAsync(filePath)))
        return [];
    const code = await fs.readFile(filePath, 'utf8');
    const lwcDeps = new Set();
    const lwcRegex = /import\s+\w+\s+from\s+["']c\/([a-zA-Z0-9_]+)["']/g;
    let match;
    while ((match = lwcRegex.exec(code)))
        lwcDeps.add(match[1]);
    return [...lwcDeps];
}
async function extractTsJsApexDependenciesAsync(filePath) {
    if (!(await fileExistsAsync(filePath)))
        return [];
    const code = await fs.readFile(filePath, 'utf8');
    const apexDeps = new Set();
    const apexRegex = /import\s+\w+\s+from\s+['"]@salesforce\/apex\/([a-zA-Z0-9_]+)\.[^'"]+['"]/g;
    let match;
    while ((match = apexRegex.exec(code)))
        apexDeps.add(match[1]);
    return [...apexDeps];
}
async function extractApexDependenciesAsync(clsFilePath, allClassNames, selfClassName) {
    if (!(await fileExistsAsync(clsFilePath)))
        return [];
    const code = await fs.readFile(clsFilePath, 'utf8');
    return allClassNames.filter((className) => className !== selfClassName && code.includes(className));
}
async function findStaticResourcesUsedForComponentAsync(componentDir) {
    const exts = ['.ts', '.js'];
    // Crée une Promise pour chaque extension
    const results = await Promise.all(exts.map(async (ext) => {
        const filePath = path.join(componentDir, path.basename(componentDir) + ext);
        if (!(await fileExistsAsync(filePath)))
            return [];
        const code = await fs.readFile(filePath, { encoding: 'utf8' });
        const regex = /import\s+\w+\s+from\s+["']@salesforce\/resourceUrl\/([a-zA-Z0-9_]+)["']/g;
        const matches = [];
        let match;
        while ((match = regex.exec(code)))
            matches.push(match[1]);
        return matches;
    }));
    // Fusionne tous les résultats dans un Set pour enlever les doublons
    return Array.from(new Set(results.flat()));
}
async function findStaticResourceFileAsync(resourceDir, resName) {
    try {
        const files = await fs.readdir(resourceDir);
        for (const file of files) {
            if (file === resName || file.startsWith(resName + '.')) {
                return path.join(resourceDir, file);
            }
        }
        return null;
    }
    catch {
        return null;
    }
}
function isForbiddenFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return FORBIDDEN_EXTENSIONS.includes(ext);
}
function* walkDirSync(dir) {
    const entries = fsSync.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            yield* walkDirSync(entryPath);
        }
        else {
            yield entryPath;
        }
    }
}
// ============= DÉTECTION ET RÉSOLUTION DES DÉPENDANCES ASYNCHRONE ============
async function getItemDependenciesAsync(depName, depType, params) {
    const { basePathLwc, allComponents, allClasses, classNameToDir } = params;
    if (depType === 'component') {
        const compDir = path.join(basePathLwc, depName);
        const [htmlDeps, tsLwcDeps, jsLwcDeps, tsApexDeps, jsApexDeps,] = await Promise.all([
            extractHTMLDependenciesAsync(path.join(compDir, `${depName}.html`)),
            extractTsJsLwcDependenciesAsync(path.join(compDir, `${depName}.ts`)),
            extractTsJsLwcDependenciesAsync(path.join(compDir, `${depName}.js`)),
            extractTsJsApexDependenciesAsync(path.join(compDir, `${depName}.ts`)),
            extractTsJsApexDependenciesAsync(path.join(compDir, `${depName}.js`)),
        ]);
        const result = [];
        for (const lwcDep of [...htmlDeps, ...tsLwcDeps, ...jsLwcDeps]) {
            if (allComponents.includes(lwcDep))
                result.push({ name: lwcDep, type: 'component' });
        }
        for (const apexDep of [...tsApexDeps, ...jsApexDeps]) {
            if (allClasses.includes(apexDep))
                result.push({ name: apexDep, type: 'class' });
        }
        return result;
    }
    else {
        const dir = classNameToDir[depName];
        const mainClsFile = dir ? path.join(dir, `${depName}.cls`) : '';
        const apexDeps = await extractApexDependenciesAsync(mainClsFile, allClasses, depName);
        return apexDeps
            .filter((dep) => allClasses.includes(dep))
            .map((dep) => ({
            name: dep,
            type: 'class',
        }));
    }
}
async function collectDepsToZipAsync(depName, depType, isRoot, params, seen = new Set()) {
    const key = `${depType}:${depName}`;
    if (seen.has(key))
        return [];
    const newSeen = new Set(seen);
    newSeen.add(key);
    const dirToAdd = depType === 'component'
        ? path.join(params.basePathLwc, depName)
        : params.classNameToDir[depName];
    // Vérification blacklist (sync pour tous les fichiers du dossier)
    for (const filePath of walkDirSync(dirToAdd)) {
        if (isForbiddenFile(filePath)) {
            throw new Error(`❌ Fichier interdit détecté : ${filePath}. Extension refusée : ${path.extname(filePath)}`);
        }
    }
    const [thisDeps, staticResources] = await Promise.all([
        getItemDependenciesAsync(depName, depType, params),
        depType === 'component'
            ? findStaticResourcesUsedForComponentAsync(dirToAdd)
            : [],
    ]);
    const item = {
        name: depName,
        type: depType,
        dependencies: thisDeps,
        staticresources: staticResources,
        ...(isRoot ? { version: params.version } : {}),
    };
    // Résolution récursive asynchrone des dépendances
    const subDepsArrays = await Promise.all(thisDeps.map((dep) => collectDepsToZipAsync(dep.name, dep.type, false, params, newSeen)));
    return [item, ...subDepsArrays.flat()];
}
//# sourceMappingURL=deploy.js.map