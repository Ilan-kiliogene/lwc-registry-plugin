import path from 'node:path';
import fs from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import fetch from 'node-fetch';
import AdmZip from 'adm-zip';
import inquirer from 'inquirer';
import { SfCommand } from '@salesforce/sf-plugins-core';

export type RegistryVersion = {
  version: string;
  registryDependencies: string[];
};

export type RegistryItem = {
  name: string;
  description: string;
  versions: RegistryVersion[];
};

export type RegistryResponse = {
  name: string;
  items: RegistryItem[];
};

export type ComponentInfoResponse = {
  name: string;
  description: string;
  versions: string[];
};

export default class RegistryDownload extends SfCommand<void> {
  public static readonly summary = 'Télécharge un composant LWC depuis un registre externe (avec menu interactif).';

  public async run(): Promise<void> {
    const server = 'https://registry.kiliogene.com';

    // 🔍 Étape 1 : Récupère les composants
    const componentsResponse = await fetch(`${server}/components`);
    const components = (await componentsResponse.json()) as RegistryResponse;

    const response = await inquirer.prompt<{ name: string }>([
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
    const info = (await infoResponse.json()) as RegistryItem;
    this.log(`🧪 info reçu : ${JSON.stringify(info, null, 2)}`);

    const versionPrompt = await inquirer.prompt<{ version: string }>([
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

    const choicePrompt = await inquirer.prompt<{ choice: string }>([
      {
        name: 'choice',
        type: 'list',
        message: 'Dossier cible ?',
        choices: baseChoices,
      },
    ]);
    const choice = choicePrompt.choice;

    let target: string;

    if (choice === 'Autre...') {
      const targetPrompt = await inquirer.prompt<{ target: string }>([
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

    const buffer = Buffer.from(await res.arrayBuffer());
    await mkdir('/tmp', { recursive: true });
    await fs.promises.writeFile(zipPath, buffer);

    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();

    // Si l’archive contient un dossier racine (ex: `myComponent/`)
    if (zipEntries.length > 0 && zipEntries[0].entryName.includes('/')) {
      const rootDir = zipEntries[0].entryName.split('/')[0];
      const targetComponentPath = path.join(extractPath, rootDir);

      // Supprimer uniquement l’ancien composant s’il existe
      await rm(targetComponentPath, { recursive: true, force: true });
    }

    // Extraire dans `lwc/`
    zip.extractAllTo(extractPath, true);

    this.log(`✅ Composant ${name}@${version} extrait dans ${extractPath}`);
    await fs.promises.rm(zipPath, { force: true });
  }
}
