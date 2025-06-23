import path from 'node:path';
import inquirer from 'inquirer';
import { findProjectRoot } from './functions.js';
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
export async function promptValidNameCommandCreate(message) {
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
export async function promptVersionToDelete(versions) {
    if (!versions) {
        this.error('Aucune version trouvé pour la supprimer');
    }
    if (versions.length === 1) {
        return versions[0].version;
    }
    const { which } = await inquirer.prompt([
        {
            name: 'which',
            type: 'list',
            message: 'Supprimer une version spécifique ou toutes ?',
            choices: [
                ...versions.map((version) => ({
                    name: `v${version.version} - ${version.description}`,
                    value: version.version,
                })),
                { name: 'Toutes les versions', value: 'all' },
            ],
        },
    ]);
    return which !== 'all' ? which : null;
}
export async function promptDeleteConfirmation(params) {
    const { type, name, version } = params;
    const confirmMsg = version
        ? `Supprimer ${type} "${name}" version ${version} ?`
        : `Supprimer toutes les versions de ${type} "${name}" ?`;
    const { ok } = await inquirer.prompt([
        {
            name: 'ok',
            type: 'confirm',
            message: confirmMsg,
        },
    ]);
    return ok;
}
export async function promptSelectVersion(entry, name) {
    const versions = entry.versions.map((v) => v.version).reverse();
    const { version } = await inquirer.prompt([
        {
            name: 'version',
            type: 'list',
            message: `Quelle version de ${name} ?`,
            choices: versions,
        },
    ]);
    return version;
}
export async function promptTargetDirectory() {
    const { choice } = await inquirer.prompt([
        {
            name: 'choice',
            type: 'list',
            message: 'Dossier cible ? (les composants LWC iront dans lwc, les classes dans classes)',
            choices: ['force-app/main/default/', 'Autre...'],
        },
    ]);
    if (choice === 'Autre...') {
        const { target } = await inquirer.prompt([
            {
                name: 'target',
                type: 'input',
                message: 'Tape un chemin :',
                validate: (input) => (input && input.trim().length > 0 ? true : 'Le chemin ne peut pas être vide.'),
            },
        ]);
        return target.trim();
    }
    const projectRoot = findProjectRoot(process.cwd());
    const finalDir = path.join(projectRoot, choice);
    return finalDir;
}
export async function promptVersionToEnter(message = 'Numéro de version à déployer ? (ex: 1.0.0)') {
    const { version } = await inquirer.prompt([
        {
            name: 'version',
            type: 'input',
            message,
            validate: (input) => (/^\d+\.\d+\.\d+$/.test(input) ? true : 'Format attendu : x.y.z'),
        },
    ]);
    return version;
}
export async function promptDescriptionToEnter(message = 'Description ?') {
    const { description } = await inquirer.prompt([
        {
            name: 'description',
            type: 'input',
            message,
            validate: (input) => input.trim() !== '' || 'La description est requise.',
        },
    ]);
    return description;
}
//# sourceMappingURL=prompts.js.map