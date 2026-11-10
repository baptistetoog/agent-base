'use strict';
// automatisations.js — les missions que l'agent fait tout seul, à heure fixe (fuseau Europe/Paris).
//
// - data/automatisations.json : { automatisations: [ … ] }. Une automatisation :
//   { id, nom, consigne, frequence: 'jour'|'semaine'|'mois', jour, heure: 'HH:MM', actif,
//     creeLe, creePar, modifieLe, prochaine (ISO), enCours, sessionId,
//     dernierPassage (ISO), dernierResultat (une ligne), dernierStatut ('ok'|'erreur'|'arrete'|'delai'), dernierDeclencheur ('planificateur'|'manuel') }
//   jour : chaque semaine → 1 (lundi) … 7 (dimanche) ; chaque mois → 1 … 31 (le dernier jour du mois si le mois est plus court) ; tous les jours → null.
// - Le planificateur (init) regarde toutes les 15 s les automatisations actives arrivées à échéance et les
//   met dans la file de l'agent (fonction `lancer` fournie par le serveur). Il ne rattrape pas les passages
//   manqués pendant un arrêt : au démarrage, chaque échéance est recalculée à partir de maintenant ;
//   une échéance dépassée de plus de 3 minutes est sautée.
// - Une automatisation ne peut pas être lancée deux fois en même temps (drapeau enCours).
//
// Les fonctions de normalisation (normaliser, texteFrequence) sont pures : app/mcp-plateforme.js s'en sert
// pour vérifier une proposition de l'agent, sans jamais écrire dans data/automatisations.json.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA = path.resolve(__dirname, '..', 'data');
const FICHIER = path.join(DATA, 'automatisations.json');
const FUSEAU = 'Europe/Paris';
const TOLERANCE = 3 * 60 * 1000; // une échéance manquée de plus de 3 minutes n'est pas rattrapée
const MAX = 30;
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

const MODELES = [
  {
    id: 'point-du-matin', nom: 'Point du matin', frequence: 'jour', jour: null, heure: '09:00',
    consigne: 'Fais le point en 5 lignes maximum : ce qui a changé dans tes documents et tes outils branchés depuis hier, ce qui attend une validation, et la priorité du jour. S\'il n\'y a rien de nouveau, dis-le en une phrase.',
  },
  {
    id: 'bilan-semaine', nom: 'Bilan de la semaine', frequence: 'semaine', jour: 5, heure: '17:00',
    consigne: 'Résume la semaine : ce que tu as fait (d\'après l\'historique et agent/work/), ce qui a été validé ou refusé, et 3 propositions pour la semaine prochaine. Enregistre le bilan dans agent/work/bilan-AAAA-SS.md.',
  },
];

// ---------- Petits outils ----------

