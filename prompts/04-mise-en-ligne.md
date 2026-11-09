# 4. Mettre l'outil en ligne sur son sous-domaine

## À la main : le sous-domaine (1 minute)

Chez le fournisseur du nom de domaine (GoDaddy, OVH, IONOS…), dans la zone DNS, ajouter :

| Type | Nom | Valeur | TTL |
|---|---|---|---|
| A | `agent` (la partie avant le domaine, ex. agent pour agent.monentreprise.fr) | l'adresse IP du VPS | 1 heure ou moins |

Puis créer son compte admin (le mot de passe est tapé par l'apprenant, il ne s'affiche pas) :

```bash
ssh -t vps 'sudo -iu {UTILISATEUR} node app/creer-compte.js {EMAIL_ADMIN} "Prénom Nom" admin'
```

## Puis ce prompt

```
Mon serveur est accessible par `ssh vps` (root). Lis d'abord /home/{UTILISATEUR}/PROJET.md pour comprendre le projet.

J'ai créé le sous-domaine {DOMAINE} qui pointe vers l'adresse IP du serveur. Mets l'outil en ligne :
1. Vérifie que {DOMAINE} pointe bien vers ce serveur (compare avec l'IP publique du serveur). Si ce n'est pas encore le cas, arrête-toi et dis-moi d'attendre.
2. Crée une configuration nginx dédiée, dans un nouveau fichier à son nom, qui envoie {DOMAINE} vers 127.0.0.1:{PORT}. Elle doit supporter le temps réel (Server-Sent Events : pas de mise en tampon, délai de lecture de 24 h), les envois de fichiers jusqu'à 20 Mo, et transmettre l'IP réelle du visiteur (X-Forwarded-For) pour le blocage des mots de passe.
3. Obtiens un certificat HTTPS Let's Encrypt avec certbot pour ce sous-domaine seulement (même méthode que les autres certificats du serveur s'il y en a, sinon `certbot --nginx` ; adresse e-mail : {EMAIL_ADMIN}), avec le rechargement de nginx au renouvellement, et redirige le HTTP vers le HTTPS.
4. Ajoute les en-têtes de sécurité habituels (HSTS, X-Content-Type-Options, Referrer-Policy, X-Frame-Options SAMEORIGIN). Si le serveur Node pose déjà certains de ces en-têtes, masque ceux de Node (proxy_hide_header) pour qu'aucun ne soit en double.
5. Teste toujours la configuration avec `nginx -t` avant de recharger nginx, et ne modifie aucun autre site.
6. Vérifie (sans retoucher le code si c'est déjà le cas) que le serveur Node lit l'IP du visiteur dans X-Forwarded-For seulement quand la requête vient de 127.0.0.1.

Vérifie toi-même : https://{DOMAINE} répond avec un certificat valide et affiche la page de connexion. Mets à jour PROJET.md.
```

**Ce qu'on voit à la fin :** https://{DOMAINE} affiche la page de connexion, avec le cadenas.

## Si ça ne marche pas

Décrivez d'abord ce que vous voyez à Claude (« J'ai collé le prompt 4, et je vois … au lieu de … ») : dans la plupart des cas, il corrige tout seul.

Si vous êtes vraiment bloqué, ce prompt remet votre outil exactement dans l'état de la fin de cette étape, à partir du dépôt commun :

```
Mon serveur est accessible par `ssh vps` (root). Remets mon outil exactement à l'état de l'étape 4 du dépôt commun {DEPOT} (étiquette etape-04) : récupère les dossiers instance/app et instance/agent de cette étiquette. Fais d'abord une sauvegarde, puis remplace /home/{UTILISATEUR}/app par instance/app, et recopie de instance/agent seulement les fichiers de configuration (CLAUDE.md, regles.md, .claude/settings.json, .claude/skills/) sans écraser CONTEXTE.md, memoire.md ni documents/. Ne touche ni à mes données (/home/{UTILISATEUR}/data), ni à ma clé Claude. Remplace dans le code le domaine, l'utilisateur et le port de l'exemple (agentforma.toog-expertise.app, agentforma, 4910) par les miens ({DOMAINE}, {UTILISATEUR}, {PORT}), mets à jour le service {UTILISATEUR}-app s'il diffère de instance/systeme, redémarre-le et vérifie que la page de connexion répond. Si cette étiquette n'existe pas dans le dépôt, ne touche à rien et dis-le-moi.
```
