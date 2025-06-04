import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import fetch from 'node-fetch';
import AdmZip from 'adm-zip';
import inquirer from 'inquirer';
import { SfCommand } from '@salesforce/sf-plugins-core';
import * as fsExtra from 'fs-extra';
import { Registry } from '../../utils/types.js';
import { SERVER_URL } from '../../utils/constants.js';
import { fetchCatalog, promptComponentOrClass, promptSelectName } from '../../utils/functions.js';

export default class RegistryDownload extends SfCommand<void> {
  // eslint-disable-next-line sf-plugin/no-hardcoded-messages-commands
  public static readonly summary =
    'Télécharge un composant LWC ou une classe Apex depuis un registre externe (avec menu interactif).';
  public static readonly examples = ['$ sf registry download'];

  public async run(): Promise<void> {
    const type = await promptComponentOrClass('Que veux-tu télécharger ?');

    const resultFetchCatalog = await fetchCatalog(SERVER_URL);
    if (!resultFetchCatalog.ok) {
      this.error(`Erreur lors de la récupération du catalogue : ${resultFetchCatalog.error}`);
    }
    const catalog = resultFetchCatalog.data;

    // 3. Sélection de l’élément à télécharger
    const entries = catalog[type];
    const label = type === 'component' ? 'Composant LWC' : 'Classe Apex';

    if (!entries.length) this.error(`❌ Aucun ${label} disponible dans le registre.`);

    const name = await promptSelectName(`Quel ${label} veux-tu télécharger ?`, entries.map(e => e.name));


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
        choices: ['force-app/main/default/', 'Autre...'],
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
      await this.downloadAndExtract(SERVER_URL, type, name, version, catalog, customTarget);
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
    customTarget: string | null
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
    customTarget: string | null
  ): Promise<void> {
    // 1. Extraction des composants/classes
    const extractedDirs = fs
      .readdirSync(tmpExtractPath, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'staticresources')
      .map((e) => e.name);

    await Promise.all(
      extractedDirs.map(async (itemName) => {
        if (itemName === 'staticresources') return;
        const itemType = getItemType(itemName, registry);
        if (!itemType) {
          this.log(`⚠️ Type inconnu pour "${itemName}", ignoré.`);
          return;
        }

        let destDir: string;
        if (customTarget) {
          const base = path.isAbsolute(customTarget) ? customTarget : path.join(process.cwd(), customTarget);
          destDir = path.join(base, itemName);
        } else if (itemType === 'component') {
          destDir = path.join(process.cwd(), 'force-app/main/default/lwc', itemName);
        } else {
          destDir = path.join(process.cwd(), 'force-app/main/default/classes', itemName);
        }

        if (fs.existsSync(destDir)) {
          this.log(`⚠️  ${itemType} "${itemName}" existe déjà dans ${destDir}. Ignoré.`);
          return;
        }

        try {
          await fsExtra.move(path.join(tmpExtractPath, itemName), destDir, { overwrite: false });
          this.log(`✅ ${itemType} "${itemName}" extrait dans ${destDir}`);
        } catch (error) {
          this.log(
            `❌ Erreur lors de l'extraction de "${itemName}": ${error instanceof Error ? error.message : String(error)}`
          );
        }
      })
    );

    // 2. Gestion des staticresources (parallèle)
    const staticResExtracted = path.join(tmpExtractPath, 'staticresources');
    if (fs.existsSync(staticResExtracted)) {
      const staticResTarget = path.join(process.cwd(), 'force-app/main/default/staticresources');
      try {
        fsExtra.mkdirpSync(staticResTarget);
        const resFiles = fs.readdirSync(staticResExtracted);

        await Promise.all(
          resFiles.map(async (file) => {
            const src = path.join(staticResExtracted, file);
            const dest = path.join(staticResTarget, file);
            if (fs.existsSync(dest)) {
              this.log(`⚠️  Fichier staticresource "${file}" déjà présent dans ${staticResTarget}, non écrasé.`);
            } else {
              try {
                await fsExtra.move(src, dest, { overwrite: false });
                this.log(`✅ Staticresource "${file}" copié dans ${staticResTarget}`);
              } catch (error) {
                this.log(
                  `❌ Erreur lors de la copie de staticresource "${file}": ${
                    error instanceof Error ? error.message : String(error)
                  }`
                );
              }
            }
          })
        );
      } catch (error) {
        this.log(
          `❌ Erreur lors du traitement des staticresources: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
}

function getItemType(itemName: string, registry: Registry): 'component' | 'class' | null {
  if (registry.component.some((c) => c.name === itemName)) return 'component';
  if (registry.class.some((c) => c.name === itemName)) return 'class';
  return null;
}
