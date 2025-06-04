import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import fetch from 'node-fetch';
import AdmZip from 'adm-zip';
import { SfCommand } from '@salesforce/sf-plugins-core';
import * as fsExtra from 'fs-extra';
import { Registry } from '../../utils/types.js';
import { SERVER_URL } from '../../utils/constants.js';
import { fetchCatalog, getCleanTypeLabel, getNonEmptyItemsOrError, findEntryOrError } from '../../utils/functions.js';
import { promptComponentOrClass, promptSelectName, promptSelectVersion, promptTargetDirectory } from '../../utils/prompts.js';


export default class RegistryDownload extends SfCommand<void> {
  // eslint-disable-next-line sf-plugin/no-hardcoded-messages-commands
  public static readonly summary ='Télécharge un composant LWC ou une classe Apex depuis un registre externe (avec menu interactif).';
  public static readonly examples = ['$ sf registry download'];

  public async run(): Promise<void> {
    try {
    const type = await promptComponentOrClass('Que veux-tu télécharger ?');
    const catalog = await fetchCatalog.call(this,SERVER_URL);
    const cleanType = getCleanTypeLabel(type,false );
    const entries = getNonEmptyItemsOrError.call(this,catalog,type,cleanType,'à télécharger');
    const name = await promptSelectName(`Quel ${cleanType} veux-tu télécharger ?`, entries.map(e => e.name));
    const entry = findEntryOrError.call(this,entries,name);
    const version = await promptSelectVersion(entry, name);
    const targetDirectory = await promptTargetDirectory();
    await this.downloadAndExtract(SERVER_URL, type, name, version, catalog, targetDirectory);
    } catch (error) {
      this.error(`❌ Erreur inattendue: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async downloadAndExtract(
    server: string,
    type: string,
    name: string,
    version: string,
    registry: Registry,
    targetDirectory: string 
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
      await this.handleExtraction(tmpExtractPath, registry, targetDirectory);

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
