# Ajouter les outils de la spécialisation à mon agent

À coller dans Claude (Claude Code, sur l'ordinateur qui a déjà accès au serveur : `ssh vps`), une seule fois, avant les modules de spécialisation (réseaux sociaux, fiche Google, prospection).

```text
Récupère le dépôt https://github.com/baptistetoog/agent-base (dossier kit/outils-specialisation) et ajoute à la plateforme de mon agent, sur mon serveur (ssh vps), les 3 outils qui y sont décrits, sans rien casser :

1. lien_public_photo : donne un lien public https à une photo ou un PDF de agent/documents/ (copie dans data/photos-publiques/, servie par la route publique /photo/<id>.<ext> du serveur).
2. pdf_en_images : transforme un PDF de agent/documents/ en images PNG de 1080 px de large, une par page (10 au maximum), avec Ghostscript.
3. apercu_video : à partir d'un lien Google Drive partagé « Tous les utilisateurs disposant du lien » ou d'une vidéo de agent/documents/, donne la durée, le format et 4 images JPEG prises au fil de la vidéo, avec ffmpeg.

Prends le code de référence dans kit/outils-specialisation/mcp-plateforme.js (fonctions lienPublicPhoto, pdfEnImages, apercuVideo, leurs descriptions et leur traitement dans tools/call), la route de kit/outils-specialisation/route-photo-server.js, et autorise les 3 outils dans le lancement de l'agent comme indiqué dans kit/outils-specialisation/agent-js-lignes.txt. Adapte aux noms de fichiers de MON installation.
Installe Ghostscript et ffmpeg sur le serveur s'ils manquent. Fais une sauvegarde des fichiers modifiés avant, vérifie la syntaxe, redémarre le service de l'agent, puis teste chaque outil avec un petit fichier d'essai que tu supprimes ensuite.
Termine par : ce qui a été ajouté, ce qui a été installé, et le résultat des 3 tests.
```

Ce que ça change pour vous : rien à faire de plus. Votre agent sait ensuite publier une photo, transformer un visuel PDF de Claude Design en images, et regarder une vidéo de votre Google Drive.
