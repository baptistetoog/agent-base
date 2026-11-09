# 5. Donner vie à l'agent : son bureau, la discussion, son cerveau

**Ce qu'on voit à la fin :** après connexion, on arrive dans le bureau de l'agent. On voit son personnage en 3D et on lui parle comme dans une messagerie. Il répond en direct et on voit ce qu'il est en train de faire. On colle la clé de l'étape 2 dans « Connecter Claude ».

---

```
Mon serveur est accessible par `ssh vps` (root). Lis d'abord /home/{UTILISATEUR}/PROJET.md.

Remplace la page d'accueil provisoire par le bureau de l'agent, et branche son cerveau (Claude Code).

LE CERVEAU (côté serveur, dans un fichier app/agent.js appelé par app/server.js) :
- L'agent travaille dans le dossier /home/{UTILISATEUR}/agent. Chaque message lance :
  `claude -p --output-format stream-json --verbose --include-partial-messages --model sonnet --setting-sources project --strict-mcp-config` avec le message passé sur l'entrée standard (pas en argument : --allowedTools et --disallowedTools avalent les mots qui suivent), dans ce dossier, en tant que {UTILISATEUR}.
  Le binaire est ~/.local/bin/claude. Le jeton est passé dans la variable CLAUDE_CODE_OAUTH_TOKEN, lue dans /home/{UTILISATEUR}/.claude-token.env à CHAQUE lancement (pas seulement au démarrage du service). Retire du service systemd le chargement de .claude-token.env mis à l'étape 3 : sinon « Déconnecter » ne servirait à rien.
- LA CASE « CONNECTER CLAUDE » (admin) : dans le bureau, un bouton « Connecter Claude » ouvre une fenêtre avec un champ masqué où l'on colle la clé obtenue avec `claude setup-token`. Le serveur :
  - nettoie la saisie (espaces, retours à la ligne, guillemets, préfixe « CLAUDE_CODE_OAUTH_TOKEN= » ou « export » collés par erreur, clé collée deux fois) et vérifie qu'elle commence par sk-ant-oat01- ;
  - la teste en lançant `claude -p "Réponds seulement : prêt"` avec cette clé ;
  - si la réponse est bonne, l'enregistre dans .claude-token.env (droits 600) et affiche « ✅ Claude est connecté » ; sinon, n'enregistre rien et affiche une erreur claire (« Clé refusée par Claude : refaites claude setup-token »).
  - La clé n'est jamais renvoyée au navigateur ni écrite dans les journaux.
  - En haut du bureau, une pastille indique en permanence « Claude connecté » (vert) ou « Claude non connecté » (orange, cliquable pour ouvrir la fenêtre). Si un membre non admin envoie un message alors que Claude n'est pas connecté, il voit « L'agent n'est pas encore connecté : demandez à un admin ».
  - LA CONNEXION SANS TERMINAL (la méthode principale, pour quelqu'un qui n'a jamais ouvert un Terminal) : la fenêtre « Connecter Claude » propose d'abord un gros bouton « Se connecter avec Claude ». Le serveur lance alors lui-même, en tant que {UTILISATEUR}, la commande officielle `claude setup-token` dans un pseudo-terminal (commande `script -qfc "stty cols 400 rows 50; exec <chemin de claude> setup-token" /dev/null` : sans le stty, le pseudo-terminal fait 0 colonne et Claude coupe le lien et la clé à 80 caractères), lit dans sa sortie le lien d'autorisation (il commence par https://claude.com/cai/oauth/authorize ; il est entouré de séquences d'échappement de terminal à retirer, et il apparaît deux fois : garde le premier, complet) et l'envoie à la page. La fenêtre affiche alors 2 étapes :
    1) « Cliquez sur ce bouton : la page de Claude s'ouvre. Connectez-vous à votre compte Claude (Pro ou Max) et cliquez sur Autoriser » (bouton « Ouvrir Claude », dans un nouvel onglet) ;
    2) « Claude affiche un code. Copiez-le et collez-le ici » (champ, puis bouton « Connecter »).
    Le serveur écrit ce code dans le processus en attente, suivi de la touche Entrée (\r, pas \n), lit dans sa sortie la clé obtenue (sk-ant-oat01-…), puis la teste et l'enregistre exactement comme une clé collée (voir plus haut). Un seul processus de connexion à la fois (une nouvelle demande remplace l'ancienne), arrêté au bout de 10 minutes sans code, et arrêté aussi dès qu'il affiche « OAuth error » (il ne s'arrête pas tout seul) ; s'il a échoué, la fenêtre dit « Le code n'a pas été accepté : recommencez » et propose de relancer. Ni le code, ni la clé, ni le lien complet ne sont écrits dans les journaux.
  - LE COLLAGE D'UNE CLÉ (solution de secours, sous un lien « J'ai déjà une clé ») : 3 étapes numérotées :
    1) « Sur votre ordinateur, ouvrez le Terminal et tapez cette commande » : `claude setup-token`, avec un bouton « Copier » ;
    2) « Votre navigateur s'ouvre : connectez-vous à votre compte Claude (Pro ou Max) et cliquez sur Autoriser. Copiez le code affiché et collez-le dans le Terminal » ;
    3) « Le Terminal affiche une clé qui commence par sk-ant-oat01-. Copiez-la et collez-la ici » : le champ masqué, puis le bouton « Connecter ».
  - Dans les deux cas, sous le champ, une phrase rassurante : « La clé est rangée dans le coffre du serveur. Elle ne sera plus jamais affichée. Ne la collez jamais dans une discussion. » Pendant la vérification, le bouton affiche « Vérification… ».
  - LA SECTION « CLAUDE » DES RÉGLAGES : la même chose se retrouve en tête de l'onglet « Réglages », dans une section « Claude » : l'état (connecté depuis le <date>, ou non connecté), un bouton « Connecter Claude » ou « Changer la clé » qui ouvre la même fenêtre guidée, et un bouton « Déconnecter » (admin, avec confirmation) qui supprime la clé du serveur.
- Variables d'environnement à ajouter pour chaque lancement : ENABLE_CLAUDEAI_MCP_SERVERS=false et DISABLE_AUTOUPDATER=1.
- Outils autorisés (--allowedTools) : Read, Glob, Grep, WebSearch, WebFetch, Skill. Interdits (--disallowedTools) : Bash, Task, Agent, NotebookEdit. Lance Claude en mode --permission-mode acceptEdits : il écrit librement dans son dossier agent/ (Write et Edit ne sont PAS dans --allowedTools, sinon il pourrait écrire n'importe où sur le serveur).
- Crée agent/.claude/settings.json (avec "disableAllHooks": true) pour lui interdire, avec des règles permissions.deny de Claude Code de type Read(...) et Edit(...) (Edit couvre aussi l'écriture : pas de règles Write) :
  - de lire ou modifier /home/{UTILISATEUR}/data, /home/{UTILISATEUR}/app, ~/.claude-token.env, ~/.claude, ~/.claude.json et /proc (sinon il pourrait lire le jeton dans /proc/self/environ) ;
  - de modifier sa propre configuration : agent/CLAUDE.md, agent/.claude/settings.json, agent/.claude/settings.local.json et agent/.mcp.json ;
  - de modifier les fichiers cachés et les .md à la racine de /home/{UTILISATEUR} (~/.bashrc, ~/.profile, ~/.local/ qui contient le programme claude…) : sinon il pourrait réécrire claude et contourner l'interdiction de Bash.
  Il garde le droit d'écrire partout ailleurs dans agent/ (y compris agent/.claude/skills/, dont on se servira plus tard).
- Écris un agent/CLAUDE.md provisoire de quelques lignes : il s'appelle « {NOM_AGENT} », assistant IA généraliste, il répond en français, simplement, et il ne sort jamais de son dossier. (On écrira sa vraie fiche à l'étape suivante.)
- Tous les fichiers de agent/ appartiennent à {UTILISATEUR} (l'outil devra pouvoir les modifier). Ce sont les règles ci-dessus, pas les droits Linux, qui protègent la configuration : ne redonne donc jamais Bash à l'agent.
- Une seule discussion, commune à toute l'équipe. Elle est continue : garde le session_id renvoyé par Claude et utilise --resume pour les messages suivants. Bouton « Nouvelle discussion » pour repartir de zéro.
- Un seul travail à la fois. Si un message arrive pendant que l'agent travaille, il est mis en file d'attente. Bouton « Arrêter » qui coupe le travail en cours.
- Limite de sécurité : 10 minutes maximum par message.
- Historique enregistré dans data/historique.jsonl (qui a parlé, quand, le texte, les outils utilisés, la durée, le coût estimé renvoyé par Claude).
- Le temps réel vers la page se fait en Server-Sent Events : statut de l'agent (au repos / réfléchit / utilise un outil : lequel / a fini), morceaux de réponse, fin.

L'INTERFACE : je veux une vraie application, belle et vivante, où l'on VOIT l'agent travailler. Pas une page de formulaire. Sans framework ni étape de compilation : HTML + CSS + JavaScript (modules), avec three.js (pour la scène 3D) chargé par une importmap depuis https://cdn.jsdelivr.net/npm/three@0.170.0/. Adapte la politique de sécurité du contenu (CSP) du serveur pour autoriser seulement ce qu'il faut : cdn.jsdelivr.net pour les scripts (et l'importmap en ligne par son empreinte sha256, recalculée automatiquement si la page change), Google Fonts pour les polices, et style-src 'unsafe-inline' (le dessin de secours de la scène 3D utilise des styles en ligne). Charge aussi les polices « Lexend Deca » et « DM Sans », utilisées par l'écran de l'ordinateur dans la scène.

1. LE SYSTÈME DE DESIGN (app/public/design.css, utilisé par toutes les pages, y compris la connexion et toutes celles des étapes suivantes). Il applique la charte neutre de la section « Paramètres » de PROJET.md :
   - Couleurs en variables CSS, toutes définies UNE SEULE FOIS en haut de design.css (:root), pour qu'on puisse habiller l'outil aux couleurs d'un client en modifiant ce seul bloc : --fond, --surface, --texte, --texte-2 (texte secondaire, une version adoucie du texte), --accent, --accent-pale (l'accent très éclairci, pour mes bulles de discussion), --accent-2, --vert #2E9E6A, --rouge #D9443B, --orange #E8590C, --bordure (une teinte légèrement plus foncée que le fond). Le texte posé sur l'accent doit rester lisible (contraste AA).
   - Police « Inter » (Google Fonts).
   - Cartes blanches arrondies (16 px) avec une ombre douce, boutons « pilule » (couleur --accent pleine pour l'action principale, contour pour les autres), pastilles d'état (point de couleur + texte), champs arrondis, focus visible, transitions de 150 ms.
   - Composants réutilisables : .carte, .bouton, .bouton-secondaire, .pastille, .onglets, .fenetre (modale), .toast (message éphémère), .vide (état vide avec une phrase d'aide), .squelette (chargement).

2. LA SCÈNE DU BUREAU : elle est fournie toute prête dans le dépôt commun ({DEPOT}). Télécharge-la directement sur le serveur depuis {DEPOT_BRUT}/kit/bureau3d.js et enregistre-la TELLE QUELLE dans /home/{UTILISATEUR}/app/public/bureau3d.js, sans la modifier. Lis le commentaire en tête du fichier : il explique comment l'utiliser.
   - Dans l'interface : const bureau = creerBureau(conteneur, { nom: <nom de l'agent>, entreprise: <nom de l'outil>, couleurCorps: "#4C5A70", couleurYeux: "#FFD43B", badge: "IA", accessoire: "aucun", fond: "#F5F6F8" }), avec les noms lus dans /api/marque.
   - Branche-le sur les événements en temps réel de l'agent : bureau.statut("message") quand on envoie un message, "reflechit" quand il réfléchit, "outil" avec le texte de ce qu'il fait (ex. « Je lis le document… ») quand il utilise un outil, "repond" pendant qu'il écrit sa réponse, "fini" à la fin, "repos" sinon.

3. LA DISPOSITION :
   - Sur ordinateur : la scène à gauche (environ 55 % de la largeur, pleine hauteur) et, à droite, un panneau avec des onglets « Discussion » et « Réglages » (on ajoutera « À valider » plus tard). Au-dessus de la scène, une étiquette flottante : nom de l'agent et ce qu'il fait en ce moment.
   - Sur mobile : la scène en haut (environ 40 % de l'écran, repliable), le panneau en dessous, et une barre d'onglets en bas de l'écran avec des icônes. L'en-tête tient sur une ligne : initiale, pastille de connexion, menu ☰.
   - En-tête fin : initiale, nom de l'outil, pastille « Claude connecté », prénom de la personne connectée, déconnexion.

4. LA DISCUSSION :
   - bulles façon messagerie (les miennes à droite en --accent-pale, celles de l'agent à gauche en blanc, avec sa petite tête), heure, réponse en Markdown (titres, listes, gras, liens, tableaux) ;
   - la réponse s'écrit en direct ; pendant le travail, une ligne discrète montre les outils utilisés (« 🔧 Lit un fichier », dépliable) ;
   - zone de saisie arrondie qui grandit avec le texte (Entrée = envoyer, Maj+Entrée = retour à la ligne), boutons « Arrêter » (visible seulement pendant le travail) et « Nouvelle discussion » ;
   - état vide accueillant : la tête de l'agent, « Bonjour, je suis <nom de l'agent> » et 3 suggestions cliquables générales (« Présente-toi », « Que sais-tu faire ? », « Aide-moi à rédiger un mail ») ;
   - l'historique revient au rechargement.

5. LA MISE EN ROUTE (pour que la personne voie tout de suite où elle en est) :
   - Tant que tout n'est pas prêt, une carte « Mise en route » est ÉPINGLÉE en haut de l'onglet Discussion (au-dessus du fil des messages, pas dedans : elle ne doit jamais disparaître en faisant défiler). Elle est dépliée par défaut, y compris sur mobile (plus compacte), et se redéplie toute seule dès qu'une étape est franchie. Elle contient des étapes cochées en direct :
     1) Connecter Claude (bouton « Connecter Claude ») ;
     2) Donner son contexte à l'agent ;
     3) Brancher un premier outil (MCP ou clé API) ;
     4) Lui confier une première mission automatique.
     Les étapes 2 à 4 s'affichent « Bientôt disponible » tant que leur fonction n'est pas installée (elles arrivent aux étapes suivantes de l'installation) : la carte lit pour cela un petit état fourni par le serveur (GET /api/etat), qui renvoie la liste des étapes {id, titre, disponible, faite, action} construite par une seule fonction etatSysteme() du serveur : les étapes suivantes de l'installation n'auront qu'à la compléter. Décris ce format dans PROJET.md. Sur mobile, la carte devient une frise compacte des 4 étapes avec une ligne d'action dessous.
   - Dans l'onglet « Réglages » : une section « État du système » avec des voyants (Claude, contexte, connexions, prochaine automatisation), toujours visible même une fois la mise en route terminée.

Vérifie toi-même, de bout en bout : connecte-toi avec un compte de test (créé puis supprimé à la fin), envoie « Bonjour, présente-toi en une phrase » par l'API, vérifie que la réponse arrive en temps réel, qu'elle est enregistrée, et qu'un deuxième message se souvient du premier. Vérifie que l'agent ne peut pas lire data/comptes.json (demande-lui, il doit refuser ou échouer). Si Claude n'est pas encore connecté, fais toutes les vérifications possibles sans lui et dis-moi de coller ma clé dans « Connecter Claude ». Mets à jour PROJET.md.
```

