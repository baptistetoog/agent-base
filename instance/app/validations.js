'use strict';
// validations.js — « Propose » ou « Agit seul » : le mode de l'agent et les cartes « À valider ».
//
// - data/reglages.json    : { mode: 'propose' | 'seul', modifieLe, modifiePar }. « propose » par défaut.
// - data/validations.json : { validations: [ carte… ] }. Une carte est créée par app/mcp-plateforme.js
//   (outil demander_validation, appelé par l'agent), puis validée ou refusée par un admin depuis le bureau.
//
// Ce module est partagé par le serveur ET par mcp-plateforme.js (deux processus différents) :
// chaque modification se fait sous un verrou (dossier data/validations.lock, création atomique),
// en relisant le fichier juste avant d'écrire.
//
// Statuts d'une carte : en-attente → validee (exécution en cours) → executee | echec ; ou refusee.
// Chaque carte garde son historique : qui, quand, quoi.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA = path.resolve(__dirname, '..', 'data');
const FICHIER_REGLAGES = path.join(DATA, 'reglages.json');
const FICHIER = path.join(DATA, 'validations.json');
const VERROU = path.join(DATA, 'validations.lock');
const MODES = ['propose', 'seul'];
const MAX_CARTES = 300; // les plus anciennes cartes terminées sont oubliées au-delà

const LIMITES = { titre: 200, ceQueJeVaisFaire: 3000, outilPrevu: 200, contenu: 20000, motif: 1000, resultat: 4000 };

