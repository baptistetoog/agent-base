# 1. Préparer l'espace de l'agent sur le serveur

**Ce que fait l'apprenant :** il colle ce prompt dans Claude Code, sur son ordinateur.

**Ce qu'on voit à la fin :** un utilisateur dédié existe sur le VPS, avec Node et Claude Code installés.

---

```
Mon serveur est accessible depuis ce terminal par la commande `ssh vps` (je suis root).
Je veux y installer un agent IA, proprement et en sécurité.

Prépare le serveur :
1. Crée un utilisateur Linux dédié nommé {UTILISATEUR}, sans droits sudo et avec un mot de passe verrouillé (adduser --disabled-password : on n'entrera dans ce compte que depuis root, avec `sudo -iu {UTILISATEUR}`). Tout le projet vivra dans son dossier personnel. Si l'utilisateur existe déjà, ne touche à rien et dis-le-moi.
2. Vérifie que Node.js 22 (ou plus récent) est installé. Sinon, installe-le depuis le dépôt officiel NodeSource (fais `apt-get update` avant).
3. Installe Claude Code pour cet utilisateur seulement, avec l'installeur officiel lancé en tant que {UTILISATEUR} : `sudo -iu {UTILISATEUR} bash -c 'curl -fsSL https://claude.ai/install.sh | bash'`. Il s'installe dans ~/.local/bin, que le profil d'Ubuntu ajoute déjà au PATH : ignore l'avertissement de l'installeur à ce sujet. Vérifie que `sudo -iu {UTILISATEUR} claude --version` répond. Ne le connecte pas à un compte : la clé viendra plus tard.
4. Vérifie que le pare-feu laisse passer SSH, HTTP et HTTPS. Si d'autres ports sont ouverts, liste-les sans les fermer : ils servent peut-être à un autre site.
5. Vérifie que nginx tourne et que certbot et son extension nginx (python3-certbot-nginx) sont installés (sinon installe-les).

Règles : ne modifie rien qui appartient à un autre utilisateur ou à un autre site déjà présent sur ce serveur. À la fin, fais-moi un récapitulatif en 5 lignes de ce qui est en place.
```

## Si ça ne marche pas

Décrivez à Claude ce que vous voyez (« J'ai collé le prompt 1, et je vois … au lieu de … ») : il corrige tout seul. L'outil n'existe pas encore à cette étape, il n'y a donc rien à restaurer.
