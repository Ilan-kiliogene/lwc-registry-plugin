import { SfCommand } from '@salesforce/sf-plugins-core';
export default class RegistryTemplate extends SfCommand<void> {
    static readonly summary = "Cr\u00E9e un squelette composant LWC ou classe Apex avec meta JSON \u00E0 compl\u00E9ter";
    static readonly examples: string[];
    run(): Promise<void>;
    private getTargetFolder;
    private createLwcComponent;
    private createApexClass;
    private createRegistryMetaJson;
}
