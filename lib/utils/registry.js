import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
// Schéma d’une dépendance
export const DependencySchema = z.object({
    name: z.string(),
    type: z.string(),
    version: z.string(),
});
// Schéma d’une version de composant/classe
export const versionSchema = z.object({
    version: z.string(),
    description: z.string(),
    hash: z.string(),
    staticresources: z.array(z.string()),
    registryDependencies: z.array(DependencySchema),
});
// Schéma d’une entrée (composant ou classe)
export const entrySchema = z.object({
    name: z.string(),
    versions: z.array(versionSchema),
});
// Schéma du registre complet
export const registrySchema = z.object({
    component: z.array(entrySchema),
    class: z.array(entrySchema),
});
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
        const res = await fetch(`${server}/catalog`);
        if (!res.ok) {
            return { ok: false, error: `Erreur ${res.status} lors de la récupération du registre` };
        }
        const json = await res.json();
        const result = registrySchema.safeParse(json);
        if (!result.success) {
            return {
                ok: false,
                error: 'Format du registre invalide : ' +
                    result.error.issues.map(i => i.message).join('; ')
            };
        }
        return { ok: true, data: result.data };
    }
    catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : String(err)
        };
    }
}
//# sourceMappingURL=registry.js.map