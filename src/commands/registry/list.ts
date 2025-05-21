import fetch from 'node-fetch';
import inquirer from 'inquirer';
import { SfCommand } from '@salesforce/sf-plugins-core';

type RegistryDependency = Readonly<{
  name: string;
  type: 'component' | 'class';
  version: string;
}>;

type RegistryVersion = Readonly<{
  version: string;
  description: string;
  hash: string;
  registryDependencies: readonly RegistryDependency[];
}>;

type RegistryEntry = Readonly<{
  name: string;
  versions: readonly RegistryVersion[];
}>;

type RegistryResponse = Readonly<{
  name: string;
  component: readonly RegistryEntry[];
  class: readonly RegistryEntry[];
}>;

export default class RegistryList extends SfCommand<void> {
  public static readonly summary = 'Affiche la liste des composants ou classes du registre';

  public async run(): Promise<void> {
    const server = 'https://registry.kiliogene.com';

    // 1. Demande du type à afficher
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

    // 2. Récupération du catalog
    const res = await fetch(`${server}/catalog`);
    if (!res.ok) this.error('Erreur lors de la récupération du registre');
    const catalog = (await res.json()) as RegistryResponse;

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
      }
    }
    this.log('\n');
  }
}
