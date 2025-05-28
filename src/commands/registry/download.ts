import path from 'node:path';
import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import fetch from 'node-fetch';
import AdmZip from 'adm-zip';
import inquirer from 'inquirer';
import { SfCommand } from '@salesforce/sf-plugins-core';
import * as fsExtra from 'fs-extra';
import { Dependency } from './list';


type RegistryDependency = Readonly<{
  name: string;
  type: 'component' | 'class';
  version: string;
}>;

type RegistryVersion = Readonly<{
  version: string;
  description: string;
  hash: string;
  registryDependencies: readonly RegistryDependency[];
}>;

type RegistryEntry = Readonly<{
  name: string;
  versions: readonly RegistryVersion[];
}>;

type RegistryResponse = Readonly<{
  name: string;
  component: readonly RegistryEntry[];
  class: readonly RegistryEntry[];
}>;

export default class RegistryDownload extends SfCommand<void> {
  public static readonly summary =
    'Télécharge un composant LWC ou une classe Apex depuis un registre externe (avec menu interactif).';
  public static readonly examples = ['$ sf registry download'];

  public async run(): Promise<void> {
    const server = 'https://registry.kiliogene.com';

    // 1. Choix du type à télécharger
    const { type } = await inquirer.prompt<{ type: 'component' | 'class' }>([
      {
        name: 'type',
        type: 'list',
        message: 'Que veux-tu télécharger ?',
        choices: ['component', 'class'],
      },
    ]);

    // 2. Récupération du registre complet
    const registry = await fetchRegistry(server, this);

    const entries = type === 'component' ? registry.component : registry.class;
    if (entries.length === 0) {
      this.error(`❌ Aucun ${type} disponible dans le registre.`);
    }

    // 3. Sélection de l’élément à télécharger
    const { name } = await inquirer.prompt<{ name: string }>([
      {
        name: 'name',
        type: 'list',
        message: `Quel ${type} veux-tu télécharger ?`,
        choices: entries.map((e) => e.name),
      },
    ]);

    // 4. Sélection de la version
    const entry = entries.find((e) => e.name === name);
    if (!entry) this.error(`❌ ${type} "${name}" non trouvé dans le registre.`);

    const versions = entry.versions.map((v) => v.version).reverse();
    const { version } = await inquirer.prompt<{ version: string }>([
      {
        name: 'version',
        type: 'list',
        message: `Quelle version de ${name} ?`,
        choices: versions,
      },
    ]);

    // 5. Sélection du dossier de destination
    const { choice } = await inquirer.prompt<{ choice: string }>([
      {
        name: 'choice',
        type: 'list',
        message: 'Dossier cible ? (les composants LWC iront dans lwc, les classes dans classes)',
        choices: [
          'force-app/main/default/', // Racine standard pour SF
          'Autre...',
        ],
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

    // 6. Téléchargement et extraction
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

      // 7. Récupération de tous les dossiers extraits (composants/classes)
      const extractedDirs = fs
        .readdirSync(tmpExtractPath, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

      for (const itemName of extractedDirs) {
        const itemType = getItemType(itemName, registry);
        if (itemName === 'staticresources') continue; // Ajoute cette ligne

        if (!itemType) {
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

      // -- GESTION DES STATICRESOURCES --
      const staticResExtracted = path.join(tmpExtractPath, 'staticresources');
      if (fs.existsSync(staticResExtracted)) {
        // Dossier de destination standard Salesforce
        const staticResTarget = path.join(process.cwd(), 'force-app/main/default/staticresources');
        if (!fs.existsSync(staticResTarget)) {
          fsExtra.mkdirpSync(staticResTarget);
        }
        const resFiles = fs.readdirSync(staticResExtracted);
        for (const file of resFiles) {
          const src = path.join(staticResExtracted, file);
          const dest = path.join(staticResTarget, file);
          if (fs.existsSync(dest)) {
            this.log(`⚠️ Fichier staticresource "${file}" déjà présent dans ${staticResTarget}, non écrasé.`);
          } else {
            // eslint-disable-next-line no-await-in-loop
            await fsExtra.move(src, dest);
            this.log(`✅ Staticresource "${file}" copié dans ${staticResTarget}`);
          }
        }
      }


      this.log('✅ Tous les items ont été extraits au bon endroit !');
      await fsExtra.remove(tmpExtractPath);
    } finally {
      await fs.promises.rm(zipPath, { force: true }).catch(() => {});
      await fsExtra.remove(tmpExtractPath).catch(() => {}); // ← ajoute ce catch pour le cas où le dossier n’existerait pas
    }
  }
}

/**
 * Télécharge le catalogue du registre.
 */
async function fetchRegistry(server: string, cli: SfCommand<void>): Promise<RegistryResponse> {
  const response = await fetch(`${server}/catalog`);
  if (!response.ok) {
    cli.error(`❌ Erreur HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json() as Promise<RegistryResponse>;
}

/**
 * Détecte si un item est un composant ou une classe à partir du registry.
 */
function getItemType(itemName: string, registry: RegistryResponse): 'component' | 'class' | null {
  if (registry.component.some((c) => c.name === itemName)) return 'component';
  if (registry.class.some((c) => c.name === itemName)) return 'class';
  return null;
}