## Si ça ne marche pas

Décrivez d'abord ce que vous voyez à Claude (« J'ai collé le prompt 5, et je vois … au lieu de … ») : dans la plupart des cas, il corrige tout seul.

Si vous êtes vraiment bloqué, ce prompt remet votre outil exactement dans l'état de la fin de cette étape, à partir du dépôt commun :

```
Mon serveur est accessible par `ssh vps` (root). Remets mon outil exactement à l'état de l'étape 5 du dépôt commun {DEPOT} (étiquette etape-05) : récupère les dossiers instance/app et instance/agent de cette étiquette. Fais d'abord une sauvegarde, puis remplace /home/{UTILISATEUR}/app par instance/app, et recopie de instance/agent seulement les fichiers de configuration (CLAUDE.md, regles.md, .claude/settings.json, .claude/skills/) sans écraser CONTEXTE.md, memoire.md ni documents/. Ne touche ni à mes données (/home/{UTILISATEUR}/data), ni à ma clé Claude. Remplace dans le code le domaine, l'utilisateur et le port de l'exemple (agentforma.toog-expertise.app, agentforma, 4910) par les miens ({DOMAINE}, {UTILISATEUR}, {PORT}), mets à jour le service {UTILISATEUR}-app s'il diffère de instance/systeme, redémarre-le et vérifie que la page de connexion répond. Si cette étiquette n'existe pas dans le dépôt, ne touche à rien et dis-le-moi.
```
