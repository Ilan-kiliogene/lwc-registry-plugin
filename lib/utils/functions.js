import path from 'node:path';
import fs from 'node:fs';
import inquirer from 'inquirer';
import { registrySchema } from './types.js';
// =======================================================================
//  PROMPT POUR CHOISIR LE TYPE D'ENTRÉE (COMPOSANT OU CLASSE)
// =======================================================================
export async function promptComponentOrClass(message) {
    const { type } = await inquirer.prompt([
        {
            name: 'type',
            type: 'list',
            message,
            choices: [
                { name: 'Composant LWC', value: 'component' },
                { name: 'Classe Apex', value: 'class' },
            ],
        },
    ]);
    return type;
}
// ===============================================
//  PROMPT POUR CHOISIR UN COMPOSANT OU UNE CLASSE
// ===============================================
export async function promptSelectName(message, names) {
    const { name } = await inquirer.prompt([
        {
            name: 'name',
            type: 'list',
            message,
            choices: names,
        },
    ]);
    return name;
}
// ==================================
//  PROMPT POUR ÉCRIRE UN NOM VALIDE
// ==================================
export async function promptValidName(message) {
    const { name } = await inquirer.prompt([
        {
            name: 'name',
            type: 'input',
            message,
            validate: (v) => /^[a-zA-Z0-9_]+$/.test(v) || 'Nom invalide (alphanumérique uniquement)',
        },
    ]);
    return name;
}
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
        if (!res.ok) {
            return { ok: false, error: `Erreur ${res.status} lors de la récupération du registre` };
        }
        const json = await res.json();
        const result = registrySchema.safeParse(json);
        if (!result.success) {
            return {
                ok: false,
                error: 'Format du registre invalide : ' + result.error.issues.map(i => i.message).join('; ')
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
//# sourceMappingURL=functions.js.map