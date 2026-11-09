# 10. Les automatisations

**Ce qu'on voit à la fin :** l'agent fait des missions tout seul, à heure fixe. On en ajoute une en un clic, ou c'est l'agent qui les propose après un court entretien. Ses actions passent toujours par les validations.

---

```
Mon serveur est accessible par `ssh vps` (root). Lis d'abord /home/{UTILISATEUR}/PROJET.md. Tout ce que tu crées dans /home/{UTILISATEUR} doit appartenir à {UTILISATEUR}.

Ajoute les automatisations : des missions que l'agent fait tout seul à heure fixe. Reste simple.

1. LA SECTION « AUTOMATISATIONS » dans l'onglet « Réglages » (avec le système de design design.css ; création et modification réservées aux admins, lecture pour tous) :
   - chaque automatisation a : un nom, la consigne donnée à l'agent (la mission), une fréquence (tous les jours / chaque semaine tel jour / chaque mois tel jour du mois) et une heure (fuseau Europe/Paris), un interrupteur actif / en pause, la date du dernier passage et son résultat en une ligne ;
   - boutons « Lancer maintenant », « Modifier », « Supprimer » ;
   - deux modèles prêts à ajouter en un clic (ajoutés en pause) :
     - « Point du matin », tous les jours à 9 h : « Fais le point en 5 lignes maximum : ce qui a changé dans tes documents et tes outils branchés depuis hier, ce qui attend une validation, et la priorité du jour. S'il n'y a rien de nouveau, dis-le en une phrase. »
     - « Bilan de la semaine », le vendredi à 17 h : « Résume la semaine : ce que tu as fait (d'après l'historique et agent/work/), ce qui a été validé ou refusé, et 3 propositions pour la semaine prochaine. Enregistre le bilan dans agent/work/bilan-AAAA-SS.md. »
   - Tout est enregistré dans data/automatisations.json.

2. LE PLANIFICATEUR (dans le serveur) : toutes les minutes, il regarde les automatisations actives arrivées à échéance et les met dans la file de l'agent, comme un message normal, mais signé « Automatisation : <nom> ». Il ne rattrape pas les passages manqués pendant un arrêt. Une automatisation ne peut pas être lancée deux fois en même temps. Le résultat (la dernière réponse de l'agent, en une ligne) est enregistré dans l'automatisation. Si l'agent a créé des cartes « À valider », la pastille de l'onglet « À valider » et le « ! » de la scène les montrent comme d'habitude. Le voyant « Prochaine automatisation » de l'État du système s'active et affiche la prochaine échéance (nom + jour + heure).
   Chaque automatisation tourne dans sa propre discussion (pas dans la discussion principale), mais on voit son passage dans la discussion principale sous forme d'une ligne discrète : « 🕘 Point du matin : rien de nouveau ».

3. L'ENTRETIEN DE DÉMARRAGE :
   - Ajoute à app/mcp-plateforme.js l'outil proposer_automatisation(nom, consigne, frequence, jour, heure). Il crée une carte « Automatisation » dans les validations, avec un bouton « Activer » (admin). Au clic, l'automatisation est créée et activée.
   - Dans agent/CLAUDE.md, section « Tes automatisations » : tant qu'aucune automatisation n'existe (l'outil le lui indique en ajoutant au premier message de chaque discussion la ligne « [Automatisations actives : aucune] » ou la liste), il propose, au début d'une discussion, un court entretien de 3 questions maximum, une à la fois :
     1) Qu'est-ce que vous aimeriez que je fasse tout seul, régulièrement ?
     2) À quel rythme ?
     3) Je vous propose tout avant d'agir, ou je peux agir seul sur certaines choses ?
     Puis il propose chaque automatisation avec proposer_automatisation, et note les choix dans sa mémoire. Plus tard, si on lui dit « automatise ça » ou s'il remarque qu'on lui demande souvent la même chose, il propose une automatisation de la même façon.
   - La réponse à la question 3 règle le mode de l'agent (« Propose » ou « Agit seul »). L'agent ne peut pas le changer lui-même : il le recommande dans la carte, et c'est l'admin qui l'applique avec l'interrupteur.

MISE EN ROUTE : l'étape 4 de la carte (« Lui confier une première mission automatique ») devient active et se coche dès qu'une automatisation est active. Quand les 4 étapes sont cochées, la carte se replie en une ligne « ✅ Votre agent est prêt ».

Vérifie toi-même (compte de test créé puis supprimé) : ajoute le modèle « Point du matin », règle-le pour passer dans 2 minutes et vérifie que le planificateur le lance, qu'il tourne dans sa propre discussion, et que le résultat s'enregistre. Teste « Lancer maintenant ». Lance une nouvelle discussion et vérifie que l'agent propose l'entretien, puis que proposer_automatisation crée bien une carte « Activer » qui fonctionne. Remets ensuite tout à zéro (aucune automatisation, aucune carte de test). Mets à jour PROJET.md.
```

## Si ça ne marche pas

Décrivez d'abord ce que vous voyez à Claude (« J'ai collé le prompt 10, et je vois … au lieu de … ») : dans la plupart des cas, il corrige tout seul.

Si vous êtes vraiment bloqué, ce prompt remet votre outil exactement dans l'état de la fin de cette étape, à partir du dépôt commun :

```
Mon serveur est accessible par `ssh vps` (root). Remets mon outil exactement à l'état de l'étape 10 du dépôt commun {DEPOT} (étiquette etape-10) : récupère les dossiers instance/app et instance/agent de cette étiquette. Fais d'abord une sauvegarde, puis remplace /home/{UTILISATEUR}/app par instance/app, et recopie de instance/agent seulement les fichiers de configuration (CLAUDE.md, regles.md, .claude/settings.json, .claude/skills/) sans écraser CONTEXTE.md, memoire.md ni documents/. Ne touche ni à mes données (/home/{UTILISATEUR}/data), ni à ma clé Claude. Remplace dans le code le domaine, l'utilisateur et le port de l'exemple (agentforma.toog-expertise.app, agentforma, 4910) par les miens ({DOMAINE}, {UTILISATEUR}, {PORT}), mets à jour le service {UTILISATEUR}-app s'il diffère de instance/systeme, redémarre-le et vérifie que la page de connexion répond. Si cette étiquette n'existe pas dans le dépôt, ne touche à rien et dis-le-moi.
```
