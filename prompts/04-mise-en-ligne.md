# 4. Mettre l'outil en ligne sur son sous-domaine

## Avant : le sous-domaine

Il a été créé à l'étape 1 (enregistrement A vers l'IP du serveur). Ce prompt vérifie qu'il pointe bien sur le serveur avant de poser le cadenas.

Si ce n'est pas déjà fait à l'étape 3, créer son compte admin (le mot de passe est tapé par l'apprenant, il ne s'affiche pas) :

```bash
ssh -t vps 'sudo -iu {UTILISATEUR} node app/creer-compte.js {EMAIL_ADMIN} "Prénom Nom" admin'
```

## Puis ce prompt

```
Mon serveur est accessible par `ssh vps` (root). Lis d'abord /home/{UTILISATEUR}/PROJET.md.

Mets l'outil en ligne sur {DOMAINE} :
1. Vérifie que {DOMAINE} pointe vers l'adresse IP de ce serveur. Sinon, arrête-toi et dis-moi d'attendre.
2. Crée sa configuration nginx dans un nouveau fichier à son nom, À L'IDENTIQUE de instance/systeme/nginx.conf du dépôt commun {DEPOT} (étiquette etape-04 : https://raw.githubusercontent.com/baptistetoog/agent-base/etape-04/instance/systeme/nginx.conf), en remplaçant seulement l'adresse et le port de l'exemple (agentforma.toog-expertise.app, 4910) par {DOMAINE} et {PORT}.
3. Le cadenas : un certificat Let's Encrypt avec certbot pour cette adresse seulement (e-mail : {EMAIL_ADMIN}), le HTTP redirigé vers le HTTPS.
Teste toujours avec `nginx -t` avant de recharger nginx, et ne touche à aucun autre site.

Vérifie : https://{DOMAINE} affiche la page de connexion, avec le cadenas. Mets à jour PROJET.md.
```

**Ce qu'on voit à la fin :** https://{DOMAINE} affiche la page de connexion, avec le cadenas.

## Si ça ne marche pas

Décrivez d'abord ce que vous voyez à Claude (« J'ai collé le prompt 4, et je vois … au lieu de … ») : dans la plupart des cas, il corrige tout seul.

Si vous êtes vraiment bloqué, ce prompt remet votre outil exactement dans l'état de la fin de cette étape, à partir du dépôt commun :

```
Mon serveur est accessible par `ssh vps` (root). Remets mon outil exactement à l'état de l'étape 4 du dépôt commun {DEPOT} (étiquette etape-04) : récupère les dossiers instance/app et instance/agent de cette étiquette. Fais d'abord une sauvegarde, puis remplace /home/{UTILISATEUR}/app par instance/app, et recopie de instance/agent seulement les fichiers de configuration (CLAUDE.md, regles.md, .claude/settings.json, .claude/skills/) sans écraser CONTEXTE.md, memoire.md ni documents/. Ne touche ni à mes données (/home/{UTILISATEUR}/data), ni à ma clé Claude. Remplace dans le code le domaine, l'utilisateur et le port de l'exemple (agentforma.toog-expertise.app, agentforma, 4910) par les miens ({DOMAINE}, {UTILISATEUR}, {PORT}), mets à jour le service {UTILISATEUR}-app s'il diffère de instance/systeme, redémarre-le et vérifie que la page de connexion répond. Si cette étiquette n'existe pas dans le dépôt, ne touche à rien et dis-le-moi.
```
