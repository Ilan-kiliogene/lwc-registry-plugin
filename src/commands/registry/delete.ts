import fetch from 'node-fetch';
import inquirer from 'inquirer';
import { SfCommand } from '@salesforce/sf-plugins-core';
import { Registry , registrySchema } from '../../types/registry'



export default class RegistryDelete extends SfCommand<void> {
  public static readonly summary = 'Supprime un composant ou une classe du registre';
  public static readonly examples = ['$ sf registry delete'];

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

    let catalog: Registry;
    try {
      const res = await fetch(`${server}/catalog`);
      if (!res.ok) this.error(`Erreur ${res.status} lors de la récupération du registre`);
      const json = await res.json();
      catalog = registrySchema.parse(json);
    } catch (error) {
      this.error('Erreur réseau ou registre invalide : ' + (error instanceof Error ? error.message : String(error)));
    }

    const label = type === 'component' ? 'Composants LWC' : 'Classes Apex';

    const items = catalog[type];
    if (!items.length) {
      this.log(`Aucun ${label} à supprimer.`);
      return;
    }

    const { name } = await inquirer.prompt<{ name: string }>([
      {
        name: 'name',
        type: 'list',
        message: `Quel ${label} veux-tu supprimer ?`,
        choices: items.map(element => element.name)
      }
    ]);

    // 3. Choix de la version ou toutes les versions
    const selectedEntry = items.find(element => element.name === name);
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
            ...selectedEntry.versions.map(versions => ({ name: `v${versions.version} - ${versions.description}`, value: versions.version })),
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
