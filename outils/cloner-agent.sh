#!/bin/bash
# Crée un nouvel agent à partir de l'agent de base (même code, mêmes skills, même fiche de contexte),
# avec le même compte Claude, SANS historique, mémoire, connexions ni automatisations : un agent neuf, prêt à être spécialisé.
# Usage (en root sur le serveur) : cloner-agent.sh <utilisateur> <port> <adresse> "<Nom de l'espace>" <badge> [base=agents]
# Ne touche ni à l'agent de base ni aux autres sites. La mise en ligne (nginx + HTTPS) se fait ensuite, quand le DNS pointe.
set -euo pipefail
U="$1"; PORT="$2"; DOM="$3"; NOM="$4"; BADGE="$5"; BASE="${6:-agents}"
B="/home/$BASE"; H="/home/$U"
[ -d "$B/app" ] || { echo "Base $B introuvable"; exit 1; }
if id "$U" >/dev/null 2>&1; then echo "L'utilisateur $U existe déjà : rien n'est fait."; exit 1; fi
if ss -ltn | grep -q ":$PORT "; then echo "Le port $PORT est déjà pris : rien n'est fait."; exit 1; fi

adduser --disabled-password --gecos "" "$U" >/dev/null
sudo -iu "$U" bash -c 'curl -fsSL https://claude.ai/install.sh | bash' >/dev/null 2>&1
sudo -iu "$U" "$H/.local/bin/claude" --version >/dev/null

# Le code de l'outil, à l'identique
rsync -a --exclude 'node_modules' "$B/app/" "$H/app/"

# La configuration de l'agent : fiche, règles, contexte, skills. Mémoire vide, aucun document ni livrable.
mkdir -p "$H/agent/.claude" "$H/agent/documents" "$H/agent/work"
cp "$B/agent/CLAUDE.md" "$B/agent/regles.md" "$B/agent/CONTEXTE.md" "$H/agent/"
cp "$B/agent/.claude/settings.json" "$H/agent/.claude/"
rsync -a "$B/agent/.claude/skills/" "$H/agent/.claude/skills/"
cat > "$H/agent/memoire.md" <<'EOF'
# Ma mémoire

Ce que l'équipe m'a appris de durable, une ligne datée par information (moins de 150 lignes).

## Préférences

## Décisions

## Infos utiles

## À ne plus faire
EOF
sed -i "s#/home/$BASE\b#/home/$U#g" "$H/agent/.claude/settings.json"

# Les données : seulement les comptes (mêmes identifiants de connexion) et l'identité de l'espace
mkdir -p "$H/data"
cp "$B/data/comptes.json" "$H/data/"
printf '{\n  "nomOutil": "%s",\n  "nomAgent": "Mon agent",\n  "badge": "%s",\n  "maj": "%s"\n}\n' "$NOM" "$BADGE" "$(date -u +%FT%TZ)" > "$H/data/identite.json"

# La mémoire du projet
if [ -f "$B/PROJET.md" ]; then
  sed -e "s#/home/$BASE\b#/home/$U#g" -e "s#$BASE-app#$U-app#g" -e "s#agents\.lecrystana\.com#$DOM#g" -e "s#4920#$PORT#g" "$B/PROJET.md" > "$H/PROJET.md"
  printf '\n## Copie de l'"'"'agent de base (%s)\n\nCréé à partir de %s : même code, mêmes skills, même fiche de contexte. Même compte Claude que la base. Sans historique, mémoire, connexions ni automatisations. À spécialiser.\n' "$(date +%d/%m/%Y)" "$B" >> "$H/PROJET.md"
fi

# Le même compte Claude que la base (la clé est recopiée sans être affichée)
[ -f "$B/.claude-token.env" ] && install -m 600 "$B/.claude-token.env" "$H/.claude-token.env"

chown -R "$U:$U" "$H"
chmod 700 "$H/data"; chmod 600 "$H/data/"*

# Le service
sed -e "s#/home/$BASE\b#/home/$U#g" -e "s#User=$BASE#User=$U#" -e "s#Group=$BASE#Group=$U#" \
    -e "s#Espace agent ($BASE)#$NOM ($U)#" -e "s#PORT=4920#PORT=$PORT#" \
    -e "s#Environment=\"NOM_OUTIL=[^\"]*\"#Environment=\"NOM_OUTIL=$NOM\"#" \
    "/etc/systemd/system/$BASE-app.service" > "/etc/systemd/system/$U-app.service"
grep -q URL_PUBLIQUE "/etc/systemd/system/$U-app.service" || sed -i "/^Environment=\"PORT=/a Environment=\"URL_PUBLIQUE=https://$DOM\"" "/etc/systemd/system/$U-app.service"
systemctl daemon-reload
systemctl enable --now "$U-app" >/dev/null 2>&1
sleep 2
systemctl is-active "$U-app" >/dev/null && curl -s -o /dev/null -w "$U : service actif, http://127.0.0.1:$PORT répond %{http_code}\n" "http://127.0.0.1:$PORT/api/marque"
