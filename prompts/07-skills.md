# 7. Les compétences (skills)

**Ce qu'on voit à la fin :** une section « Skills » qui liste les savoir-faire de l'agent. On en crée un en deux clics, et l'agent l'applique tout seul quand la demande s'y prête. On peut aussi lui demander de transformer une méthode en skill.

---

```
Mon serveur est accessible par `ssh vps` (root). Lis d'abord /home/{UTILISATEUR}/PROJET.md. Tout ce que tu crées dans /home/{UTILISATEUR} doit appartenir à {UTILISATEUR}.

Ajoute les skills à l'agent. Un skill est une méthode écrite que l'agent applique quand la demande s'y prête. On utilise le format natif de Claude Code : un dossier agent/.claude/skills/<identifiant>/SKILL.md, avec en tête :
---
name: <identifiant>
description: <quand utiliser ce skill, en une ou deux phrases>
---
puis la méthode en Markdown.

1. Crée deux skills de départ, utiles à n'importe quelle structure. Ils doivent être OPÉRATIONNELS tout de suite : des méthodes complètes, pas des modèles creux. Ils s'appuient sur CONTEXTE.md, memoire.md et regles.md (ton, signature, interdits) quand ces fichiers sont remplis.
   - synthese-document : résumer un document (de agent/documents/ ou collé dans la discussion). Sortie : en une phrase, l'essentiel ; puis 5 points clés au maximum ; puis les chiffres et dates importants ; puis les actions à mener (qui, quoi, quand) ; et ce qui manque ou reste flou. Il cite le document et ne rajoute rien qui n'y est pas.
   - redaction-mail : rédiger un mail professionnel. Il demande (ou déduit) le destinataire, l'objectif et le ton. Structure : objet clair, une phrase d'accroche, le message en 3 à 6 lignes, une seule demande précise, une formule de fin, la signature de la mémoire ou de CONTEXTE.md. Il propose 2 objets au choix. Interdits : promesses non tenables, jargon, formules toutes faites répétées. Avec 3 exemples (une relance, une réponse à une demande, une prise de rendez-vous).

2. Dans l'outil, ajoute une section « Skills » dans l'onglet « Réglages » du panneau (avec le système de design design.css) :
   - la liste des skills (nom + description) ;
   - un admin peut créer, modifier et supprimer un skill (nom, description, méthode), avec un aperçu ;
   - un membre peut seulement les lire ;
   - dans la zone de discussion, un petit bouton « / » permet de choisir un skill à appliquer au prochain message. Le message envoyé à l'agent se termine alors par « Applique le skill <identifiant>. » et l'interface montre une étiquette du skill sur la bulle ;
   - côté serveur, l'identifiant est nettoyé (minuscules, chiffres, tirets) pour qu'on ne puisse pas écrire ailleurs que dans agent/.claude/skills/.

ATTENTION, point technique : Claude Code refuse toujours que l'agent écrive dans son dossier .claude/, même avec une autorisation. Pour qu'il puisse créer ses skills, ajoute un petit serveur MCP d'approbation app/mcp-approbation.js (stdio, sans dépendance), passé à Claude avec --permission-prompt-tool : il répond « oui » uniquement pour écrire ou modifier agent/.claude/skills/<identifiant>/SKILL.md avec un en-tête valide, et « non » à tout le reste (les règles deny existantes passent avant lui). Ne passe jamais par le mode qui désactive toutes les vérifications. Garde Claude en --permission-mode acceptEdits, sans Write ni Edit dans --allowedTools.

3. Dans agent/CLAUDE.md, ajoute une section « Tes skills » : il utilise ses skills quand la demande s'y prête. Quand on lui dit « fais-en un skill » ou qu'il remarque qu'il refait souvent la même méthode, il propose de créer un skill, et s'il a l'accord, il l'écrit lui-même dans .claude/skills/<identifiant>/SKILL.md au bon format.

Vérifie toi-même (compte de test créé puis supprimé) : donne à l'agent un court texte de compte rendu de réunion inventé et demande-lui de le résumer ; vérifie dans le résultat brut de Claude qu'il a bien utilisé le skill synthese-document (outil Skill). Demande-lui un mail de relance : il doit utiliser redaction-mail. Puis demande-lui de créer un skill « compte-rendu » (transformer des notes en vrac en compte rendu de réunion : participants, décisions, actions avec responsable et date) et vérifie qu'il apparaît dans la section Skills : celui-là, on le garde. Mets à jour PROJET.md.
```

## Si ça ne marche pas

Décrivez d'abord ce que vous voyez à Claude (« J'ai collé le prompt 7, et je vois … au lieu de … ») : dans la plupart des cas, il corrige tout seul.

Si vous êtes vraiment bloqué, ce prompt remet votre outil exactement dans l'état de la fin de cette étape, à partir du dépôt commun :

```
Mon serveur est accessible par `ssh vps` (root). Remets mon outil exactement à l'état de l'étape 7 du dépôt commun {DEPOT} (étiquette etape-07) : récupère les dossiers instance/app et instance/agent de cette étiquette. Fais d'abord une sauvegarde, puis remplace /home/{UTILISATEUR}/app par instance/app, et recopie de instance/agent seulement les fichiers de configuration (CLAUDE.md, regles.md, .claude/settings.json, .claude/skills/) sans écraser CONTEXTE.md, memoire.md ni documents/. Ne touche ni à mes données (/home/{UTILISATEUR}/data), ni à ma clé Claude. Remplace dans le code le domaine, l'utilisateur et le port de l'exemple (agentforma.toog-expertise.app, agentforma, 4910) par les miens ({DOMAINE}, {UTILISATEUR}, {PORT}), mets à jour le service {UTILISATEUR}-app s'il diffère de instance/systeme, redémarre-le et vérifie que la page de connexion répond. Si cette étiquette n'existe pas dans le dépôt, ne touche à rien et dis-le-moi.
```
