# 9. « Propose » ou « Agit seul » : les validations

**Ce qu'on voit à la fin :** par défaut, l'agent lit librement mais ne fait rien dans un outil branché sans accord. Ses actions arrivent sous forme de cartes « À valider ». Un clic sur « Valider », et c'est l'agent qui exécute. Un interrupteur permet de le laisser agir seul.

---

```
Mon serveur est accessible par `ssh vps` (root). Lis d'abord /home/{UTILISATEUR}/PROJET.md. Tout ce que tu crées dans /home/{UTILISATEUR} doit appartenir à {UTILISATEUR}.

Je veux garder la main sur ce que l'agent fait dans le monde réel (envoyer, publier, créer, modifier ou supprimer quelque chose dans un outil branché).

1. LE MODE DE L'AGENT : un réglage enregistré dans data/reglages.json, modifiable par un admin depuis le bureau (interrupteur bien visible, sous le personnage) :
   - « Propose » (par défaut) : il lit et prépare, mais toute action qui modifie quelque chose passe par une validation ;
   - « Agit seul » : il peut tout faire directement.

2. LE TRI DES OUTILS : dans la section Connexions des Réglages, après « Tester », chaque outil de la connexion apparaît avec une case « Action (à valider) ». On la pré-coche automatiquement si le nom ou la description de l'outil parle d'écrire (create, update, delete, reply, post, publish, send, add, remove, patch, upload, write…). Les outils de lecture (get, list, search, find, read, fetch…) restent libres. L'admin peut corriger. Pour le type « API avec clé », appel_api est toujours une action ; lire_api reste libre. Le tri est enregistré par connexion.

3. LA DEMANDE DE VALIDATION : un petit serveur MCP stdio intégré, app/mcp-plateforme.js, toujours branché, avec l'outil demander_validation(titre, ce_que_je_vais_faire, outil_prevu, contenu_exact). Il crée une carte dans data/validations.json (statut « en attente ») et répond à l'agent : « Demande n°X envoyée, attends la réponse. »
   En mode « Propose », le serveur ajoute à --disallowedTools tous les outils marqués « Action ». Dans agent/CLAUDE.md, section « Tes validations » (elle remplace la règle « sans l'accord explicite » de la section « Tes connexions ») : s'il a besoin d'une action, il prépare tout, appelle demander_validation avec le contenu exact (le texte du mail, du message, les données envoyées…), puis il s'arrête.

4. LES CARTES « À VALIDER » dans un onglet « À valider » du panneau (pastille avec le nombre sur l'onglet, visibles par les admins ; dans la scène 3D, appelle bureau.statut("alerte") quand une carte attend : un panneau « ! » apparaît au-dessus du bureau, et bureau.statut("alerte", false) quand il n'y en a plus) : titre, ce que l'agent va faire, le contenu exact (que l'admin peut corriger avant de valider), et les boutons « Valider » et « Refuser » (avec un motif facultatif).
   - Valider : le serveur relance l'agent dans la même discussion, avec les outils d'action autorisés pour CE lancement seulement, et le message : « Validation n°X accordée par <prénom>. Exécute exactement cette action, rien d'autre : <contenu final>. Puis confirme en une phrase. » La carte passe à « exécutée » avec le résultat.
   - Refuser : la carte passe à « refusée ». L'agent reçoit le motif dans la discussion et le retient dans sa mémoire s'il est utile pour la suite.
   - Tout est historisé (qui, quand, quoi).

Vérifie toi-même (compte de test créé puis supprimé) : avec une connexion « API avec clé » de test vers une API publique (par exemple https://httpbin.org, fausse clé, écriture autorisée), en mode « Propose », demande à l'agent de faire un POST de {"test": 1} sur /post. Il doit créer une demande de validation, sans faire l'appel. Valide-la par l'API et vérifie qu'il est relancé et l'exécute. Refais un essai et refuse-le avec un motif : il doit le recevoir. Puis supprime la connexion et les cartes de test, et remets le mode « Propose ». Mets à jour PROJET.md.
```

## Si ça ne marche pas

Décrivez d'abord ce que vous voyez à Claude (« J'ai collé le prompt 9, et je vois … au lieu de … ») : dans la plupart des cas, il corrige tout seul.

Si vous êtes vraiment bloqué, ce prompt remet votre outil exactement dans l'état de la fin de cette étape, à partir du dépôt commun :

```
Mon serveur est accessible par `ssh vps` (root). Remets mon outil exactement à l'état de l'étape 9 du dépôt commun {DEPOT} (étiquette etape-09) : récupère les dossiers instance/app et instance/agent de cette étiquette. Fais d'abord une sauvegarde, puis remplace /home/{UTILISATEUR}/app par instance/app, et recopie de instance/agent seulement les fichiers de configuration (CLAUDE.md, regles.md, .claude/settings.json, .claude/skills/) sans écraser CONTEXTE.md, memoire.md ni documents/. Ne touche ni à mes données (/home/{UTILISATEUR}/data), ni à ma clé Claude. Remplace dans le code le domaine, l'utilisateur et le port de l'exemple (agentforma.toog-expertise.app, agentforma, 4910) par les miens ({DOMAINE}, {UTILISATEUR}, {PORT}), mets à jour le service {UTILISATEUR}-app s'il diffère de instance/systeme, redémarre-le et vérifie que la page de connexion répond. Si cette étiquette n'existe pas dans le dépôt, ne touche à rien et dis-le-moi.
```
