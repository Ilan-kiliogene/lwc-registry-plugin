import path from 'node:path';
import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import fetch from 'node-fetch';
import AdmZip from 'adm-zip';
import inquirer from 'inquirer';
import { SfCommand } from '@salesforce/sf-plugins-core';
import * as fsExtra from 'fs-extra'; // Typage correct

type RegistryVersion = {
  version: string;
  description: string;
  hash: string;
  registryDependencies: Array<{ name: string; type: string; version: string }>;
};
type RegistryEntry = { name: string; versions: RegistryVersion[] };
type RegistryResponse = {
  name: string;
  component: RegistryEntry[];
  class: RegistryEntry[];
};

export default class RegistryDownload extends SfCommand<void> {
  public static readonly summary =
    'Télécharge un composant LWC ou une classe Apex depuis un registre externe (avec menu interactif).';
  public static readonly examples = [
    '$ sf registry download',
  ];

  public async run(): Promise<void> {
    const server = 'https://registry.kiliogene.com';

    // Étape 1 : choix du type
    const { type } = await inquirer.prompt<{ type: 'component' | 'class' }>([
      {
        name: 'type',
        type: 'list',
        message: 'Que veux-tu télécharger ?',
        choices: ['component', 'class'],
      },
    ]);

    // Étape 2 : récupération des données du registre (catalog complet)
    const response = await fetch(`${server}/catalog`);
    if (!response.ok) {
      this.error(`❌ Erreur HTTP ${response.status}: ${response.statusText}`);
    }

    const registry = (await response.json()) as RegistryResponse;
    const entries: RegistryEntry[] = type === 'component' ? registry.component : registry.class;

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

    // Étape 3 : récupération des infos sur l’élément
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

    // Étape 4 : choix du dossier cible (racine lwc/classes ou custom)
    const baseChoices = [
      'force-app/main/default/',
      'Autre...',
    ];
    const { choice } = await inquirer.prompt<{ choice: string }>([
      {
        name: 'choice',
        type: 'list',
        message: 'Dossier cible ? (les composants LWC iront dans lwc, les classes dans classes)',
        choices: baseChoices,
      },
    ]);

    let customTarget: string | null = null;
    if (choice === 'Autre...') {
      const { target: custom } = await inquirer.prompt<{ target: string }>([
        {
          name: 'target',
          type: 'input',
          message: 'Tape un chemin :',
        },
      ]);
      customTarget = custom;
    }

    // 📥 Étape 5 : téléchargement et extraction du zip
    const url = `${server}/download/${type}/${name}/${version}`;
    const zipPath = path.join('/tmp', `${name}-${version}.zip`);
    const tmpExtractPath = path.join('/tmp', `registry-download-${Date.now()}`);

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
      zip.extractAllTo(tmpExtractPath, true);

      // On veut savoir quels dossiers sont composants, lesquels sont classes
      // => On récupère la liste des dossiers extraits
      const extractedDirs = fs.readdirSync(tmpExtractPath, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

      // On mappe chaque dossier à son type via registry.json (reçu plus haut)
      for (const itemName of extractedDirs) {
        let itemType: string | null = null;

        if (registry.component.some((c) => c.name === itemName)) {
          itemType = 'component';
        } else if (registry.class.some((c) => c.name === itemName)) {
          itemType = 'class';
        } else {
          this.log(`⚠️ Type inconnu pour ${itemName}, ignoré`);
          continue;
        }

        let destDir = '';
        if (customTarget) {
          destDir = path.join(
            path.isAbsolute(customTarget) ? customTarget : path.join(process.cwd(), customTarget),
            itemName
          );
        } else if (itemType === 'component') {
          destDir = path.join(process.cwd(), 'force-app/main/default/lwc', itemName);
        } else if (itemType === 'class') {
          destDir = path.join(process.cwd(), 'force-app/main/default/classes', itemName);
        }
        if (fs.existsSync(destDir)) {
          this.error(`❌ ${itemType} "${itemName}" existe déjà dans ${destDir}.`);
        }
        // eslint-disable-next-line no-await-in-loop
        await fsExtra.move(path.join(tmpExtractPath, itemName), destDir);
        this.log(`✅ ${itemType} "${itemName}" extrait dans ${destDir}`);
      }

      this.log('✅ Tous les items ont été extraits au bon endroit !');
      await fsExtra.remove(tmpExtractPath);
    } finally {
      await fs.promises.rm(zipPath, { force: true }).catch(() => {});
    }
  }
}
