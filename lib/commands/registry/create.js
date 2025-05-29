import path from 'node:path';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import inquirer from 'inquirer';
import { SfCommand } from '@salesforce/sf-plugins-core';
class RegistryTemplate extends SfCommand {
    async run() {
        try {
            // 1. Choix du type d’item
            const { type } = await inquirer.prompt([
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
            const { name } = await inquirer.prompt([
                {
                    name: 'name',
                    type: 'input',
                    message: `Nom du ${type === 'component' ? 'composant LWC' : 'classe Apex'} ?`,
                    validate: (v) => /^[a-zA-Z0-9_]+$/.test(v) || 'Nom invalide (alphanumérique uniquement)',
                },
            ]);
            let folder;
            if (type === 'component') {
                folder = this.createLwcComponent(name);
            }
            else {
                folder = this.createApexClass(name);
            }
            // 3. Création du JSON meta (dans le bon dossier)
            const metaPath = path.join(folder, 'registry-meta.json');
            const meta = {
                description: '',
                version: '',
            };
            try {
                fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
                this.log(`✅ Fichier registry-meta.json généré dans ${metaPath}`);
            }
            catch (error) {
                this.log(`❌ Erreur lors de la création du fichier meta: ${error instanceof Error ? error.message : String(error)}`);
                return;
            }
            this.log('📝 Remplis les champs "description" et "version" avant de déployer !');
        }
        catch (error) {
            this.log(`❌ Erreur inattendue: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    createLwcComponent(name) {
        const lwcParent = path.join('force-app', 'main', 'default', 'lwc');
        const folder = path.join(lwcParent, name);
        try {
            fs.mkdirSync(lwcParent, { recursive: true });
            this.log('⏳ Création du composant LWC...');
            execSync(`sf lightning component generate --type lwc --name ${name}`, {
                stdio: 'inherit',
                cwd: lwcParent,
            });
        }
        catch (error) {
            throw new Error(`Erreur lors de la création du composant LWC : ${error instanceof Error ? error.message : String(error)}`);
        }
        // Renomme le .js en .ts si besoin
        const jsFile = path.join(folder, `${name}.js`);
        const tsFile = path.join(folder, `${name}.ts`);
        try {
            if (fs.existsSync(jsFile)) {
                fs.renameSync(jsFile, tsFile);
                this.log(`🔁 Fichier ${name}.js renommé en ${name}.ts`);
            }
            else {
                this.log(`⚠️ Fichier JS introuvable pour renommer en TS (${jsFile})`);
            }
        }
        catch (error) {
            this.log(`❌ Erreur lors du renommage en TS : ${error instanceof Error ? error.message : String(error)}`);
        }
        return folder;
    }
    createApexClass(name) {
        const classesParent = path.join('force-app', 'main', 'default', 'classes');
        const folder = path.join(classesParent, name);
        try {
            fs.mkdirSync(classesParent, { recursive: true });
            this.log('⏳ Création de la classe Apex...');
            execSync(`sf apex class generate --name ${name}`, {
                stdio: 'inherit',
                cwd: classesParent,
            });
        }
        catch (error) {
            throw new Error(`Erreur lors de la création de la classe Apex : ${error instanceof Error ? error.message : String(error)}`);
        }
        // Crée le sous-dossier si besoin
        try {
            if (!fs.existsSync(folder)) {
                fs.mkdirSync(folder, { recursive: true });
            }
        }
        catch (error) {
            this.log(`❌ Erreur création du dossier ${folder} : ${error instanceof Error ? error.message : String(error)}`);
        }
        // Déplace les fichiers générés dans le sous-dossier
        const clsPath = path.join(classesParent, `${name}.cls`);
        const metaXmlPath = path.join(classesParent, `${name}.cls-meta.xml`);
        const destCls = path.join(folder, `${name}.cls`);
        const destMeta = path.join(folder, `${name}.cls-meta.xml`);
        try {
            if (fs.existsSync(clsPath)) {
                fs.renameSync(clsPath, destCls);
            }
            if (fs.existsSync(metaXmlPath)) {
                fs.renameSync(metaXmlPath, destMeta);
            }
        }
        catch (error) {
            this.log(`❌ Erreur lors du déplacement des fichiers de la classe Apex : ${error instanceof Error ? error.message : String(error)}`);
        }
        return folder;
    }
}
RegistryTemplate.summary = 'Crée un squelette composant LWC ou classe Apex avec meta JSON à compléter';
RegistryTemplate.examples = ['$ sf registry create'];
export default RegistryTemplate;
//# sourceMappingURL=create.js.map