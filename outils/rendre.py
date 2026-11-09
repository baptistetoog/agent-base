"""Fabrique les prompts prêts à coller à partir d'une fiche de paramètres.

python3 outils/rendre.py parametres.md  ->  mes-prompts/<UTILISATEUR>/01-….md
"""
import glob, os, re, sys

DEPOT = "https://github.com/baptistetoog/agent-base"
DEPOT_BRUT = "https://raw.githubusercontent.com/baptistetoog/agent-base/main"
ici = os.path.dirname(os.path.abspath(__file__))
racine = os.path.dirname(ici)
fiche = sys.argv[1] if len(sys.argv) > 1 else os.path.join(racine, "parametres.md")
v = {"DEPOT": DEPOT, "DEPOT_BRUT": DEPOT_BRUT}
for ligne in open(fiche, encoding="utf-8"):
    m = re.match(r"\|\s*([A-Z_]+)\s*\|\s*([^|]*?)\s*\|", ligne)
    if m and m.group(1) != "Paramètre":
        v[m.group(1)] = m.group(2)
sortie = os.path.join(racine, "mes-prompts", v["UTILISATEUR"])
os.makedirs(sortie, exist_ok=True)
manque = set()
for f in sorted(glob.glob(os.path.join(racine, "prompts", "*.md"))):
    s = open(f, encoding="utf-8").read()
    s = re.sub(r"\{([A-Z_]+)\}", lambda m: v.get(m.group(1), m.group(0)), s)
    manque |= set(re.findall(r"\{([A-Z_]{3,})\}", s))
    open(os.path.join(sortie, os.path.basename(f)), "w", encoding="utf-8").write(s)
print("Prompts prêts dans", sortie)
if manque:
    print("À compléter :", ", ".join(sorted(manque)))
