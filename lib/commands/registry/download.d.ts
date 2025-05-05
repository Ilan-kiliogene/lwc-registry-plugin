import { SfCommand } from '@salesforce/sf-plugins-core';
export type RegistryVersion = {
  version: string;
  registryDependencies: string[];
};
export type RegistryItem = {
  name: string;
  description: string;
  versions: RegistryVersion[];
};
export type RegistryResponse = {
  name: string;
  items: RegistryItem[];
};
export type ComponentInfoResponse = {
  name: string;
  description: string;
  versions: string[];
};
export default class RegistryDownload extends SfCommand<void> {
  static readonly summary = 'T\u00E9l\u00E9charge un composant LWC depuis un registre externe (avec menu interactif).';
  run(): Promise<void>;
}
