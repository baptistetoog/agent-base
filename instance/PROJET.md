# PROJET.md — mémoire du projet

À relire avant chaque étape, à mettre à jour à la fin de chaque étape.

## Paramètres

- Nom de l'outil : Espace agent — nom de l'agent : Mon agent
- Adresse : https://agentforma.toog-expertise.app — port local : 4910
- Charte neutre (on la changera plus tard, dans un seul bloc : « CHARTE » en haut de `app/public/design.css`) : fond #F5F6F8, surface #FFFFFF, texte #1F2430, accent #3B5BDB, accent secondaire #0CA678, police « Inter » (Google Fonts) pour tout. Pas de logo : un carré arrondi couleur accent avec l'initiale de l'outil.
- Personnage du bureau 3D : corps #4C5A70, yeux #FFD43B, badge « IA », accessoire « aucun ».

## Organisation des dossiers (dans /home/agentforma)

- `app/` : le code de l'outil
  - `app/server.js` : le serveur (Node.js 22, aucune dépendance npm)
  - `app/agent.js` : le cerveau (lance Claude Code pour chaque message, file d'attente, clé Claude)
  - `app/creer-compte.js` : créer, modifier ou supprimer un compte
  - `app/public/` : les pages
    - `design.css` : le système de design de TOUTES les pages (charte + composants .carte, .bouton, .bouton-secondaire, .pastille, .onglets, .fenetre, .toast, .vide, .squelette)
    - `connexion.html`, `connexion.js` : la page de connexion
    - `index.html`, `bureau.css`, `app.js`, `markdown.js` : le bureau de l'agent
    - `bureau3d.js` : la scène 3D, copiée TELLE QUELLE depuis le dépôt commun (kit/bureau3d.js) ; ne pas la modifier
- `data/` : les données privées (droits 700, fichiers en 600) : `comptes.json`, `sessions.json`, `historique.jsonl`, `agent-etat.json` (session Claude à reprendre + discussion en cours), `claude.json` (date de connexion de Claude)
- `agent/` : le dossier de travail de l'agent : `CLAUDE.md` (fiche provisoire), `.claude/settings.json` (interdictions)
- `sauvegardes/` : archives faites avant chaque étape
- `.claude-token.env` : la clé Claude (600), écrite par la fenêtre « Connecter Claude ». Ne jamais l'afficher.
- `PROJET.md` : ce fichier

Où changer quoi :
- Les couleurs et la police : le bloc « CHARTE » en haut de `app/public/design.css` (seul endroit où sont définies les couleurs).
- Le personnage 3D (couleurs, badge, accessoire) : la constante `PERSONNAGE` en haut de `app/public/app.js`.
- Le nom de l'outil et de l'agent : les lignes `Environment=` du service (voir plus bas), puis redémarrer. Ils ne sont écrits nulle part dans le code ; les pages les lisent par `GET /api/marque`.

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
  `~/.local/bin/claude -p --output-format stream-json --verbose --include-partial-messages --model sonnet --setting-sources project --strict-mcp-config --permission-mode acceptEdits --allowedTools Read Glob Grep WebSearch WebFetch Skill --disallowedTools Bash Task Agent NotebookEdit` (+ `--resume <session_id>` pour continuer la discussion). Le message est envoyé sur l'entrée standard.
- Environnement propre et minimal (HOME, PATH…), plus `CLAUDE_CODE_OAUTH_TOKEN` relu dans `.claude-token.env` à CHAQUE lancement, `ENABLE_CLAUDEAI_MCP_SERVERS=false`, `DISABLE_AUTOUPDATER=1`. La copie de la clé chargée par systemd au démarrage est ignorée.
- Un seul travail à la fois ; les autres messages attendent (file de 20 au plus). « Arrêter » coupe le travail en cours (le message suivant de la file démarre). Limite : 10 minutes par message.
- « Nouvelle discussion » : vide la file, arrête le travail en cours, oublie le session_id. La discussion est commune à toute l'équipe.
- Si la conversation à reprendre n'existe plus, on relance une fois sans `--resume`.
- Historique : `data/historique.jsonl`, une ligne par message (`role` utilisateur/agent, `qui`, `quand`, `texte`, `outils`, `dureeMs`, `coutUSD`, `statut` ok/arrete/delai/erreur, `discussion`) ; une ligne `type: nouvelle` à chaque nouvelle discussion.
- Interdictions de l'agent : `agent/.claude/settings.json` (`disableAllHooks`, `permissions.deny` en `Read(//…)` / `Edit(//…)`) : data/, app/, ~/.claude*, ~/.claude-token.env et /proc en lecture et en écriture ; sa propre configuration (CLAUDE.md, settings.json, settings.local.json, .mcp.json) et les fichiers cachés et .md à la racine de /home/agentforma en écriture. Ne JAMAIS redonner Bash à l'agent.
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
- Mise en route : les étapes 2 à 4 sont « Bientôt disponible ». À l'étape qui installe chaque fonction : dans `etatSysteme()` de `app/server.js`, passer `disponible` à `true` et brancher `fait` (et le voyant correspondant).

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
