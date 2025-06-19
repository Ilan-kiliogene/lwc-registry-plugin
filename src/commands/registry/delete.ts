import { SfCommand } from '@salesforce/sf-plugins-core';
import { SERVER_URL } from '../../utils/constants.js';
import {
  fetchCatalog,
  getCleanTypeLabel,
  getNonEmptyItemsOrError,
  findEntryOrError,
  authedFetch,
} from '../../utils/functions.js';
import {
  promptComponentOrClass,
  promptSelectName,
  promptVersionToDelete,
  promptDeleteConfirmation,
} from '../../utils/prompts.js';
import { AuthError } from '../../utils/errors.js';

export default class RegistryDelete extends SfCommand<void> {
  // eslint-disable-next-line sf-plugin/no-hardcoded-messages-commands
  public static readonly summary = 'Supprime un composant ou une classe du registre';
  public static readonly examples = ['$ sf registry delete'];

  public async run(): Promise<void> {
    try {
      const type = await promptComponentOrClass("Quel type d'élément veux-tu supprimer ?");
      const catalog = await fetchCatalog.call(this, SERVER_URL);
      const cleanType = getCleanTypeLabel(type);
      const items = getNonEmptyItemsOrError.call(this, catalog, type, cleanType, 'à supprimer');
      const name = await promptSelectName(`Quel ${cleanType} veux-tu supprimer ?`,items.map((e) => e.name));
      const selectedEntry = findEntryOrError.call(this, items, name);
      const version = await promptVersionToDelete.call(this, selectedEntry.versions);
      const ok = await promptDeleteConfirmation({ type, name, version });
      if (!ok) return;
      await this.deleteFromRegistry(SERVER_URL, type, name, version);
    } catch (error) {
      if (error instanceof AuthError) {
        this.error(error.message);
      }
      this.error(`❌ Erreur inattendue: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  private async deleteFromRegistry(
    serverUrl: string,
    type: string,
    name: string,
    version?: string | null
  ): Promise<void> {
    let url = `${serverUrl}/delete/${type}/${name}`;
    if (version) url += `/${version}`;
    const delRes = await authedFetch.call(this,url, { method: 'DELETE' });
    const result = (await delRes.json()) as { error?: string; message?: string };
    if (!delRes.ok) {
      this.error(result.error ?? 'Erreur lors de la suppression.');
    } else {
      this.log(result.message ?? 'Suppression réussie.');
    }
  }
}
