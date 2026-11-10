# 0. Le serveur et l'adresse de l'agent

**Ce qu'on voit à la fin :** on sait que le serveur est prêt à accueillir l'agent, et l'adresse de l'agent (par exemple agent.mondomaine.fr) pointe vers ce serveur.

**Ce qu'on a déjà :** le VPS sous Linux Ubuntu 24.04, installé et branché à Claude Code au module précédent : la commande `ssh vps` y entre directement. On ne le refait pas.

## À la main : le sous-domaine de l'agent (2 minutes, à faire tout de suite)

Le DNS peut mettre de quelques minutes à quelques heures à se propager : on le crée maintenant, il sera prêt à l'étape 4. Chez le fournisseur du nom de domaine (GoDaddy, OVH, IONOS…), dans la zone DNS, ajoutez :

| Type | Nom | Valeur | TTL |
|---|---|---|---|
| A | `agent` (la partie avant votre domaine : agent pour agent.mondomaine.fr) | l'adresse IP du VPS (la même que pour votre site) | 1 heure ou moins |

Votre agent sera alors en ligne sur https://agent.mondomaine.fr (le cadenas arrive à l'étape 4).

## Puis ce prompt

```
Mon serveur est accessible depuis ce terminal par `ssh vps` (je suis root). Avant d'y installer un agent IA, vérifie qu'il est prêt, sans rien modifier :
1. Que c'est bien un Linux Ubuntu 24.04 (lsb_release -a), et donne-moi son adresse IP publique.
2. Sa mémoire (2 Go minimum conseillés) et son espace disque libre (5 Go minimum).
3. Ce qui tourne déjà dessus (sites nginx, services) : on cohabitera sans y toucher.
4. Si le sous-domaine {DOMAINE} pointe déjà vers cette adresse IP (avec dig ou nslookup, en interrogeant aussi 8.8.8.8). Sinon, dis-moi simplement que la propagation est en cours : on n'en aura besoin qu'à l'étape 4.
Récapitule en 4 lignes. Si quelque chose bloque (pas Ubuntu 24.04, pas assez de place), arrête-toi et dis-le-moi.
```

## Si ça ne marche pas

- `ssh vps` ne répond pas : reprenez la connexion au serveur du module précédent.
- Le sous-domaine ne pointe pas encore : c'est normal pendant quelques heures, continuez les étapes 1 à 3.
