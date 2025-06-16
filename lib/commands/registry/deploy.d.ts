import { SfCommand } from '@salesforce/sf-plugins-core';
export default class RegistryDeploy extends SfCommand<void> {
    static readonly summary = "D\u00E9ploie un composant LWC ou une classe Apex sur le registre externe";
    static readonly examples: string[];
    private projectRoot;
    private basePathLwc;
    private basePathApex;
    /**
     * Méthode principale orchestrant le déploiement.
     * Chaque étape est déléguée à une méthode spécialisée pour plus de clarté.
     */
    run(): Promise<void>;
    /** Étape 1: Gère les prompts pour l'utilisateur. */
    private gatherUserInput;
    /** Étape 2: Scanne le projet pour trouver tous les composants et classes. */
    private scanProject;
    /** Étape 3: Valide la présence des ressources statiques et de leurs méta-fichiers. */
    private validateStaticResources;
    /** Étape 4: Crée l'archive ZIP contenant tous les artefacts. */
    private createDeploymentPackage;
    /** Étape 5: Envoie le paquet ZIP au serveur. */
    private sendPackage;
    private collectDependencies;
    private getItemDependencies;
    private getLwcDependencies;
    private safeListDirNamesAsync;
    private findAllClassesAsync;
    private checkForbiddenFiles;
    private walkDirAsync;
}
