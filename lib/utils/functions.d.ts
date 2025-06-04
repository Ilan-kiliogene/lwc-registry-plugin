import { Registry } from './types.js';
export declare function promptComponentOrClass(message: string): Promise<'component' | 'class'>;
export declare function promptSelectName(message: string, names: string[]): Promise<string>;
export declare function promptValidName(message: string): Promise<string>;
export declare function findProjectRoot(currentDir: string): string;
export declare function fetchCatalog(server: string): Promise<{
    ok: true;
    data: Registry;
} | {
    ok: false;
    error: string;
}>;
