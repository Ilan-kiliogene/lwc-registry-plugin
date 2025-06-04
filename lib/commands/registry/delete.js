import fetch from 'node-fetch';
import inquirer from 'inquirer';
import { SfCommand } from '@salesforce/sf-plugins-core';
import { fetchCatalog, promptComponentOrClass, promptSelectName } from '../../utils/functions.js';
import { SERVER_URL } from '../../utils/constants.js';
class RegistryDelete extends SfCommand {
    async run() {
        const type = await promptComponentOrClass('Quel type d\'élément veux-tu supprimer ?');
        const resultFetchCatalog = await fetchCatalog(SERVER_URL);
        if (!resultFetchCatalog.ok) {
            this.error(`Erreur lors de la récupération du catalogue : ${resultFetchCatalog.error}`);
        }
        const catalog = resultFetchCatalog.data;
        const label = type === 'component' ? 'Composants LWC' : 'Classes Apex';
        const items = catalog[type];
        if (!items.length) {
            this.log(`Aucun ${label} à supprimer.`);
            return;
        }
        const name = await promptSelectName(`Quel ${label} veux-tu supprimer ?`, items.map(e => e.name));
        // 3. Choix de la version ou toutes les versions
        const selectedEntry = items.find((element) => element.name === name);
        if (!selectedEntry) {
            this.error('Élément introuvable.');
        }
        let version = null;
        if (selectedEntry.versions.length > 1) {
            const { which } = await inquirer.prompt([
                {
                    name: 'which',
                    type: 'list',
                    message: 'Supprimer une version spécifique ou toutes ?',
                    choices: [
                        ...selectedEntry.versions.map((versions) => ({
                            name: `v${versions.version} - ${versions.description}`,
                            value: versions.version,
                        })),
                        { name: 'Toutes les versions', value: 'ALL' },
                    ],
                },
            ]);
            version = which !== 'ALL' ? which : null;
        }
        // 4. Confirmation
        const confirmMsg = version
            ? `Supprimer ${type} "${name}" version ${version} ?`
            : `Supprimer TOUTES les versions de ${type} "${name}" ?`;
        const { ok } = await inquirer.prompt([
            {
                name: 'ok',
                type: 'confirm',
                message: confirmMsg,
            },
        ]);
        if (!ok) {
            this.log('Suppression annulée.');
            return;
        }
        // 5. Appel API
        let url = `${SERVER_URL}/delete/${type}/${name}`;
        if (version)
            url += `/${version}`;
        const delRes = await fetch(url, { method: 'DELETE' });
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