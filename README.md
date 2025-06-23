# SF Registry Plugin

Ce projet est un plugin pour la CLI Salesforce (`sf`) conçu pour interagir avec un registre externe de composants (LWC et classes Apex). Il facilite le partage, le déploiement et le téléchargement de composants et de leurs dépendances entre différents projets Salesforce.

## 🚀 Objectif

L'objectif principal de ce plugin est de créer un écosystème de partage de code source (principalement des composants LWC et des classes Apex) qui ne sont pas destinés à être packagés dans des managed packages. Il offre une solution légère pour la réutilisation de code, en gérant automatiquement les dépendances entre les composants.

## ✨ Fonctionnalités

  * **Authentification :** Connexion sécurisée au serveur du registre.
  * **Création de Squelettes :** Génération rapide de squelettes pour de nouveaux composants LWC ou classes Apex, prêts à être déployés sur le registre.
  * **Listing :** Affichage de la liste des composants et des classes disponibles sur le registre, avec leurs versions et descriptions.
  * **Déploiement Intelligent :** Analyse des dépendances locales (autres LWC, classes Apex, static resources) et empaquetage de l'ensemble dans une archive ZIP avant de l'envoyer au serveur.
  * **Téléchargement Simplifié :** Téléchargement d'un composant ou d'une classe et extraction automatique dans la structure de dossiers Salesforce locale.
  * **Suppression :** Suppression d'une version spécifique ou de toutes les versions d'un composant/classe du registre.

## 📦 Installation

Dépôt public :

```bash
sf plugins install https://github.com/Ilan-kiliogene/lwc-registry-plugin 
```

Pour un dépôt privé il est possible d'y accéder via une clé ssh exemple :

```bash
sf plugins:install git+ssh://git@github.com:TON-ORGA/mon-plugin-sf.git
```

## 📦 Déinstallation

```bash
sf plugins unistall registry
```

## 🔧 Commandes

Voici le détail de chaque commande disponible dans le plugin.

-----

### `sf registry login`

Cette commande vous authentifie auprès du serveur du registre. Elle vous demandera un nom d'utilisateur et un mot de passe, et en cas de succès, elle sauvegardera un token d'authentification JWT dans un fichier de configuration local à votre système (`~/.my-registry-auth.json`). Ce token sera ensuite utilisé pour toutes les autres commandes.

**Exemple :**

```bash
$ sf registry login
```

-----

### `sf registry list`

Affiche la liste des composants LWC ou des classes Apex disponibles sur le registre. La commande présente les informations dans un tableau clair, incluant les versions, les descriptions et les ressources statiques associées (pour les LWC).

**Exemple :**

```bash
$ sf registry list
```

-----

### `sf registry create`

Crée un squelette pour un nouveau composant LWC ou une nouvelle classe Apex.

  * **Pour un LWC :** Elle utilise `sf lightning component generate`, puis renomme le fichier `.js` en `.ts`.
  * **Pour une classe Apex :** Elle utilise `sf apex class generate`, puis déplace les fichiers `.cls` et `-meta.xml` dans un dossier portant le nom de la classe pour une meilleure organisation.

Dans les deux cas, elle ajoute un fichier `registry-meta.json` dans le dossier généré. Ce fichier doit être complété avec la version et la description avant le déploiement.

**Exemple :**

```bash
$ sf registry create
```

-----

### `sf registry deploy`

C'est la commande la plus complexe. Elle analyse, empaquette et déploie un composant ou une classe sur le registre.

1.  **Analyse :** Elle scanne votre projet pour trouver tous les composants LWC et classes Apex existants.
2.  **Sélection :** Elle vous demande quel élément déployer.
3.  **Métadonnées :** Elle recherche un fichier `registry-meta.json` pour obtenir la version et la description. Si le fichier est absent ou invalide, elle vous les demande interactivement.
4.  **Analyse des dépendances :** Elle parcourt récursivement tous les fichiers de l'élément à déployer pour trouver ses dépendances :
      * Imports de LWC (`import ... from 'c/componentName'`).
      * Imports de classes Apex (`import ... from '@salesforce/apex/ClassName.methodName'`).
      * Imports de ressources statiques (`import ... from '@salesforce/resourceUrl/resourceName'`).
5.  **Validation :** Elle vérifie que les ressources statiques référencées existent bien dans votre projet.
6.  **Empaquetage :** Elle crée une archive `.zip` contenant l'élément principal, toutes ses dépendances (LWC, classes, ressources statiques) et deux fichiers de métadonnées (`metadata.json` et `registry-deps.json`).
7.  **Envoi :** L'archive est envoyée au serveur via une requête `POST` sur l'endpoint `/deploy`.

**Exemple :**

```bash
$ sf registry deploy
```

-----

### `sf registry download`

