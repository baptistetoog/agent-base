# 1. Préparer l'espace de l'agent sur le serveur

**Ce que fait l'apprenant :** il colle ce prompt dans Claude Code, sur son ordinateur.

**Ce qu'on voit à la fin :** un utilisateur dédié existe sur le VPS, avec Node et Claude Code installés.

---

```
Mon serveur est accessible depuis ce terminal par la commande `ssh vps` (je suis root).
Je veux y installer un agent IA, proprement et en sécurité.

Prépare le serveur :
1. Crée un utilisateur Linux dédié nommé {UTILISATEUR}, sans mot de passe et sans droits sudo. Tout le projet vivra dans son dossier personnel. Si l'utilisateur existe déjà, ne touche à rien et dis-le-moi.
2. Vérifie que Node.js 22 (ou plus récent) est installé. Sinon, installe-le depuis le dépôt officiel NodeSource (fais `apt-get update` avant).
3. Installe Claude Code pour cet utilisateur seulement, avec l'installeur officiel (`curl -fsSL https://claude.ai/install.sh | bash`, lancé en tant que {UTILISATEUR}). Vérifie que `claude --version` répond.
4. Vérifie que le pare-feu laisse passer seulement SSH, HTTP et HTTPS. Ne ferme rien qui est déjà ouvert sans me demander.
5. Vérifie que nginx et certbot sont installés (sinon installe-les).

Règles : ne modifie rien qui appartient à un autre utilisateur ou à un autre site déjà présent sur ce serveur. À la fin, fais-moi un récapitulatif en 5 lignes de ce qui est en place.
```

## Si ça ne marche pas

Décrivez à Claude ce que vous voyez (« J'ai collé le prompt 1, et je vois … au lieu de … ») : il corrige tout seul. L'outil n'existe pas encore à cette étape, il n'y a donc rien à restaurer.
