import { SfCommand } from '@salesforce/sf-plugins-core';
import kleur from 'kleur';
import { fetchCatalog, getCleanTypeLabel, getNonEmptyItemsOrError } from '../../utils/functions.js';
import { promptComponentOrClass } from '../../utils/prompts.js';
import { SERVER_URL } from '../../utils/constants.js';
class RegistryList extends SfCommand {
    async run() {
        try {
            const type = await promptComponentOrClass('Que veux-tu afficher ?');
            const catalog = await fetchCatalog.call(this, SERVER_URL);
            const cleanType = getCleanTypeLabel(type);
            const items = getNonEmptyItemsOrError.call(this, catalog, type, cleanType, 'à afficher');
            this.logRegistryItems(items, type, cleanType);
        }
        catch (error) {
            this.error(`❌ Erreur inattendue: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    logRegistryItems(items, type, label) {
        const header = `\n${kleur.bold().underline(`${label} disponibles (${items.length})`)}\n`;
        const blocks = items.map(entry => {
            let block = kleur.cyan().bold(`- ${entry.name}`) + '\n';
            if (!entry.versions.length)
                return block;
            block +=
                `   ${kleur.bold('Version').padEnd(12)}${kleur.bold('Description').padEnd(40)}` +
                    (type === 'component' ? kleur.bold('StaticResources') : '') +
                    '\n';
            block += entry.versions
                .map(v => {
                let line = `   ${kleur.green(`v${v.version}`).padEnd(12)}${v.description.padEnd(40)}`;
                if (type === 'component' && v.staticresources?.length) {
                    line += kleur.magenta(v.staticresources.join(', '));
                }
                return line;
            })
                .join('\n');
            block += '\n'; // Saut de ligne après chaque bloc d’entrée
            return block;
        });
        this.log(header + blocks.join('\n'));
    }
}
// eslint-disable-next-line sf-plugin/no-hardcoded-messages-commands
RegistryList.summary = 'Affiche la liste des composants ou classes du registre';
RegistryList.examples = ['$ sf registry list'];
export default RegistryList;
//# sourceMappingURL=list.js.map