function lireJSON(fichier, defaut) {
  try { return JSON.parse(fs.readFileSync(fichier, 'utf8')); } catch { return defaut; }
}
function ecrireJSON(fichier, valeur) {
  const tmp = fichier + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(valeur, null, 2), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, fichier);
}
function maintenant() { return new Date().toISOString(); }
function couper(t, n) { const s = String(t === undefined || t === null ? '' : t).replace(/\r\n/g, '\n').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// ---------- Le mode de l'agent ----------

function mode() {
  const r = lireJSON(FICHIER_REGLAGES, {});
  return MODES.includes(r.mode) ? r.mode : 'propose';
}
function reglages() {
  const r = lireJSON(FICHIER_REGLAGES, {});
  return { mode: MODES.includes(r.mode) ? r.mode : 'propose', modifieLe: r.modifieLe || null, modifiePar: r.modifiePar || null };
}
function changerMode(m, compte) {
  if (!MODES.includes(m)) return { code: 400, erreur: 'Mode inconnu (propose ou seul).' };
  const r = lireJSON(FICHIER_REGLAGES, {});
  Object.assign(r, { mode: m, modifieLe: maintenant(), modifiePar: compte ? compte.nom || compte.email : null });
  ecrireJSON(FICHIER_REGLAGES, r);
  return { code: 200, ok: true, reglages: reglages() };
}

// ---------- Verrou (partagé entre le serveur et mcp-plateforme.js) ----------

function attendre(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function sousVerrou(fn) {
  const debut = Date.now();
  for (;;) {
    try { fs.mkdirSync(VERROU, { mode: 0o700 }); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Verrou oublié (processus arrêté brutalement) : retiré au bout de 10 secondes.
      try { if (Date.now() - fs.statSync(VERROU).mtimeMs > 10000) { fs.rmdirSync(VERROU); continue; } } catch { continue; }
      if (Date.now() - debut > 5000) throw new Error('validations.json est occupé');
      attendre(25);
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(VERROU); } catch { /* déjà retiré */ } }
}

function charger() {
  const d = lireJSON(FICHIER, { validations: [] });
  return Array.isArray(d.validations) ? d.validations : [];
}
function sauver(liste) {
  // On garde toutes les cartes en attente ou en cours, et les plus récentes des autres.
  if (liste.length > MAX_CARTES) {
    const actives = liste.filter((c) => c.statut === 'en-attente' || c.statut === 'validee');
    const finies = liste.filter((c) => !actives.includes(c)).slice(-(MAX_CARTES - actives.length));
    liste = [...actives, ...finies].sort((a, b) => a.n - b.n);
  }
  ecrireJSON(FICHIER, { validations: liste });
}

// Modifie une carte sous verrou. fn(carte, liste) renvoie une erreur (texte) ou rien.
function modifier(n, fn) {
  return sousVerrou(() => {
    const liste = charger();
    const c = liste.find((x) => x.n === Number(n));
    if (!c) return { code: 404, erreur: 'Demande introuvable.' };
    const pb = fn(c, liste);
    if (pb) return { code: 409, erreur: pb };
    sauver(liste);
    return { code: 200, ok: true, carte: c };
  });
}

// ---------- Création (appelée par mcp-plateforme.js) ----------

function creer(a, contexte = {}) {
  const titre = couper(a.titre, LIMITES.titre);
  const ceQue = couper(a.ce_que_je_vais_faire, LIMITES.ceQueJeVaisFaire);
  const outil = couper(a.outil_prevu, LIMITES.outilPrevu);
  const contenuBrut = typeof a.contenu_exact === 'string' ? a.contenu_exact : (a.contenu_exact === undefined || a.contenu_exact === null ? '' : JSON.stringify(a.contenu_exact, null, 2));
  const contenu = String(contenuBrut).replace(/\r\n/g, '\n');
  if (!titre || !ceQue || !outil || !contenu.trim()) return { erreur: 'Les quatre champs sont obligatoires : titre, ce_que_je_vais_faire, outil_prevu, contenu_exact.' };
  if (contenu.length > LIMITES.contenu) return { erreur: `contenu_exact trop long (${LIMITES.contenu} caractères au maximum).` };
  return sousVerrou(() => {
    const liste = charger();
    const n = liste.reduce((m, c) => Math.max(m, c.n || 0), 0) + 1;
    const quand = maintenant();
    const carte = {
      n, titre, ceQueJeVaisFaire: ceQue, outilPrevu: outil,
      contenuExact: contenu, contenuFinal: null,
      statut: 'en-attente',
      discussion: contexte.discussion || null, lancement: contexte.lancement || null,
      demandePar: contexte.demandePar || null,
      creeLe: quand,
      historique: [{ quand, qui: 'agent', quoi: `Demande créée par l'agent${contexte.demandePar && contexte.demandePar.nom ? ` (message de ${contexte.demandePar.nom})` : ''}` }],
    };
    liste.push(carte);
    sauver(liste);
    return { ok: true, carte };
  });
}

// ---------- Décisions (serveur) ----------

function valider(n, contenuCorrige, compte) {
  return modifier(n, (c) => {
    if (c.statut !== 'en-attente') return 'Cette demande a déjà été traitée.';
    const quand = maintenant();
    let final = c.contenuExact;
    if (typeof contenuCorrige === 'string' && contenuCorrige.replace(/\r\n/g, '\n').trim()) {
      final = contenuCorrige.replace(/\r\n/g, '\n');
      if (final.length > LIMITES.contenu) return `Contenu trop long (${LIMITES.contenu} caractères au maximum).`;
      if (final.trim() !== c.contenuExact.trim()) c.historique.push({ quand, qui: compte.nom, email: compte.email, quoi: 'Contenu corrigé avant validation' });
    }
    c.contenuFinal = final;
    c.statut = 'validee';
    c.decision = { par: compte.nom, email: compte.email, le: quand };
    c.historique.push({ quand, qui: compte.nom, email: compte.email, quoi: 'Validée : l\'agent est relancé pour exécuter' });
    return null;
  });
}

function refuser(n, motif, compte) {
  return modifier(n, (c) => {
    if (c.statut !== 'en-attente') return 'Cette demande a déjà été traitée.';
    const quand = maintenant();
    c.statut = 'refusee';
    c.motif = couper(motif, LIMITES.motif) || null;
    c.decision = { par: compte.nom, email: compte.email, le: quand };
    c.historique.push({ quand, qui: compte.nom, email: compte.email, quoi: c.motif ? `Refusée : ${c.motif}` : 'Refusée (sans motif)' });
    return null;
  });
}

// Fin du lancement qui exécutait la validation : « exécutée » (ou « échec ») avec le résultat.
function finir(n, ok, resultat) {
  try {
    return modifier(n, (c) => {
      if (c.statut !== 'validee') return 'pas en cours';
      const quand = maintenant();
      c.statut = ok ? 'executee' : 'echec';
      c.resultat = couper(resultat, LIMITES.resultat);
      c.executeLe = quand;
      c.historique.push({ quand, qui: 'agent', quoi: ok ? 'Exécutée' : 'Échec de l\'exécution' });
      return null;
    });
  } catch (e) { return { code: 500, erreur: e.message }; }
}

// Supprime des cartes (nettoyage des tests). Sans liste : rien.
function supprimer(numeros) {
  const set = new Set((numeros || []).map(Number));
  return sousVerrou(() => {
    const liste = charger();
    const reste = liste.filter((c) => !set.has(c.n));
    sauver(reste);
    return { code: 200, ok: true, supprimees: liste.length - reste.length };
  });
}

function lister() {
  const liste = charger().slice().sort((a, b) => b.n - a.n);
  return { validations: liste.slice(0, 100), enAttente: liste.filter((c) => c.statut === 'en-attente').length };
}
function nombreEnAttente() { return charger().filter((c) => c.statut === 'en-attente').length; }
function trouver(n) { return charger().find((c) => c.n === Number(n)) || null; }

module.exports = {
  FICHIER, mode, reglages, changerMode,
  creer, valider, refuser, finir, supprimer, lister, nombreEnAttente, trouver,
};
