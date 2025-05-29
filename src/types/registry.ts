import { z } from 'zod'

// Schéma d’une dépendance
export const DependencySchema = z.object({
  name: z.string(),
  type: z.string(),
  version: z.string(), 
})

// Schéma d’une version de composant/classe
export const versionSchema = z.object({
  version: z.string(),
  description: z.string(),
  hash: z.string(),
  staticresources: z.array(z.string()),
  registryDependencies: z.array(DependencySchema),
})

// Schéma d’une entrée (composant ou classe)
export const entrySchema = z.object({
  name: z.string(),
  versions: z.array(versionSchema),
})

// Schéma du registre complet
export const registrySchema = z.object({
  component: z.array(entrySchema),
  class: z.array(entrySchema),
})

export type Dependency = z.infer<typeof DependencySchema>
export type ComponentOrClassVersion = z.infer<typeof versionSchema>
export type ComponentOrClassEntry = z.infer<typeof entrySchema>
export type Registry = z.infer<typeof registrySchema>