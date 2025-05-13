import { SfCommand } from '@salesforce/sf-plugins-core';
export default class RegistryDeploy extends SfCommand<void> {
    static readonly summary = "D\u00E9ploie un composant LWC ou une classe Apex sur le registre externe";
    run(): Promise<void>;
}
