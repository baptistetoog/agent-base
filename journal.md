# Journal du test de bout en bout

Instance de test : https://agentforma.toog-expertise.app (VPS TOOGVPS, 155.117.100.221), utilisateur Linux `agentforma`, service `agentforma-app`, port 4910.
Méthode : chaque prompt est collé tel quel dans une session Claude vierge. Quand elle doit improviser, on corrige le PROMPT (pas le code), et on note l'écart ici. Après chaque étape : `outils/enregistrer-etape.sh N "titre"` (étiquette etape-NN).

| Étape | Date | Résultat | Écarts et corrections du prompt |
|---|---|---|---|
| 1 · Espace serveur | 09/11 | Réussi | Précisé : mot de passe verrouillé (adduser --disabled-password), installation et vérification avec `sudo -iu`, avertissement PATH à ignorer, autres ports ouverts listés sans être fermés (8080 utilisé par un autre site), extension certbot nginx. |
| 2 · Clé Claude | 09/11 | À la main | Pas de prompt : `claude setup-token` sur l'ordinateur de l'apprenant. |
| 3 · Outil et connexion | 09/11 | Réussi (11 vérifications) | Précisé : 401 en JSON pour les API, cookie Secure (test en curl avant HTTPS), IP via X-Forwarded-For seulement depuis 127.0.0.1, creer-compte.js lancé par root garde le bon propriétaire, empreinte du cookie relue à chaud. |
| 4 · Mise en ligne | 09/11 | Réussi (certificat valide, 301, en-têtes uniques, gmb-demo intact) | Précisé : méthode certbot (celle du serveur, sinon --nginx), e-mail, rechargement au renouvellement, en-têtes de Node masqués pour éviter les doublons, délai SSE chiffré, point 6 = vérifier sans retoucher. |
| 5 · Agent visuel | 09/11 | Réussi sans clé (routes, nettoyage et refus de clé, cerveau simulé, scène 3D sans erreur, captures ordinateur et mobile) ; 3 tests en attente de la clé | Précisé : message sur l'entrée standard, retrait du chargement de la clé dans systemd (pour Déconnecter), discussion commune, CSP style-src unsafe-inline + polices de la scène, format de /api/etat, frise mobile. |
| 5 bis · Connexion sans Terminal | 09/11 | Réussi (vrai lien d'autorisation, faux code refusé, un seul processus, cache no-cache + ETag) ; vraie connexion à faire par Baptiste | Ajouté à la demande de Baptiste : « Se connecter avec Claude » (setup-token lancé par le serveur dans un pseudo-terminal), stty cols 400, Entrée = \r, arrêt sur « OAuth error ». Anti-cache ajouté au prompt 3. |
| 5 ter · Vraie connexion | 09/11 | Réussi : Baptiste connecté sans Terminal | Bug corrigé : code et Entrée écrits ensemble = pris pour un collage, Entrée jamais reçue (blocage sur « Vérification… »). Code puis Entrée 700 ms plus tard. |
