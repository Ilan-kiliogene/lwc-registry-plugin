import { SfCommand } from '@salesforce/sf-plugins-core';
export default class RegistryList extends SfCommand<void> {
    static readonly summary = "Affiche la liste des composants ou classes du registre";
    static readonly examples: string[];
    run(): Promise<void>;
    private formatRegistry;
}
