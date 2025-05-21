import path from 'node:path';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import inquirer from 'inquirer';
import { SfCommand } from '@salesforce/sf-plugins-core';

export default class RegistryTemplate extends SfCommand<void> {
  public static readonly summary = 'Crée un squelette composant LWC ou classe Apex avec meta JSON à compléter';
  public static readonly examples = ['$ sf registry create'];

  public async run(): Promise<void> {
    // 1. Choix du type d’item
    const { type } = await inquirer.prompt<{ type: 'component' | 'class' }>([
      {
        name: 'type',
        type: 'list',
        message: 'Quel type de template veux-tu créer ?',
        choices: [
          { name: 'Composant LWC', value: 'component' },
          { name: 'Classe Apex', value: 'class' },
        ],
      },
    ]);

    // 2. Saisie du nom
    const { name } = await inquirer.prompt<{ name: string }>([
      {
        name: 'name',
        type: 'input',
        message: `Nom du ${type === 'component' ? 'composant LWC' : 'classe Apex'} ?`,
        validate: (v) => /^[a-zA-Z0-9_]+$/.test(v) || 'Nom invalide (alphanumérique uniquement)',
      },
    ]);

    let folder = '';
    if (type === 'component') {
      folder = path.join('force-app', 'main', 'default', 'lwc', name);
      const lwcParent = path.join('force-app', 'main', 'default', 'lwc');
      fs.mkdirSync(lwcParent, { recursive: true });

      this.log('⏳ Création du composant LWC...');
      execSync(`sf lightning component generate --type lwc --name ${name}`, {
        stdio: 'inherit',
        cwd: lwcParent,
      });

      // Renomme le .js en .ts
      const jsFile = path.join(folder, `${name}.js`);
      const tsFile = path.join(folder, `${name}.ts`);
      if (fs.existsSync(jsFile)) {
        fs.renameSync(jsFile, tsFile);
        this.log(`🔁 Fichier ${name}.js renommé en ${name}.ts`);
      } else {
        this.log(`⚠️ Fichier JS introuvable pour renommer en TS (${jsFile})`);
      }
    } else {
      // === Cas classe Apex ===
      const classesParent = path.join('force-app', 'main', 'default', 'classes');
      fs.mkdirSync(classesParent, { recursive: true });

      this.log('⏳ Création de la classe Apex...');
      execSync(`sf apex class generate --name ${name}`, {
        stdio: 'inherit',
        cwd: classesParent,
      });

      // Nouveau dossier pour regrouper les fichiers de la classe
      folder = path.join(classesParent, name);
      if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
      }

      // Déplacer les fichiers générés dans le sous-dossier
      const clsPath = path.join(classesParent, `${name}.cls`);
      const metaXmlPath = path.join(classesParent, `${name}.cls-meta.xml`);
      const destCls = path.join(folder, `${name}.cls`);
      const destMeta = path.join(folder, `${name}.cls-meta.xml`);

      if (fs.existsSync(clsPath)) {
        fs.renameSync(clsPath, destCls);
      }
      if (fs.existsSync(metaXmlPath)) {
        fs.renameSync(metaXmlPath, destMeta);
      }
    }

    // 3. Création du JSON meta (dans le bon dossier)
    const metaPath = path.join(folder, 'registry-meta.json');
    const meta = {
      description: '',
      version: '',
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    this.log(`✅ Fichier registry-meta.json généré dans ${metaPath}`);

    this.log('📝 Remplis les champs "description" et "version" avant de déployer !');
  }
}
