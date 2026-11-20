# Outils de la spécialisation (référence)

Code de référence, pris sur l'agent de démonstration le 20/11/2026, pour la procédure `prompts/outils-specialisation.md` :
- `mcp-plateforme.js` : serveur MCP « plateforme » complet, avec `lien_public_photo`, `pdf_en_images` (Ghostscript) et `apercu_video` (ffmpeg, ffprobe, curl).
- `route-photo-server.js` : la route publique `/photo/<id>.<ext>` du serveur (rien d'autre n'est exposé).
- `agent-js-lignes.txt` : les lignes de `agent.js` qui autorisent ces outils et leur libellé.
Chaque installation de l'agent est écrite par Claude : ces fichiers servent de modèle, pas de remplacement à l'identique.
