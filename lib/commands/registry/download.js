import path from 'node:path';
import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import fetch from 'node-fetch';
import AdmZip from 'adm-zip';
import inquirer from 'inquirer';
import { SfCommand } from '@salesforce/sf-plugins-core';
class RegistryDownload extends SfCommand {
  async run() {
    const server = 'https://registry.kiliogene.com';
    // 🔍 Étape 1 : Récupère les composants
    const componentsResponse = await fetch(`${server}/components`);
    const components = await componentsResponse.json();
    const response = await inquirer.prompt([
      {
        name: 'name',
        type: 'list',
        message: 'Quel composant veux-tu télécharger ?',
        choices: components.items.map((item) => item.name),
      },
    ]);
    const name = response.name;
    // 🔢 Étape 2 : Récupère les versions du composant sélectionné
    const infoResponse = await fetch(`${server}/info/${name}`);
    const info = await infoResponse.json();
    this.log(`🧪 info reçu : ${JSON.stringify(info, null, 2)}`);
    const versionPrompt = await inquirer.prompt([
      {
        name: 'version',
        type: 'list',
        message: `Quelle version de ${name} ?`,
        choices: info.versions.map((v) => v.version).reverse(),
      },
    ]);
    const version = versionPrompt.version;
    // 📂 Étape 3 : Choix du dossier
    const baseChoices = ['force-app/main/default/lwc', 'Autre...'];
    const choicePrompt = await inquirer.prompt([
      {
        name: 'choice',
        type: 'list',
        message: 'Dossier cible ?',
        choices: baseChoices,
      },
    ]);
    const choice = choicePrompt.choice;
    let target;
    if (choice === 'Autre...') {
      const targetPrompt = await inquirer.prompt([
        {
          name: 'target',
          type: 'input',
          message: 'Tape un chemin :',
        },
      ]);
      target = targetPrompt.target;
    } else {
      target = choice;
    }
    const url = `${server}/download/${name}/${version}`;
    const zipPath = path.join('/tmp', `${name}-${version}.zip`);
    const extractPath = path.isAbsolute(target) ? target : path.join(process.cwd(), target);
    this.log(`📥 Téléchargement depuis ${url}...`);
    const res = await fetch(url);
    if (!res.ok) {
      this.error(`❌ Erreur HTTP ${res.status}: ${res.statusText}`);
    }
    try {
      const buffer = Buffer.from(await res.arrayBuffer());
      await mkdir('/tmp', { recursive: true });
      await fs.promises.writeFile(zipPath, buffer);
      const zip = new AdmZip(zipPath);
      const zipEntries = zip.getEntries();
      if (zipEntries.length > 0 && zipEntries[0].entryName.includes('/')) {
        const rootDir = zipEntries[0].entryName.split('/')[0];
        const targetComponentPath = path.join(extractPath, rootDir);
        if (fs.existsSync(targetComponentPath)) {
          this.error(`❌ Le composant "${rootDir}" existe déjà dans ${extractPath}.`, { exit: 1 });
        }
      }
      // ✅ Extraction uniquement si tout est bon
      zip.extractAllTo(extractPath, true);
      this.log(`✅ Composant ${name}@${version} extrait dans ${extractPath}`);
    } finally {
      // 🧹 Nettoyage dans tous les cas
      await fs.promises.rm(zipPath, { force: true }).catch(() => {});
    }
  }
}
RegistryDownload.summary = 'Télécharge un composant LWC depuis un registre externe (avec menu interactif).';
export default RegistryDownload;
//# sourceMappingURL=download.js.map
