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
        // Liste tous les composants et classes
        const allComponents = fs
            .readdirSync(basePathLwc, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
        const allClasses = [];
        const classDirs = fs.readdirSync(basePathApex, { withFileTypes: true })
            .filter(entry => entry.isDirectory());
        const classNameToDir = {};
        for (const dir of classDirs) {
            const dirPath = path.join(basePathApex, dir.name);
            const files = fs.readdirSync(dirPath);
            for (const file of files) {
                if (file.endsWith('.cls') && !file.endsWith('.cls-meta.xml')) {
                    const className = file.replace(/\.cls$/, '');
                    allClasses.push(className);
                    classNameToDir[className] = dirPath;
                }
            }
        }
        const items = type === 'component' ? allComponents : allClasses;
        if (items.length === 0) {
            this.error(`❌ Aucun ${type} trouvé dans ${type === 'component' ? basePathLwc : basePathApex}`);
        }
        const { name } = await inquirer.prompt([
            {
                name: 'name',
                type: 'list',
                message: `Quel ${type} veux-tu déployer ?`,
                choices: items,
            },
        ]);
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
        // --- RÉSOLUTION RÉCURSIVE DES DÉPENDANCES (avec stockage dépendances propres à chaque item) ---
        const added = new Set();
        const itemsToZip = [];
        // Pour éviter de repasser plusieurs fois sur les mêmes items
        const getItemDependencies = (depName, depType) => {
            if (depType === 'component') {
                const compDir = path.join(basePathLwc, depName);
                // Dépendances LWC et Apex dans les fichiers
                const htmlDeps = extractHTMLDependencies(path.join(compDir, `${depName}.html`));
                const tsLwcDeps = extractTsJsLwcDependencies(path.join(compDir, `${depName}.ts`));
                const jsLwcDeps = extractTsJsLwcDependencies(path.join(compDir, `${depName}.js`));
                const tsApexDeps = extractTsJsApexDependencies(path.join(compDir, `${depName}.ts`));
                const jsApexDeps = extractTsJsApexDependencies(path.join(compDir, `${depName}.js`));
                // LWC = composant, Apex = classe
                const result = [];
                for (const lwcDep of [...htmlDeps, ...tsLwcDeps, ...jsLwcDeps]) {
                    if (allComponents.includes(lwcDep)) {
                        result.push({ name: lwcDep, type: 'component' });
                    }
                }
                for (const apexDep of [...tsApexDeps, ...jsApexDeps]) {
                    if (allClasses.includes(apexDep)) {
                        result.push({ name: apexDep, type: 'class' });
                    }
                }
                return result;
            }
            else {
                // === Classe Apex ===
                const classDir = path.join(basePathApex, depName);
                const mainClsFile = path.join(classDir, `${depName}.cls`);
                const apexDeps = extractApexDependencies(mainClsFile, allClasses, depName);
                return apexDeps.filter((dep) => allClasses.includes(dep)).map((dep) => ({
                    name: dep,
                    type: 'class',
                }));
            }
        };
        // Fonction principale récursive, mais ici chaque item conserve sa propre liste de dépendances
        const addWithDependencies = (depName, depType) => {
            const key = `${depType}:${depName}`;
            if (added.has(key))
                return;
            added.add(key);
            // Ajoute le dossier au zip
            if (depType === 'component') {
                const compDir = path.join(basePathLwc, depName);
                zip.addLocalFolder(compDir, depName);
            }
            else {
                const classDir = classNameToDir[depName];
                zip.addLocalFolder(classDir, depName);
            }
            const thisDeps = getItemDependencies(depName, depType);
            itemsToZip.push({
                name: depName,
                type: depType,
                dependencies: thisDeps,
            });
            // Ajoute récursivement les dépendances détectées
            for (const dep of thisDeps) {
                addWithDependencies(dep.name, dep.type);
            }
        };
        addWithDependencies(name, type === 'component' ? 'component' : 'class');
        // Génère un fichier JSON pour les dépendances
        const depsJsonPath = path.join(tmpDir, `${name}-registry-deps.json`);
        fs.writeFileSync(depsJsonPath, JSON.stringify(itemsToZip, null, 2));
        zip.addLocalFile(depsJsonPath, '', 'registry-deps.json');
        // Ecrit le ZIP
        const zipPath = path.join(tmpDir, `${name}-${Date.now()}.zip`);
        zip.writeZip(zipPath);
        // 🧭 Debug ZIP
        this.log(`📦 ZIP créé : ${zipPath}`);
        this.log(`📁 Contenu : ${zip.getEntries().length} fichier(s)`);
        // Prépare le form pour upload
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
export default RegistryDeploy;
// --- FONCTIONS DÉTECTION DÉPENDANCES ---
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
// Dépendances Apex dans les fichiers TS/JS des composants
function extractTsJsApexDependencies(filePath) {
    if (!fs.existsSync(filePath))
        return [];
    const code = fs.readFileSync(filePath, 'utf8');
    const apexDeps = new Set();
    // import ... from "@salesforce/apex/XXX.METHOD";
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