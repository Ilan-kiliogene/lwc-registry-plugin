import fetch from 'node-fetch';
import inquirer from 'inquirer';
import { SfCommand } from '@salesforce/sf-plugins-core';
class RegistryList extends SfCommand {
    async run() {
        const server = 'https://registry.kiliogene.com';
        // 1. Demande du type à afficher
        const { type } = await inquirer.prompt([
            {
                name: 'type',
                type: 'list',
                message: 'Que veux-tu afficher ?',
                choices: [
                    { name: 'Composants LWC', value: 'component' },
                    { name: 'Classes Apex', value: 'class' },
                ],
            },
        ]);
        // 2. Récupération du catalog
        const res = await fetch(`${server}/catalog`);
        if (!res.ok)
            this.error('Erreur lors de la récupération du registre');
        const catalog = (await res.json());
        const items = catalog[type];
        if (!items || items.length === 0) {
            this.log(`Aucun ${type === 'component' ? 'composant' : 'classe'} trouvé.`);
            return;
        }
        // 3. Affichage formaté
        this.log(`\n=== ${type === 'component' ? 'Composants LWC' : 'Classes Apex'} disponibles ===\n`);
        for (const item of items) {
            this.log(`- ${item.name}`);
            for (const v of item.versions ?? []) {
                this.log(`    • v${v.version}: ${v.description}`);
                // === Affiche les staticresources si présentes ===
                if (type === 'component' && Array.isArray(v.staticresources) && v.staticresources.length > 0) {
                    this.log(`      → StaticResources: ${v.staticresources.join(', ')}`);
                }
            }
        }
        this.log('\n');
    }
}
RegistryList.summary = 'Affiche la liste des composants ou classes du registre';
export default RegistryList;
//# sourceMappingURL=list.js.map