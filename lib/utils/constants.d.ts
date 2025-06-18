import { z } from 'zod';
export declare const SERVER_URL: string;
export declare const FORBIDDEN_EXTENSIONS: [string, ...string[]];
export declare const FILENAMES: {
    METADATA: string;
    DEPS: string;
    REGISTRY_META: string;
};
export declare const registryMetaFileSchema: z.ZodObject<{
    version: z.ZodString;
    description: z.ZodString;
}, "strip", z.ZodTypeAny, {
    version: string;
    description: string;
}, {
    version: string;
    description: string;
}>;
export declare const PATHS: {
    STATIC_RESOURCES: string;
    LWC: string;
    APEX: string;
};
export declare const AUTH_CONFIG_FILE_PATH: string;
