import path from 'node:path';
import fs from 'node:fs';
import fsExtra from 'fs-extra';
import fetch, { type RequestInit, type Response } from 'node-fetch';
import { ComponentOrClassEntry, Registry, registrySchema } from './types.js';
import { AUTH_CONFIG_FILE_PATH } from './constants.js';
import { AuthError } from './errors.js';

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

export async function fetchCatalog(this: { error: (msg: string) => never }, server: string): Promise<Registry> {
  try {
    const res   = await authedFetch.call(this, `${server}/catalog`);
    if (!res.ok) throw new Error(`Erreur ${res.status} lors de la récupération du registre`);
    const json  = await res.json();
    const check = registrySchema.safeParse(json);
    if (!check.success) {
      this.error('Format du registre invalide : ' + check.error.issues.map(i => i.message).join('; '));
    }
    return check.data;
  } catch (err) {
    if (err instanceof AuthError) throw err;   // ← on laisse passer
    this.error(err instanceof Error ? err.message : String(err));
  }
}


export function getCleanTypeLabel(type: 'component' | 'class', plural = true): string {
  if (type === 'component') return plural ? 'Composants LWC' : 'composant LWC';
  return plural ? 'Classes Apex' : 'classe Apex';
}


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


export async function safeRemove(this: { error: (msg: string) => never }, fileOrDir: string): Promise<void> {
  try {
    await fsExtra.remove(fileOrDir);
  } catch (err) {
    this.error(`⚠️ Impossible de supprimer ${fileOrDir}: ${err instanceof Error ? err.message : String(err)}`);
  }
}


export function getDestination(targetDir: string, itemType: 'component' | 'class', itemName: string): string {
  if (itemType === 'component') {
    return path.join(targetDir, 'lwc', itemName);
  }
  return path.join(targetDir, 'classes', itemName);
}

export async function fileExistsAndIsFile(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.promises.stat(filePath);
    return stats.isFile();
  } catch (error) {
    return false;
  }
}


async function getAuthToken(): Promise<string | undefined> {
  try {
    const configContent = await fs.promises.readFile(AUTH_CONFIG_FILE_PATH, 'utf-8');
    const config: unknown = JSON.parse(configContent);
    if (config && typeof config === 'object' && 'token' in config && typeof config.token === 'string') {
      return config.token;
    }
    return undefined;
  } catch (error) {    
    return undefined;
  }
}


export async function authedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getAuthToken();

  if (!token) {
    throw new AuthError(
      'no_token',
      'Vous n’êtes pas authentifié. Lancez « sf registry login ».'
    );
  }

  const res = await fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });

  if (res.status !== 401) return res;

  let msg = 'Accès non autorisé (401).';
  try {
    const body = (await res.json()) as { code: string; error: string };
    if (body.code === 'token_expired') {
      msg = body.error 
      throw new AuthError('token_expired', msg);
    }
    if (body.code === 'token_invalid') {
      msg = body.error 
      throw new AuthError('token_invalid', msg);
    }
  } catch {
    /* parsing JSON raté : on garde le message générique */
  }
  throw new AuthError('token_invalid', msg);
}
