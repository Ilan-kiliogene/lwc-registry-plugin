import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import fetch from 'node-fetch';
import AdmZip from 'adm-zip';
import inquirer from 'inquirer';
import { SfCommand } from '@salesforce/sf-plugins-core';
import * as fsExtra from 'fs-extra';
import { fetchCatalog } from '../../utils/registry';
class RegistryDownload extends SfCommand {
    async run() {
        const server = 'https://registry.kiliogene.com';
        // 1. Choix du type à télécharger
        const { type } = await inquirer.prompt([
            {
                name: 'type',
                type: 'list',
                message: 'Que veux-tu télécharger ?',
                choices: [
                    { name: 'Composant LWC', value: 'component' },
                    { name: 'Classe Apex', value: 'class' },
                ],
            },
        ]);
        const resultFetchCatalog = await fetchCatalog(server);
        ;
        if (!resultFetchCatalog.ok) {
            this.error(`Erreur lors de la récupération du catalogue : ${resultFetchCatalog.error}`);
        }
        const catalog = resultFetchCatalog.data;
        // 3. Sélection de l’élément à télécharger
        const entries = catalog[type];
        const label = type === 'component' ? 'Composant LWC' : 'Classe Apex';
        if (!entries.length)
            this.error(`❌ Aucun ${label} disponible dans le registre.`);
        const { name } = await inquirer.prompt([
            {
                name: 'name',
                type: 'list',
                message: `Quel ${label} veux-tu télécharger ?`,
                choices: entries.map((element) => element.name),
            },
        ]);
        // 4. Sélection de la version
        const entry = entries.find((element) => element.name === name);
        if (!entry)
            this.error(`❌ ${label} "${name}" non trouvé dans le registre.`);
        const versions = entry.versions.map((v) => v.version).reverse();
        const { version } = await inquirer.prompt([
            {
                name: 'version',
                type: 'list',
                message: `Quelle version de ${name} ?`,
                choices: versions,
            },
        ]);
        // 5. Sélection du dossier de destination
        const { choice } = await inquirer.prompt([
            {
                name: 'choice',
                type: 'list',
                message: 'Dossier cible ? (les composants LWC iront dans lwc, les classes dans classes)',
                choices: ['force-app/main/default/', 'Autre...'],
            },
        ]);
        let customTarget = null;
        if (choice === 'Autre...') {
            const { target } = await inquirer.prompt([
                {
                    name: 'target',
                    type: 'input',
                    message: 'Tape un chemin :',
                },
            ]);
            customTarget = target;
        }
        // 6. Téléchargement et extraction
        try {
            await this.downloadAndExtract(server, type, name, version, catalog, customTarget);
        }
        catch (error) {
            this.error(error instanceof Error ? error.message : String(error));
        }
    }
    async downloadAndExtract(server, type, name, version, registry, customTarget) {
        const url = `${server}/download/${type}/${name}/${version}`;
        const zipPath = path.join(os.tmpdir(), `${name}-${version}-${randomUUID()}.zip`);
        const tmpExtractPath = path.join(os.tmpdir(), `registry-download-${randomUUID()}`);
        this.log(`📥 Téléchargement depuis ${url}...`);
        const res = await fetch(url);
        if (!res.ok)
            throw new Error(`❌ Erreur HTTP ${res.status}: ${res.statusText}`);
        try {
            const buffer = Buffer.from(await res.arrayBuffer());
            await fs.promises.writeFile(zipPath, buffer);
            const zip = new AdmZip(zipPath);
            zip.extractAllTo(tmpExtractPath, true);
            // Extraction et déplacement factorisé
            await this.handleExtraction(tmpExtractPath, registry, customTarget);
            this.log('✅ Tous les items ont été extraits au bon endroit !');
        }
        finally {
            await fsExtra.remove(zipPath).catch(() => { });
            await fsExtra.remove(tmpExtractPath).catch(() => { });
        }
    }
    async handleExtraction(tmpExtractPath, registry, customTarget) {
        // 1. Extraction des composants/classes
        const extractedDirs = fs
            .readdirSync(tmpExtractPath, { withFileTypes: true })
            .filter((e) => e.isDirectory() && e.name !== 'staticresources')
            .map((e) => e.name);
        await Promise.all(extractedDirs.map(async (itemName) => {
            if (itemName === 'staticresources')
                return;
            const itemType = getItemType(itemName, registry);
            if (!itemType) {
                this.log(`⚠️ Type inconnu pour "${itemName}", ignoré.`);
                return;
            }
            let destDir;
            if (customTarget) {
                const base = path.isAbsolute(customTarget) ? customTarget : path.join(process.cwd(), customTarget);
                destDir = path.join(base, itemName);
            }
            else if (itemType === 'component') {
                destDir = path.join(process.cwd(), 'force-app/main/default/lwc', itemName);
            }
            else {
                destDir = path.join(process.cwd(), 'force-app/main/default/classes', itemName);
            }
            if (fs.existsSync(destDir)) {
                this.log(`⚠️  ${itemType} "${itemName}" existe déjà dans ${destDir}. Ignoré.`);
                return;
            }
            try {
                await fsExtra.move(path.join(tmpExtractPath, itemName), destDir, { overwrite: false });
                this.log(`✅ ${itemType} "${itemName}" extrait dans ${destDir}`);
            }
            catch (error) {
                this.log(`❌ Erreur lors de l'extraction de "${itemName}": ${error instanceof Error ? error.message : String(error)}`);
            }
        }));
        // 2. Gestion des staticresources (parallèle)
        const staticResExtracted = path.join(tmpExtractPath, 'staticresources');
        if (fs.existsSync(staticResExtracted)) {
            const staticResTarget = path.join(process.cwd(), 'force-app/main/default/staticresources');
            try {
                fsExtra.mkdirpSync(staticResTarget);
                const resFiles = fs.readdirSync(staticResExtracted);
                await Promise.all(resFiles.map(async (file) => {
                    const src = path.join(staticResExtracted, file);
                    const dest = path.join(staticResTarget, file);
                    if (fs.existsSync(dest)) {
                        this.log(`⚠️  Fichier staticresource "${file}" déjà présent dans ${staticResTarget}, non écrasé.`);
                    }
                    else {
                        try {
                            await fsExtra.move(src, dest, { overwrite: false });
                            this.log(`✅ Staticresource "${file}" copié dans ${staticResTarget}`);
                        }
                        catch (error) {
                            this.log(`❌ Erreur lors de la copie de staticresource "${file}": ${error instanceof Error ? error.message : String(error)}`);
                        }
                    }
                }));
            }
            catch (error) {
                this.log(`❌ Erreur lors du traitement des staticresources: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
}
RegistryDownload.summary = 'Télécharge un composant LWC ou une classe Apex depuis un registre externe (avec menu interactif).';
RegistryDownload.examples = ['$ sf registry download'];
export default RegistryDownload;
function getItemType(itemName, registry) {
    if (registry.component.some((c) => c.name === itemName))
        return 'component';
    if (registry.class.some((c) => c.name === itemName))
        return 'class';
    return null;
}
//# sourceMappingURL=download.js.map