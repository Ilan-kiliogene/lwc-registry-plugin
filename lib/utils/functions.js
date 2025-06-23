import path from 'node:path';
import fs from 'node:fs';
import fsExtra from 'fs-extra';
import fetch from 'node-fetch';
import { registrySchema } from './types.js';
import { AUTH_CONFIG_FILE_PATH } from './constants.js';
import { AuthError } from './errors.js';
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
export async function fetchCatalog(server) {
    try {
        const res = await authedFetch.call(this, `${server}/catalog`);
        if (!res.ok)
            throw new Error(`Erreur ${res.status} lors de la récupération du registre`);
        const json = await res.json();
        const check = registrySchema.safeParse(json);
        if (!check.success) {
            this.error('Format du registre invalide : ' + check.error.issues.map(i => i.message).join('; '));
        }
        return check.data;
    }
    catch (err) {
        if (err instanceof AuthError)
            throw err; // ← on laisse passer
        this.error(err instanceof Error ? err.message : String(err));
    }
}
export function getCleanTypeLabel(type, plural = true) {
    if (type === 'component')
        return plural ? 'Composants LWC' : 'composant LWC';
    return plural ? 'Classes Apex' : 'classe Apex';
}
export function getNonEmptyItemsOrError(catalog, type, label, action) {
    const items = catalog[type];
    if (!items.length) {
        this.error(`Aucun ${label} ${action}.`);
    }
    return items;
}
export function findEntryOrError(items, name) {
    const selectedEntry = items.find((element) => element.name === name);
    if (!selectedEntry) {
        this.error(`Élément "${name}" introuvable.`);
    }
    return selectedEntry;
}
export async function safeRemove(fileOrDir) {
    try {
        await fsExtra.remove(fileOrDir);
    }
    catch (err) {
        this.error(`⚠️ Impossible de supprimer ${fileOrDir}: ${err instanceof Error ? err.message : String(err)}`);
    }
}
export function getDestination(targetDir, itemType, itemName) {
    if (itemType === 'component') {
        return path.join(targetDir, 'lwc', itemName);
    }
    return path.join(targetDir, 'classes', itemName);
}
export async function fileExistsAndIsFile(filePath) {
    try {
        const stats = await fs.promises.stat(filePath);
        return stats.isFile();
    }
    catch (error) {
        return false;
    }
}
async function getAuthToken() {
    try {
        const configContent = await fs.promises.readFile(AUTH_CONFIG_FILE_PATH, 'utf-8');
        const config = JSON.parse(configContent);
        if (config && typeof config === 'object' && 'token' in config && typeof config.token === 'string') {
            return config.token;
        }
        return undefined;
    }
    catch (error) {
        return undefined;
    }
}
export async function authedFetch(url, options = {}) {
    const token = await getAuthToken();
    if (!token) {
        throw new AuthError('no_token', 'Vous n’êtes pas authentifié. Lancez « sf registry login ».');
    }
    const res = await fetch(url, {
        ...options,
        headers: { ...options.headers, Authorization: `Bearer ${token}` },
    });
    if (res.status !== 401)
        return res;
    let msg = 'Accès non autorisé (401).';
    try {
        const body = (await res.json());
        if (body.code === 'token_expired') {
            msg = body.error;
            throw new AuthError('token_expired', msg);
        }
        if (body.code === 'token_invalid') {
            msg = body.error;
            throw new AuthError('token_invalid', msg);
        }
    }
    catch {
        /* parsing JSON raté : on garde le message générique */
    }
    throw new AuthError('token_invalid', msg);
}
//# sourceMappingURL=functions.js.map