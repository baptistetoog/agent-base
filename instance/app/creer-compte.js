#!/usr/bin/env node
'use strict';
// Créer ou modifier un compte :   node app/creer-compte.js email@exemple.fr "Prénom Nom" admin
// Supprimer un compte :           node app/creer-compte.js email@exemple.fr --supprimer
// Le mot de passe est demandé deux fois sans être affiché.
// Pour les tests automatiques : MOT_DE_PASSE=... node app/creer-compte.js ...

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.umask(0o077);

const DATA = path.resolve(__dirname, '..', 'data');
const FICHIER_COMPTES = path.join(DATA, 'comptes.json');
const FICHIER_SESSIONS = path.join(DATA, 'sessions.json');
const PARAMS_SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function arreter(message) {
  console.error(message);
  process.exit(1);
}

function lireJSON(fichier, defaut) {
  try { return JSON.parse(fs.readFileSync(fichier, 'utf8')); } catch { return defaut; }
}

function ecrireJSON(fichier, valeur) {
  const tmp = fichier + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(valeur, null, 2), { mode: 0o600 });
  // Si le script est lancé par root, le fichier doit quand même appartenir au propriétaire de data/.
  if (process.getuid && process.getuid() === 0) {
    const st = fs.statSync(DATA);
    fs.chownSync(tmp, st.uid, st.gid);
  }
  fs.renameSync(tmp, fichier);
}

function demanderCache(question) {
  return new Promise((resolve) => {
    const entree = process.stdin;
    if (!entree.isTTY) arreter('Pas de terminal pour saisir le mot de passe : utilisez la variable MOT_DE_PASSE.');
    process.stdout.write(question);
    entree.setRawMode(true);
    entree.resume();
    entree.setEncoding('utf8');
    let saisie = '';
    const surTouche = (texte) => {
      for (const car of texte) {
        if (car === '\r' || car === '\n' || car === '\u0004') {
          entree.setRawMode(false);
          entree.pause();
          entree.removeListener('data', surTouche);
          process.stdout.write('\n');
          return resolve(saisie);
        }
        if (car === '\u0003') { entree.setRawMode(false); process.stdout.write('\n'); process.exit(130); }
        if (car === '\u007f' || car === '\b') { saisie = saisie.slice(0, -1); continue; }
        saisie += car;
      }
    };
    entree.on('data', surTouche);
  });
}

function hacher(motDePasse) {
  const sel = crypto.randomBytes(16);
  const hash = crypto.scryptSync(motDePasse, sel, 64, PARAMS_SCRYPT);
  return { sel: sel.toString('hex'), hash: hash.toString('hex') };
}

function fermerSessions(email) {
  const sessions = lireJSON(FICHIER_SESSIONS, {});
  let n = 0;
  for (const [cle, s] of Object.entries(sessions)) {
    if (s && s.email === email) { delete sessions[cle]; n++; }
  }
  if (n > 0) ecrireJSON(FICHIER_SESSIONS, sessions);
  return n;
}

async function principal() {
  const args = process.argv.slice(2);
  const supprimer = args.includes('--supprimer');
  const positionnels = args.filter((a) => a !== '--supprimer');
  const email = String(positionnels[0] || '').trim().toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    arreter('Usage :\n  node app/creer-compte.js email@exemple.fr "Prénom Nom" admin|membre\n  node app/creer-compte.js email@exemple.fr --supprimer');
  }
  if (!fs.existsSync(DATA)) arreter(`Dossier introuvable : ${DATA}`);

  const donnees = lireJSON(FICHIER_COMPTES, { comptes: [] });
  if (!Array.isArray(donnees.comptes)) donnees.comptes = [];
  const index = donnees.comptes.findIndex((c) => c.email === email);

  if (supprimer) {
    if (index === -1) arreter(`Aucun compte pour ${email}.`);
    donnees.comptes.splice(index, 1);
    ecrireJSON(FICHIER_COMPTES, donnees);
    const n = fermerSessions(email);
    console.log(`Compte ${email} supprimé (${n} session(s) fermée(s)).`);
    return;
  }

  const existant = index >= 0 ? donnees.comptes[index] : null;
  const nom = String(positionnels[1] || (existant && existant.nom) || '').trim();
  const role = String(positionnels[2] || (existant && existant.role) || 'membre').trim();
  if (!nom) arreter('Indiquez le nom entre guillemets, par exemple "Prénom Nom".');
  if (role !== 'admin' && role !== 'membre') arreter('Le rôle doit être « admin » ou « membre ».');

  let motDePasse = process.env.MOT_DE_PASSE;
  if (motDePasse === undefined) {
    motDePasse = await demanderCache('Mot de passe : ');
    const confirmation = await demanderCache('Confirmez le mot de passe : ');
    if (motDePasse !== confirmation) arreter('Les deux mots de passe ne sont pas identiques. Rien n\'a été changé.');
  }
  if (String(motDePasse).length < 10) arreter('Le mot de passe doit faire au moins 10 caractères.');

  const compte = {
    email,
    nom,
    role,
    motDePasse: hacher(String(motDePasse)),
    cree: existant ? existant.cree : new Date().toISOString(),
    modifie: new Date().toISOString(),
  };
  if (existant) donnees.comptes[index] = compte; else donnees.comptes.push(compte);
  ecrireJSON(FICHIER_COMPTES, donnees);
  console.log(`Compte ${existant ? 'modifié' : 'créé'} : ${email} (${nom}, ${role}).`);
}

principal().catch((err) => arreter('Erreur : ' + err.message));
