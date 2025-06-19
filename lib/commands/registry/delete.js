import { SfCommand } from '@salesforce/sf-plugins-core';
import { SERVER_URL } from '../../utils/constants.js';
import { fetchCatalog, getCleanTypeLabel, getNonEmptyItemsOrError, findEntryOrError, authedFetch, } from '../../utils/functions.js';
import { promptComponentOrClass, promptSelectName, promptVersionToDelete, promptDeleteConfirmation, } from '../../utils/prompts.js';
import { AuthError } from '../../utils/errors.js';
class RegistryDelete extends SfCommand {
    async run() {
        try {
            const type = await promptComponentOrClass("Quel type d'élément veux-tu supprimer ?");
            const catalog = await fetchCatalog.call(this, SERVER_URL);
            const cleanType = getCleanTypeLabel(type);
            const items = getNonEmptyItemsOrError.call(this, catalog, type, cleanType, 'à supprimer');
            const name = await promptSelectName(`Quel ${cleanType} veux-tu supprimer ?`, items.map((e) => e.name));
            const selectedEntry = findEntryOrError.call(this, items, name);
            const version = await promptVersionToDelete.call(this, selectedEntry.versions);
            const ok = await promptDeleteConfirmation({ type, name, version });
            if (!ok)
                return;
            await this.deleteFromRegistry(SERVER_URL, type, name, version);
        }
        catch (error) {
            if (error instanceof AuthError) {
                this.error(error.message);
            }
            this.error(`❌ Erreur inattendue: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async deleteFromRegistry(serverUrl, type, name, version) {
        let url = `${serverUrl}/delete/${type}/${name}`;
        if (version)
            url += `/${version}`;
        const delRes = await authedFetch.call(this, url, { method: 'DELETE' });
        const result = (await delRes.json());
        if (!delRes.ok) {
            this.error(result.error ?? 'Erreur lors de la suppression.');
        }
        else {
            this.log(result.message ?? 'Suppression réussie.');
        }
    }
}
// eslint-disable-next-line sf-plugin/no-hardcoded-messages-commands
RegistryDelete.summary = 'Supprime un composant ou une classe du registre';
RegistryDelete.examples = ['$ sf registry delete'];
export default RegistryDelete;
//# sourceMappingURL=delete.js.map