function lireJSON(fichier, defaut) {
  try { return JSON.parse(fs.readFileSync(fichier, 'utf8')); } catch { return defaut; }
}
function ecrireJSON(fichier, valeur) {
  const tmp = fichier + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(valeur, null, 2), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, fichier);
}
function sansAccents(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
function maintenant() { return new Date().toISOString(); }

// ---------- L'heure de Paris ----------

const FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function partiesParis(ms) {
  const o = {};
  for (const p of FORMAT.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { a: +o.year, mo: +o.month, j: +o.day, h: +o.hour, mi: +o.minute, s: +o.second };
}
// Décalage de Paris par rapport à UTC à cet instant (en ms).
function decalage(ms) {
  const p = partiesParis(ms);
  return Date.UTC(p.a, p.mo - 1, p.j, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}
// Heure de Paris → instant (ms). Deux passes pour les changements d'heure.
function parisVersMs(a, mo, j, h, mi) {
  const brut = Date.UTC(a, mo - 1, j, h, mi);
  let ms = brut - decalage(brut);
  ms = brut - decalage(ms);
  return ms;
}
function joursDansMois(a, mo) { return new Date(Date.UTC(a, mo, 0)).getUTCDate(); }

// Prochain passage strictement après `depuis` (ms), ou null.
function prochainPassage(auto, depuis = Date.now()) {
  const [h, mi] = String(auto.heure || '09:00').split(':').map(Number);
  const p = partiesParis(depuis);
  for (let d = 0; d <= 400; d++) {
    const date = new Date(Date.UTC(p.a, p.mo - 1, p.j + d));
    const a = date.getUTCFullYear(), mo = date.getUTCMonth() + 1, j = date.getUTCDate();
    if (auto.frequence === 'semaine') {
      const iso = ((date.getUTCDay() + 6) % 7) + 1; // 1 = lundi … 7 = dimanche
      if (iso !== Number(auto.jour)) continue;
    } else if (auto.frequence === 'mois') {
      if (j !== Math.min(Number(auto.jour) || 1, joursDansMois(a, mo))) continue;
    }
    const ms = parisVersMs(a, mo, j, h, mi);
    if (ms > depuis) return ms;
  }
  return null;
}

// ---------- Textes ----------

function texteHeure(heure) {
  const [h, mi] = String(heure || '').split(':');
  if (h === undefined) return '';
  return `${Number(h)} h${mi && mi !== '00' ? ' ' + mi : ''}`;
}
function texteFrequence(a) {
  const h = texteHeure(a.heure);
  if (a.frequence === 'semaine') return `Chaque ${JOURS[(Number(a.jour) || 1) - 1]} à ${h}`;
  if (a.frequence === 'mois') { const j = Number(a.jour) || 1; return `Le ${j === 1 ? '1er' : j} de chaque mois à ${h}`; }
  return `Tous les jours à ${h}`;
}
// « mardi 11 nov. à 9 h »
function texteEcheance(ms) {
  const d = new Date(ms);
  const jour = d.toLocaleDateString('fr-FR', { timeZone: FUSEAU, weekday: 'long', day: 'numeric', month: 'short' });
  const p = partiesParis(ms);
  return `${jour} à ${texteHeure(`${p.h}:${String(p.mi).padStart(2, '0')}`)}`;
}

// Résultat en une ligne : la première ligne utile de la réponse, sans Markdown.
function uneLigne(texte, n = 180) {
  const brutes = String(texte || '').replace(/\r/g, '').split('\n').filter((l) => l.trim() && !/^\s*[-_*]{3,}\s*$/.test(l));
  // Un titre (« ## Point du matin ») ne dit rien du résultat : on prend la première ligne qui n'en est pas un.
  const choisie = brutes.find((l) => !/^\s*#{1,6}\s/.test(l)) || brutes[0] || '';
  const t = choisie.replace(/^\s*(#{1,6}\s+|[-*•]\s+|\d+[.)]\s+|>\s*)/, '').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

// ---------- Vérification d'une automatisation (formulaire, modèle ou proposition de l'agent) ----------

function lireFrequence(f) {
  const s = sansAccents(f);
  if (!s) return null;
  if (/(jour|quotid|daily|^j$)/.test(s) && !/semaine|mois/.test(s)) return 'jour';
  if (/(sem|hebdo|week)/.test(s)) return 'semaine';
  if (/(mois|mensu|month)/.test(s)) return 'mois';
  return null;
}
function lireHeure(h) {
  const s = sansAccents(h).replace(/\s+/g, '');
  const m = s.match(/^(\d{1,2})(?:[h:](\d{2})?)?$/);
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2] || 0);
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
function lireJourSemaine(j) {
  if (j === undefined || j === null || j === '') return null;
  const n = Number(j);
  if (Number.isInteger(n) && n >= 1 && n <= 7) return n;
  const s = sansAccents(j);
  const i = JOURS.findIndex((x) => s.startsWith(x.slice(0, 3)));
  return i >= 0 ? i + 1 : null;
}
function lireJourMois(j) {
  const n = parseInt(String(j === undefined || j === null ? '' : j).replace(/\D/g, ''), 10);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
}

function normaliser(a) {
  a = a || {};
  const nom = String(a.nom || '').replace(/\s+/g, ' ').trim();
  const consigne = String(a.consigne || '').replace(/\r\n/g, '\n').trim();
  if (!nom) return { erreur: 'Donnez un nom à l\'automatisation.' };
  if (nom.length > 60) return { erreur: 'Nom trop long (60 caractères au maximum).' };
  if (!consigne) return { erreur: 'Écrivez la consigne (la mission donnée à l\'agent).' };
  if (consigne.length > 4000) return { erreur: 'Consigne trop longue (4 000 caractères au maximum).' };
  const frequence = lireFrequence(a.frequence);
  if (!frequence) return { erreur: 'Fréquence inconnue : tous les jours, chaque semaine ou chaque mois.' };
  let jour = null;
  if (frequence === 'semaine') { jour = lireJourSemaine(a.jour); if (!jour) return { erreur: 'Choisissez le jour de la semaine (lundi … dimanche).' }; }
  if (frequence === 'mois') { jour = lireJourMois(a.jour); if (!jour) return { erreur: 'Choisissez le jour du mois (1 à 31).' }; }
  const heure = lireHeure(a.heure);
  if (!heure) return { erreur: 'Heure invalide (ex. 09:00).' };
  return { nom, consigne, frequence, jour, heure };
}

// ---------- Le fichier ----------

function charger() {
  const d = lireJSON(FICHIER, { automatisations: [] });
  return Array.isArray(d.automatisations) ? d.automatisations : [];
}
function sauver(liste) { ecrireJSON(FICHIER, { automatisations: liste }); }

function publique(a) {
  return {
    id: a.id, nom: a.nom, consigne: a.consigne, frequence: a.frequence, jour: a.jour, heure: a.heure,
    actif: Boolean(a.actif), enCours: Boolean(a.enCours), texteFrequence: texteFrequence(a),
    prochaine: a.actif && a.prochaine ? a.prochaine : null,
    texteProchaine: a.actif && a.prochaine ? texteEcheance(Date.parse(a.prochaine)) : null,
    dernierPassage: a.dernierPassage || null, dernierResultat: a.dernierResultat || null,
    dernierStatut: a.dernierStatut || null, dernierDeclencheur: a.dernierDeclencheur || null,
    creeLe: a.creeLe || null, creePar: a.creePar || null, modele: a.modele || null,
  };
}

function lister() {
  return {
    automatisations: charger().map(publique),
    modeles: MODELES.map((m) => ({ ...m, texteFrequence: texteFrequence(m) })),
    fuseau: FUSEAU,
  };
}

function trouver(id) { return charger().find((a) => a.id === String(id)) || null; }

let diffuser = () => {};
let lancerAgent = null;
const enCours = new Set(); // identifiants dans la file ou en train de tourner

function signaler() { diffuser('automatisations', {}); }

function creer(donnees, compte, options = {}) {
  const n = normaliser(donnees);
  if (n.erreur) return { code: 400, erreur: n.erreur };
  const liste = charger();
  if (liste.length >= MAX) return { code: 409, erreur: `${MAX} automatisations au maximum.` };
  const actif = Boolean(options.actif);
  const a = {
    id: crypto.randomBytes(6).toString('base64url'), ...n, actif,
    creeLe: maintenant(), creePar: compte ? (compte.nom || compte.email || null) : null,
    modele: options.modele || null, origine: options.origine || 'reglages',
    prochaine: null, enCours: false, sessionId: null,
    dernierPassage: null, dernierResultat: null, dernierStatut: null, dernierDeclencheur: null,
  };
  if (actif) { const p = prochainPassage(a); a.prochaine = p ? new Date(p).toISOString() : null; }
  liste.push(a);
  sauver(liste);
  signaler();
  return { code: 200, ok: true, automatisation: publique(a) };
}

function ajouterModele(id, compte) {
  const m = MODELES.find((x) => x.id === String(id));
  if (!m) return { code: 404, erreur: 'Modèle inconnu.' };
  return creer(m, compte, { actif: false, modele: m.id }); // ajouté en pause
}

function modifier(id, donnees) {
  const liste = charger();
  const a = liste.find((x) => x.id === String(id));
  if (!a) return { code: 404, erreur: 'Automatisation introuvable.' };
  const n = normaliser({ ...a, ...donnees });
  if (n.erreur) return { code: 400, erreur: n.erreur };
  const consigneChangee = n.consigne !== a.consigne;
  Object.assign(a, n, { modifieLe: maintenant() });
  if (consigneChangee) a.sessionId = null; // nouvelle mission : nouvelle discussion
  if (typeof donnees.actif === 'boolean') a.actif = donnees.actif;
  const p = a.actif ? prochainPassage(a) : null;
  a.prochaine = p ? new Date(p).toISOString() : null;
  sauver(liste);
  signaler();
  return { code: 200, ok: true, automatisation: publique(a) };
}

function changerActif(id, actif) { return modifier(id, { actif: Boolean(actif) }); }

function supprimer(id) {
  const liste = charger();
  const reste = liste.filter((a) => a.id !== String(id));
  if (reste.length === liste.length) return { code: 404, erreur: 'Automatisation introuvable.' };
  sauver(reste);
  signaler();
  return { code: 200, ok: true };
}

// Met l'automatisation dans la file de l'agent (planificateur ou « Lancer maintenant »).
function lancer(id, declencheur) {
  const liste = charger();
  const a = liste.find((x) => x.id === String(id));
  if (!a) return { code: 404, erreur: 'Automatisation introuvable.' };
  if (enCours.has(a.id)) return { code: 409, erreur: `« ${a.nom} » est déjà en cours : attendez la fin de ce passage.` };
  if (!lancerAgent) return { code: 500, erreur: 'Planificateur non démarré.' };
  const r = lancerAgent({ id: a.id, nom: a.nom, consigne: a.consigne, sessionId: a.sessionId || null, declencheur });
  if (!r || !r.ok) return { code: (r && r.code) || 500, erreur: (r && r.erreur) || 'Impossible de lancer l\'automatisation.' };
  enCours.add(a.id);
  a.enCours = true;
  sauver(liste);
  signaler();
  console.log(`Automatisation « ${a.nom} » lancée (${declencheur}).`);
  return { code: 200, ok: true, automatisation: publique(a) };
}

// Fin d'un passage (appelée par app/agent.js) : résultat en une ligne, discussion à reprendre la prochaine fois.
function finir(id, fin) {
  enCours.delete(String(id));
  const liste = charger();
  const a = liste.find((x) => x.id === String(id));
  if (!a) return null;
  a.enCours = false;
  a.dernierPassage = fin.quand || maintenant();
  a.dernierStatut = fin.statut || 'ok';
  a.dernierDeclencheur = fin.declencheur || null;
  a.dernierResultat = uneLigne(fin.texte) || (fin.statut === 'ok' ? 'Terminé.' : 'Pas de réponse.');
  if (fin.statut === 'ok' && fin.sessionId) a.sessionId = fin.sessionId;
  sauver(liste);
  signaler();
  console.log(`Automatisation « ${a.nom} » terminée (${a.dernierStatut}).`);
  return publique(a);
}

// ---------- Ce que voient l'agent et le système ----------

function actives() { return charger().filter((a) => a.actif); }

// Ligne ajoutée au premier message de chaque discussion.
function ligneAgent() {
  const l = actives();
  if (!l.length) return '[Automatisations actives : aucune]';
  return `[Automatisations actives : ${l.map((a) => `${a.nom} (${texteFrequence(a).toLowerCase()})`).join(' ; ')}]`;
}

// Prochaine échéance parmi les automatisations actives : { nom, quand, texte } ou null.
function prochaine() {
  let mieux = null;
  for (const a of actives()) {
    const ms = Date.parse(a.prochaine || '');
    if (!Number.isFinite(ms)) continue;
    if (!mieux || ms < mieux.ms) mieux = { ms, nom: a.nom };
  }
  return mieux ? { nom: mieux.nom, quand: new Date(mieux.ms).toISOString(), texte: texteEcheance(mieux.ms) } : null;
}

// ---------- Le planificateur ----------

function tic() {
  const maintenantMs = Date.now();
  const liste = charger();
  const aLancer = [];
  let change = false;
  for (const a of liste) {
    if (!a.actif) continue;
    const ms = Date.parse(a.prochaine || '');
    if (!Number.isFinite(ms)) { const p = prochainPassage(a, maintenantMs); a.prochaine = p ? new Date(p).toISOString() : null; change = true; continue; }
    if (maintenantMs < ms) continue;
    if (maintenantMs - ms <= TOLERANCE) aLancer.push(a.id);
    else console.log(`Automatisation « ${a.nom} » : passage manqué non rattrapé.`);
    const p = prochainPassage(a, maintenantMs);
    a.prochaine = p ? new Date(p).toISOString() : null;
    change = true;
  }
  if (change) { sauver(liste); signaler(); }
  for (const id of aLancer) {
    const r = lancer(id, 'planificateur');
    if (!r.ok) {
      console.log(`Automatisation non lancée : ${r.erreur}`);
      if (r.code !== 409) finir(id, { statut: 'erreur', texte: r.erreur, declencheur: 'planificateur' });
    }
  }
}

function init(options) {
  diffuser = options.diffuser || diffuser;
  lancerAgent = options.lancer;
  // Démarrage : rien n'est en cours, et on ne rattrape pas les passages manqués pendant l'arrêt.
  const liste = charger();
  if (liste.length) {
    const t = Date.now();
    for (const a of liste) {
      a.enCours = false;
      const p = a.actif ? prochainPassage(a, t) : null;
      a.prochaine = p ? new Date(p).toISOString() : null;
    }
    sauver(liste);
  }
  setInterval(() => { try { tic(); } catch (e) { console.error('Planificateur :', e.message); } }, 15 * 1000).unref();
}

module.exports = {
  FICHIER, FUSEAU, MODELES, JOURS,
  normaliser, texteFrequence, texteEcheance, uneLigne, prochainPassage,
  init, lister, trouver, creer, ajouterModele, modifier, changerActif, supprimer, lancer, finir,
  actives, ligneAgent, prochaine,
};
