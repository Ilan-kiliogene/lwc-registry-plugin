import type { ComponentOrClassEntry, ComponentOrClassVersion } from './types.js';
export declare function promptComponentOrClass(message: string): Promise<'component' | 'class'>;
export declare function promptSelectName(message: string, names: string[]): Promise<string>;
export declare function promptValidNameCommandCreate(message: string): Promise<string>;
export declare function promptVersionToDelete(this: {
    error: (msg: string) => never;
}, versions: ComponentOrClassVersion[]): Promise<string | null>;
export declare function promptDeleteConfirmation(params: {
    type: string;
    name: string;
    version?: string | null;
}): Promise<boolean>;
export declare function promptSelectVersion(entry: ComponentOrClassEntry, name: string): Promise<string>;
export declare function promptTargetDirectory(): Promise<string>;
export declare function promptVersionToEnter(message?: string): Promise<string>;
export declare function promptDescriptionToEnter(message?: string): Promise<string>;
