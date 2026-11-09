# 3. Créer l'outil et son espace de connexion protégé

**Ce qu'on voit à la fin :** l'outil tourne sur le serveur, avec une page de connexion. Seules les personnes qui ont un compte peuvent entrer.

---

```
Mon serveur est accessible par `ssh vps` (root). Le projet appartient à l'utilisateur Linux {UTILISATEUR}, qui a déjà Node 22 et Claude Code.

Je veux créer l'outil web d'un agent IA. C'est une base commune, sans marque : elle servira ensuite à des agents de métiers différents. Commence par le serveur et l'espace de connexion protégé.

Voici les paramètres du projet. Toutes les étapes suivantes s'y réfèrent : recopie-les tels quels dans une section « Paramètres » de PROJET.md (voir plus bas).
- Nom de l'outil : {NOM_OUTIL} — nom de l'agent : {NOM_AGENT}
- Adresse : https://{DOMAINE} — port local : {PORT}
- Charte neutre (on la changera plus tard, dans un seul bloc) : fond #F5F6F8, surface #FFFFFF, texte #1F2430, accent #3B5BDB, accent secondaire #0CA678, police « Inter » (Google Fonts) pour tout. Pas de logo : un carré arrondi couleur accent avec l'initiale de l'outil.
- Personnage du bureau 3D : corps #4C5A70, yeux #FFD43B, badge « IA », accessoire « aucun ».

Organisation des dossiers (dans /home/{UTILISATEUR}) :
- app/ : le code de l'outil (serveur + pages)
- data/ : les données privées (comptes, sessions, historique, connexions), droits 700
- agent/ : le dossier de travail de l'agent (on le remplira plus tard)
- PROJET.md : la mémoire du projet (voir plus bas)

Le serveur :
- Un seul fichier app/server.js en Node.js 22, SANS aucune dépendance npm (uniquement les modules intégrés : http, crypto, fs, path, child_process…).
- Il écoute seulement sur 127.0.0.1:{PORT} (nginx sera devant plus tard).
- Il sert les pages du dossier app/public/. Toutes les pages et tous les fichiers sont servis avec `Cache-Control: no-cache` et un ETag (réponse 304 s'il n'a pas changé) : une simple actualisation de la page montre toujours la dernière version, sans vider le cache. Les routes /api/ sont en `Cache-Control: no-store`.
- Le nom de l'outil et celui de l'agent ne sont écrits en dur nulle part : ils viennent des variables NOM_OUTIL et NOM_AGENT du service systemd, exposées aux pages par une petite route publique GET /api/marque (nom de l'outil, nom de l'agent, initiale).

L'espace de connexion :
- Page app/public/connexion.html : e-mail + mot de passe, sobre, propre, adaptée au mobile. Elle suit la charte neutre des paramètres. En haut, le carré arrondi avec l'initiale et le nom de l'outil.
- Les comptes sont dans data/comptes.json : e-mail, nom, rôle (« admin » ou « membre »), mot de passe haché avec crypto.scrypt et un sel unique (jamais en clair).
- Session par cookie : HttpOnly, Secure, SameSite=Lax, valable 30 jours, sessions stockées dans data/sessions.json (seulement une empreinte du cookie ; le serveur relit le fichier quand il change, pour qu'une suppression de compte ferme bien ses sessions).
- Après 5 mauvais mots de passe en 15 minutes pour la même adresse IP, on bloque 15 minutes.
- Toute page (sauf la page de connexion, ses fichiers et /api/marque) renvoie vers la connexion si on n'est pas connecté ; une API renvoie une erreur 401 en JSON. L'IP du visiteur est lue dans X-Forwarded-For seulement quand la requête vient de 127.0.0.1 (nginx).
- Le cookie est Secure : le navigateur ne pourra se connecter qu'une fois le HTTPS posé (étape suivante). Pour les tests en curl d'ici là, passe le cookie à la main.
- Bouton « Se déconnecter ».
- Un petit script app/creer-compte.js pour créer ou modifier un compte en ligne de commande :
  `node app/creer-compte.js email@exemple.fr "Prénom Nom" admin`
  Lancé par root, il se relance ou corrige le propriétaire pour que data/ appartienne toujours à {UTILISATEUR}. Il demande le mot de passe sans l'afficher (deux fois, 10 caractères minimum). Il accepte aussi une variable d'environnement MOT_DE_PASSE pour les tests automatiques, et une option --supprimer pour retirer un compte (ses sessions sont fermées).
- Une fois connecté, la page app/public/index.html affiche pour l'instant : « Bonjour <prénom>, ton agent arrive bientôt. »

Le service :
- Un service systemd nommé {UTILISATEUR}-app qui lance le serveur en tant que {UTILISATEUR}, redémarre tout seul en cas d'arrêt et démarre avec le serveur, avec Environment="NOM_OUTIL={NOM_OUTIL}" et Environment="NOM_AGENT={NOM_AGENT}" (entre guillemets à cause des espaces). Ajoute les protections systemd simples : NoNewPrivileges, PrivateTmp, ProtectSystem=strict avec écriture autorisée seulement dans /home/{UTILISATEUR}.
- Le service charge le fichier /home/{UTILISATEUR}/.claude-token.env s'il existe (on s'en servira pour l'agent).

PROJET.md : écris-y en français simple la section « Paramètres » (ci-dessus), l'organisation des dossiers, comment démarrer/arrêter/voir les journaux du service, et ce qui a été fait à cette étape. À chaque étape suivante, on le relira avant de commencer et on le mettra à jour à la fin.

Vérifications à faire toi-même avant de me rendre la main :
- le service tourne (systemctl status) ;
- sans être connecté, `curl` sur / renvoie vers la page de connexion ;
- crée un compte de test avec creer-compte.js (MOT_DE_PASSE en variable), connecte-toi avec curl, vérifie que la page d'accueil répond, puis supprime ce compte de test ;
- les fichiers de data/ ne sont lisibles que par {UTILISATEUR}.

Ne touche à aucun autre site, service ou utilisateur du serveur. À la fin, donne-moi la commande exacte pour créer mon propre compte admin.
```

## Si ça ne marche pas

Décrivez d'abord ce que vous voyez à Claude (« J'ai collé le prompt 3, et je vois … au lieu de … ») : dans la plupart des cas, il corrige tout seul.

Si vous êtes vraiment bloqué, ce prompt remet votre outil exactement dans l'état de la fin de cette étape, à partir du dépôt commun :

```
Mon serveur est accessible par `ssh vps` (root). Remets mon outil exactement à l'état de l'étape 3 du dépôt commun {DEPOT} (étiquette etape-03) : récupère les dossiers instance/app et instance/agent de cette étiquette. Fais d'abord une sauvegarde, puis remplace /home/{UTILISATEUR}/app par instance/app, et recopie de instance/agent seulement les fichiers de configuration (CLAUDE.md, regles.md, .claude/settings.json, .claude/skills/) sans écraser CONTEXTE.md, memoire.md ni documents/. Ne touche ni à mes données (/home/{UTILISATEUR}/data), ni à ma clé Claude. Remplace dans le code le domaine, l'utilisateur et le port de l'exemple (agentforma.toog-expertise.app, agentforma, 4910) par les miens ({DOMAINE}, {UTILISATEUR}, {PORT}), mets à jour le service {UTILISATEUR}-app s'il diffère de instance/systeme, redémarre-le et vérifie que la page de connexion répond. Si cette étiquette n'existe pas dans le dépôt, ne touche à rien et dis-le-moi.
```
