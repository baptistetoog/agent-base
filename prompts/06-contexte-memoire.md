# 6. L'identité, le contexte et la mémoire de l'agent

**Ce qu'on voit à la fin :** l'espace prend le nom, le logo et le nom d'agent qu'on veut (Réglages › Identité). L'agent sait qui il est, pour qui il travaille et ce qu'il doit faire. On lui donne du contexte (une fiche et des documents). Il retient ce qu'on lui apprend d'une discussion à l'autre, et la section « Contexte et mémoire » montre ce qu'il a retenu.

---

```
Mon serveur est accessible par `ssh vps` (root). Lis d'abord /home/{UTILISATEUR}/PROJET.md. Tout ce que tu crées dans /home/{UTILISATEUR} doit appartenir à {UTILISATEUR}.

L'agent reste générique : on ne lui donne pas encore de métier. On lui construit la place pour recevoir un contexte, une mémoire et des règles, qu'on remplira différemment pour chaque usage.

1. LA FICHE DE L'AGENT : écris /home/{UTILISATEUR}/agent/CLAUDE.md. C'est sa fiche de poste, chargée à chaque message. Contenu :
   - En tête, ces trois lignes d'import exactement :
     @CONTEXTE.md
     @memoire.md
     @regles.md
   - Qui il est : « {NOM_AGENT} », un assistant IA qui travaille pour la structure décrite dans CONTEXTE.md. Sa mission précise est écrite dans CONTEXTE.md (rubrique « Sa mission ») : il s'y tient.
   - Sa méthode générale : comprendre la demande, regarder d'abord ce qu'il sait déjà (contexte, documents, mémoire), puis répondre ou faire, de façon courte et claire. S'il lui manque une information, il pose UNE question précise plutôt que d'inventer.
   - Ses documents : le dossier agent/documents/ contient des documents déposés par l'équipe (textes, PDF, tableaux). Il les consulte quand la demande s'y rapporte et cite le document utilisé.
   - Ses livrables vont dans agent/work/ (un fichier par travail, au nom clair).
   - Sa mémoire (voir le point 3).

2. LE CONTEXTE :
   - agent/CONTEXTE.md : la fiche d'identité de la structure pour laquelle il travaille. Crée-la avec ces rubriques, toutes marquées « À compléter » : Qui nous sommes, Ce que nous proposons, Nos clients, Notre ton, Sa mission (ce que l'agent doit faire pour nous), Ce qu'il ne doit jamais faire, Coordonnées et liens utiles. N'invente rien.
   - Un bouton « Remplir à partir d'un site » (admin) : on donne l'adresse d'un site, l'agent le parcourt (pages utiles : accueil, offres, à propos, contact, FAQ, mentions légales) et propose un CONTEXTE.md complété, qu'on relit dans la page avant de l'enregistrer. Ce qu'il ne trouve pas reste « À compléter ».
   - agent/regles.md : les règles communes. Contenu : Réponds en français, de façon courte et claire, sur le ton indiqué dans CONTEXTE.md. Ne jamais inventer de chiffre ni de fait. Dire quand une information manque. Ne jamais afficher de clé, de jeton ou de mot de passe.
   - L'agent peut lire CONTEXTE.md et regles.md mais pas les modifier (ajoute-les aux règles deny Edit de agent/.claude/settings.json) : seuls les admins les changent, depuis l'outil.
   - Les documents : dans l'outil, une zone « Documents » où un admin dépose des fichiers (glisser-déposer ou bouton, 20 Mo maximum, formats texte, Markdown, PDF, CSV, images), les voit en liste (nom, taille, date) et peut les supprimer. Ils sont enregistrés dans agent/documents/ avec un nom nettoyé (pas de chemin, pas de fichier caché).

3. LA MÉMOIRE :
   - agent/memoire.md commence vide : un titre, une phrase d'explication et les quatre rubriques (Préférences, Décisions, Infos utiles, À ne plus faire).
   - Dans CLAUDE.md, ajoute une section « Ta mémoire » : quand on lui apprend quelque chose de durable (une préférence, une décision, une info utile, une erreur à ne plus refaire), il l'ajoute à memoire.md en une ligne datée, dans la bonne rubrique. Il ne garde pas les choses passagères. Il corrige ou supprime une ligne devenue fausse. Le fichier reste sous 150 lignes. Quand il retient quelque chose, il le dit en une phrase (« Je retiens : … »).

4. DANS L'OUTIL : dans l'onglet « Réglages », une section « Contexte et mémoire » (avec le système de design design.css) qui affiche, en sous-onglets, CONTEXTE.md, memoire.md, regles.md, la fiche CLAUDE.md et les documents. Un admin peut modifier et enregistrer ; un membre lit seulement. Côté serveur, seuls ces fichiers et le dossier documents/ sont accessibles par cette page. L'étape 2 de la carte « Mise en route » (« Donner son contexte à l'agent ») devient active : elle mène à cette section et se coche quand la rubrique « Sa mission » de CONTEXTE.md n'est plus « À compléter ». Le voyant « Contexte » de l'État du système suit la même règle.

5. L'IDENTITÉ DE L'ESPACE : en tête de l'onglet « Réglages », une section « Identité » (admin ; un membre la voit sans pouvoir la modifier) pour personnaliser l'espace sans toucher au code :
   - le nom de l'espace (affiché dans l'en-tête, l'onglet du navigateur et la page de connexion) ;
   - le logo : envoi d'une image PNG, JPEG ou SVG (2 Mo maximum), avec un aperçu et un bouton « Retirer le logo ». Il remplace le carré avec l'initiale dans l'en-tête et sur la page de connexion, et sert d'icône d'onglet. Le serveur vérifie le vrai type du fichier, l'enregistre sous un nom fixe dans data/ et le sert par une route publique /api/logo (un SVG est servi avec une politique de sécurité qui interdit tout script) ;
   - le nom de l'agent : celui de son étiquette au-dessus de la scène, de sa bulle de bienvenue et de l'écran de son ordinateur dans le bureau 3D ;
   - le texte de son badge, sur sa poitrine (4 caractères maximum, en majuscules) ;
   - un bouton « Enregistrer » : tout est rangé dans data/identite.json, prioritaire sur les valeurs NOM_OUTIL et NOM_AGENT du service, et /api/marque renvoie ces valeurs. La scène 3D est recréée tout de suite avec le nouveau nom et le nouveau badge, sans recharger la page.
   - Le nom de l'agent est aussi mis à jour dans agent/CLAUDE.md (la ligne « Qui il est »), pour qu'il se présente sous son nouveau nom.

Vérifie toi-même (compte de test créé puis supprimé) :
- change le nom de l'espace, le nom de l'agent et le badge par l'API, envoie un petit logo PNG de test, vérifie /api/marque et /api/logo, puis demande à l'agent « Comment t'appelles-tu ? » : il doit donner le nouveau nom ; remets ensuite les valeurs d'origine et retire le logo de test ;
- dépose un petit document de test (un fichier texte qui dit que « le code interne du projet est ORION-7 ») et demande à l'agent « Quel est le code interne du projet ? » : il doit le trouver dans le document et le citer ; supprime ensuite ce document ;
- dis à l'agent « Retiens que je préfère des réponses en listes à puces ». Vérifie que memoire.md contient la ligne. Puis, dans une NOUVELLE discussion, demande-lui comment je préfère les réponses : il doit le savoir. Retire ensuite cette ligne de test de memoire.md ;
- demande-lui de modifier regles.md : il doit échouer.
Laisse CONTEXTE.md avec ses rubriques « À compléter ». Mets à jour PROJET.md.
```

