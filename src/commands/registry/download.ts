import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import fetch from 'node-fetch';
import unzipper from 'unzipper';
import { SfCommand } from '@salesforce/sf-plugins-core';
import fsExtra from 'fs-extra';
import { SERVER_URL } from '../../utils/constants.js';
import { fetchCatalog, getCleanTypeLabel, getNonEmptyItemsOrError, findEntryOrError, safeRemove, getDestination } from '../../utils/functions.js';
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
    await this.downloadAndExtract(SERVER_URL, type, name, version, targetDirectory);
    } catch (error) {
      this.error(`❌ Erreur inattendue: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async downloadAndExtract(
    server: string,
    type: string,
    name: string,
    version: string,
    targetDirectory: string 
  ): Promise<void> {

    const url = `${server}/download/${type}/${name}/${version}`;
    const zipPath = path.join(os.tmpdir(), `${name}-${version}-${randomUUID()}.zip`);
    const tmpExtractPath = path.join(os.tmpdir(), `registry-download-${randomUUID()}`);
    this.log(`📥 Téléchargement depuis ${url}...`);
    try {
      const res = await fetch(url);
      if (!res.ok) this.error(`❌ Erreur HTTP ${res.status}: ${res.statusText}`);
      if (!res.body) this.error('Réponse HTTP sans body !');

      // 1. Téléchargement du zip (stream direct disque)
      const fileStream = fs.createWriteStream(zipPath);
      await new Promise<void>((resolve, reject) => {
        res.body!.pipe(fileStream);
        res.body!.on('error', reject);
        fileStream.on('finish', resolve);
        fileStream.on('error', reject);
      });
  
      // 2. Extraction avec unzipper (promesse manuelle pour TS)
      await fs.promises.mkdir(tmpExtractPath, { recursive: true });
      await new Promise<void>((resolve, reject) => {
        fs.createReadStream(zipPath)
          .pipe(unzipper.Extract({ path: tmpExtractPath }))
          .on('close', resolve)
          .on('error', reject);
      });
  
      // 3. Traitement métier custom
      await this.handleExtraction(tmpExtractPath, targetDirectory);

      this.log('✅ Tous les items ont été extraits au bon endroit !');

    } catch (error) {
      this.error(`❌ Erreur inattendue: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await safeRemove.call(this,zipPath)
      await safeRemove.call(this,tmpExtractPath)
    }
  }

  
  private async handleExtraction(
    tmpExtractPath: string,
    targetDirectory: string 
  ): Promise<void> {
    // 1. Extraction des composants/classes
    const extractedDirs = 
    fs.readdirSync(tmpExtractPath, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'staticresources')
      .map((e) => e.name);

    await Promise.all(
      extractedDirs.map(async (itemName) => {
        try {
          const sourceDir = path.join(tmpExtractPath,itemName)
          const itemType = this.getItemTypeFromFiles(sourceDir);
          const destinationDir = getDestination(targetDirectory,itemType,itemName)

          if (fs.existsSync(destinationDir)) {
            this.error(`❌  ${itemType} "${itemName}" existe déjà dans ${destinationDir}. Ignoré.`);
          }

          await fsExtra.move(sourceDir, destinationDir, { overwrite: false });
          this.log(`✅ ${itemType} "${itemName}" extrait dans ${destinationDir}`);
        } catch (error) {
          this.error(`❌ Erreur lors de l'extraction de "${itemName}": ${error instanceof Error ? error.message : String(error)}`);
        }
      })
    );

    // 2. Gestion des staticresources (parallèle)
    try {
      const staticResExtracted = path.join(tmpExtractPath, 'staticresources');
      if (!fs.existsSync(staticResExtracted)) {
        return; 
      }
      const staticResTarget = path.join(targetDirectory,'staticresources');
      fsExtra.mkdirpSync(staticResTarget);
      const resFiles = fs.readdirSync(staticResExtracted);
      await Promise.all(resFiles.map(file => this.copyStaticResource(file, staticResExtracted, staticResTarget)));
    } catch (error) {
      this.error(`❌ Erreur lors du traitement des staticresources: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getItemTypeFromFiles(dirPath: string): 'component' | 'class' {
    const classExtensions = ['.cls']
    const componentExtensions = ['.ts', '.js']
    const files = fs.readdirSync(dirPath);
    if (files.some(file => classExtensions.some(extension => file.endsWith(extension)))) {
      return 'class';
    } else if (files.some(file => componentExtensions.some(extension => file.endsWith(extension)))) {
      return 'component';
    }
    this.error('❌ Erreur fichiers non reconnus lors de l extraction du zip')
  }

  private async copyStaticResource(
    file: string,
    srcDir: string,
    destDir: string,
  ): Promise<void> {
    try {
      const src = path.join(srcDir, file);
      const dest = path.join(destDir, file);
      if (fs.existsSync(dest)) {
        this.log(`⚠️  Fichier staticresource "${file}" déjà présent dans ${destDir}, non écrasé.`);
        return;
      }
      await fsExtra.move(src, dest, { overwrite: false });
      this.log(`✅ Staticresource "${file}" copié dans ${destDir}`);
    } catch (error) {
      this.error(`❌ Erreur lors de la copie de staticresource "${file}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

