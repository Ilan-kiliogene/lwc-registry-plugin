import { SfCommand } from '@salesforce/sf-plugins-core';
export default class RegistryDeploy extends SfCommand<void> {
    static readonly summary = "D\u00E9ploie un composant LWC ou une classe Apex sur le registre externe";
    static readonly examples: string[];
    private projectRoot;
    private basePathLwc;
    private basePathApex;
    run(): Promise<void>;
    private gatherUserInput;
    private scanProject;
    private validateStaticResources;
    private createDeploymentPackage;
    private sendPackage;
    private collectDependencies;
    private getItemDependencies;
    private getLwcDependencies;
    private findAllClassesAsync;
    private checkForbiddenFiles;
    private walkDirAsync;
    private tryReadRegistryMeta;
}
