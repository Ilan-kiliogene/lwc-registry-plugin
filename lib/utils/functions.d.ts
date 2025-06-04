import type { ComponentOrClassEntry, Registry } from './types.js';
export declare function findProjectRoot(currentDir: string): string;
export declare function fetchCatalog(this: {
    error: (msg: string) => never;
}, server: string): Promise<Registry>;
export declare function getCleanTypeLabel(type: 'component' | 'class', plural?: boolean): string;
export declare function getNonEmptyItemsOrError(this: {
    error: (msg: string) => never;
}, catalog: Registry, type: 'component' | 'class', label: string, action: string): ComponentOrClassEntry[];
export declare function findEntryOrError(this: {
    error: (msg: string) => never;
}, items: ComponentOrClassEntry[], name: string): ComponentOrClassEntry;