## Si ça ne marche pas

Décrivez d'abord ce que vous voyez à Claude (« J'ai collé le prompt 6, et je vois … au lieu de … ») : dans la plupart des cas, il corrige tout seul.

Si vous êtes vraiment bloqué, ce prompt remet votre outil exactement dans l'état de la fin de cette étape, à partir du dépôt commun :

```
Mon serveur est accessible par `ssh vps` (root). Remets mon outil exactement à l'état de l'étape 6 du dépôt commun {DEPOT} (étiquette etape-06) : récupère les dossiers instance/app et instance/agent de cette étiquette. Fais d'abord une sauvegarde, puis remplace /home/{UTILISATEUR}/app par instance/app, et recopie de instance/agent seulement les fichiers de configuration (CLAUDE.md, regles.md, .claude/settings.json, .claude/skills/) sans écraser CONTEXTE.md, memoire.md ni documents/. Ne touche ni à mes données (/home/{UTILISATEUR}/data), ni à ma clé Claude. Remplace dans le code le domaine, l'utilisateur et le port de l'exemple (agentforma.toog-expertise.app, agentforma, 4910) par les miens ({DOMAINE}, {UTILISATEUR}, {PORT}), mets à jour le service {UTILISATEUR}-app s'il diffère de instance/systeme, redémarre-le et vérifie que la page de connexion répond. Si cette étiquette n'existe pas dans le dépôt, ne touche à rien et dis-le-moi.
```
