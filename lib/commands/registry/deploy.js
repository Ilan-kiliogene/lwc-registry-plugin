import { createReadStream, createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { finished } from 'node:stream/promises';
import archiver from 'archiver';
import { SfCommand } from '@salesforce/sf-plugins-core';
import { SERVER_URL, FORBIDDEN_EXTENSIONS, PATHS, FILENAMES, registryMetaFileSchema } from '../../utils/constants.js';
import { promptComponentOrClass, promptSelectName, promptVersionToEnter, promptDescriptionToEnter, } from '../../utils/prompts.js';
import { findProjectRoot, getCleanTypeLabel, fileExistsAndIsFile, authedFetch } from '../../utils/functions.js';
import { AuthError } from '../../utils/errors.js';
class RegistryDeploy extends SfCommand {
    /**
     * Méthode principale orchestrant le déploiement.
     * Chaque étape est déléguée à une méthode spécialisée pour plus de clarté.
     */
    async run() {
        try {
            this.projectRoot = findProjectRoot(process.cwd());
            this.basePathLwc = path.join(this.projectRoot, PATHS.LWC);
            this.basePathApex = path.join(this.projectRoot, PATHS.APEX);
            // Étape 1 : Analyse
            const { allComponents, allClasses, classNameToDir } = await this.scanProject();
            // Étape 2 : Interaction utilisateur
            const userInput = await this.gatherUserInput(allComponents, allClasses, classNameToDir);
            // Étape 3 : Collecte des dépendances
            const analysisParams = { allComponents, allClasses, classNameToDir, version: userInput.version };
            const itemsToZip = await this.collectDependencies(userInput.name, userInput.type, analysisParams);
            // Étape 4 : Validation
            const staticResources = new Set(itemsToZip.flatMap((item) => item.staticresources));
            await this.validateStaticResources(staticResources);
            // Étape 5 : Création du paquet
            const zipFilePath = await this.createDeploymentPackage(itemsToZip, staticResources, userInput, classNameToDir);
            // Étape 6 : Envoi et nettoyage
            await this.sendPackage(zipFilePath, userInput.type);
            await fs.unlink(zipFilePath);
            this.log('✅ Déploiement terminé avec succès !');
        }
        catch (error) {
            this.error(`❌ Le déploiement a échoué : ${error.message}`);
        }
    }
    /** Étape 1: Gère les prompts pour l'utilisateur. */
    async gatherUserInput(allComponents, allClasses, classNameToDir) {
        const type = await promptComponentOrClass('Que voulez vous déployer ?');
        const cleanType = getCleanTypeLabel(type, false);
        const items = type === 'component' ? allComponents : allClasses;
        if (items.length === 0) {
            this.error(`❌ Aucun ${cleanType} trouvé.`);
        }
        const name = await promptSelectName(`Quel ${cleanType} voulez-vous déployer ?`, items);
        let version;
        let description;
        const meta = await this.tryReadRegistryMeta(type, name, classNameToDir);
        if (meta) {
            this.log(`ℹ️ Fichier ${FILENAMES.REGISTRY_META} trouvé et valide. Utilisation des valeurs...`);
            version = meta.version;
            description = meta.description;
        }
        else {
            this.log(`ℹ️ Fichier ${FILENAMES.REGISTRY_META} non trouvé ou invalide. Passage en mode interactif...`);
            version = await promptVersionToEnter();
            description = await promptDescriptionToEnter();
        }
        return { name, type, version, description };
    }
    /** Étape 2: Scanne le projet pour trouver tous les composants et classes. */
    async scanProject() {
        try {
            const [allComponents, { allClasses, classNameToDir }] = await Promise.all([
                // Cette fonction ne fait plus appel à this.error()
                safeListDirNamesAsync(this.basePathLwc),
                this.findAllClassesAsync(this.basePathApex),
            ]);
            return { allComponents, allClasses, classNameToDir };
        }
        catch (error) {
            // C'est ici, à un plus haut niveau, qu'on gère l'affichage de l'erreur
            this.error(`❌ Une erreur est survenue lors de l'analyse du projet : ${error.message}`);
        }
    }
    /** Étape 3: Valide la présence des ressources statiques et de leurs méta-fichiers. */
    async validateStaticResources(resources) {
        const checks = Array.from(resources).map(async (resName) => {
            const resourceDir = path.join(this.projectRoot, PATHS.STATIC_RESOURCES);
            const metaFile = path.join(resourceDir, `${resName}.resource-meta.xml`);
            if (!(await findStaticResourceFileAsync(resourceDir, resName))) {
                throw new Error(`Ressource statique "${resName}" référencée mais introuvable.`);
            }
            if (!(await fileExistsAndIsFile(metaFile))) {
                throw new Error(`Fichier .resource-meta.xml manquant pour la ressource statique "${resName}".`);
            }
        });
        try {
            await Promise.all(checks);
        }
        catch (err) {
            this.error(`❌ Erreur de validation des ressources statiques : ${err.message}\nAbandon du déploiement.`);
        }
    }
    /** Étape 4: Crée l'archive ZIP contenant tous les artefacts. */
    async createDeploymentPackage(itemsToZip, staticResources, metadata, classNameToDir) {
        const tmpFile = path.join(os.tmpdir(), `sf-deploy-${Date.now()}.zip`);
        const output = createWriteStream(tmpFile);
        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(output);
        // Ajoute les composants et classes
        for (const item of itemsToZip) {
            const dirToAdd = item.type === 'component' ? path.join(this.basePathLwc, item.name) : classNameToDir[item.name];
            archive.directory(dirToAdd, item.name);
        }
        // Ajoute les ressources statiques
        const resourceDir = path.join(this.projectRoot, PATHS.STATIC_RESOURCES);
        const resourcePromises = Array.from(staticResources).map(async (resName) => {
            const mainFile = await findStaticResourceFileAsync(resourceDir, resName);
            const metaFile = path.join(resourceDir, `${resName}.resource-meta.xml`);
            return { mainFile, metaFile };
        });
        const resolvedResources = await Promise.all(resourcePromises);
        for (const { mainFile, metaFile } of resolvedResources) {
            if (mainFile) {
                archive.file(mainFile, { name: path.join('staticresources', path.basename(mainFile)) });
            }
            archive.file(metaFile, { name: path.join('staticresources', path.basename(metaFile)) });
        }
        // Ajoute les fichiers de métadonnées
        archive.append(JSON.stringify(metadata, null, 2), { name: FILENAMES.METADATA });
        archive.append(JSON.stringify(itemsToZip, null, 2), { name: FILENAMES.DEPS });
        await archive.finalize();
        await finished(output); // Utilisation de stream/promises pour une attente propre
        return tmpFile;
    }
    /** Étape 5: Envoie le paquet ZIP au serveur. */
    async sendPackage(zipFilePath, type) {
        this.log(`📤 Envoi de ${zipFilePath} (${type}) vers ${SERVER_URL}/deploy...`);
        try {
            const stats = await fs.stat(zipFilePath);
            const res = await authedFetch.call(this, `${SERVER_URL}/deploy`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/zip',
                    'Content-Length': stats.size.toString(),
                },
                body: createReadStream(zipFilePath),
            });
            const resultText = await res.text();
            if (!res.ok) {
                this.error(`❌ Échec HTTP ${res.status} : ${resultText}`);
            }
            this.log(`✅ Réponse du serveur : ${resultText}`);
        }
        catch (error) {
            if (error instanceof AuthError) {
                // on affiche exactement le message défini dans authedFetch
                this.error(error.message);
            }
            this.error(`❌ Erreur réseau : ${error.message}`);
        }
    }
    async collectDependencies(dependenceName, dependenceType, params, seen = new Set()) {
        const key = `${dependenceType}:${dependenceName}`;
        if (seen.has(key))
            return [];
        seen.add(key);
        const directoryPath = dependenceType === 'component'
            ? path.join(this.basePathLwc, dependenceName)
            : params.classNameToDir[dependenceName];
        await this.checkForbiddenFiles(directoryPath);
        const [dependencies, staticresources] = await Promise.all([
            this.getItemDependencies(dependenceName, dependenceType, params),
            dependenceType === 'component' ? findStaticResourcesForComponent(directoryPath) : Promise.resolve([]),
        ]);
        const isFirstItem = seen.size === 1;
        const item = {
            name: dependenceName,
            type: dependenceType,
            dependencies,
            staticresources,
            ...(isFirstItem && params.version ? { version: params.version } : {}),
        };
        const subDeps = await Promise.all(dependencies.map((dependence) => this.collectDependencies(dependence.name, dependence.type, params, seen)));
        return [item, ...subDeps.flat()];
    }
    async getItemDependencies(name, type, params) {
        if (type === 'component') {
            return this.getLwcDependencies(name, params);
        }
        // Cas 'class'
        const dirClass = params.classNameToDir[name];
        if (!dirClass)
            throw new Error(`Dossier introuvable pour la classe Apex "${name}".`);
        const clsFile = path.join(dirClass, `${name}.cls`);
        const apexDeps = await extractApexDependencies(clsFile, params.allClasses, name);
        return apexDeps.map((depName) => ({ name: depName, type: 'class' }));
    }
    async getLwcDependencies(name, params) {
        const compDir = path.join(this.basePathLwc, name);
        const htmlFile = path.join(compDir, `${name}.html`);
        const tsFile = path.join(compDir, `${name}.ts`);
        const jsFile = path.join(compDir, `${name}.js`);
        const [htmlDeps, tsLwcDeps, jsLwcDeps, tsApexDeps, jsApexDeps] = await Promise.all([
            extractDependenciesFromFile(htmlFile, /<c-([a-zA-Z0-9_]+)[\s>]/g),
            extractDependenciesFromFile(tsFile, /import\s+\w+\s+from\s+["']c\/([a-zA-Z0-9_]+)["']/g),
            extractDependenciesFromFile(jsFile, /import\s+\w+\s+from\s+["']c\/([a-zA-Z0-9_]+)["']/g),
            extractDependenciesFromFile(tsFile, /import\s+\w+\s+from\s+['"]@salesforce\/apex\/([a-zA-Z0-9_]+)\.[^'"]+['"]/g),
            extractDependenciesFromFile(jsFile, /import\s+\w+\s+from\s+['"]@salesforce\/apex\/([a-zA-Z0-9_]+)\.[^'"]+['"]/g),
        ]);
        const uniqueDependencies = new Map();
        // 2. On traite et on ajoute à la map en une seule passe, sans tableaux intermédiaires
        const allLwcDeps = [...htmlDeps, ...tsLwcDeps, ...jsLwcDeps];
        for (const depName of allLwcDeps) {
            if (params.allComponents.includes(depName)) {
                uniqueDependencies.set(`component:${depName}`, { name: depName, type: 'component' });
            }
        }
        const allApexDeps = [...tsApexDeps, ...jsApexDeps];
        for (const depName of allApexDeps) {
            if (params.allClasses.includes(depName)) {
                uniqueDependencies.set(`class:${depName}`, { name: depName, type: 'class' });
            }
        }
        // 3. On retourne le résultat final
        return Array.from(uniqueDependencies.values());
    }
    // =================================================================
    // FONCTIONS UTILITAIRES DE SYSTÈME DE FICHIERS (FILE SYSTEM)
    // =================================================================
    async findAllClassesAsync(basePathApex) {
        try {
            const allClasses = [];
            const classNameToDir = {};
            const classDirs = await safeListDirNamesAsync(basePathApex);
            const filesByDir = await Promise.all(classDirs.map(async (dirName) => {
                const dirPath = path.join(basePathApex, dirName);
                const files = await fs.readdir(dirPath);
                return { dirPath, files };
            }));
            for (const { dirPath, files } of filesByDir) {
                for (const file of files) {
                    if (file.endsWith('.cls') && !file.endsWith('.cls-meta.xml')) {
                        const className = path.basename(file, '.cls');
                        allClasses.push(className);
                        classNameToDir[className] = dirPath;
                    }
                }
            }
            return { allClasses, classNameToDir };
        }
        catch (error) {
            this.error(`❌ Erreur lors de la recherche des classes Apex: ${error.message}`);
        }
    }
    async checkForbiddenFiles(directoryPath) {
        // Remplacement de walkDirSync par un générateur asynchrone
        for await (const filePath of this.walkDirAsync(directoryPath)) {
            const extension = path.extname(filePath).toLowerCase();
            if (FORBIDDEN_EXTENSIONS.includes(extension)) {
                this.error(`❌ Fichier interdit détecté : ${filePath}. Extension refusée : ${extension}`);
            }
        }
    }
    async *walkDirAsync(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const entryPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                yield* this.walkDirAsync(entryPath);
            }
            else {
                yield entryPath;
            }
        }
    }
    async tryReadRegistryMeta(type, name, classNameToDir) {
        const componentDir = type === 'component' ? path.join(this.basePathLwc, name) : classNameToDir[name];
        if (!componentDir)
            return null;
        const metaFilePath = path.join(componentDir, FILENAMES.REGISTRY_META);
        try {
            const fileContent = await fs.readFile(metaFilePath, 'utf8');
            const result = registryMetaFileSchema.safeParse(JSON.parse(fileContent));
            if (!result.success) {
                this.warn(`Fichier ${FILENAMES.REGISTRY_META} invalide : ${result.error.issues.map((i) => i.message).join(', ')}`);
                return null; // Le fichier est mal formé, on ignore
            }
            return result.data; // Succès, on retourne les données validées
        }
        catch (error) {
            // Gère les erreurs de lecture de fichier (ex: non trouvé) ou de parsing JSON
            return null;
        }
    }
}
// eslint-disable-next-line sf-plugin/no-hardcoded-messages-commands
RegistryDeploy.summary = 'Déploie un composant LWC ou une classe Apex sur le registre externe';
RegistryDeploy.examples = ['$ sf registry deploy'];
export default RegistryDeploy;
async function extractApexDependencies(clsFilePath, allClassNames, selfClassName) {
    const code = await fs.readFile(clsFilePath, 'utf8');
    // Utilise un mot-clé (boundary `\b`) pour éviter les correspondances partielles (ex: `MyClass` dans `MyClassName`)
    return allClassNames.filter((className) => className !== selfClassName && new RegExp(`\\b${className}\\b`).test(code));
}
async function findStaticResourcesForComponent(componentDir) {
    const regex = /import\s+\w+\s+from\s+["']@salesforce\/resourceUrl\/([a-zA-Z0-9_]+)["']/g;
    const baseName = path.basename(componentDir);
    const tsFile = path.join(componentDir, `${baseName}.ts`);
    const jsFile = path.join(componentDir, `${baseName}.js`);
    const [tsResults, jsResults] = await Promise.all([
        extractDependenciesFromFile(tsFile, regex),
        extractDependenciesFromFile(jsFile, regex),
    ]);
    return [...new Set([...tsResults, ...jsResults])];
}
async function findStaticResourceFileAsync(resourceDir, resName) {
    try {
        const files = await fs.readdir(resourceDir);
        const foundFile = files.find((file) => 
        // Condition 1 (inchangée) : Le nom doit correspondre exactement OU commencer par le nom de la ressource suivi d'un point.
        (file === resName || file.startsWith(resName + '.')) &&
            // Condition 2 (NOUVEAU) : ET le nom du fichier NE DOIT PAS se terminer par `.resource-meta.xml`.
            !file.endsWith('.resource-meta.xml'));
        return foundFile ? path.join(resourceDir, foundFile) : null;
    }
    catch {
        return null;
    }
}
// --- Helper pour extraire les dépendances avec une regex ---
// Mutualise la logique de lecture de fichier et d'application de regex
async function extractDependenciesFromFile(filePath, regex) {
    try {
        const code = await fs.readFile(filePath, 'utf8');
        const matches = [...code.matchAll(regex)];
        return [...new Set(matches.map((match) => match[1]))];
    }
    catch (error) {
        // Si l'erreur est "Fichier non trouvé", c'est un cas normal, on retourne un tableau vide.
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return [];
        }
        // Pour toutes les autres erreurs, on les laisse remonter pour qu'elles soient gérées.
        throw error;
    }
}
async function safeListDirNamesAsync(base) {
    try {
        const entries = await fs.readdir(base, { withFileTypes: true });
        return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    }
    catch (error) {
        throw new Error(`Erreur lors de la lecture du dossier "${base}" : ${error.message}`);
    }
}
//# sourceMappingURL=deploy.js.map