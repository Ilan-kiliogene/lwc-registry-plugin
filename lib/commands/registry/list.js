import fetch from 'node-fetch';
import inquirer from 'inquirer';
import { SfCommand } from '@salesforce/sf-plugins-core';
import kleur from 'kleur';
import { registrySchema } from '../../types/registry';
class RegistryList extends SfCommand {
    async run() {
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
        const label = type === 'component' ? 'Composants LWC' : 'Classes Apex';
        let catalog;
        try {
            const res = await fetch('https://registry.kiliogene.com/catalog');
            if (!res.ok)
                this.error(`Erreur ${res.status} lors de la récupération du registre`);
            const json = await res.json();
            catalog = registrySchema.parse(json);
        }
        catch (e) {
            this.error('Erreur réseau ou registre invalide : ' + (e instanceof Error ? e.message : String(e)));
            return;
        }
        const items = catalog[type];
        if (!items.length) {
            this.log(kleur.red(`Aucun ${label} trouvé.`));
            return;
        }
        this.log('\n' + kleur.bold().underline(`${label} disponibles (${items.length})`) + '\n');
        for (const entry of items) {
            this.log(kleur.cyan().bold(`- ${entry.name}`));
            if (!entry.versions.length)
                continue;
            // Affiche un "header"
            this.log(`   ${kleur.bold('Version').padEnd(12)}${kleur.bold('Description').padEnd(40)}${type === 'component' ? kleur.bold('StaticResources') : ''}`);
            for (const v of entry.versions) {
                let line = `   ${kleur.green(`v${v.version}`).padEnd(12)}` +
                    `${v.description.padEnd(40)}`;
                if (type === 'component' && v.staticresources?.length) {
                    line += kleur.magenta(v.staticresources.join(', '));
                }
                this.log(line);
            }
            this.log(''); // Ligne vide pour séparer les entrées
        }
    }
}
RegistryList.summary = 'Affiche la liste des composants ou classes du registre';
RegistryList.examples = ['$ sf registry list'];
export default RegistryList;
//# sourceMappingURL=list.js.map