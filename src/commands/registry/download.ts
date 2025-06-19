import path from 'node:path';
import fs from 'node:fs';
import { createWriteStream, createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import unzipper from 'unzipper';
import { SfCommand } from '@salesforce/sf-plugins-core';
import fsExtra from 'fs-extra';
import { SERVER_URL } from '../../utils/constants.js';
import {
  fetchCatalog,
  getCleanTypeLabel,
  getNonEmptyItemsOrError,
  findEntryOrError,
  safeRemove,
  getDestination,
  authedFetch,
} from '../../utils/functions.js';
import {
  promptComponentOrClass,
  promptSelectName,
  promptSelectVersion,
  promptTargetDirectory,
} from '../../utils/prompts.js';
import { AuthError } from '../../utils/errors.js';

export default class RegistryDownload extends SfCommand<void> {
  // eslint-disable-next-line sf-plugin/no-hardcoded-messages-commands
  public static readonly summary =
    'Télécharge un composant LWC ou une classe Apex depuis un registre externe (avec menu interactif).';
  public static readonly examples = ['$ sf registry download'];

  public async run(): Promise<void> {
    const tmpDir = path.join(os.tmpdir(), `registry-download-${randomUUID()}`);
    let zipPath: string | undefined;
    try {
      const type = await promptComponentOrClass('Que veux-tu télécharger ?');
      const catalog = await fetchCatalog.call(this, SERVER_URL);
      const cleanType = getCleanTypeLabel(type, false);
      const entries = getNonEmptyItemsOrError.call(this, catalog, type, cleanType, 'à télécharger');
      const name = await promptSelectName(`Quel ${cleanType} veux-tu télécharger ?`,entries.map((e) => e.name));
      const entry = findEntryOrError.call(this, entries, name);
      const version = await promptSelectVersion(entry, name);
      const targetDirectory = await promptTargetDirectory();
      zipPath = await this.downloadZip(SERVER_URL, type, name, version);
      await extractZip(zipPath, tmpDir);
      await this.handleExtraction(tmpDir, targetDirectory);
      this.log('✅ Téléchargement et extraction terminés avec succès !');
    } catch (error) {
      if (error instanceof AuthError) {
        this.error(error.message);
      }
      this.error(`❌ Le téléchargement a échoué : ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await Promise.all([zipPath ? safeRemove.call(this, zipPath) : Promise.resolve(), safeRemove.call(this, tmpDir)]);
    }
  }

  private async downloadZip(server: string, type: string, name: string, version: string): Promise<string> {
    const url = `${server}/download/${type}/${name}/${version}`;
    const zipPath = path.join(os.tmpdir(), `${name}-${version}-${randomUUID()}.zip`);
    this.log('📥 Téléchargement ...');

    const res = await authedFetch.call(this,url);
    if (!res.ok) throw new Error(`Erreur HTTP ${res.status}: ${res.statusText}`);
    if (!res.body) throw new Error('Réponse HTTP sans body !');

    const fileStream = createWriteStream(zipPath);
    await new Promise<void>((resolve, reject) => {
      res.body!.pipe(fileStream).on('error', reject).on('finish', resolve);
    });

    return zipPath;
  }

  private async handleExtraction(tmpExtractPath: string, targetDirectory: string): Promise<void> {
    const entries = await fs.promises.readdir(tmpExtractPath, { withFileTypes: true });
    const extractedDirs = entries
      .filter((e) => e.isDirectory() && e.name !== 'staticresources')
      .map((e) => e.name);

    await Promise.all(
      extractedDirs.map(async (itemName) => {
        try {
          const sourceDir = path.join(tmpExtractPath, itemName);
          const itemType = await getItemTypeFromFiles(sourceDir);
          const destinationDir = getDestination(targetDirectory, itemType, itemName);
          await fsExtra.move(sourceDir, destinationDir, { overwrite: false });
          this.log(`✅ ${itemType} "${itemName}" extrait dans ${destinationDir}`);
        } catch (err) {
          if (err instanceof Error && err.message.includes('dest already exists')) {
            this.warn(`⚠️  Un item nommé "${itemName}" existe déjà. Extraction ignorée.`);
          } else {
            throw new Error(
              `Erreur lors de l'extraction de "${itemName}": ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      })
    );
    await this.handleStaticResources(tmpExtractPath, targetDirectory);
  }

  private async handleStaticResources(tmpExtractPath: string, targetDirectory: string): Promise<void> {
    try {
      const staticResExtracted = path.join(tmpExtractPath, 'staticresources');
      if (!(await fileExists(staticResExtracted))) {
        return;
      }
      const staticResTarget = path.join(targetDirectory, 'staticresources');
      await fsExtra.ensureDir(staticResTarget);
      const resFiles = await fs.promises.readdir(staticResExtracted);
      await Promise.all(resFiles.map((file) => this.copyStaticResource(file, staticResExtracted, staticResTarget)));
    } catch (error) {
      throw new Error(
        `Erreur lors du traitement des staticresources: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async copyStaticResource(file: string, srcDir: string, destDir: string): Promise<void> {
    const src = path.join(srcDir, file);
    const dest = path.join(destDir, file);
    try {
      await fsExtra.move(src, dest, { overwrite: false });
      this.log(`✅ Staticresource "${file}" copiée dans ${destDir}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('dest already exists')) {
        this.warn(`⚠️  Fichier staticresource "${file}" déjà présent. Copie ignorée.`);
      } else {
        throw error; 
      }
    }
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function extractZip(zipPath: string, extractPath: string): Promise<void> {
  await fs.promises.mkdir(extractPath, { recursive: true });
  const stream = createReadStream(zipPath).pipe(unzipper.Extract({ path: extractPath }));
  await new Promise((resolve, reject) => {
    stream.on('close', resolve).on('error', reject);
  });
}

async function getItemTypeFromFiles(dirPath: string): Promise<'component' | 'class'> {
  const files = await fs.promises.readdir(dirPath);
  if (files.some((file) => file.endsWith('.cls'))) return 'class';
  if (files.some((file) => file.endsWith('.js') || file.endsWith('.ts'))) return 'component';
  throw new Error(`Type de source non reconnu dans le dossier ${dirPath}`);
}