Télécharge un composant ou une classe depuis le registre.

1.  **Sélection :** Vous choisissez le type (LWC/Classe), le nom et la version à télécharger via des menus interactifs.
2.  **Téléchargement :** La commande télécharge une archive `.zip` depuis le serveur.
3.  **Extraction :** L'archive est extraite dans un dossier temporaire.
4.  **Placement :** Le contenu est ensuite déplacé vers les bons répertoires de votre projet (`force-app/main/default/lwc`, `force-app/main/default/classes`, etc.).
5.  **Gestion des doublons :** Si un élément du même nom existe déjà, son extraction est ignorée pour éviter d'écraser des fichiers locaux.

**Exemple :**

```bash
$ sf registry download
```

-----

### `sf registry delete`

Supprime un élément du registre.

  * La commande vous demande quel élément supprimer (type, nom).
  * Elle vous permet de choisir une version spécifique à supprimer ou de supprimer toutes les versions d'un coup.
  * Une confirmation est demandée avant toute action destructrice.

**Exemple :**

```bash
$ sf registry delete
```

## ⚙️ Architecture et Concepts Clés

Cette section détaille le fonctionnement interne du plugin pour en faciliter la maintenance.

### Structure du Projet

  * `src/commands/registry/`: Contient le code de chaque commande `sf`. Chaque fichier correspond à une commande et gère principalement l'interaction avec l'utilisateur (prompts, logs).
  * `src/utils/`: C'est le cœur du plugin. On y trouve :
      * `functions.ts`: Fonctions utilitaires réutilisées par plusieurs commandes (ex: `fetchCatalog`, `authedFetch`, `findProjectRoot`).
      * `prompts.ts`: Centralise tous les menus interactifs `inquirer` pour une maintenance facile.
      * `constants.ts`: Définit les constantes globales comme les chemins standards (`PATHS`) et les noms de fichiers (`FILENAMES`).
      * `types.ts`: Définit les schémas de données (`zod`) et les types TypeScript pour les objets manipulés (registre, dépendances, etc.).
      * `errors.ts`: Contient les classes d'erreurs personnalisées comme `AuthError`.
  * `messages/`: Fichiers de description pour les commandes et leurs flags.
  * `package.json`: Définit les dépendances du projet (`@salesforce/sf-plugins-core`, `archiver`, `inquirer`, etc.) et les scripts de build/test.

### Authentification

L'authentification est basée sur un token.

1.  La commande `sf registry login` envoie les identifiants à l'endpoint `/auth/login` du serveur.
2.  Le serveur retourne un token JWT.
3.  Ce token est stocké dans `~/.my-registry-auth.json`.
4.  Toutes les autres commandes faisant appel à l'API utilisent la fonction `authedFetch` de `src/utils/functions.ts`. Cette fonction lit le token, l'ajoute à l'en-tête `Authorization: Bearer` de la requête et gère les erreurs de type 401 (token invalide ou expiré).

### Le fichier `registry-meta.json`

Ce fichier est crucial pour le processus de déploiement.

  * Il est généré par `sf registry create`.
  * Il doit contenir la `version` (format `x.y.z`) et la `description` de l'élément à déployer.
  * La commande `sf registry deploy` lit ce fichier. S'il est présent et valide, elle utilise ses valeurs sans poser de questions à l'utilisateur, ce qui est idéal pour une intégration dans un pipeline de CI/CD. S'il est absent ou invalide, elle bascule en mode interactif.

### Empaquetage pour le Déploiement (`deploy`)

Lorsque vous déployez un élément, le plugin crée une archive `.zip` avec une structure précise :

  * À la racine, chaque composant LWC et chaque classe Apex (avec ses dépendances) se trouve dans un dossier à son nom.
  * Un dossier `staticresources` contient les ressources statiques requises et leurs fichiers `-meta.xml`.
  * Un fichier `metadata.json` contient les informations de l'élément principal (nom, type, version, description).
  * Un fichier `registry-deps.json` contient la liste complète de tous les éléments inclus dans l'archive.

Cette archive est ensuite envoyée au serveur, qui se chargera de la traiter pour mettre à jour le registre.

## 🛠️ Développement

Pour contribuer au développement du plugin :

1.  **Cloner le dépôt :**

    ```bash
    git clone <URL_DU_REPO>
    cd lwc-registry-plugin
    ```

2.  **Installer les dépendances :**

    ```bash
    yarn install
    ```

3.  **Compiler le code :**

    ```bash
    yarn build
    ```

4.  **Activer le plugin localement :**

    ```bash
    sf plugins link .
    ```

5.  **Vérifier l'activation du plugin :**

    ```bash
    sf plugins
    ```

6.  **Lancer les commandes :**

    ```bash
    sf registry <commande>
    ```


### Version CLI Salesforce Utilisé : 2.90.4
