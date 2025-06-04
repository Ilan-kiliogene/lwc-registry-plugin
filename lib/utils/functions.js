import path from 'node:path';
import fs from 'node:fs';
import { registrySchema } from './types.js';
// ===============================================
//  UTILITAIRE : Trouve la racine d’un projet SFDX
// ===============================================
export function findProjectRoot(currentDir) {
    let dir = currentDir;
    while (!fs.existsSync(path.join(dir, 'sfdx-project.json'))) {
        const parent = path.dirname(dir);
        if (parent === dir) {
            throw new Error('Impossible de trouver la racine Salesforce (sfdx-project.json)');
        }
        dir = parent;
    }
    return dir;
}
// =====================================================
//  UTILITAIRE : Récupère et valide le catalogue distant
// =====================================================
export async function fetchCatalog(server) {
    try {
        const res = await fetch(`${server}/catalog`);
        if (!res.ok)
            this.error(`Erreur ${res.status} lors de la récupération du registre`);
        const json = await res.json();
        const result = registrySchema.safeParse(json);
        if (!result.success) {
            this.error('Format du registre invalide : ' +
                result.error.issues.map(i => i.message).join('; '));
        }
        return result.data;
    }
    catch (error) {
        this.error(error instanceof Error ? error.message : String(error));
    }
}
// =====================================================
//  UTILITAIRE : Récupère et affiche proprement le type
// =====================================================
export function getCleanTypeLabel(type, plural = true) {
    if (type === 'component')
        return plural ? 'Composants LWC' : 'composant LWC';
    return plural ? 'Classes Apex' : 'classe Apex';
}
// ===========================================================
//  UTILITAIRE : Récupère la partie du catalog voulue non vide
// ===========================================================
export function getNonEmptyItemsOrError(catalog, type, label, action) {
    const items = catalog[type];
    if (!items.length) {
        this.error(`Aucun ${label} ${action}.`);
    }
    return items;
}
// ======================================================
//  UTILITAIRE : Trouve une entrée dans le catalog valide
// ======================================================
export function findEntryOrError(items, name) {
    const selectedEntry = items.find((element) => element.name === name);
    if (!selectedEntry) {
        this.error(`Élément "${name}" introuvable.`);
    }
    return selectedEntry;
}
//# sourceMappingURL=functions.js.map