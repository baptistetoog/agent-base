# 3. Créer l'outil et son espace de connexion protégé

**Ce qu'on voit à la fin :** l'outil tourne sur le serveur, avec une page de connexion. Seules les personnes qui ont un compte peuvent entrer. Il est repris à l'identique du dépôt commun : tout le monde a le même.

---

```
Mon serveur est accessible par `ssh vps` (root). L'utilisateur {UTILISATEUR} est prêt (étape 1).

Installe la base de l'outil de l'agent À L'IDENTIQUE du dépôt commun {DEPOT}, étiquette etape-03 :
1. Télécharge l'archive https://github.com/baptistetoog/agent-base/archive/refs/tags/etape-03.tar.gz sur le serveur et reprends tel quel son dossier instance/app dans /home/{UTILISATEUR}/app, ainsi que le service décrit dans instance/systeme (nommé {UTILISATEUR}-app).
2. Remplace seulement les valeurs de l'exemple par les miennes : utilisateur agentforma → {UTILISATEUR}, port 4910 → {PORT}, adresse agentforma.toog-expertise.app → {DOMAINE}. Ne change rien d'autre.
3. Crée /home/{UTILISATEUR}/data (droits 700) et /home/{UTILISATEUR}/agent ; tout appartient à {UTILISATEUR}.
4. Un seul réglage en plus : sers toutes les pages avec `Cache-Control: no-cache` et un ETag (une actualisation normale montre toujours la dernière version).
5. Écris /home/{UTILISATEUR}/PROJET.md en français simple : mes valeurs (utilisateur, port, adresse), les dossiers, comment démarrer, arrêter et voir les journaux du service. On le relira et on le complétera à chaque étape.

Vérifie : le service tourne ; sans connexion, la page d'accueil renvoie vers la connexion ; un compte de test créé avec app/creer-compte.js (mot de passe dans la variable MOT_DE_PASSE) peut se connecter, puis supprime-le. Ne touche à aucun autre site ni service. À la fin, donne-moi la commande exacte pour créer mon compte admin.
```

## Si ça ne marche pas

Décrivez d'abord ce que vous voyez à Claude (« J'ai collé le prompt 3, et je vois … au lieu de … ») : dans la plupart des cas, il corrige tout seul.

Si vous êtes vraiment bloqué, ce prompt remet votre outil exactement dans l'état de la fin de cette étape, à partir du dépôt commun :

```
Mon serveur est accessible par `ssh vps` (root). Remets mon outil exactement à l'état de l'étape 3 du dépôt commun {DEPOT} (étiquette etape-03) : récupère les dossiers instance/app et instance/agent de cette étiquette. Fais d'abord une sauvegarde, puis remplace /home/{UTILISATEUR}/app par instance/app, et recopie de instance/agent seulement les fichiers de configuration (CLAUDE.md, regles.md, .claude/settings.json, .claude/skills/) sans écraser CONTEXTE.md, memoire.md ni documents/. Ne touche ni à mes données (/home/{UTILISATEUR}/data), ni à ma clé Claude. Remplace dans le code le domaine, l'utilisateur et le port de l'exemple (agentforma.toog-expertise.app, agentforma, 4910) par les miens ({DOMAINE}, {UTILISATEUR}, {PORT}), mets à jour le service {UTILISATEUR}-app s'il diffère de instance/systeme, redémarre-le et vérifie que la page de connexion répond. Si cette étiquette n'existe pas dans le dépôt, ne touche à rien et dis-le-moi.
```
