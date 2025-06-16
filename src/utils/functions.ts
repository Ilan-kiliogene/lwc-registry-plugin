import path from 'node:path';
import fs from 'node:fs';
import fsExtra from 'fs-extra';
import { ComponentOrClassEntry, Registry } from './types.js';
import { registrySchema } from './types.js';

// ===============================================
//  UTILITAIRE : Trouve la racine d’un projet SFDX
// ===============================================
export function findProjectRoot(currentDir: string): string {
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
export async function fetchCatalog(this: { error: (msg: string) => never }, server: string): Promise<Registry> {
  try {
    const res = await fetch(`${server}/catalog`);
    if (!res.ok) this.error(`Erreur ${res.status} lors de la récupération du registre`);
    const json = await res.json();

    const result = registrySchema.safeParse(json);
    if (!result.success) {
      this.error('Format du registre invalide : ' + result.error.issues.map((i) => i.message).join('; '));
    }
    return result.data;
  } catch (error) {
    this.error(error instanceof Error ? error.message : String(error));
  }
}

// =====================================================
//  UTILITAIRE : Récupère et affiche proprement le type
// =====================================================
export function getCleanTypeLabel(type: 'component' | 'class', plural = true): string {
  if (type === 'component') return plural ? 'Composants LWC' : 'composant LWC';
  return plural ? 'Classes Apex' : 'classe Apex';
}

// ===========================================================
//  UTILITAIRE : Récupère la partie du catalog voulue non vide
// ===========================================================
export function getNonEmptyItemsOrError(
  this: { error: (msg: string) => never },
  catalog: Registry,
  type: 'component' | 'class',
  label: string,
  action: string
): ComponentOrClassEntry[] {
  const items = catalog[type];
  if (!items.length) {
    this.error(`Aucun ${label} ${action}.`);
  }
  return items;
}

// ======================================================
//  UTILITAIRE : Trouve une entrée dans le catalog valide
// ======================================================
export function findEntryOrError(
  this: { error: (msg: string) => never },
  items: ComponentOrClassEntry[],
  name: string
): ComponentOrClassEntry {
  const selectedEntry = items.find((element) => element.name === name);
  if (!selectedEntry) {
    this.error(`Élément "${name}" introuvable.`);
  }
  return selectedEntry;
}

// ===============================================
//  UTILITAIRE : Supprime un fichier ou un dossier
// ===============================================
export async function safeRemove(this: { error: (msg: string) => never }, fileOrDir: string): Promise<void> {
  try {
    await fsExtra.remove(fileOrDir);
  } catch (err) {
    this.error(`⚠️ Impossible de supprimer ${fileOrDir}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// =================================================
//  UTILITAIRE : Renvoie le bon chemin selon le type
// =================================================
export function getDestination(targetDir: string, itemType: 'component' | 'class', itemName: string): string {
  if (itemType === 'component') {
    return path.join(targetDir, 'lwc', itemName);
  }
  return path.join(targetDir, 'classes', itemName);
}


export async function fileExistsAndIsFile(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.promises.stat(filePath);
    return stats.isFile(); // On vérifie en plus que ce n'est pas un dossier
  } catch (error) {
    return false;
  }
}