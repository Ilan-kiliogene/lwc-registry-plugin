# summary

Télécharge un composant LWC depuis un registre externe (avec menu interactif).

# description

Cette commande permet de :

- Parcourir les composants disponibles dans un registre LWC
- Choisir une version
- Spécifier un dossier d’extraction
  Le composant est ensuite téléchargé et extrait automatiquement.

# examples

$ sf registry download
$ sf registry download --interactive

# flags.name.summary

Nom du composant à télécharger

# flags.version.summary

Version spécifique du composant à télécharger

# flags.target.summary

Dossier local dans lequel extraire le composant

# flags.server.summary

URL du serveur distant hébergeant le registre

# errors.download.failed

Erreur lors du téléchargement : {0}

# prompts.selectComponent

Quel composant veux-tu télécharger ?

# prompts.selectVersion

Quelle version de {0} ?

# prompts.selectTargetFolder

Dossier cible ?

# prompts.customPath

Tape un chemin :
