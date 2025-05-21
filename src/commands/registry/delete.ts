import fetch from 'node-fetch';
import inquirer from 'inquirer';
import { SfCommand } from '@salesforce/sf-plugins-core';

type RegistryEntry = {
  name: string;
  versions: Array<{ version: string; description: string }>;
};
type RegistryResponse = {
  name: string;
  component: RegistryEntry[];
  class: RegistryEntry[];
};




export default class RegistryDelete extends SfCommand<void> {
  public static readonly summary = 'Supprime un composant ou une classe du registre';
  public static readonly examples = [
    '$ sf registry delete'
  ];

  public async run(): Promise<void> {
    const server = 'https://registry.kiliogene.com';

    // 1. Choix du type
    const { type } = await inquirer.prompt<{ type: 'component' | 'class' }>([
      {
        name: 'type',
        type: 'list',
        message: 'Supprimer un composant ou une classe ?',
        choices: [
          { name: 'Composant LWC', value: 'component' },
          { name: 'Classe Apex', value: 'class' }
        ]
      }
    ]);

    // 2. Liste des items
    const res = await fetch(`${server}/catalog`);
    if (!res.ok) this.error('Erreur lors de la récupération du registre');
    const catalog = (await res.json()) as RegistryResponse;
    const items = catalog[type];
    if (!items || items.length === 0) {
      this.log(`Aucun ${type === 'component' ? 'composant' : 'classe'} à supprimer.`);
      return;
    }

    const { name } = await inquirer.prompt<{ name: string }>([
      {
        name: 'name',
        type: 'list',
        message: `Quel ${type === 'component' ? 'composant' : 'classe'} veux-tu supprimer ?`,
        choices: items.map(e => e.name)
      }
    ]);

    // 3. Choix de la version ou toutes les versions
    const selectedEntry = items.find(e => e.name === name);
    if (!selectedEntry) {
      this.error('Élément introuvable.');
    }

    let version: string | null = null;
    if (selectedEntry.versions.length > 1) {
      const { which } = await inquirer.prompt<{ which: string }>([
        {
          name: 'which',
          type: 'list',
          message: 'Supprimer une version spécifique ou toutes ?',
          choices: [
            ...selectedEntry.versions.map(v => ({ name: `v${v.version} - ${v.description}`, value: v.version })),
            { name: 'Toutes les versions', value: 'ALL' }
          ]
        }
      ]);
      version = which !== 'ALL' ? which : null;
    }

    // 4. Confirmation
    const confirmMsg = version
      ? `Supprimer ${type} "${name}" version ${version} ?`
      : `Supprimer TOUTES les versions de ${type} "${name}" ?`;
    const { ok } = await inquirer.prompt<{ ok: boolean }>([
      {
        name: 'ok',
        type: 'confirm',
        message: confirmMsg
      }
    ]);
    if (!ok) {
      this.log('Suppression annulée.');
      return;
    }

    // 5. Appel API
    let url = `${server}/delete/${type}/${name}`;
    if (version) url += `/${version}`;
    const delRes = await fetch(url, { method: 'DELETE' });
    const result = (await delRes.json()) as { error?: string; message?: string };

    if (!delRes.ok) {
      this.error(result.error ?? 'Erreur lors de la suppression.');
    } else {
      this.log(result.message ?? 'Suppression réussie.');
    }
  }
}
