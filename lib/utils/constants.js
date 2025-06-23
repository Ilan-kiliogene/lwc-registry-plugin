import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
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
};
const configSchema = z.object({
    SERVER_URL: z.string().url(),
    FORBIDDEN_EXTENSIONS: z.array(z.string().startsWith('.')).nonempty(),
});
const parsed = configSchema.safeParse(rawConfig);
if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('❌ Mauvaise configuration interne :', parsed.error.flatten().fieldErrors);
    process.exit(1);
}
export const SERVER_URL = parsed.data.SERVER_URL;
export const FORBIDDEN_EXTENSIONS = parsed.data.FORBIDDEN_EXTENSIONS;
export const FILENAMES = {
    // Fichier de métadonnées pour le déploiement (dans le ZIP)
    METADATA: 'metadata.json',
    // Fichier des dépendances (dans le ZIP)
    DEPS: 'registry-deps.json',
    // Fichier local d'aide au déploiement généré par la commande `create`
    REGISTRY_META: 'registry-meta.json',
};
export const registryMetaFileSchema = z.object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Le format de la version doit être x.y.z'),
    description: z.string().min(1, 'La description ne peut pas être vide.'),
});
export const PATHS = {
    STATIC_RESOURCES: 'force-app/main/default/staticresources',
    LWC: 'force-app/main/default/lwc',
    APEX: 'force-app/main/default/classes',
};
export const AUTH_CONFIG_FILE_PATH = path.join(os.homedir(), '.my-registry-auth.json');
//# sourceMappingURL=constants.js.map