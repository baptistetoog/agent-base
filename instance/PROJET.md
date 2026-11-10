# PROJET.md — mémoire du projet

À relire avant chaque étape, à mettre à jour à la fin de chaque étape.

## Paramètres

- Nom de l'outil : Espace agent — nom de l'agent : Mon agent (valeurs du service ; Réglages › Identité les remplace sans toucher au code, voir plus bas)
- Adresse : https://agentforma.toog-expertise.app — port local : 4910
- Charte neutre (on la changera plus tard, dans un seul bloc : « CHARTE » en haut de `app/public/design.css`) : fond #F5F6F8, surface #FFFFFF, texte #1F2430, accent #3B5BDB, accent secondaire #0CA678, police « Inter » (Google Fonts) pour tout. Pas de logo : un carré arrondi couleur accent avec l'initiale de l'outil.
- Personnage du bureau 3D : corps #4C5A70, yeux #FFD43B, badge « IA » (modifiable dans Réglages › Identité), accessoire « aucun ».

## Organisation des dossiers (dans /home/agentforma)

- `app/` : le code de l'outil
  - `app/server.js` : le serveur (Node.js 22, aucune dépendance npm)
  - `app/agent.js` : le cerveau (lance Claude Code pour chaque message, file d'attente, clé Claude)
  - `app/creer-compte.js` : créer, modifier ou supprimer un compte
  - `app/skills.js` : les skills (liste, création, modification, suppression ; identifiant nettoyé)
  - `app/mcp-approbation.js` : serveur MCP d'approbation (stdio, sans dépendance) passé à Claude avec `--permission-prompt-tool`
  - `app/connexions.js` : les connexions aux outils externes (Réglages › Connexions) : liste, création, test, suppression, OAuth (découverte, enregistrement du client, PKCE, retour)
  - `app/mcp-pont.js` : pont stdio ↔ « Streamable HTTP » vers un serveur MCP distant (types oauth et jeton), lancé avec le NOM de la connexion
  - `app/mcp-api.js` : serveur MCP stdio d'une « API avec clé » (outils `lire_api`, `appel_api`), lancé avec le NOM de la connexion
  - `app/espace.js` : identité de l'espace (nom, logo, agent, badge), fichiers de contexte, documents déposés, fichiers produits par l'agent (seuls chemins accessibles par l'outil)
  - `app/public/` : les pages
    - `design.css` : le système de design de TOUTES les pages (charte + composants .carte, .bouton, .bouton-secondaire, .pastille, .onglets, .fenetre, .toast, .vide, .squelette)
    - `connexion.html`, `connexion.js` : la page de connexion
    - `index.html`, `bureau.css`, `app.js`, `markdown.js` : le bureau de l'agent
    - `bureau3d.js` : la scène 3D, copiée TELLE QUELLE depuis le dépôt commun (kit/bureau3d.js) ; ne pas la modifier
- `data/` : les données privées (droits 700, fichiers en 600) : `comptes.json`, `sessions.json`, `historique.jsonl`, `agent-etat.json` (session Claude à reprendre + discussion en cours), `claude.json` (date de connexion de Claude), `identite.json` (nom de l'espace, de l'agent, badge, logo ; n'existe qu'après un premier « Enregistrer »), `logo` (le logo, nom fixe, type rangé dans identite.json) ; `connexions.json` (connexions + jetons/clés des types jeton et api) et `oauth/<nom>.json` (700/600 : découverte, client_id, jetons OAuth) ; `mcp-<pid>-<hasard>.json` = configuration MCP temporaire d'un lancement de Claude (600, supprimée à la fin, et au démarrage du service si oubliée)
- `agent/` : le dossier de travail de l'agent :
  - `CLAUDE.md` : sa fiche de poste, chargée à chaque message. Commence par `@CONTEXTE.md`, `@memoire.md`, `@regles.md` (imports). Sections : Qui tu es (la ligne « Tu t'appelles « … » » suit le nom de l'agent), Avant de répondre (obligation de s'informer), Ta méthode, Tes documents, Tes livrables, Ta mémoire.
  - `CONTEXTE.md` : la fiche d'identité de la structure (7 rubriques, « À compléter » au départ). L'agent la lit, ne la modifie pas.
  - `memoire.md` : ce qu'il retient (Préférences, Décisions, Infos utiles, À ne plus faire), une ligne datée par info, moins de 150 lignes. Il l'écrit lui-même.
  - `regles.md` : les règles communes. L'agent la lit, ne la modifie pas.
  - `documents/` : les documents déposés par l'équipe (Réglages ou trombone de la discussion).
  - `work/` : ses livrables (un fichier par travail), téléchargeables dans « Fichiers de l'agent ».
  - `.claude/settings.json` : interdictions
  - `.claude/skills/<identifiant>/SKILL.md` : ses skills (format natif Claude Code). Départ : `synthese-document`, `redaction-mail` ; créé par l'agent : `compte-rendu`.
- `sauvegardes/` : archives faites avant chaque étape
- `.claude-token.env` : la clé Claude (600), écrite par la fenêtre « Connecter Claude ». Ne jamais l'afficher.
- `PROJET.md` : ce fichier

Où changer quoi :
- Les couleurs et la police : le bloc « CHARTE » en haut de `app/public/design.css` (seul endroit où sont définies les couleurs).
- Le personnage 3D (couleurs, badge, accessoire) : la constante `PERSONNAGE` en haut de `app/public/app.js`.
- Le nom de l'espace, le logo, le nom de l'agent et son badge : Réglages › Identité (admin). Rangés dans `data/identite.json`, prioritaires sur `NOM_OUTIL` / `NOM_AGENT` du service (qui ne servent plus que de valeurs par défaut). Les pages les lisent par `GET /api/marque` ; la scène 3D est recréée tout de suite.
- Ce que l'agent sait (contexte, mémoire, règles, fiche) et ses documents : Réglages › Contexte et mémoire.
- Ses skills : Réglages › Skills (admin), ou en lui disant « fais-en un skill ».

## Le service

Nom : `agentforma-app` (fichier `/etc/systemd/system/agentforma-app.service`). Il tourne en tant qu'utilisateur agentforma, écoute seulement sur 127.0.0.1:4910, redémarre tout seul et démarre avec le serveur. Il charge `/home/agentforma/.claude-token.env` s'il existe.

Commandes (en root) :
- État : `systemctl status agentforma-app`
- Démarrer / arrêter / redémarrer : `systemctl start agentforma-app` / `systemctl stop agentforma-app` / `systemctl restart agentforma-app`
- Journaux en direct : `journalctl -u agentforma-app -f`
- Après modification du fichier de service : `systemctl daemon-reload && systemctl restart agentforma-app`

## Les comptes

- Créer ou modifier (le mot de passe est demandé deux fois, sans s'afficher, 10 caractères minimum) :
  `cd /home/agentforma && sudo -u agentforma node app/creer-compte.js email@exemple.fr "Prénom Nom" admin`
  (rôle : `admin` ou `membre`)
- Supprimer (ferme aussi ses sessions) : `sudo -u agentforma node app/creer-compte.js email@exemple.fr --supprimer`
- Pour les tests automatiques : variable `MOT_DE_PASSE=...` devant la commande.

## Fonctionnement de la connexion

- Mots de passe hachés avec scrypt et un sel unique par compte, jamais en clair.
- Cookie de session `session` : HttpOnly, Secure, SameSite=Lax, 30 jours. Dans `sessions.json` on ne garde qu'une empreinte du cookie, pas le cookie lui-même.
- 5 mauvais mots de passe en 15 minutes depuis la même adresse IP : blocage 15 minutes (compteur en mémoire, remis à zéro au redémarrage). Derrière nginx, l'IP vient de l'en-tête X-Real-IP / X-Forwarded-For.
- Sans connexion, seuls `/connexion.html`, `/connexion.js`, `/design.css` et `/api/marque` répondent. Les autres pages renvoient vers `/connexion.html`, les autres API répondent 401.
- Routes : `GET /api/marque` (public), `POST /api/connexion`, `POST /api/deconnexion`, `GET /api/moi`.

## Le cerveau de l'agent (app/agent.js)

- Chaque message lance, dans `/home/agentforma/agent`, en tant que agentforma :
  `~/.local/bin/claude -p --output-format stream-json --verbose --include-partial-messages --model sonnet --setting-sources project --strict-mcp-config --mcp-config data/mcp-<…>.json --permission-prompt-tool mcp__approbation__approuver --permission-mode acceptEdits --allowedTools Read Glob Grep WebSearch WebFetch Skill mcp__<nom>__* (une par connexion active) --disallowedTools Bash Task Agent NotebookEdit` (+ `--resume <session_id>` pour continuer la discussion). Le message est envoyé sur l'entrée standard.
- Le fichier `data/mcp-<…>.json` contient le serveur d'approbation + une entrée par connexion active (OAuth avec jetons, ou jeton/clé enregistré) : `node app/mcp-pont.js <nom>` ou `node app/mcp-api.js <nom>`. AUCUN secret dedans : les ponts relisent eux-mêmes `data/` (interdit à l'agent).
- Environnement propre et minimal (HOME, PATH…), plus `CLAUDE_CODE_OAUTH_TOKEN` relu dans `.claude-token.env` à CHAQUE lancement, `ENABLE_CLAUDEAI_MCP_SERVERS=false`, `DISABLE_AUTOUPDATER=1`. La copie de la clé chargée par systemd au démarrage est ignorée.
- Un seul travail à la fois ; les autres messages attendent (file de 20 au plus). « Arrêter » coupe le travail en cours (le message suivant de la file démarre). Limite : 10 minutes par message.
- « Nouvelle discussion » : vide la file, arrête le travail en cours, oublie le session_id. La discussion est commune à toute l'équipe.
- Si la conversation à reprendre n'existe plus, on relance une fois sans `--resume`.
- Historique : `data/historique.jsonl`, une ligne par message (`role` utilisateur/agent, `qui`, `quand`, `texte`, `outils`, `dureeMs`, `coutUSD`, `statut` ok/arrete/delai/erreur, `discussion`) ; une ligne `type: nouvelle` à chaque nouvelle discussion.
- Interdictions de l'agent : `agent/.claude/settings.json` (`disableAllHooks`, `permissions.deny` en `Read(//…)` / `Edit(//…)`) : data/, app/, ~/.claude*, ~/.claude-token.env et /proc en lecture et en écriture ; sa propre configuration (CLAUDE.md, settings.json, settings.local.json, .mcp.json), CONTEXTE.md, regles.md et les fichiers cachés et .md à la racine de /home/agentforma en écriture. Il peut écrire memoire.md et dans work/. Ne JAMAIS redonner Bash à l'agent.
- Fichiers produits : quand l'agent écrit (Write/Edit) un fichier directement dans `agent/work/`, son nom est ajouté à la ligne d'historique (`fichiers`) et la bulle affiche une carte « 📄 nom · Télécharger ».
- Fichier joint (trombone) : le fichier est rangé dans `agent/documents/` (`POST /api/joindre`), puis le message part avec `fichier` ; le serveur ajoute « Fichier joint : documents/<nom> » à la fin du texte envoyé à l'agent, et la ligne d'historique garde `fichier`.
- « Remplir à partir d'un site » : lancement à part (`claude -p --tools WebFetch`, 6 minutes max, un seul à la fois), hors de la discussion ; le résultat est une proposition relue dans la page, jamais enregistrée sans clic. « Sa mission » et « Ce qu'il ne doit jamais faire » restent « À compléter » (c'est à l'équipe de les écrire).
- Tous les fichiers de agent/ appartiennent à agentforma.

## Connecter Claude

- Bouton « Connecter Claude » (pastille orange en haut, carte « Mise en route », Réglages › Claude), réservé aux admins. Même fenêtre partout, deux méthodes :
  - **Sans Terminal (par défaut)** : gros bouton « Se connecter avec Claude ». Le serveur lance lui-même, en tant que agentforma, `script -qfc "stty cols 400 rows 50; exec ~/.local/bin/claude setup-token" /dev/null` (COLUMNS=400 ; le `stty` est indispensable car `script` lancé sans terminal crée un pseudo-terminal de taille 0 et Claude coupe alors le lien et la clé à 80 colonnes). Il lit le lien d'autorisation (`https://claude.com/cai/oauth/authorize?…`, premier des deux, pris dans la séquence OSC 8) et l'envoie à la page. Étape 1 : bouton « Ouvrir Claude » (nouvel onglet) ; étape 2 : coller le code → le serveur l'écrit dans le processus (suivi d'Entrée, `\r`), lit la clé `sk-ant-oat01-…` dans la sortie, la teste et l'enregistre comme une clé collée. Un seul processus à la fois (une nouvelle demande arrête la précédente), arrêté au bout de 10 minutes sans code, et toujours arrêté après l'envoi d'un code (réussite ou échec). Code refusé : « Le code n'a pas été accepté : recommencez. » + bouton « Recommencer » (nouveau lien). Ni le code, ni la clé, ni le lien ne sont écrits dans les journaux.
  - **« J'ai déjà une clé »** (secours) : les 3 étapes d'avant (`claude setup-token` sur son ordinateur, autoriser dans le navigateur, coller la clé `sk-ant-oat01-…`). Lien « ← Se connecter avec Claude, sans Terminal » pour revenir.
- Le serveur nettoie la saisie (espaces, guillemets, `export`, `CLAUDE_CODE_OAUTH_TOKEN=`, clé collée deux fois), la teste avec `claude -p "Réponds seulement : prêt"` et ne l'enregistre (600) que si la réponse est bonne. La clé n'est jamais renvoyée au navigateur ni écrite dans les journaux.
- « Déconnecter » (admin, avec confirmation) supprime la clé du serveur. Changer de clé ne demande pas de redémarrage.
- Un membre non admin qui écrit alors que Claude n'est pas connecté voit « L'agent n'est pas encore connecté : demandez à un admin ».

## Routes du bureau (connexion obligatoire ; les POST exigent du JSON)

- `GET /api/etat` : Claude connecté ?, statut de l'agent, étapes de la mise en route, voyants des Réglages.
- `GET /api/discussion` : messages de la discussion en cours (+ réponse en cours d'écriture).
- `GET /api/flux` : temps réel (Server-Sent Events) : `etat`, `statut` (repos / message / reflechit / outil + texte / repond / fini), `message`, `debut`, `morceau`, `outils`, `fin`, `file`, `nouvelle`, `claude`.
- `POST /api/message` `{texte}`, `POST /api/arreter`, `POST /api/nouvelle`.
- `POST /api/claude/connecter` `{cle}`, `POST /api/claude/deconnecter` (admin).
- `POST /api/claude/lien` (admin) : lance `claude setup-token`, renvoie `{lien}`. `POST /api/claude/code` `{code}` (admin) : échange le code contre la clé, la teste et l'enregistre ; en cas d'échec renvoie `relancer: true`.
- `GET /api/marque` (public) : nomOutil, nomAgent, initiale, badge, logo (adresse versionnée ou null). `GET /api/logo` (public) : le logo ; un SVG est servi avec une CSP sans script et `sandbox`.
- `POST /api/identite` `{nomOutil, nomAgent, badge}` (admin), `POST /api/identite/logo` (admin, corps brut ≤ 2 Mo, PNG/JPEG/SVG vérifiés par leurs premiers octets), `POST /api/identite/logo/retirer` (admin). Événement temps réel `marque`.
- `GET /api/contexte` : CONTEXTE.md, memoire.md, regles.md, CLAUDE.md (et rien d'autre). `POST /api/contexte/{contexte|memoire|regles|fiche}` `{contenu}` (admin, 200 Ko max). Événement `contexte`.
- `POST /api/contexte/remplir` `{url}` (admin) puis `GET /api/contexte/remplir` (état + proposition), `POST /api/contexte/remplir/annuler`.
- `GET /api/documents`, `POST /api/documents` (admin), `POST /api/documents/supprimer` `{nom}` (admin) ; `POST /api/joindre` (tout compte : fichier joint à un message). `GET /api/fichiers`, `POST /api/fichiers/supprimer` `{nom}` (admin). `GET /api/telecharger?dossier=work|documents&nom=…[&apercu=1]` : seulement ces deux dossiers, noms nettoyés, aucun chemin, aucun lien symbolique suivi.
- Envois de fichiers : corps brut + en-tête `X-Nom-Fichier` (nom encodé) obligatoire, 20 Mo max, formats .txt .md .markdown .csv .pdf .png .jpg .jpeg .gif .webp, contenu vérifié (le contenu doit correspondre à l'extension). Nom nettoyé (pas de chemin, pas de fichier caché, « (2) » si le nom existe).
- Mise en route : l'étape 2 « Donner son contexte à l'agent » est active (bouton → Réglages › Contexte et mémoire) et se coche quand la rubrique « Sa mission » de CONTEXTE.md n'est plus « À compléter » (fonction `missionRemplie` de `app/espace.js`) ; le voyant « Contexte de l'agent » suit la même règle. L'étape 3 « Brancher un premier outil » est active depuis l'étape 8 (bouton → Réglages › Connexions) et se coche dès qu'une connexion a passé le test (statut « connecte ») ; le voyant « Connexions » affiche le nombre de connexions qui marchent. L'étape 4 est « Bientôt disponible ». À l'étape qui installe chaque fonction : dans `etatSysteme()` de `app/server.js`, passer `disponible` à `true` et brancher `fait` (et le voyant correspondant).

## Cache du navigateur

- Toutes les pages et fichiers de `app/public` sont servis avec `Cache-Control: no-cache` + `ETag` (taille + date de modification) + `Last-Modified` : le navigateur redemande toujours, le serveur répond 304 si rien n'a changé. Une actualisation normale montre donc toujours la dernière version (pas besoin de Cmd+Maj+R).
- Les routes `/api/` restent en `Cache-Control: no-store`.

## Sécurité du contenu (CSP, posée par app/server.js)

- Scripts : `self` + `https://cdn.jsdelivr.net` (three.js 0.170.0 via l'importmap) + l'empreinte sha256 de l'importmap, recalculée automatiquement si `index.html` change.
- Styles : `self` + Google Fonts + `unsafe-inline` (nécessaire au dessin de secours SVG de bureau3d.js quand WebGL manque). Polices : fonts.gstatic.com.

## Mise en ligne (nginx + HTTPS)

- Configuration nginx : `/etc/nginx/sites-available/agentforma` (lien dans `sites-enabled/`). Seul fichier nginx propre à cet outil ; ne jamais toucher aux autres sites du serveur.
  - Port 80 : sert `/.well-known/acme-challenge/` depuis `/var/www/certbot`, renvoie tout le reste vers HTTPS (301).
  - Port 443 : proxy vers 127.0.0.1:4910, temps réel SSE (proxy_buffering off, délai de lecture 24 h), envois jusqu'à 20 Mo, transmet X-Real-IP / X-Forwarded-For.
  - En-têtes posés par nginx (ceux du serveur Node du même nom sont masqués pour éviter les doublons) : HSTS 1 an, X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin-when-cross-origin. La CSP reste celle du serveur Node.
- Certificat Let's Encrypt : `/etc/letsencrypt/live/agentforma.toog-expertise.app/`, méthode webroot, renouvellement automatique (minuteur certbot) avec rechargement de nginx.
- Modifier la config : éditer le fichier, puis `nginx -t && systemctl reload nginx` (jamais recharger si `nginx -t` échoue).
- IP réelle : le serveur Node ne lit X-Real-IP / X-Forwarded-For que si la requête vient de 127.0.0.1 (fonction `adresseIP` de `app/server.js`, déjà en place).

## Journal des étapes

### Étape 3 — serveur et espace de connexion protégé (09/11/2026)
- Création de `app/`, `data/` (700), `agent/`.
- Serveur `app/server.js`, pages de connexion et d'accueil (« Bonjour <prénom>, ton agent arrive bientôt. »), bouton « Se déconnecter ».
- Script `app/creer-compte.js`.
- Service systemd `agentforma-app` activé et démarré.
- Vérifié : service actif, `/` sans connexion renvoie vers la connexion, compte de test créé, connexion par curl, accueil OK, compte de test supprimé, `data/` lisible seulement par agentforma.
- Pas encore fait à cette étape : nginx et HTTPS (fait à l'étape 4).

### Étape 4 — mise en ligne sur https://agentforma.toog-expertise.app (09/11/2026)
- DNS vérifié : agentforma.toog-expertise.app → 155.117.100.221 (IP publique du serveur).
- Configuration nginx `agentforma` créée, certificat Let's Encrypt obtenu (expire le 07/02/2027, renouvellement automatique), HTTP → HTTPS.
- Code Node inchangé : la lecture de l'IP réelle derrière nginx était déjà limitée à 127.0.0.1.
- Vérifié : certificat valide, HTTP renvoie en 301 vers HTTPS, `/` renvoie vers `/connexion.html` qui s'affiche, `/api/marque` répond, en-têtes de sécurité présents une seule fois, autres sites du serveur toujours en ligne.

### Étape 5 — le bureau de l'agent et son cerveau (09/11/2026)
- Sauvegarde : `sauvegardes/app-avant-etape5-20261109-0946.tar.gz`.
- Page d'accueil provisoire remplacée par le bureau : scène 3D (bureau3d.js du dépôt commun, non modifié) + panneau Discussion / Réglages, en-tête, mise en route épinglée, version mobile (scène repliable, frise compacte, barre d'onglets en bas, menu ☰).
- `style.css` et `accueil.js` supprimés, remplacés par `design.css` (toutes les pages), `bureau.css`, `app.js`, `markdown.js`.
- Cerveau `app/agent.js`, nouvelles routes et CSP dans `app/server.js` ; `agent/CLAUDE.md` provisoire et `agent/.claude/settings.json`.
- Vérifié sans clé Claude : service actif ; pages protégées ; `/api/etat`, `/api/discussion`, flux temps réel ; message refusé avec le bon texte (admin / membre) ; seul un admin peut connecter Claude ; nettoyage de la clé (export, guillemets, collée deux fois) ; une fausse clé est refusée par Claude (« Clé refusée par Claude… »), rien n'est enregistré ni écrit dans les journaux ; logique du cerveau (morceaux en direct, outils, coût, file, Arrêter, --resume, nouvelle discussion) testée avec un faux programme claude ; captures ordinateur et mobile : scène 3D chargée, aucune erreur de console ni de CSP. Comptes de test supprimés.
- RESTE À FAIRE : coller la clé dans « Connecter Claude », puis vérifier une vraie réponse, la mémoire d'un message à l'autre et le refus de lire data/comptes.json.

### Étape 5 (amélioration) — connexion à Claude sans Terminal + cache (09/11/2026)
- Sauvegarde : `sauvegardes/app-avant-etape5b-20261109-0957.tar.gz`.
- `app/agent.js` : `demarrerConnexion` / `finirConnexion` (claude setup-token piloté par le serveur dans un pseudo-terminal), `testerEtEnregistrer` commun aux deux méthodes.
- `app/server.js` : routes `/api/claude/lien` et `/api/claude/code` ; fichiers statiques en `no-cache` + ETag / 304.
- `index.html`, `app.js`, `bureau.css` : fenêtre « Connecter Claude » en deux méthodes (sans Terminal par défaut, « J'ai déjà une clé » en secours).
- Vérifié : le lien commence par https://claude.com/cai/oauth/authorize et contient code_challenge ; le processus tourne en tant que agentforma sous le service (ProtectSystem=strict, PrivateTmp) ; un faux code donne « Le code n'a pas été accepté : recommencez. », rien n'est enregistré et le processus est arrêté ; une deuxième demande de lien remplace la première (un seul processus) ; une fausse clé collée est toujours refusée ; rien de secret dans les journaux ; cache : en-têtes présents, 304 avec If-None-Match, 200 après modification ; captures ordinateur et mobile. Compte de test supprimé.
- RESTE À FAIRE : une vraie connexion avec un compte Claude (Pro ou Max), puis les vérifications de l'étape 5 (vraie réponse, mémoire, refus de lire data/comptes.json).

### Étape 5 — vérifications avec Claude connecté (09/11/2026)
- Compte de test créé puis supprimé. « Bonjour, présente-toi en une phrase » : réponse en direct (10 morceaux, premier au bout de 2,6 s), enregistrée dans l'historique. Deuxième message : il cite la première question (--resume OK). Lire data/comptes.json : refusé (l'agent n'essaie même pas ; la règle deny est en place). Aucun bug.

### Étape 6 — identité, contexte, mémoire, fichiers (09/11/2026)
- Sauvegarde : `sauvegardes/avant-etape6-20261109-1021.tar.gz` (app, agent, PROJET.md).
- `agent/` : CLAUDE.md (fiche de poste complète), CONTEXTE.md (7 rubriques « À compléter »), memoire.md (vide, 4 rubriques), regles.md, dossiers documents/ et work/ ; deny Edit sur CONTEXTE.md et regles.md.
- `app/espace.js` (nouveau), `app/server.js` (routes identité, contexte, documents, fichiers, téléchargement ; voyant et étape 2 de la mise en route), `app/agent.js` (nom de l'agent modifiable, fichiers produits dans work/, fichier joint, « Remplir à partir d'un site »).
- Interface : Réglages › Identité (en tête), Contexte et mémoire (sous-onglets Contexte, Mémoire, Règles, Fiche, Documents ; lecture mise en forme, « Modifier » pour un admin), Fichiers de l'agent (aperçu, téléchargement, suppression admin ; accessible depuis l'en-tête sur ordinateur et le menu ☰ sur mobile) ; trombone et glisser-déposer dans la discussion ; cartes de fichier dans les bulles ; icône d'onglet = logo ou carré avec l'initiale ; sur mobile, le bureau 3D se replie sur l'onglet Réglages.
- Vérifié (compte de test admin + compte membre, supprimés) : identité changée par l'API (/api/marque, /api/logo, SVG avec CSP sans script), l'agent répond « Je m'appelle Hector », scène recréée sans recharger ; valeurs d'origine remises, logo retiré ; document ORION-7 trouvé et cité ; « Je retiens » + ligne datée dans memoire.md, retrouvée dans une nouvelle discussion, puis retirée ; modifier regles.md refusé ; fichier joint lu, work/essai.md créé, listé et téléchargé, puis supprimés ; « Quels sont nos tarifs ? » → « Je n'ai pas cette information » + proposition de déposer un document ; « Remplir à partir d'un site » testé (48 s, rien enregistré) ; refus : faux PNG, PDF déguisé, SVG en document, chemin ../, lien symbolique, dossier hors liste, membre (403 sur toute modification) ; mission remplie → étape 2 cochée + voyant vert, puis remise à « À compléter ». Captures ordinateur et mobile, aucune erreur de console.
- CONTEXTE.md laissé avec ses rubriques « À compléter ».

## Les skills (étape 7)

- Format : `agent/.claude/skills/<identifiant>/SKILL.md`, en-tête `---` / `name: <identifiant>` / `description: "<quand l'utiliser>"` / `---`, puis la méthode en Markdown. La description est écrite entre guillemets (le « : » français casserait l'en-tête YAML). Claude Code les charge tout seul (`--setting-sources project`) ; l'agent les utilise avec l'outil `Skill` (déjà dans `--allowedTools`).
- Identifiant : minuscules, chiffres, tirets, 60 caractères max (« Réponse aux avis » → `reponse-aux-avis`). Nettoyé côté serveur (`nettoyerId` de `app/skills.js`) : impossible d'écrire ailleurs que dans `agent/.claude/skills/`.
- Routes : `GET /api/skills` (tout compte), `POST /api/skills` `{nom, description, methode, ancien?}` (admin ; `ancien` = identifiant avant modification/renommage), `POST /api/skills/supprimer` `{id}` (admin). Événement temps réel `skills`.
- Interface : Réglages › Skills (liste nom + description ; admin : « Nouveau skill », crayon, poubelle, éditeur avec onglets Écrire / Aperçu ; membre : lecture seule). Discussion : bouton « / » (ou « / » tapé dans un message vide) → liste des skills → étiquette « Skill : <id> » au-dessus de la saisie. `POST /api/message` reçoit alors `skill` ; le serveur vérifie qu'il existe et termine le texte envoyé à l'agent par « Applique le skill <id>. » ; la ligne d'historique garde `skill` et la bulle affiche l'étiquette (la phrase est masquée).
- L'agent crée ses skills lui-même (section « Tes skills » de `agent/CLAUDE.md`). Claude Code refuse toujours l'écriture dans `.claude/` : `app/mcp-approbation.js` répond « oui » UNIQUEMENT à Write/Edit de `agent/.claude/skills/<id>/SKILL.md` avec un en-tête valide (name = nom du dossier, description non vide et entre guillemets si elle contient « : », méthode non vide, aucun autre champ, aucun lien symbolique) et « non » à tout le reste. Les règles deny passent avant lui. Jamais de `--dangerously-skip-permissions`, pas de Write/Edit dans `--allowedTools`. Journaux du serveur d'approbation : `~/.cache/claude-cli-nodejs/-home-agentforma-agent/mcp-logs-approbation/`.
- L'historique garde, pour l'outil Skill, le skill réellement utilisé (`outils[].skill`).

### Étape 7 — les skills (09/11/2026)
- Sauvegarde : `sauvegardes/avant-etape7-20261109-1043.tar.gz` (app, agent, PROJET.md).
- Nouveaux : `app/skills.js`, `app/mcp-approbation.js`, skills `synthese-document` et `redaction-mail`, section « Tes skills » de `agent/CLAUDE.md`. Modifiés : `app/agent.js`, `app/server.js`, `index.html`, `app.js`, `bureau.css`.
- Vérifié (compte de test admin + membre, supprimés) : résumé d'un compte rendu inventé → outil `Skill` `synthese-document` (vu dans la transcription brute de Claude) ; mail de relance → `redaction-mail` ; « crée un skill compte-rendu » → Write approuvé par le serveur d'approbation (journal MCP), skill visible dans Réglages › Skills (GARDÉ) ; bouton « / » + compte-rendu → message terminé par « Applique le skill compte-rendu. », étiquette sur la bulle, skill utilisé ; API : création, renommage, doublon refusé, `../../settings` nettoyé en `settings`, membre 403 ; serveur d'approbation : refus de settings.json, d'un autre nom de fichier, d'un name différent du dossier, de Bash. Captures ordinateur et mobile, aucune erreur de console.

## Les connexions (étape 8)

- Réglages › Connexions : section réservée aux admins (masquée pour un membre, API en 403). Trois types :
  - `oauth` — « Serveur MCP (connexion par compte, OAuth) » : nom + adresse, bouton « Connecter ». Découverte : en-tête `WWW-Authenticate` (resource_metadata) d'un POST initialize sans jeton, puis `/.well-known/oauth-protected-resource[/chemin]`, puis `/.well-known/oauth-authorization-server` (et `openid-configuration`) du serveur d'autorisation annoncé, sinon de l'origine. Enregistrement automatique du client (DCR, `token_endpoint_auth_method: none`, retour `https://agentforma.toog-expertise.app/api/oauth/retour`), PKCE S256, `resource`, `scope` si la ressource en annonce, `state` à usage unique (10 min) lié à la session de l'admin (empreinte du cookie). Le client_id est réutilisé pour « Reconnecter ».
  - `jeton` — « Serveur MCP (avec un jeton) » : nom, adresse, en-tête (Authorization par défaut), préfixe (Bearer par défaut), jeton.
  - `api` — « API avec clé » : nom, URL de base (on ajoute « / » à la fin), en-tête, préfixe facultatif, clé, case « Autoriser l'écriture » (décochée par défaut ; modifiable ensuite par l'interrupteur de la liste).
- Noms : minuscules, chiffres, tirets, 40 max ; `approbation`, `claude`, `ide` réservés. Adresses en https:// uniquement.
- Secrets : `data/connexions.json` (jeton/clé) et `data/oauth/<nom>.json` (jetons OAuth, client), 600. Le navigateur ne reçoit que `••••` + les 4 derniers caractères. Rien de secret dans les journaux.
- Statuts : `connecte` (dernier test réussi), `a-reconnecter` (OAuth pas fini, expiré ou refusé), `erreur`. « Tester » lance le pont, fait `initialize` puis `tools/list` et affiche les outils. Une connexion jeton/api est testée dès l'ajout ; une connexion OAuth est testée juste après le retour.
- `app/mcp-pont.js` : ajoute l'en-tête, renouvelle le jeton OAuth avec le refresh_token (avant expiration ou sur 401, une fois) et réécrit `data/oauth/<nom>.json`, garde `Mcp-Session-Id` et `MCP-Protocol-Version`, lit les réponses JSON et text/event-stream, masque les jetons. Expiré/refusé → « La connexion « nom » a expiré ou a été refusée : un admin doit reconnecter nom dans Connexions. »
- `app/mcp-api.js` : `lire_api(chemin)` (GET), `appel_api(methode, chemin, corps)` seulement si l'écriture est autorisée ; chemins strictement sous l'URL de base (même origine, même début de chemin, pas de `..`), redirections suivies seulement sous la base, clé ajoutée par le pont, réponses coupées à 50 000 caractères, clé masquée.
- Routes (admin) : `GET /api/connexions`, `POST /api/connexions` `{type, nom, url, entete?, prefixe?, secret?, ecriture?}` (oauth → `{lien}` ; jeton/api → `{connexion, test}`), `POST /api/connexions/tester|reconnecter|supprimer` `{nom}`, `POST /api/connexions/ecriture` `{nom, ecriture}`, `GET /api/oauth/retour` (retour du site de l'outil ; sans session → page de connexion ; puis redirection vers `/?oauth=ok|erreur&nom=…&message=…`, la page affiche « Connecté » et ouvre Connexions). Événement temps réel `connexions`.
- `agent/CLAUDE.md`, section « Tes connexions » : regarder ses outils mcp__… avant de dire qu'il ne peut pas, préférer les données réelles, signaler simplement une connexion en erreur, ne rien créer/modifier/envoyer/supprimer dans un outil branché sans accord explicite (en attendant l'étape des validations).
- Ajouter un outil : Réglages › Connexions › « Nouvelle connexion ». Jamais de clé dans la discussion.

### Étape 8 — les connexions MCP et clés API (09/11/2026)
- Sauvegarde : `sauvegardes/avant-etape8-20261109-1107.tar.gz` (app, agent, PROJET.md).
- Nouveaux : `app/connexions.js`, `app/mcp-pont.js`, `app/mcp-api.js`. Modifiés : `app/agent.js` (config MCP temporaire, outils `mcp__<nom>__*`, libellés des outils), `app/server.js` (routes, étape 3, voyant), `index.html`, `app.js`, `bureau.css`, `agent/CLAUDE.md`.
- Vérifié (compte de test admin, supprimé) : découverte OAuth de https://mcp.notion.com/mcp (oauth-protected-resource/mcp puis oauth-authorization-server, client_id obtenu par DCR, lien https://mcp.notion.com/authorize avec response_type, client_id, redirect_uri, code_challenge S256, state, resource, scope), state inconnu refusé, retour sans session → connexion, connexion inachevée supprimée (fichier OAuth effacé) ; pont « jeton » sur https://mcp.deepwiki.com/mcp (3 outils) ; API github-test (fausse clé dans X-Test) : seul `lire_api` tant que l'écriture n'est pas autorisée (`appel_api` apparaît puis disparaît avec l'interrupteur), GET repos/anthropics/claude-code → HTTP 200, adresse hors base refusée, réponse longue coupée, fausse clé absente de toutes les réponses et des journaux ; agent : « Quel est le nombre d'étoiles du dépôt github.com/anthropics/claude-code ? » → `mcp__github-test__lire_api`, réponse « 155 064 étoiles » (10 s) ; étape 3 cochée + voyant « 1 connexion qui marche », puis décochée après suppression. Captures ordinateur et mobile (liste, formulaire des 3 types, résultat de « Tester »), aucune erreur de console.
- Non vérifié faute de compte tiers : une autorisation OAuth complète (échange du code, renouvellement par refresh_token).
- Aucune connexion laissée.
