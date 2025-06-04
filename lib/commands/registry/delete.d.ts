import { SfCommand } from '@salesforce/sf-plugins-core';
export default class RegistryDelete extends SfCommand<void> {
    static readonly summary = "Supprime un composant ou une classe du registre";
    static readonly examples: string[];
    run(): Promise<void>;
    private deleteFromRegistry;
}
