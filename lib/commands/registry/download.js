import path from 'node:path';
import fs from 'node:fs';
import { createWriteStream, createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import fetch from 'node-fetch';
import unzipper from 'unzipper';
import { SfCommand } from '@salesforce/sf-plugins-core';
import fsExtra from 'fs-extra';
import { SERVER_URL } from '../../utils/constants.js';
import { fetchCatalog, getCleanTypeLabel, getNonEmptyItemsOrError, findEntryOrError, safeRemove, getDestination } from '../../utils/functions.js';
import { promptComponentOrClass, promptSelectName, promptSelectVersion, promptTargetDirectory } from '../../utils/prompts.js';
class RegistryDownload extends SfCommand {
    async run() {
        const tmpDir = path.join(os.tmpdir(), `registry-download-${randomUUID()}`);
        let zipPath;
        try {
            const type = await promptComponentOrClass('Que veux-tu télécharger ?');
            const catalog = await fetchCatalog.call(this, SERVER_URL);
            const cleanType = getCleanTypeLabel(type, false);
            const entries = getNonEmptyItemsOrError.call(this, catalog, type, cleanType, 'à télécharger');
            const name = await promptSelectName(`Quel ${cleanType} veux-tu télécharger ?`, entries.map((e) => e.name));
            const entry = findEntryOrError.call(this, entries, name);
            const version = await promptSelectVersion(entry, name);
            const targetDirectory = await promptTargetDirectory();
            zipPath = await this.downloadZip(SERVER_URL, type, name, version);
            await extractZip(zipPath, tmpDir);
            await this.handleExtraction(tmpDir, targetDirectory);
            this.log('✅ Téléchargement et extraction terminés avec succès !');
        }
        catch (error) {
            this.error(`❌ Le téléchargement a échoué : ${error instanceof Error ? error.message : String(error)}`);
        }
        finally {
            // Nettoyage final
            await Promise.all([
                zipPath ? safeRemove.call(this, zipPath) : Promise.resolve(),
                safeRemove.call(this, tmpDir),
            ]);
        }
    }
    async downloadZip(server, type, name, version) {
        const url = `${server}/download/${type}/${name}/${version}`;
        const zipPath = path.join(os.tmpdir(), `${name}-${version}-${randomUUID()}.zip`);
        this.log(`📥 Téléchargement depuis ${url}...`);
        const res = await fetch(url);
        if (!res.ok)
            throw new Error(`Erreur HTTP ${res.status}: ${res.statusText}`);
        if (!res.body)
            throw new Error('Réponse HTTP sans body !');
        const fileStream = createWriteStream(zipPath);
        // Utilisation de stream.finished pour une gestion plus propre
        await new Promise((resolve, reject) => {
            res.body.pipe(fileStream).on('error', reject).on('finish', resolve);
        });
        return zipPath;
    }
    async handleExtraction(tmpExtractPath, targetDirectory) {
        const allEntries = await fs.promises.readdir(tmpExtractPath, { withFileTypes: true });
        // 1. Extraction des composants/classes
        const componentAndClassDirs = allEntries
            .filter((e) => e.isDirectory() && e.name !== 'staticresources')
            .map((e) => e.name);
        await Promise.all(componentAndClassDirs.map(async (itemName) => {
            const sourceDir = path.join(tmpExtractPath, itemName);
            const itemType = await getItemTypeFromFiles(sourceDir);
            const destinationDir = getDestination(targetDirectory, itemType, itemName);
            // fsExtra.exists est déprécié, il vaut mieux tenter et attraper l'erreur
            await fsExtra.move(sourceDir, destinationDir, { overwrite: false }).catch((err) => {
                if (err instanceof Error && err.message.includes('dest already exists')) {
                    this.warn(`⚠️  ${itemType} "${itemName}" existe déjà. Extraction ignorée.`);
                }
                else {
                    throw err; // Relancer les autres erreurs
                }
            });
            this.log(`✅ ${itemType} "${itemName}" extrait dans ${destinationDir}`);
        }));
        // 2. Gestion des staticresources
        const staticResExtracted = path.join(tmpExtractPath, 'staticresources');
        if (!(await fileExists(staticResExtracted)))
            return;
        const staticResTarget = path.join(targetDirectory, 'staticresources');
        await fsExtra.ensureDir(staticResTarget);
        const resFiles = await fs.promises.readdir(staticResExtracted);
        await Promise.all(resFiles.map(file => this.copyStaticResource(file, staticResExtracted, staticResTarget)));
    }
    async copyStaticResource(file, srcDir, destDir) {
        const src = path.join(srcDir, file);
        const dest = path.join(destDir, file);
        try {
            await fsExtra.move(src, dest, { overwrite: false });
            this.log(`✅ Staticresource "${file}" copiée dans ${destDir}`);
        }
        catch (error) {
            if (error instanceof Error && error.message.includes('dest already exists')) {
                this.warn(`⚠️  Fichier staticresource "${file}" déjà présent. Copie ignorée.`);
            }
            else {
                throw error; // Relancer les autres erreurs
            }
        }
    }
}
// eslint-disable-next-line sf-plugin/no-hardcoded-messages-commands
RegistryDownload.summary = 'Télécharge un composant LWC ou une classe Apex depuis un registre externe (avec menu interactif).';
RegistryDownload.examples = ['$ sf registry download'];
export default RegistryDownload;
async function fileExists(filePath) {
    try {
        await fs.promises.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
async function extractZip(zipPath, extractPath) {
    await fs.promises.mkdir(extractPath, { recursive: true });
    const stream = createReadStream(zipPath).pipe(unzipper.Extract({ path: extractPath }));
    await new Promise((resolve, reject) => {
        stream.on('close', resolve).on('error', reject);
    });
}
async function getItemTypeFromFiles(dirPath) {
    const files = await fs.promises.readdir(dirPath);
    if (files.some(file => file.endsWith('.cls')))
        return 'class';
    if (files.some(file => file.endsWith('.js') || file.endsWith('.ts')))
        return 'component';
    throw new Error(`Type de source non reconnu dans le dossier ${dirPath}`);
}
//# sourceMappingURL=download.js.map