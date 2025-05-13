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
        // Étape 1 : Choix du type
        const { type } = await inquirer.prompt([
            {
                name: 'type',
                type: 'list',
                message: 'Que veux-tu déployer ?',
                choices: ['composant', 'classe'],
            },
        ]);
        const basePath = type === 'composant'
            ? 'force-app/main/default/lwc'
            : 'force-app/main/default/classes';
        // Étape 2 : Liste des fichiers ou dossiers
        const items = fs.readdirSync(basePath, { withFileTypes: true })
            .filter((entry) => type === 'composant' ? entry.isDirectory() : entry.isFile() && entry.name.endsWith('.cls'))
            .map((entry) => type === 'composant' ? entry.name : entry.name.replace(/\.cls$/, ''));
        if (items.length === 0) {
            this.error(`❌ Aucun ${type} trouvé dans ${basePath}`);
        }
        // Étape 3 : Sélection du composant ou de la classe
        const { name } = await inquirer.prompt([
            {
                name: 'name',
                type: 'list',
                message: `Quel ${type} veux-tu déployer ?`,
                choices: items,
            },
        ]);
        // Étape 4 : Métadonnées
        let metadata;
        if (type === 'composant') {
            const answers = await inquirer.prompt([
                { name: 'description', message: 'Description ?', type: 'input' },
                { name: 'tags', message: 'Tags (séparés par des virgules) ?', type: 'input' },
                { name: 'isModal', message: 'Est-ce un LightningModal ?', type: 'confirm' },
            ]);
            metadata = answers;
        }
        else {
            const answers = await inquirer.prompt([
                { name: 'description', message: 'Description ?', type: 'input' },
                { name: 'tags', message: 'Tags (séparés par des virgules) ?', type: 'input' },
            ]);
            metadata = answers;
        }
        // Étape 5 : Vérification du chemin
        const fullPath = path.join(basePath, name);
        if (!fs.existsSync(fullPath)) {
            this.error(`❌ Fichier ou dossier introuvable : ${fullPath}`);
        }
        // Étape 6 : Création du zip
        const zip = new AdmZip();
        if (type === 'composant') {
            zip.addLocalFolder(fullPath, name);
        }
        else {
            const clsFile = `${fullPath}.cls`;
            if (!fs.existsSync(clsFile)) {
                this.error(`❌ Fichier classe introuvable : ${clsFile}`);
            }
            zip.addLocalFile(clsFile);
        }
        const tmpDir = '/tmp';
        await mkdir(tmpDir, { recursive: true });
        const zipPath = path.join(tmpDir, `${name}-${Date.now()}.zip`);
        zip.writeZip(zipPath);
        // Étape 7 : Préparation de l'envoi
        const form = new FormData();
        form.append('componentZip', fs.createReadStream(zipPath));
        form.append('name', name);
        form.append('description', metadata.description);
        form.append('tags', metadata.tags);
        form.append('type', type);
        if (type === 'composant') {
            form.append('isModal', String(metadata.isModal));
        }
        this.log(`📤 Envoi de ${name} (${type}) vers ${server}/deploy...`);
        const res = await fetch(`${server}/deploy`, {
            method: 'POST',
            body: form,
            headers: form.getHeaders(),
        });
        if (!res.ok) {
            this.error(`❌ Échec HTTP ${res.status} : ${res.statusText}`);
        }
        const resultText = await res.text();
        this.log(`✅ Serveur : ${resultText}`);
        await rm(zipPath, { force: true });
    }
}
RegistryDeploy.summary = 'Déploie un composant LWC ou une classe Apex sur le registre externe';
export default RegistryDeploy;
//# sourceMappingURL=deploy.js.map