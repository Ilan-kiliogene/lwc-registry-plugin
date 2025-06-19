import { SfCommand } from '@salesforce/sf-plugins-core';
import kleur from 'kleur';
import Table from 'cli-table3';

import { fetchCatalog, getCleanTypeLabel, getNonEmptyItemsOrError } from '../../utils/functions.js';
import { promptComponentOrClass } from '../../utils/prompts.js';
import { SERVER_URL } from '../../utils/constants.js';
import { ComponentOrClassEntry } from '../../utils/types.js';
import { AuthError } from '../../utils/errors.js';

export default class RegistryList extends SfCommand<void> {
  // eslint-disable-next-line sf-plugin/no-hardcoded-messages-commands
  public static readonly summary = 'Affiche la liste des composants ou classes du registre';
  public static readonly examples = ['$ sf registry list'];

  public async run(): Promise<void> {
    try {
      const type = await promptComponentOrClass('Que veux‑tu afficher ?');
      const catalog = await fetchCatalog.call(this, SERVER_URL);
      const cleanType = getCleanTypeLabel(type);
      const items = getNonEmptyItemsOrError.call(this, catalog, type, cleanType, 'à afficher');
      this.log(this.formatRegistry(items, type, cleanType));
    } catch (error) {
      if (error instanceof AuthError) return this.error(error.message);
      this.error(`❌ Erreur inattendue: ${(error as Error).message}`);
    }
  }

  // eslint-disable-next-line class-methods-use-this
  private formatRegistry(
    items: ComponentOrClassEntry[],
    type: 'component' | 'class',
    label: string,
  ): string {
    const chunks: string[] = [];
    chunks.push('\n' + kleur.bold().underline(`${label} disponibles (${items.length})`) + '\n');
    for (const entry of items) {
      chunks.push(kleur.cyan().bold(`• ${entry.name}`));
      if (!entry.versions.length) continue;
      const table = new Table({
        head:
          type === 'component'
            ? [kleur.bold('Version'), kleur.bold('Description'), kleur.bold('StaticResources')]
            : [kleur.bold('Version'), kleur.bold('Description')],
        colWidths: type === 'component' ? [12, 40, 30] : [12, 60],
        style: { head: [], border: [] },
        wordWrap: true,
      });
      entry.versions.forEach((v) => {
        table.push(
          type === 'component'
            ? [`v${v.version}`, v.description || '—', (v.staticresources ?? []).join(', ') || '—']
            : [`v${v.version}`, v.description || '—'],
        );
      });
      chunks.push(table.toString(), '');
    }
    return chunks.join('\n');
  }
}
