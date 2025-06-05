import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import fetch from 'node-fetch';
import { SfCommand } from '@salesforce/sf-plugins-core';
import FormData from 'form-data';
import { SERVER_URL, FORBIDDEN_EXTENSIONS } from '../../utils/constants.js';
import { promptComponentOrClass, promptSelectName, promptVersionToEnter, promptDescriptionToEnter } from '../../utils/prompts.js';
import { findProjectRoot, getCleanTypeLabel } from '../../utils/functions.js';
const STATICRES_DIR = 'force-app/main/default/staticresources';
class RegistryDeploy extends SfCommand {
    async run() {
        const type = await promptComponentOrClass('Que voulez vous déployer ?');
        const projectRoot = findProjectRoot(process.cwd());
        const basePathLwc = path.join(projectRoot, 'force-app/main/default/lwc');
        const basePathApex = path.join(projectRoot, 'force-app/main/default/classes');
        const cleanType = getCleanTypeLabel(type, false);
        const allComponents = safeListDirNames(basePathLwc);
        const { allClasses, classNameToDir } = findAllClasses(basePathApex);
        const items = type === 'component' ? allComponents : allClasses;
        if (items.length === 0) {
            this.error(`❌ Aucun ${type} trouvé dans ${type === 'component' ? basePathLwc : basePathApex}`);
        }
        const name = await promptSelectName(`Quel ${cleanType} voulez-vous déployer ?`, items);
        const version = await promptVersionToEnter();
        const description = await promptDescriptionToEnter();
        // Dépendances récursives + ajout des fichiers au ZIP (via archiver)
        const added = new Set();
        const itemsToZip = [];
        const staticResourcesUsed = new Set();
        const getItemDependencies = (depName, depType) => {
            if (depType === 'component') {
                const compDir = path.join(basePathLwc, depName);
                findStaticResourcesUsed(compDir, staticResourcesUsed);
                const htmlDeps = extractHTMLDependencies(path.join(compDir, `${depName}.html`));
                const tsLwcDeps = extractTsJsLwcDependencies(path.join(compDir, `${depName}.ts`));
                const jsLwcDeps = extractTsJsLwcDependencies(path.join(compDir, `${depName}.js`));
                const tsApexDeps = extractTsJsApexDependencies(path.join(compDir, `${depName}.ts`));
                const jsApexDeps = extractTsJsApexDependencies(path.join(compDir, `${depName}.js`));
                const result = [];
                for (const lwcDep of [
                    ...htmlDeps,
                    ...tsLwcDeps,
                    ...jsLwcDeps,
                ]) {
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
                // classe Apex
                const dir = classNameToDir[depName];
                const mainClsFile = dir ? path.join(dir, `${depName}.cls`) : '';
                const apexDeps = extractApexDependencies(mainClsFile, allClasses, depName);
                return apexDeps
                    .filter((dep) => allClasses.includes(dep))
                    .map((dep) => ({
                    name: dep,
                    type: 'class',
                }));
            }
        };
        const addWithDependencies = (depName, depType, isRoot = false) => {
            const key = `${depType}:${depName}`;
            if (added.has(key))
                return;
            added.add(key);
            const dirToAdd = depType === 'component'
                ? path.join(basePathLwc, depName)
                : classNameToDir[depName];
            // Vérification blacklist avant ajout
            for (const filePath of walkDir(dirToAdd)) {
                if (isForbiddenFile(filePath)) {
                    this.error(`❌ Fichier interdit détecté : ${filePath}. Extension refusée : ${path.extname(filePath)}`);
                }
            }
            const thisDeps = getItemDependencies(depName, depType);
            let staticResources;
            if (depType === 'component') {
                staticResources = findStaticResourcesUsedForComponent(dirToAdd);
            }
            else {
                staticResources = [];
            }
            if (isRoot) {
                itemsToZip.push({
                    name: depName,
                    type: depType,
                    dependencies: thisDeps,
                    staticresources: staticResources,
                    version,
                });
            }
            else {
                itemsToZip.push({
                    name: depName,
                    type: depType,
                    dependencies: thisDeps,
                    staticresources: staticResources,
                });
            }
            for (const dep of thisDeps) {
                addWithDependencies(dep.name, dep.type);
            }
        };
        addWithDependencies(name, type, true);
        // =======================
        //   ZIP et Upload STREAM
        // =======================
        const form = new FormData();
        const archive = archiver('zip', { zlib: { level: 9 } });
        // Champs texte
        form.append('name', name);
        form.append('description', description);
        form.append('type', type);
        form.append('version', version);
        // Champ fichier ZIP : flux archiver
        form.append('componentZip', archive, { filename: `${name}.zip` });
        // Ajout des dossiers (tous les items et leurs dépendances)
        for (const item of itemsToZip) {
            const dirToAdd = item.type === 'component'
                ? path.join(basePathLwc, item.name)
                : classNameToDir[item.name];
            archive.directory(dirToAdd, item.name);
        }
        // Ajout des staticresources EN STREAMING (pas de dossier temporaire)
        for (const resName of staticResourcesUsed) {
            const mainFile = findStaticResourceFile(STATICRES_DIR, resName);
            if (mainFile) {
                archive.append(fs.createReadStream(mainFile), {
                    name: path.join('staticresources', path.basename(mainFile)),
                });
            }
            const metaFile = path.join(STATICRES_DIR, `${resName}.resource-meta.xml`);
            if (fs.existsSync(metaFile) && fs.statSync(metaFile).isFile()) {
                archive.append(fs.createReadStream(metaFile), {
                    name: path.join('staticresources', path.basename(metaFile)),
                });
            }
        }
        // Ajout du JSON des dépendances en mémoire
        archive.append(JSON.stringify(itemsToZip, null, 2), {
            name: 'registry-deps.json',
        });
        try {
            await archive.finalize();
        }
        catch (e) {
            this.error(`Erreur ZIP : ${e.message}`);
        }
        this.log(`📤 Envoi de ${name} (${type}) vers ${SERVER_URL}/deploy (streaming direct)...`);
        try {
            const res = await fetch(`${SERVER_URL}/deploy`, {
                method: 'POST',
                body: form,
                headers: form.getHeaders(),
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
    }
}
// eslint-disable-next-line sf-plugin/no-hardcoded-messages-commands
RegistryDeploy.summary = 'Déploie un composant LWC ou une classe Apex (et ses dépendances récursives) sur le registre externe';
RegistryDeploy.examples = ['$ sf registry deploy'];
export default RegistryDeploy;
// ===== Utilitaires robustes et typés =====
function safeListDirNames(base) {
    try {
        return fs
            .readdirSync(base, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name);
    }
    catch {
        return [];
    }
}
function findAllClasses(basePathApex) {
    const allClasses = [];
    const classNameToDir = {};
    try {
        const classDirs = fs
            .readdirSync(basePathApex, { withFileTypes: true })
            .filter((e) => e.isDirectory());
        for (const dir of classDirs) {
            const dirPath = path.join(basePathApex, dir.name);
            for (const file of fs.readdirSync(dirPath)) {
                if (file.endsWith('.cls') &&
                    !file.endsWith('.cls-meta.xml')) {
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
function extractHTMLDependencies(filePath) {
    if (!fs.existsSync(filePath))
        return [];
    const html = fs.readFileSync(filePath, 'utf8');
    const regex = /<c-([a-zA-Z0-9_]+)[\s>]/g;
    const dependencies = new Set();
    let match;
    while ((match = regex.exec(html))) {
        dependencies.add(match[1]);
    }
    return [...dependencies];
}
function extractTsJsLwcDependencies(filePath) {
    if (!fs.existsSync(filePath))
        return [];
    const code = fs.readFileSync(filePath, 'utf8');
    const lwcDeps = new Set();
    const lwcRegex = /import\s+\w+\s+from\s+["']c\/([a-zA-Z0-9_]+)["']/g;
    let match;
    while ((match = lwcRegex.exec(code))) {
        lwcDeps.add(match[1]);
    }
    return [...lwcDeps];
}
function extractTsJsApexDependencies(filePath) {
    if (!fs.existsSync(filePath))
        return [];
    const code = fs.readFileSync(filePath, 'utf8');
    const apexDeps = new Set();
    const apexRegex = /import\s+\w+\s+from\s+['"]@salesforce\/apex\/([a-zA-Z0-9_]+)\.[^'"]+['"]/g;
    let match;
    while ((match = apexRegex.exec(code))) {
        apexDeps.add(match[1]);
    }
    return [...apexDeps];
}
function extractApexDependencies(clsFilePath, allClassNames, selfClassName) {
    if (!fs.existsSync(clsFilePath))
        return [];
    const code = fs.readFileSync(clsFilePath, 'utf8');
    return allClassNames.filter((className) => className !== selfClassName && code.includes(className));
}
function isForbiddenFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return FORBIDDEN_EXTENSIONS.includes(ext);
}
function* walkDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            yield* walkDir(entryPath);
        }
        else {
            yield entryPath;
        }
    }
}
function findStaticResourcesUsed(componentDir, staticResSet) {
    for (const ext of ['.ts', '.js']) {
        const filePath = path.join(componentDir, path.basename(componentDir) + ext);
        if (!fs.existsSync(filePath))
            continue;
        const code = fs.readFileSync(filePath, 'utf8');
        const regex = /import\s+\w+\s+from\s+["']@salesforce\/resourceUrl\/([a-zA-Z0-9_]+)["']/g;
        let match;
        while ((match = regex.exec(code))) {
            staticResSet.add(match[1]);
        }
    }
}
function findStaticResourceFile(resourceDir, resName) {
    const files = fs.readdirSync(resourceDir);
    for (const file of files) {
        if (file === resName || file.startsWith(resName + '.')) {
            return path.join(resourceDir, file);
        }
    }
    return null;
}
function findStaticResourcesUsedForComponent(componentDir) {
    const res = new Set();
    for (const ext of ['.ts', '.js']) {
        const filePath = path.join(componentDir, path.basename(componentDir) + ext);
        if (!fs.existsSync(filePath))
            continue;
        const code = fs.readFileSync(filePath, 'utf8');
        const regex = /import\s+\w+\s+from\s+["']@salesforce\/resourceUrl\/([a-zA-Z0-9_]+)["']/g;
        let match;
        while ((match = regex.exec(code))) {
            res.add(match[1]);
        }
    }
    return Array.from(res);
}
//# sourceMappingURL=deploy.js.map