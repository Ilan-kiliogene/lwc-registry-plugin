import path from 'node:path';
import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import fetch from 'node-fetch';
import AdmZip from 'adm-zip';
import inquirer from 'inquirer';
import { SfCommand } from '@salesforce/sf-plugins-core';

/** Types partagés avec le serveur */
export interface RegistryVersion {
  version: string;
  description: string;
  hash: string;
  registryDependencies: string[];
}

export interface RegistryEntry {
  name: string;
  versions: RegistryVersion[];
}

export interface RegistryResponse {
  name: string;
  components: RegistryEntry[];
  classes: RegistryEntry[];
}

export default class RegistryDownload extends SfCommand<void> {
  public static readonly summary =
    'Télécharge un composant LWC ou une classe Apex depuis un registre externe (avec menu interactif).';

  public async run(): Promise<void> {
    const server = 'https://registry.kiliogene.com';

    // 🔍 Étape 1 : choix du type
    const { type } = await inquirer.prompt<{ type: 'components' | 'classes' }>([
      {
        name: 'type',
        type: 'list',
        message: 'Que veux-tu télécharger ?',
        choices: ['components', 'classes'],
      },
    ]);

    // 🔍 Étape 2 : récupération des données du registre
    const response = await fetch(`${server}/components`);
    if (!response.ok) {
      this.error(`❌ Erreur HTTP ${response.status}: ${response.statusText}`);
    }

    const registry = (await response.json()) as RegistryResponse;
    const entries = type === 'components' ? registry.components : registry.classes;

    if (entries.length === 0) {
      this.error(`❌ Aucun ${type} disponible dans le registre.`);
    }

    const { name } = await inquirer.prompt<{ name: string }>([
      {
        name: 'name',
        type: 'list',
        message: `Quel ${type} veux-tu télécharger ?`,
        choices: entries.map((e) => e.name),
      },
    ]);

    // 🔢 Étape 3 : récupération des infos sur l’élément
    const infoRes = await fetch(`${server}/info/${type}/${name}`);
    if (!infoRes.ok) {
      this.error(`❌ Erreur HTTP ${infoRes.status}: ${infoRes.statusText}`);
    }

    const info = (await infoRes.json()) as RegistryEntry;
    this.log(`🧪 info reçu : ${JSON.stringify(info, null, 2)}`);

    const { version } = await inquirer.prompt<{ version: string }>([
      {
        name: 'version',
        type: 'list',
        message: `Quelle version de ${name} ?`,
        choices: info.versions.map((v) => v.version).reverse(),
      },
    ]);

    // 📂 Étape 4 : dossier de destination
    const baseChoices = [
      type === 'components' ? 'force-app/main/default/lwc' : 'force-app/main/default/classes',
      'Autre...',
    ];

    const { choice } = await inquirer.prompt<{ choice: string }>([
      {
        name: 'choice',
        type: 'list',
        message: 'Dossier cible ?',
        choices: baseChoices,
      },
    ]);

    let target: string;
    if (choice === 'Autre...') {
      const { target: custom } = await inquirer.prompt<{ target: string }>([
        {
          name: 'target',
          type: 'input',
          message: 'Tape un chemin :',
        },
      ]);
      target = custom;
    } else {
      target = choice;
    }

    // 📥 Étape 5 : téléchargement et extraction
    const url = `${server}/download/${type}/${name}/${version}`;
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
        const targetPath = path.join(extractPath, rootDir);

        if (fs.existsSync(targetPath)) {
          this.error(`❌ ${type} "${rootDir}" existe déjà dans ${extractPath}.`, { exit: 1 });
        }
      }

      zip.extractAllTo(extractPath, true);
      this.log(`✅ ${type} ${name}@${version} extrait dans ${extractPath}`);
    } finally {
      await fs.promises.rm(zipPath, { force: true }).catch(() => {});
    }
  }
}
