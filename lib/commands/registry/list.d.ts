import { SfCommand } from '@salesforce/sf-plugins-core';
export default class RegistryList extends SfCommand<void> {
    static readonly summary = "Affiche la liste des composants ou classes du registre";
    run(): Promise<void>;
}
