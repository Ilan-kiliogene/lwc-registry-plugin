import path from 'node:path';
import inquirer from 'inquirer';
import type { ComponentOrClassEntry, ComponentOrClassVersion } from './types';
import { findProjectRoot } from './functions';


// =======================================================================
//  PROMPT POUR CHOISIR LE TYPE D'ENTRÉE (COMPOSANT OU CLASSE)
// =======================================================================
export async function promptComponentOrClass(message: string): Promise<'component' | 'class'> {
  const { type } = await inquirer.prompt<{ type: 'component' | 'class' }>([
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
export async function promptSelectName(message: string, names: string[]): Promise<string> {
  const { name } = await inquirer.prompt<{ name: string }>([
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
export async function promptValidNameCommandCreate(message: string): Promise<string> {
  const { name } = await inquirer.prompt<{ name: string }>([
    {
      name: 'name',
      type: 'input',
      message,
      validate: (v) => /^[a-zA-Z0-9_]+$/.test(v) || 'Nom invalide (alphanumérique uniquement)',
    },
  ]);
  return name;
}


// =============================================
//  PROMPT POUR CHOISIR QUELLE VERSION SUPPRIMER
// =============================================
export async function promptVersionToDelete(
  this: { error: (msg: string) => never},
  versions: ComponentOrClassVersion[]
): Promise<string | null> {
  if (!versions){
    this.error('Aucune version trouvé pour la supprimer')
  }
  if (versions.length === 1) {
    return versions[0].version;
  }

  const { which } = await inquirer.prompt<{ which: string }>([
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


// =============================================
//  PROMPT POUR CONFIRMER LA VERSION À SUPPRIMER
// =============================================
export async function promptDeleteConfirmation(
  params: { type: string; name: string; version?: string | null }
): Promise<boolean> {
  const { type, name, version } = params;
  const confirmMsg = version
    ? `Supprimer ${type} "${name}" version ${version} ?`
    : `Supprimer toutes les versions de ${type} "${name}" ?`;

  const { ok } = await inquirer.prompt<{ ok: boolean }>([
    {
      name: 'ok',
      type: 'confirm',
      message: confirmMsg,
    },
  ]);
  return ok;
}


// =============================================
//  PROMPT POUR CHOISIR LA VERSION A TÉLÉCHARGER
// =============================================
export async function promptSelectVersion(
  entry: ComponentOrClassEntry,
  name: string
): Promise<string> {
  const versions = entry.versions.map((v) => v.version).reverse();
  const { version } = await inquirer.prompt<{ version: string }>([
    {
      name: 'version',
      type: 'list',
      message: `Quelle version de ${name} ?`,
      choices: versions,
    },
  ]);
  return version;
}


// =============================================
//  PROMPT POUR CHOISIR LE CHEMIN OÙ TÉLÉCHARGER
// =============================================
export async function promptTargetDirectory(): Promise<string> {
  const { choice } = await inquirer.prompt<{ choice: string }>([
    {
      name: 'choice',
      type: 'list',
      message: 'Dossier cible ? (les composants LWC iront dans lwc, les classes dans classes)',
      choices: ['force-app/main/default/', 'Autre...'],
    },
  ]);

  if (choice === 'Autre...') {
    const { target } = await inquirer.prompt<{ target: string }>([
      {
        name: 'target',
        type: 'input',
        message: 'Tape un chemin :',
        validate: (input: string) =>
          input && input.trim().length > 0 ? true : 'Le chemin ne peut pas être vide.',
      },
    ]);
    return target.trim();
  }
  const projectRoot = findProjectRoot(process.cwd());
  const finalDir = path.join(projectRoot,choice);
  return finalDir;
}