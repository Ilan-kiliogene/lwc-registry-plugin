import path from 'node:path';
import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'os'
import fetch from 'node-fetch';
import AdmZip from 'adm-zip';
import inquirer from 'inquirer';
import { SfCommand } from '@salesforce/sf-plugins-core';
import * as fsExtra from 'fs-extra';
import { Registry, registrySchema } from '../../types/registry';


export default class RegistryDownload extends SfCommand<void> {
  public static readonly summary = 'Télécharge un composant LWC ou une classe Apex depuis un registre externe (avec menu interactif).';
  public static readonly examples = ['$ sf registry download'];

  public async run(): Promise<void> {
    const server = 'https://registry.kiliogene.com';
    let registry: Registry;

    // 1. Choix du type à télécharger
    const { type } = await inquirer.prompt<{ type: 'component' | 'class' }>([
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

    // 2. Récupération du registre complet
    try {
      const response = await fetch(`${server}/catalog`);
      if (!response.ok) this.error(`Erreur ${response.status} lors de la récupération du registre : ${response.statusText}`);
      const json = await response.json();
      registry = registrySchema.parse(json);
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }

    // 3. Sélection de l’élément à télécharger
    const entries = registry[type];
    const label = type === 'component' ? 'Composant LWC' : 'Classe Apex';

    if (!entries.length) this.error(`❌ Aucun ${label} disponible dans le registre.`);

    const { name } = await inquirer.prompt<{ name: string }>([
      {
        name: 'name',
        type: 'list',
        message: `Quel ${label} veux-tu télécharger ?`,
        choices: entries.map((element) => element.name),
      },
    ]);

    // 4. Sélection de la version
    const entry = entries.find((element) => element.name === name);
    if (!entry) this.error(`❌ ${label} "${name}" non trouvé dans le registre.`);
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
          'force-app/main/default/',
          'Autre...',
        ],
      },
    ]);

    let customTarget: string | null = null;
    if (choice === 'Autre...') {
      const { target } = await inquirer.prompt<{ target: string }>([
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
      await this.downloadAndExtract(server, type, name, version, registry, customTarget);
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
  }

  private async downloadAndExtract(
    server: string,
    type: string,
    name: string,
    version: string,
    registry: Registry,
    customTarget: string | null,
  ): Promise<void> {
    const url = `${server}/download/${type}/${name}/${version}`;
    const zipPath = path.join(os.tmpdir(), `${name}-${version}-${randomUUID()}.zip`);
    const tmpExtractPath = path.join(os.tmpdir(), `registry-download-${randomUUID()}`);

    this.log(`📥 Téléchargement depuis ${url}...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`❌ Erreur HTTP ${res.status}: ${res.statusText}`);

    try {
      const buffer = Buffer.from(await res.arrayBuffer());
      await fs.promises.writeFile(zipPath, buffer);

      const zip = new AdmZip(zipPath);
      zip.extractAllTo(tmpExtractPath, true);

      // Extraction et déplacement factorisé
      await this.handleExtraction(tmpExtractPath, registry, customTarget);

      this.log('✅ Tous les items ont été extraits au bon endroit !');
    } finally {
      await fsExtra.remove(zipPath).catch(() => {});
      await fsExtra.remove(tmpExtractPath).catch(() => {});
    }
  }

  private async handleExtraction(
    tmpExtractPath: string,
    registry: Registry,
    customTarget: string | null,
  ): Promise<void> {
    const extractedDirs = fs
      .readdirSync(tmpExtractPath, { withFileTypes: true })
      .filter((element) => element.isDirectory())
      .map((element) => element.name);

    for (const itemName of extractedDirs) {
      if (itemName === 'staticresources') continue;
      const itemType = getItemType(itemName, registry);
      if (!itemType) {
        this.log(`⚠️ Type inconnu pour ${itemName}, ignoré`);
        continue;
      }

      let destDir: string;
      if (customTarget) {
        destDir = path.join(
          path.isAbsolute(customTarget) ? customTarget : path.join(process.cwd(), customTarget),
          itemName,
        );
      } else if (itemType === 'component') {
        destDir = path.join(process.cwd(), 'force-app/main/default/lwc', itemName);
      } else {
        destDir = path.join(process.cwd(), 'force-app/main/default/classes', itemName);
      }

      if (fs.existsSync(destDir)) {
        this.error(`❌ ${itemType} "${itemName}" existe déjà dans ${destDir}.`);
      }
      await fsExtra.move(path.join(tmpExtractPath, itemName), destDir);
      this.log(`✅ ${itemType} "${itemName}" extrait dans ${destDir}`);
    }

    // Gestion des staticresources
    const staticResExtracted = path.join(tmpExtractPath, 'staticresources');
    if (fs.existsSync(staticResExtracted)) {
      const staticResTarget = path.join(process.cwd(), 'force-app/main/default/staticresources');
      fsExtra.mkdirpSync(staticResTarget);
      const resFiles = fs.readdirSync(staticResExtracted);
      for (const file of resFiles) {
        const src = path.join(staticResExtracted, file);
        const dest = path.join(staticResTarget, file);
        if (fs.existsSync(dest)) {
          this.log(`⚠️ Fichier staticresource "${file}" déjà présent dans ${staticResTarget}, non écrasé.`);
        } else {
          await fsExtra.move(src, dest);
          this.log(`✅ Staticresource "${file}" copié dans ${staticResTarget}`);
        }
      }
    }
  }
}

function getItemType(itemName: string, registry: Registry): 'component' | 'class' | null {
  if (registry.component.some((c) => c.name === itemName)) return 'component';
  if (registry.class.some((c) => c.name === itemName)) return 'class';
  return null;
}
