import { SfCommand } from '@salesforce/sf-plugins-core';
/** Types partagés avec le serveur */
export interface RegistryVersion {
    version: string;
    description: string;
    hash: string;
    registryDependencies: string[];
}
export interface RegistryEntry {
    name: string;
    versions: RegistryVersion[];
}
export interface RegistryResponse {
    name: string;
    components: RegistryEntry[];
    classes: RegistryEntry[];
}
export default class RegistryDownload extends SfCommand<void> {
    static readonly summary = "T\u00E9l\u00E9charge un composant LWC ou une classe Apex depuis un registre externe (avec menu interactif).";
    run(): Promise<void>;
}
