#!/bin/bash
# Enregistre le code de l'instance de test après l'étape $1 ($2 = titre), sans données ni secrets, et pose l'étiquette etape-NN.
# Usage : outils/enregistrer-etape.sh 5 "bureau 3D, discussion, cerveau"     (UTILISATEUR=agentforma par défaut)
set -e
cd "$(dirname "$0")/.."
U=${UTILISATEUR:-agentforma}
N=$(printf "%02d" "$1")
rm -rf instance && mkdir -p instance/systeme
rsync -a --exclude 'node_modules' vps:/home/$U/app instance/ 2>/dev/null || true
rsync -a --exclude 'work/' --exclude 'documents/' --exclude '.claude/settings.local.json' vps:/home/$U/agent instance/ 2>/dev/null || true
rsync -a vps:/home/$U/PROJET.md instance/ 2>/dev/null || true
ssh vps "cat /etc/systemd/system/$U-app.service 2>/dev/null" > instance/systeme/$U-app.service || true
ssh vps "cat /etc/nginx/sites-available/$U 2>/dev/null || cat /etc/nginx/sites-available/${U}.conf 2>/dev/null || grep -l '$U' /etc/nginx/sites-available/* | head -1 | xargs cat 2>/dev/null" > instance/systeme/nginx.conf || true
if grep -rIl -E 'sk-ant-[a-z0-9]+-[A-Za-z0-9_-]{30,}|refresh_token"\s*:\s*"[^"]{8,}|access_token"\s*:\s*"[^"]{8,}' instance >/dev/null 2>&1; then echo "SECRET DÉTECTÉ : rien n'est enregistré"; exit 1; fi
git add -A
git commit -q -m "Étape $N : $2" || echo "rien de nouveau"
git tag -f "etape-$N" >/dev/null
echo "Étape $N enregistrée ($(git rev-parse --short HEAD))"
