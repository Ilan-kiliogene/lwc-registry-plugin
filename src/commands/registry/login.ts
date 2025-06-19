import { promises as fs } from 'node:fs';
import { SfCommand } from '@salesforce/sf-plugins-core';
import inquirer from 'inquirer';
import fetch from 'node-fetch';
import { SERVER_URL, AUTH_CONFIG_FILE_PATH } from '../../utils/constants.js';

export default class RegistryLogin extends SfCommand<void> {
  // eslint-disable-next-line sf-plugin/no-hardcoded-messages-commands
  public static readonly summary = "S'authentifie auprès du registre et sauvegarde le token d'accès.";
  public static readonly examples = ['$ sf registry login'];

  public async run(): Promise<void> {
    const { username, password } = await inquirer.prompt<{ username: string; password: string }>([
      {
        name: 'username',
        message: 'Nom d\'utilisateur du registre :',
        type: 'input', 
      },
      {
        name: 'password',
        message: 'Mot de passe du registre :',
        type: 'password',
        mask: '*',
      },
    ]);

    if (!username || !password) {
      this.error('Le nom d\'utilisateur et le mot de passe sont requis.');
    }

    this.log('⏳ Tentative d\'authentification auprès du serveur...');
    try {
      const res = await fetch(`${SERVER_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const body = (await res.json()) as { token?: string; error?: string };


      if (!res.ok || !body.token) {
        this.error(`❌ Échec de l'authentification (Status: ${res.status}) - Erreur serveur: ${body.error ?? 'Aucune précision'}`);
      }

      const configData = { token: body.token };
      await fs.writeFile(AUTH_CONFIG_FILE_PATH, JSON.stringify(configData, null, 2), 'utf-8');
      this.log('✅ Authentification réussie ! Le token a été sauvegardé');

    } catch (error) {
      this.error(`❌ Échec de la connexion : ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}