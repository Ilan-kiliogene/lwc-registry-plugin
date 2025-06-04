import inquirer from 'inquirer';
import { SfCommand } from '@salesforce/sf-plugins-core';
import kleur from 'kleur';
import { fetchCatalog } from '../../utils/registry';

export default class RegistryList extends SfCommand<void> {
  public static readonly summary = 'Affiche la liste des composants ou classes du registre';
  public static readonly examples = ['$ sf registry list'];

  public async run(): Promise<void> {
    const server = 'https://registry.kiliogene.com';

    const { type } = await inquirer.prompt<{ type: 'component' | 'class' }>([
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

    const resultFetchCatalog = await fetchCatalog(server);
    if (!resultFetchCatalog.ok) {
      this.error(`Erreur lors de la récupération du catalogue : ${resultFetchCatalog.error}`);
    }
    const catalog = resultFetchCatalog.data;

    const label = type === 'component' ? 'Composants LWC' : 'Classes Apex';
    const items = catalog[type];
    if (!items.length) {
      this.log(kleur.red(`Aucun ${label} trouvé.`));
      return;
    }

    this.log('\n' + kleur.bold().underline(`${label} disponibles (${items.length})`) + '\n');

    for (const entry of items) {
      this.log(kleur.cyan().bold(`- ${entry.name}`));
      if (!entry.versions.length) continue;
      // Affiche un "header"
      this.log(
        `   ${kleur.bold('Version').padEnd(12)}${kleur.bold('Description').padEnd(40)}${
          type === 'component' ? kleur.bold('StaticResources') : ''
        }`
      );
      for (const v of entry.versions) {
        let line = `   ${kleur.green(`v${v.version}`).padEnd(12)}` + `${v.description.padEnd(40)}`;
        if (type === 'component' && v.staticresources?.length) {
          line += kleur.magenta(v.staticresources.join(', '));
        }
        this.log(line);
      }
      this.log(''); // Ligne vide pour séparer les entrées
    }
  }
}
