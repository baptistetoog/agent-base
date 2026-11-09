# Agent IA : la base commune

Ce dépôt installe, en 10 prompts collés dans Claude Code, un agent IA **générique et sans marque** sur son propre serveur. C'est la base commune de la formation Toog Expertise : tout le monde part de ce même dépôt et arrive au même outil, qu'on spécialise ensuite pour chaque métier (un agent fiche Google, un agent commercial, un agent de suivi client…).

L'outil obtenu :

- une adresse à soi (un sous-domaine), en HTTPS, derrière une page de connexion ;
- le bureau en 3D où l'on **voit** l'agent travailler, et une discussion en direct, sur ordinateur et sur téléphone ;
- le cerveau : Claude Code, branché avec son propre abonnement Claude ;
- le **contexte** (une fiche d'identité et des documents déposés) et la **mémoire** (ce qu'il retient d'une discussion à l'autre) ;
- les **compétences** (skills) qu'on lui ajoute, ou qu'il écrit lui-même ;
- les **connexions** : n'importe quel serveur MCP (par compte ou par jeton) et n'importe quelle API avec une clé, rangée dans le coffre du serveur ;
- le **contrôle** : le mode « Propose » ou « Agit seul », et les cartes « À valider » ;
- les **automatisations** : des missions à heure fixe, proposées par l'agent après un court entretien.

## Les 10 étapes

| # | Étape | Prompt | À la main |
|---|---|---|---|
| 1 | Préparer l'espace de l'agent sur le serveur | `prompts/01-espace-serveur.md` | — |
| 2 | Créer la clé de connexion à Claude | `prompts/02-connecter-claude.md` | `claude setup-token` |
| 3 | Créer l'outil et son espace de connexion protégé | `prompts/03-outil-connexion.md` | — |
| 4 | Mettre l'outil en ligne sur son sous-domaine | `prompts/04-mise-en-ligne.md` | le DNS, son compte admin |
| 5 | Donner vie à l'agent : bureau 3D, discussion, cerveau | `prompts/05-agent-visuel.md` | coller la clé dans « Connecter Claude » |
| 6 | Le contexte et la mémoire | `prompts/06-contexte-memoire.md` | remplir sa fiche |
| 7 | Les compétences (skills) | `prompts/07-skills.md` | — |
| 8 | Les connexions : MCP et clés API | `prompts/08-connexions.md` | coller ses clés dans « Connexions » |
| 9 | « Propose » ou « Agit seul » : les validations | `prompts/09-validations.md` | — |
| 10 | Les automatisations | `prompts/10-automatisations.md` | répondre à l'entretien de l'agent |

## Comment s'en servir

1. Remplir `parametres.md` (utilisateur, port, sous-domaine, e-mail, noms).
2. `python3 outils/rendre.py parametres.md` : les 10 prompts prêts à coller sont créés dans `mes-prompts/`.
3. Coller les prompts dans Claude Code, dans l'ordre, un par un, en vérifiant « Ce qu'on voit à la fin » avant de passer au suivant.

Il faut : un VPS Ubuntu 24.04 joignable par `ssh vps`, un nom de domaine, un abonnement Claude (Pro ou Max).

## La règle des clés

Une clé (Claude, API, jeton) ne se colle **jamais** dans une discussion avec Claude. Elle se colle uniquement dans l'outil (« Connecter Claude », « Connexions »), qui la range dans le coffre du serveur et ne la réaffiche plus.

## Le code de référence

Après chaque étape, le code de l'instance de test est enregistré ici, avec l'étiquette `etape-01` à `etape-10` (dossier `instance/`). Si un projet déraille, le prompt « Si vous êtes vraiment bloqué » de l'étape le remet exactement à cet état, sans toucher aux données ni à la clé. Aucune donnée ni aucun secret ne sont dans ce dépôt.

- `kit/bureau3d.js` : la scène 3D du bureau, fournie toute faite pour que tout le monde ait le même rendu.
- `outils/rendre.py` : fabrique les prompts à partir des paramètres. `outils/enregistrer-etape.sh` : enregistre l'instance de test (formateur).

Formation proposée par [Toog Expertise](https://toog-expertise.app).
