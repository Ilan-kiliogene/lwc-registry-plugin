import { z } from 'zod';

// ============================================
//  CONFIGURATION DES VARIABLES D'ENVIRONNEMENT
// ============================================

const rawConfig = {
  SERVER_URL: 'https://registry.kiliogene.com',
  FORBIDDEN_EXTENSIONS: [
    '.sh',
    '.bash',
    '.zsh',
    '.bat',
    '.cmd',
    '.ps1',
    '.exe',
    '.scr',
    '.vbs',
    '.msi',
    '.php',
    '.py',
    '.pl',
    '.rb',
    '.jar',
    '.com',
    '.wsf',
  ],
  // ...autres configs ici si besoin
};

const configSchema = z.object({
  SERVER_URL: z.string().url(),
  FORBIDDEN_EXTENSIONS: z.array(z.string().startsWith('.')).nonempty(),
  // autres variables si besoin...
});

const parsed = configSchema.safeParse(rawConfig);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Mauvaise configuration interne :', parsed.error.flatten().fieldErrors);
  process.exit(1); // Stoppe le process si la config est invalide
}

export const SERVER_URL = parsed.data.SERVER_URL;
export const FORBIDDEN_EXTENSIONS = parsed.data.FORBIDDEN_EXTENSIONS;
