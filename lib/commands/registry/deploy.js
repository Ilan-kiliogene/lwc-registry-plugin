import fs from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import fetch from 'node-fetch';
import inquirer from 'inquirer';
import { SfCommand } from '@salesforce/sf-plugins-core';
// eslint-disable-next-line import/no-extraneous-dependencies
import FormData from 'form-data';
class RegistryDeploy extends SfCommand {
    async run() {
        const server = 'https://registry.kiliogene.com';
        // 1. Sélection du type à déployer
        const { type } = await inquirer.prompt([
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
        const { name } = await inquirer.prompt([
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
        const metadata = answers;
        const zip = new AdmZip();
        const tmpDir = '/tmp';
        await mkdir(tmpDir, { recursive: true });
        // 5. Dépendances récursives + ajout des fichiers au ZIP
        const added = new Set();
        const itemsToZip = [];
        const getItemDependencies = (depName, depType) => {
            if (depType === 'component') {
                const compDir = path.join(basePathLwc, depName);
                const htmlDeps = extractHTMLDependencies(path.join(compDir, `${depName}.html`));
                const tsLwcDeps = extractTsJsLwcDependencies(path.join(compDir, `${depName}.ts`));
                const jsLwcDeps = extractTsJsLwcDependencies(path.join(compDir, `${depName}.js`));
                const tsApexDeps = extractTsJsApexDependencies(path.join(compDir, `${depName}.ts`));
                const jsApexDeps = extractTsJsApexDependencies(path.join(compDir, `${depName}.js`));
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
                // classe Apex
                const dir = classNameToDir[depName];
                const mainClsFile = dir ? path.join(dir, `${depName}.cls`) : '';
                const apexDeps = extractApexDependencies(mainClsFile, allClasses, depName);
                return apexDeps.filter((dep) => allClasses.includes(dep)).map((dep) => ({
                    name: dep,
                    type: 'class',
                }));
            }
        };
        const addWithDependencies = (depName, depType) => {
            const key = `${depType}:${depName}`;
            if (added.has(key))
                return;
            added.add(key);
            // Ajoute les fichiers au ZIP
            if (depType === 'component') {
                const compDir = path.join(basePathLwc, depName);
                zip.addLocalFolder(compDir, depName);
            }
            else {
                const classDir = classNameToDir[depName];
                if (!classDir) {
                    this.log(`❌ Impossible de trouver le dossier source pour la classe ${depName} (dossier parent inconnu)`);
                    return;
                }
                zip.addLocalFolder(classDir, depName);
            }
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
        }
        catch (err) {
            this.error(`❌ Erreur réseau : ${err.message}`);
        }
        finally {
            await rm(zipPath, { force: true });
            await rm(depsJsonPath, { force: true });
        }
    }
}
RegistryDeploy.summary = 'Déploie un composant LWC ou une classe Apex (et ses dépendances récursives) sur le registre externe';
RegistryDeploy.examples = [
    '$ sf registry deploy',
];
export default RegistryDeploy;
// ===== Utilitaires robustes et typés =====
// Liste tous les dossiers immédiats (sécurité et compatibilité cross-OS)
function safeListDirNames(base) {
    try {
        return fs.readdirSync(base, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => e.name);
    }
    catch {
        return [];
    }
}
/**
 * Recherche tous les noms de classes Apex dans force-app/main/default/classes,
 * peu importe le nom du dossier parent.
 */
function findAllClasses(basePathApex) {
    const allClasses = [];
    const classNameToDir = {};
    try {
        const classDirs = fs.readdirSync(basePathApex, { withFileTypes: true }).filter(e => e.isDirectory());
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
    }
    catch { /* ignore */ }
    return { allClasses, classNameToDir };
}
// Dépendances LWC depuis HTML
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
//# sourceMappingURL=deploy.js.map