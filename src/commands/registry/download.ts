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
    const server = 'http://192.168.1.50:3000';

    // 🔍 Étape 1 : Récupère les composants
    const components = await fetch(`${server}/components`).then((res) => res.json() as Promise<RegistryResponse>);

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
    const info = await fetch(`${server}/info/${name}`).then((res) => res.json() as Promise<ComponentInfoResponse>);

    const versionPrompt = await inquirer.prompt<{ version: string }>([
      {
        name: 'version',
        type: 'list',
        message: `Quelle version de ${name} ?`,
        choices: info.versions.reverse(),
      },
    ]);
    const version = versionPrompt.version;

    // 📂 Étape 3 : Choix du dossier
    const baseChoices = ['components', 'downloads', 'temp', 'Autre...'];

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
    const extractPath = path.isAbsolute(target) ? path.join(target, name) : path.join(process.cwd(), target, name);

    this.log(`📥 Téléchargement depuis ${url}...`);
    const res = await fetch(url);
    if (!res.ok) {
      this.error(`❌ Erreur HTTP ${res.status}: ${res.statusText}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    await mkdir('/tmp', { recursive: true });
    await fs.promises.writeFile(zipPath, buffer);

    await rm(extractPath, { recursive: true, force: true });
    await mkdir(extractPath, { recursive: true });

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractPath, true);

    this.log(`✅ Composant ${name}@${version} extrait dans ${extractPath}`);
    await fs.promises.rm(zipPath, { force: true });
  }
}
