import { SfCommand } from '@salesforce/sf-plugins-core';
export default class RegistryLogin extends SfCommand<void> {
    static readonly summary = "S'authentifie aupr\u00E8s du registre et sauvegarde le token d'acc\u00E8s.";
    static readonly examples: string[];
    run(): Promise<void>;
}
