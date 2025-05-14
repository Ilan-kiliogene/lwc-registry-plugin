import fs from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import fetch from 'node-fetch';
import inquirer from 'inquirer';
import { SfCommand } from '@salesforce/sf-plugins-core';
// eslint-disable-next-line import/no-extraneous-dependencies
import FormData from 'form-data';

type DeployType = 'components' | 'classes';

type MetadataBase = {
  description: string;
};

type MetadataComposant = MetadataBase & { isModal: boolean };

// ... (imports et types inchangés)

export default class RegistryDeploy extends SfCommand<void> {
  public static readonly summary = 'Déploie un composant LWC ou une classe Apex sur le registre externe';

  public async run(): Promise<void> {
    const server = 'https://registry.kiliogene.com';

    const { type } = await inquirer.prompt<{ type: DeployType }>([
      {
        name: 'type',
        type: 'list',
        message: 'Que veux-tu déployer ?',
        choices: ['components', 'classes'],
      },
    ]);

    const basePath = type === 'components'
      ? 'force-app/main/default/lwc'
      : 'force-app/main/default/classes';

    let items: string[] = [];

    if (type === 'components') {
      items = fs.readdirSync(basePath, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
    } else {
      const classDirs = fs.readdirSync(basePath, { withFileTypes: true })
        .filter(entry => entry.isDirectory());

      for (const dir of classDirs) {
        const dirPath = path.join(basePath, dir.name);
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
          if (file.endsWith('.cls') && !file.endsWith('.cls-meta.xml')) {
            items.push(file.replace(/\.cls$/, ''));
          }
        }
      }
    }

    if (items.length === 0) {
      this.error(`❌ Aucun ${type} trouvé dans ${basePath}`);
    }

    const { name } = await inquirer.prompt<{ name: string }>([
      {
        name: 'name',
        type: 'list',
        message: `Quel ${type} veux-tu déployer ?`,
        choices: items,
      },
    ]);

    let metadata: MetadataBase | MetadataComposant;

    if (type === 'components') {
      const answers = await inquirer.prompt([
        { name: 'description', message: 'Description ?', type: 'input', validate: input => input.trim() !== '' || 'La description est requise.' },
        { name: 'isModal', message: 'Est-ce un LightningModal ?', type: 'confirm' },
      ]);
      metadata = answers as MetadataComposant;
    } else {
      const answers = await inquirer.prompt([
        { name: 'description', message: 'Description ?', type: 'input', validate: input => input.trim() !== '' || 'La description est requise.' }
      ]);
      metadata = answers as MetadataBase;
    }

    const zip = new AdmZip();

    if (type === 'components') {
      const folderToZip = path.join(basePath, name);
      if (!fs.existsSync(folderToZip)) {
        this.error(`❌ Dossier composant introuvable : ${folderToZip}`);
      }
      zip.addLocalFolder(folderToZip, name);
    } else {
      const classDirs = fs.readdirSync(basePath, { withFileTypes: true })
        .filter(entry => entry.isDirectory());

      const foundDir = classDirs.find(dir => {
        const clsPath = path.join(basePath, dir.name, `${name}.cls`);
        return fs.existsSync(clsPath);
      });

      if (!foundDir) {
        this.error(`❌ Classe "${name}" introuvable dans ${basePath}`);
      }

      const clsDir = path.join(basePath, foundDir.name);
      const clsFile = path.join(clsDir, `${name}.cls`);
      const metaFile = path.join(clsDir, `${name}.cls-meta.xml`);

      if (!fs.existsSync(clsFile)) {
        this.error(`❌ Fichier .cls introuvable : ${clsFile}`);
      }
      zip.addLocalFile(clsFile, name);

      if (fs.existsSync(metaFile)) {
        zip.addLocalFile(metaFile, name);
      }
    }

    const tmpDir = '/tmp';
    await mkdir(tmpDir, { recursive: true });
    const zipPath = path.join(tmpDir, `${name}-${Date.now()}.zip`);
    zip.writeZip(zipPath);

    // 🧭 Debug ZIP
    this.log(`📦 ZIP créé : ${zipPath}`);
    this.log(`📁 Contenu : ${zip.getEntries().length} fichier(s)`);

    const form = new FormData();
    form.append('componentZip', fs.createReadStream(zipPath));
    form.append('name', name);
    form.append('description', metadata.description);
    form.append('type', type);
    if (type === 'components') {
      form.append('isModal', String((metadata as MetadataComposant).isModal));
    }

    this.log(`📤 Envoi de ${name} (${type}) vers ${server}/deploy...`);

    try {
      const res = await fetch(`${server}/deploy`, {
        method: 'POST',
        body: form,
        headers: form.getHeaders(),
      });
      const resultText = await res.text();
      if (!res.ok) {
        this.error(`❌ Échec HTTP ${res.status} : ${resultText}`);
      }

      this.log(`✅ Serveur : ${resultText}`);
    } catch (err) {
      this.error(`❌ Erreur réseau : ${(err as Error).message}`);
    }finally {
      await rm(zipPath, { force: true });
    }
  }
}
