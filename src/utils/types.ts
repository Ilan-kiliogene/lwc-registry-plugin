import { z } from 'zod';

// --- Définition d’une dépendance d’un composant ou d’une classe
export const DependencySchema = z.object({
  name: z.string(),
  type: z.string(),
  version: z.string(),
});

// --- Schéma d’une version d’un composant ou d’une classe
export const versionSchema = z.object({
  version: z.string(),
  description: z.string(),
  hash: z.string(),
  staticresources: z.array(z.string()),
  registryDependencies: z.array(DependencySchema),
});

// --- Schéma d’une entrée (composant ou classe) du registre
export const entrySchema = z.object({
  name: z.string(),
  versions: z.array(versionSchema),
});

// --- Schéma du registre complet (liste des composants et classes)
export const registrySchema = z.object({
  component: z.array(entrySchema),
  class: z.array(entrySchema),
});

export type Dependency = z.infer<typeof DependencySchema>;
export type ComponentOrClassVersion = z.infer<typeof versionSchema>;
export type ComponentOrClassEntry = z.infer<typeof entrySchema>;
export type Registry = z.infer<typeof registrySchema>;

export type ItemType = 'component' | 'class';

export type RegistryDep = Readonly<{
  name: string;
  type: ItemType;
  dependencies: Array<{ name: string; type: ItemType }>;
  staticresources: string[];
  version?: string;
}>;