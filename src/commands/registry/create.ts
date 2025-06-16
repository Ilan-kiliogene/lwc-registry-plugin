import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execa } from 'execa';
import { SfCommand } from '@salesforce/sf-plugins-core';
import { findProjectRoot, getCleanTypeLabel, fileExistsAndIsFile } from '../../utils/functions.js';
import { promptComponentOrClass, promptValidNameCommandCreate } from '../../utils/prompts.js';
import { FILENAMES } from '../../utils/constants.js';

export default class RegistryTemplate extends SfCommand<void> {
  // eslint-disable-next-line sf-plugin/no-hardcoded-messages-commands
  public static readonly summary = 'Crée un squelette composant LWC ou classe Apex avec meta JSON à compléter';
  public static readonly examples = ['$ sf registry create'];

  public async run(): Promise<void> {
    try {
      const type = await promptComponentOrClass('Quel type de template veux-tu créer ?');    
      const cleanType = getCleanTypeLabel(type, false) 
      const name = await promptValidNameCommandCreate(`Nom du ${cleanType}`)
      const folder = await this.getTargetFolder(type, name);
      await this.createRegistryMetaJson(folder)
      this.log(`✅ ${getCleanTypeLabel(type, false)} "${name}" créé avec succès.`);
    } catch (error) {
      this.error(`❌ Erreur inattendue: ${error instanceof Error ? error.message : String(error)}`);
    }
  }


  private async getTargetFolder(type: 'component' | 'class', name: string): Promise<string> {
    if (type === 'component') {
      return this.createLwcComponent(name);
    }
    return this.createApexClass(name);
  }

  private async createLwcComponent(name: string): Promise<string> {
    const projectRoot = findProjectRoot(process.cwd());
    const lwcParent = path.join(projectRoot, 'force-app', 'main', 'default', 'lwc');
    const folder = path.join(lwcParent, name);

    await fs.mkdir(lwcParent, { recursive: true });
    this.log('⏳ Création du composant LWC...');
    // Utilisation de execa pour un meilleur contrôle asynchrone
    await execa('sf', ['lightning', 'component', 'generate', '--type', 'lwc', '--name', name], {
      cwd: lwcParent,
      stdio: 'inherit', // Affiche la sortie de la commande en temps réel
    });

    // Renomme le .js en .ts si besoin
    const jsFile = path.join(folder, `${name}.js`);
    const tsFile = path.join(folder, `${name}.ts`);
    if (await fileExistsAndIsFile(jsFile)) {
        await fs.rename(jsFile, tsFile);
        this.log(`🔁 Fichier ${name}.js renommé en ${name}.ts`);
    }
    return folder;
  }


  private async createApexClass(name: string): Promise<string> {
    const projectRoot = findProjectRoot(process.cwd());
    const classesParent = path.join(projectRoot, 'force-app', 'main', 'default', 'classes');
    const folder = path.join(classesParent, name);

    await fs.mkdir(classesParent, { recursive: true });
    this.log('⏳ Création de la classe Apex...');
    await execa('sf', ['apex', 'class', 'generate', '--name', name], {
      cwd: classesParent,
      stdio: 'inherit',
    });

    // Crée le sous-dossier
    await fs.mkdir(folder, { recursive: true });

    // Déplace les fichiers générés dans le sous-dossier
    const clsPath = path.join(classesParent, `${name}.cls`);
    const metaXmlPath = path.join(classesParent, `${name}.cls-meta.xml`);
    
    await fs.rename(clsPath, path.join(folder, `${name}.cls`));
    await fs.rename(metaXmlPath, path.join(folder, `${name}.cls-meta.xml`));

    return folder;
  }


  private async createRegistryMetaJson(folder: string): Promise<void> {
    // On utilise la constante pour être sûr d'avoir le même nom de fichier que la commande 'deploy'
    const metaPath = path.join(folder, FILENAMES.REGISTRY_META);
    const meta = { description: '', version: '' };
    try {
      // On utilise la version asynchrone de writeFile
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
      this.log(`✅ Fichier ${FILENAMES.REGISTRY_META} généré dans ${metaPath}`);
    } catch (error) {
      // On lève une erreur qui sera attrapée par le catch de la méthode run()
      throw new Error(
        `Erreur lors de la création du fichier ${FILENAMES.REGISTRY_META}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}