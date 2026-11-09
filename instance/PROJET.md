# PROJET.md — mémoire du projet

À relire avant chaque étape, à mettre à jour à la fin de chaque étape.

## Paramètres

- Nom de l'outil : Espace agent — nom de l'agent : Mon agent
- Adresse : https://agentforma.toog-expertise.app — port local : 4910
- Charte neutre (on la changera plus tard, dans un seul bloc) : fond #F5F6F8, surface #FFFFFF, texte #1F2430, accent #3B5BDB, accent secondaire #0CA678, police « Inter » (Google Fonts) pour tout. Pas de logo : un carré arrondi couleur accent avec l'initiale de l'outil.
- Personnage du bureau 3D : corps #4C5A70, yeux #FFD43B, badge « IA », accessoire « aucun ».

## Organisation des dossiers (dans /home/agentforma)

- `app/` : le code de l'outil
  - `app/server.js` : le serveur (Node.js 22, aucune dépendance npm)
  - `app/creer-compte.js` : créer, modifier ou supprimer un compte
  - `app/public/` : les pages (connexion.html, index.html, style.css, connexion.js, accueil.js)
- `data/` : les données privées (droits 700, fichiers en 600) : `comptes.json`, `sessions.json` ; plus tard l'historique et les connexions
- `agent/` : le dossier de travail de l'agent (vide pour l'instant)
- `PROJET.md` : ce fichier

Où changer quoi :
- Les couleurs et la police : le bloc « CHARTE » en haut de `app/public/style.css`.
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
- Sans connexion, seuls `/connexion.html`, `/connexion.js`, `/style.css` et `/api/marque` répondent. Les autres pages renvoient vers `/connexion.html`, les autres API répondent 401.
- Routes : `GET /api/marque` (public), `POST /api/connexion`, `POST /api/deconnexion`, `GET /api/moi`.

## Journal des étapes

### Étape 3 — serveur et espace de connexion protégé (09/11/2026)
- Création de `app/`, `data/` (700), `agent/`.
- Serveur `app/server.js`, pages de connexion et d'accueil (« Bonjour <prénom>, ton agent arrive bientôt. »), bouton « Se déconnecter ».
- Script `app/creer-compte.js`.
- Service systemd `agentforma-app` activé et démarré.
- Vérifié : service actif, `/` sans connexion renvoie vers la connexion, compte de test créé, connexion par curl, accueil OK, compte de test supprimé, `data/` lisible seulement par agentforma.
- Pas encore fait : nginx et HTTPS pour https://agentforma.toog-expertise.app (le cookie étant « Secure », la connexion dans un navigateur se fera par l'adresse HTTPS une fois nginx en place).
