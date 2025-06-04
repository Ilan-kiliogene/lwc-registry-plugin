import { z } from 'zod';

// ============================================
//  CONFIGURATION DES VARIABLES D'ENVIRONNEMENT
// ============================================

const rawConfig = {
  SERVER_URL: 'https://registry.kiliogene.com',
  // ...autres configs ici si besoin
};

const configSchema = z.object({
  SERVER_URL: z.string().url(),
  // autres variables si besoin...
});

const parsed = configSchema.safeParse(rawConfig);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Mauvaise configuration interne :', parsed.error.flatten().fieldErrors);
  process.exit(1); // Stoppe le process si la config est invalide
}

export const SERVER_URL = parsed.data.SERVER_URL;