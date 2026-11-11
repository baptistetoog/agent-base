# 1. L'adresse de l'agent et son environnement

**Ce qu'on a déjà :** le serveur (VPS), branché à Claude Code au module précédent : la commande `ssh vps` y entre directement. On ne le refait pas.

**Ce qu'on voit à la fin :** l'adresse de l'agent est créée, et le serveur a tout ce qu'il faut pour l'accueillir, à côté de ce qui y tourne déjà.

## À la main : l'adresse de l'agent (2 minutes, à faire en premier)

Le DNS peut mettre de quelques minutes à quelques heures à se propager : on le crée tout de suite, il sera prêt à l'étape 4. Chez le fournisseur du nom de domaine, dans la zone DNS, ajoutez :

| Type | Nom | Valeur | TTL |
|---|---|---|---|
| A | `agents` (la partie avant votre domaine : agents pour agents.mondomaine.fr) | l'adresse IP de votre VPS (la même que pour votre site) | 1 heure ou moins |

Votre agent sera en ligne sur https://agents.mondomaine.fr (le cadenas arrive à l'étape 4).

## Puis ce prompt

```
Mon serveur est accessible depuis ce terminal par la commande `ssh vps` (je suis root).
Je veux y installer un agent IA, proprement et en sécurité, sans toucher à ce qui tourne déjà dessus.

Prépare l'environnement :
1. Regarde ce qui tourne déjà sur le serveur : on cohabitera sans y toucher. Vérifie que le port {PORT} est libre et qu'il reste de la place (2 Go de mémoire, 5 Go de disque) ; sinon, arrête-toi et dis-le-moi.
2. Crée un utilisateur dédié nommé {UTILISATEUR}, sans droits d'administration et avec un mot de passe verrouillé (adduser --disabled-password : on n'entrera dans ce compte que depuis root, avec `sudo -iu {UTILISATEUR}`). Tout le projet vivra dans son dossier personnel. S'il existe déjà, ne touche à rien et dis-le-moi.
3. Vérifie que Node.js 22 (ou plus récent) est installé. Sinon, installe-le depuis le dépôt officiel NodeSource.
4. Installe Claude Code pour cet utilisateur seulement, avec l'installeur officiel lancé en son nom : `sudo -iu {UTILISATEUR} bash -c 'curl -fsSL https://claude.ai/install.sh | bash'`. Ignore l'avertissement de l'installeur sur le PATH. Vérifie que `sudo -iu {UTILISATEUR} claude --version` répond. Ne le connecte pas à un compte : on le fera plus tard, dans l'outil.
5. Vérifie que le pare-feu laisse passer SSH, HTTP et HTTPS (sans fermer ce qui est déjà ouvert), et que nginx et certbot (avec son extension nginx) sont installés.
6. Vérifie si l'adresse {DOMAINE} pointe déjà vers l'adresse IP publique du serveur (avec dig ou nslookup, en interrogeant aussi 8.8.8.8). Sinon, dis-moi simplement que la propagation est en cours : on n'en aura besoin qu'à l'étape 4.

Règles : ne modifie rien qui appartient à un autre utilisateur ou à un autre site déjà présent sur ce serveur. À la fin, fais-moi un récapitulatif en 5 lignes de ce qui est en place.
```

## Si ça ne marche pas

- `ssh vps` ne répond pas : reprenez la connexion au serveur du module précédent.
- L'adresse ne pointe pas encore vers le serveur : c'est normal pendant quelques heures, continuez les étapes 2 et 3.
- Pour le reste, décrivez à Claude ce que vous voyez (« J'ai collé le prompt 1, et je vois … au lieu de … ») : il corrige tout seul. L'outil n'existe pas encore à cette étape, il n'y a donc rien à restaurer.
