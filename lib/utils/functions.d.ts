import { type RequestInit, type Response } from 'node-fetch';
import { ComponentOrClassEntry, Registry } from './types.js';
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
export declare function safeRemove(this: {
    error: (msg: string) => never;
}, fileOrDir: string): Promise<void>;
export declare function getDestination(targetDir: string, itemType: 'component' | 'class', itemName: string): string;
export declare function fileExistsAndIsFile(filePath: string): Promise<boolean>;
export declare function authedFetch(url: string, options?: RequestInit): Promise<Response>;
