import { SfCommand } from '@salesforce/sf-plugins-core';
export default class RegistryDownload extends SfCommand<void> {
    static readonly summary = "T\u00E9l\u00E9charge un composant LWC ou une classe Apex depuis un registre externe (avec menu interactif).";
    static readonly examples: string[];
    run(): Promise<void>;
    private downloadZip;
    private handleExtraction;
    private handleStaticResources;
    private copyStaticResource;
}
