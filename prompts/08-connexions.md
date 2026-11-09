# 8. Les connexions : MCP et clés API

**Ce qu'on voit à la fin :** une section « Connexions ». On y branche n'importe quel outil : un serveur MCP (avec connexion par compte ou par jeton) ou une API avec une clé. La clé n'est plus jamais affichée, et l'agent peut se servir de l'outil.

## À préparer à la main

L'adresse du serveur MCP ou de l'API de l'outil à brancher, et sa clé si elle en demande une (dans l'espace développeur de l'outil). **Une clé ne se colle jamais dans une discussion avec Claude** : uniquement dans la section « Connexions » de l'outil.

---

```
Mon serveur est accessible par `ssh vps` (root). Lis d'abord /home/{UTILISATEUR}/PROJET.md. Tout ce que tu crées dans /home/{UTILISATEUR} doit appartenir à {UTILISATEUR}.

Ajoute une section « Connexions » dans l'onglet « Réglages » (réservée aux admins, avec le système de design design.css) pour brancher des outils externes à l'agent. Il y a trois types de connexion.

TYPE 1 — « Serveur MCP (connexion par compte, OAuth) » :
- L'admin donne un nom (minuscules, chiffres, tirets) et l'adresse du serveur MCP, puis clique sur « Connecter ».
- Le serveur suit la norme MCP d'autorisation : découverte (/.well-known/oauth-protected-resource, sinon /.well-known/oauth-authorization-server sur l'origine), enregistrement automatique du client (Dynamic Client Registration) avec l'adresse de retour https://{DOMAINE}/api/oauth/retour, puis autorisation avec PKCE (S256), le paramètre resource et un state à usage unique lié à la session de l'admin.
- Au retour, le serveur échange le code contre les jetons, les enregistre dans data/oauth/<nom>.json (droits 600) et affiche « Connecté ». Les jetons ne sont jamais renvoyés au navigateur.

TYPE 2 — « Serveur MCP (avec un jeton) » : pour les serveurs MCP qui donnent un jeton fixe. L'admin donne un nom, l'adresse du serveur MCP, le nom de l'en-tête (Authorization par défaut), un préfixe facultatif (« Bearer » par défaut) et le jeton.

Pour les types 1 et 2, l'agent parle au serveur grâce à un petit pont app/mcp-pont.js (stdio ↔ « Streamable HTTP », sans dépendance). Il ajoute le jeton, le renouvelle tout seul avec le refresh_token quand il expire ou sur une erreur 401 (type 1), garde l'en-tête mcp-session-id, gère les réponses JSON et text/event-stream, et masque les jetons dans tous les messages d'erreur. Si la connexion a expiré, l'erreur dit à l'agent : « un admin doit reconnecter <nom> dans Connexions ».

TYPE 3 — « API avec clé » :
- L'admin donne un nom, l'URL de base de l'API, le nom de l'en-tête (ex. Authorization ou X-API-Key), un préfixe facultatif (ex. « Bearer ») et la clé. Une case « Autoriser l'écriture » est décochée par défaut.
- L'agent y accède par un petit serveur MCP stdio app/mcp-api.js avec deux outils : lire_api(chemin) (GET seulement) et appel_api(methode, chemin, corps) (seulement si l'écriture est autorisée). Il n'autorise que les chemins sous l'URL de base, ajoute la clé lui-même, coupe les réponses trop longues (50 000 caractères) et masque la clé si elle apparaît.

Pour tous les types : les secrets sont enregistrés dans data/connexions.json ou data/oauth/ (droits 600) et ne sont plus jamais affichés en entier (seulement les 4 derniers caractères). Pour chaque connexion, la page montre : le type, le statut (connecté / à reconnecter / erreur), un bouton « Tester » (il lance le pont, fait initialize puis tools/list et affiche la liste des outils disponibles), « Reconnecter » (type 1) et « Supprimer ».

Branchement à l'agent : à chaque lancement de Claude, le serveur génère un fichier de configuration MCP temporaire (dans data/, droits 600, supprimé après) avec toutes les connexions actives, et le passe avec --mcp-config et --strict-mcp-config. Ajoute « mcp__<nom>__* » de chaque connexion aux outils autorisés. Les secrets ne passent que par des variables d'environnement ou des fichiers que l'agent ne peut pas lire (data/ est déjà interdit à l'agent).

MISE EN ROUTE : l'étape 3 de la carte (« Brancher un premier outil ») devient active : elle mène à cette section et se coche dès qu'une connexion a passé le test. Le voyant « Connexions » de l'État du système affiche le nombre de connexions qui marchent.

Dans agent/CLAUDE.md, ajoute une section « Tes connexions » : il regarde quels outils il a (mcp__…) avant de dire qu'il ne peut pas faire quelque chose. Il préfère les données réelles des outils branchés à toute supposition. Si une connexion est en erreur, il le dit simplement. En attendant l'étape des validations, il ne crée, ne modifie, n'envoie et ne supprime rien dans un outil branché sans l'accord explicite de la personne : il propose d'abord ce qu'il va faire.

Vérifie toi-même :
- la découverte OAuth d'un serveur MCP public qui la propose (par exemple https://mcp.notion.com/mcp) fonctionne : affiche les adresses trouvées et le client_id obtenu par l'enregistrement, mais aucun secret, et vérifie que le lien d'autorisation est bien formé ; puis supprime cette connexion inachevée ;
- ajoute une connexion « API avec clé » de test vers une API publique qui n'a pas besoin de vraie clé (par exemple https://api.github.com avec une fausse clé dans un en-tête X-Test), teste-la avec un GET via le pont, vérifie que appel_api n'existe pas tant que l'écriture n'est pas autorisée et que la fausse clé n'apparaît dans aucune réponse ;
- demande à l'agent (compte de test créé puis supprimé) « Quel est le nombre d'étoiles du dépôt github.com/anthropics/claude-code ? » : il doit utiliser lire_api ; puis supprime la connexion de test.
Mets à jour PROJET.md.
```

## Si ça ne marche pas

Décrivez d'abord ce que vous voyez à Claude (« J'ai collé le prompt 8, et je vois … au lieu de … ») : dans la plupart des cas, il corrige tout seul.

Si vous êtes vraiment bloqué, ce prompt remet votre outil exactement dans l'état de la fin de cette étape, à partir du dépôt commun :

```
Mon serveur est accessible par `ssh vps` (root). Remets mon outil exactement à l'état de l'étape 8 du dépôt commun {DEPOT} (étiquette etape-08) : récupère les dossiers instance/app et instance/agent de cette étiquette. Fais d'abord une sauvegarde, puis remplace /home/{UTILISATEUR}/app par instance/app, et recopie de instance/agent seulement les fichiers de configuration (CLAUDE.md, regles.md, .claude/settings.json, .claude/skills/) sans écraser CONTEXTE.md, memoire.md ni documents/. Ne touche ni à mes données (/home/{UTILISATEUR}/data), ni à ma clé Claude. Remplace dans le code le domaine, l'utilisateur et le port de l'exemple (agentforma.toog-expertise.app, agentforma, 4910) par les miens ({DOMAINE}, {UTILISATEUR}, {PORT}), mets à jour le service {UTILISATEUR}-app s'il diffère de instance/systeme, redémarre-le et vérifie que la page de connexion répond. Si cette étiquette n'existe pas dans le dépôt, ne touche à rien et dis-le-moi.
```
