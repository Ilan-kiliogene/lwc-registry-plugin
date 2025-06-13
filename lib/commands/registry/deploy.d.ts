import { SfCommand } from '@salesforce/sf-plugins-core';
export default class RegistryDeploy extends SfCommand<void> {
    static readonly summary = "D\u00E9ploie un composant LWC ou une classe Apex (et ses d\u00E9pendances r\u00E9cursives) sur le registre externe";
    static readonly examples: string[];
    run(): Promise<void>;
    private getItems;
}
