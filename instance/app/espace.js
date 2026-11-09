'use strict';
// espace.js — identité de l'espace (nom, logo, agent, badge), contexte et mémoire de l'agent,
// documents déposés (agent/documents/) et fichiers produits par l'agent (agent/work/).
// Seuls les fichiers listés ici sont accessibles par l'outil : aucun autre chemin n'est jamais servi.

const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const DATA = path.join(RACINE, 'data');
const DOSSIER_AGENT = path.join(RACINE, 'agent');
const DOCUMENTS = path.join(DOSSIER_AGENT, 'documents');
const WORK = path.join(DOSSIER_AGENT, 'work');
const FICHIER_IDENTITE = path.join(DATA, 'identite.json');
const FICHIER_LOGO = path.join(DATA, 'logo');          // nom fixe ; le type est rangé dans identite.json
const FICHE = path.join(DOSSIER_AGENT, 'CLAUDE.md');

const MAX_LOGO = 2 * 1024 * 1024;
const MAX_DOCUMENT = 20 * 1024 * 1024;
const MAX_TEXTE = 200 * 1024;                          // fichiers de contexte modifiés dans la page

// Les fichiers de la section « Contexte et mémoire » (et RIEN d'autre).
const FICHIERS_CONTEXTE = {
  contexte: { fichier: 'CONTEXTE.md', titre: 'Contexte' },
  memoire: { fichier: 'memoire.md', titre: 'Mémoire' },
  regles: { fichier: 'regles.md', titre: 'Règles' },
  fiche: { fichier: 'CLAUDE.md', titre: 'Fiche' },
};

const EXTENSIONS = {
  '.txt': 'texte', '.md': 'texte', '.markdown': 'texte', '.csv': 'texte',
  '.pdf': 'pdf', '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.gif': 'gif', '.webp': 'webp',
};
const TYPES_MIME = {
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.markdown': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.json': 'application/json; charset=utf-8',
  '.html': 'text/plain; charset=utf-8', '.svg': 'text/plain; charset=utf-8',
};

for (const d of [DOCUMENTS, WORK]) { try { fs.mkdirSync(d, { recursive: true, mode: 0o755 }); } catch { /* rien */ } }

// ---------- Petits outils ----------

function lireJSON(fichier, defaut) {
  try { return JSON.parse(fs.readFileSync(fichier, 'utf8')); } catch { return defaut; }
}
function ecrireFichier(fichier, contenu, mode = 0o600) {
  const tmp = path.join(path.dirname(fichier), '.' + path.basename(fichier) + '.' + process.pid + '.tmp');
  fs.writeFileSync(tmp, contenu, { mode });
  fs.renameSync(tmp, fichier);
}

// Vrai type d'un fichier d'après ses premiers octets.
function typeReel(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return 'gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  const debut = buf.subarray(0, 64 * 1024);
  if (!debut.includes(0)) {
    const t = debut.toString('utf8').replace(/^\uFEFF/, '').trimStart();
    if (/^(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(t)) return 'svg';
    return 'texte';
  }
  return null;
}

// Nom de fichier nettoyé : pas de chemin, pas de fichier caché, caractères simples.
function nettoyerNom(brut) {
  let n = String(brut || '').normalize('NFC');
  n = n.split(/[\\/]/).pop();
  n = n.replace(/[\u0000-\u001f\u007f]/g, '');
  n = n.replace(/[^\p{L}\p{N} ._()+,'-]/gu, '-').replace(/\s+/g, ' ').replace(/-{2,}/g, '-');
  n = n.replace(/^[\s.\-]+/, '').replace(/[\s.]+$/, '');
  if (n.length > 100) {
    const ext = path.extname(n).slice(0, 12);
    n = n.slice(0, 100 - ext.length).trim() + ext;
  }
  return n;
}

// Nom demandé pour lire ou supprimer un fichier : doit déjà être un nom propre (sinon refus).
function nomValide(nom) {
  const n = String(nom || '');
  return Boolean(n) && n === nettoyerNom(n) && n !== '.' && n !== '..';
}

function nomLibre(dossier, nom) {
  const ext = path.extname(nom);
  const base = nom.slice(0, nom.length - ext.length);
  let essai = nom;
  for (let i = 2; fs.existsSync(path.join(dossier, essai)); i++) essai = `${base} (${i})${ext}`;
  return essai;
}

// ---------- Identité de l'espace ----------

let NOM_OUTIL_SERVICE = 'Outil';
let NOM_AGENT_SERVICE = 'Agent';
const BADGE_DEFAUT = 'IA';
let surChangementNom = () => {};

function identite() {
  const i = lireJSON(FICHIER_IDENTITE, {}) || {};
  return {
    nomOutil: typeof i.nomOutil === 'string' && i.nomOutil.trim() ? i.nomOutil.trim() : NOM_OUTIL_SERVICE,
    nomAgent: typeof i.nomAgent === 'string' && i.nomAgent.trim() ? i.nomAgent.trim() : NOM_AGENT_SERVICE,
    badge: typeof i.badge === 'string' ? i.badge : BADGE_DEFAUT,
    logo: i.logo && fs.existsSync(FICHIER_LOGO) ? i.logo : null, // { type, version }
  };
}

function marque() {
  const i = identite();
  return {
    nomOutil: i.nomOutil,
    nomAgent: i.nomAgent,
    initiale: (i.nomOutil.trim()[0] || '?').toUpperCase(),
    badge: i.badge,
    logo: i.logo ? `/api/logo?v=${i.logo.version}` : null,
  };
}

function sauverIdentite(modif) {
  const brut = lireJSON(FICHIER_IDENTITE, {}) || {};
  ecrireFichier(FICHIER_IDENTITE, JSON.stringify({ ...brut, ...modif }, null, 2));
}

function nettoyerTexte(t, max) {
  return String(t || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function changerIdentite(corps) {
  const nomOutil = nettoyerTexte(corps.nomOutil, 40);
  const nomAgent = nettoyerTexte(corps.nomAgent, 30);
  const badge = Array.from(nettoyerTexte(corps.badge, 20).toUpperCase().replace(/\s+/g, '')).slice(0, 4).join('');
  if (!nomOutil) return { erreur: 'Donnez un nom à l\'espace.' };
  if (!nomAgent) return { erreur: 'Donnez un nom à l\'agent.' };
  if (Array.from(String(corps.badge || '').trim()).length > 4) return { erreur: 'Le badge fait 4 caractères au maximum.' };
  const avant = identite();
  sauverIdentite({ nomOutil, nomAgent, badge });
  if (avant.nomAgent !== nomAgent) majFiche(nomAgent);
  surChangementNom(nomAgent);
  return { ok: true, marque: marque() };
}

// La ligne « Qui il est » de agent/CLAUDE.md suit le nom de l'agent.
function majFiche(nomAgent) {
  let texte;
  try { texte = fs.readFileSync(FICHE, 'utf8'); } catch { return false; }
  const propre = String(nomAgent).replace(/[«»\n]/g, '');
  const nouveau = texte.replace(/Tu t'appelles « [^»\n]* »/, `Tu t'appelles « ${propre} »`);
  if (nouveau === texte) return false;
  ecrireFichier(FICHE, nouveau, 0o644);
  return true;
}

function enregistrerLogo(buf) {
  if (!buf || !buf.length) return { erreur: 'Le fichier est vide.' };
  if (buf.length > MAX_LOGO) return { erreur: 'Le logo dépasse 2 Mo.' };
  const t = typeReel(buf);
  const types = { png: 'image/png', jpeg: 'image/jpeg', svg: 'image/svg+xml' };
  if (!types[t]) return { erreur: 'Format refusé : envoyez une image PNG, JPEG ou SVG.' };
  ecrireFichier(FICHIER_LOGO, buf);
  sauverIdentite({ logo: { type: types[t], version: Date.now().toString(36) } });
  return { ok: true, marque: marque() };
}

function retirerLogo() {
  try { fs.unlinkSync(FICHIER_LOGO); } catch { /* déjà absent */ }
  sauverIdentite({ logo: null });
  return { ok: true, marque: marque() };
}

// Route publique /api/logo. Un SVG est servi avec une CSP qui interdit tout script.
function servirLogo(res) {
  const i = identite();
  if (!i.logo) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end('Pas de logo'); }
  let buf;
  try { buf = fs.readFileSync(FICHIER_LOGO); } catch { res.writeHead(404); return res.end(); }
  const entetes = {
    'Content-Type': i.logo.type, 'Content-Length': buf.length,
    'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff',
  };
  if (i.logo.type === 'image/svg+xml') {
    entetes['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'; sandbox";
  } else {
    entetes['Content-Security-Policy'] = "default-src 'none'; sandbox";
  }
  res.writeHead(200, entetes);
  res.end(buf);
}

// ---------- Contexte et mémoire ----------

// Le modèle vierge de CONTEXTE.md (sert aussi de gabarit à « Remplir à partir d'un site »).
const MODELE_CONTEXTE = "# Contexte de la structure\n\nFiche d'identité de la structure pour laquelle l'agent travaille. Elle est remplie par un admin dans l'outil (Réglages › Contexte et mémoire).\n\n## Qui nous sommes\nÀ compléter\n\n## Ce que nous proposons\nÀ compléter\n\n## Nos clients\nÀ compléter\n\n## Notre ton\nÀ compléter\n\n## Sa mission (ce que l'agent doit faire pour nous)\nÀ compléter\n\n## Ce qu'il ne doit jamais faire\nÀ compléter\n\n## Coordonnées et liens utiles\nÀ compléter\n";

// « Sa mission » est remplie quand sa rubrique contient autre chose que « À compléter ».
function missionRemplie() {
  let t;
  try { t = fs.readFileSync(path.join(DOSSIER_AGENT, 'CONTEXTE.md'), 'utf8'); } catch { return false; }
  const m = t.match(/^#{1,6}\s*Sa mission[^\n]*\n([\s\S]*?)(?=^#{1,6}\s|(?![\s\S]))/m);
  if (!m) return false;
  const corps = m[1].replace(/^\(ce que l'agent doit faire pour nous\)\s*$/m, '').replace(/[*_>\-\s]/g, '');
  if (!corps) return false;
  return !/àcompléter|acompleter/i.test(corps);
}

function lireContexte() {
  const fichiers = Object.entries(FICHIERS_CONTEXTE).map(([id, f]) => {
    let contenu = '', modifie = null;
    try {
      const complet = path.join(DOSSIER_AGENT, f.fichier);
      const st = fs.lstatSync(complet);
      if (st.isFile()) { contenu = fs.readFileSync(complet, 'utf8'); modifie = st.mtime.toISOString(); }
    } catch { /* absent */ }
    return { id, fichier: f.fichier, titre: f.titre, contenu, modifie };
  });
  return { fichiers, missionRemplie: missionRemplie() };
}

function ecrireContexte(id, contenu) {
  const f = FICHIERS_CONTEXTE[id];
  if (!f) return { code: 404, erreur: 'Fichier inconnu.' };
  const t = String(contenu == null ? '' : contenu).replace(/\r\n/g, '\n');
  if (Buffer.byteLength(t) > MAX_TEXTE) return { code: 413, erreur: 'Texte trop long (200 Ko au maximum).' };
  const complet = path.join(DOSSIER_AGENT, f.fichier);
  try { if (fs.lstatSync(complet).isSymbolicLink()) return { code: 400, erreur: 'Fichier refusé.' }; } catch { /* nouveau */ }
  ecrireFichier(complet, t.endsWith('\n') ? t : t + '\n', 0o644);
  return { code: 200, ok: true, modifie: new Date().toISOString(), missionRemplie: missionRemplie() };
}

// ---------- Documents (agent/documents) et fichiers de l'agent (agent/work) ----------

const DOSSIERS = { documents: DOCUMENTS, work: WORK };

function lister(dossier) {
  const d = DOSSIERS[dossier];
  if (!d) return [];
  let noms = [];
  try { noms = fs.readdirSync(d); } catch { return []; }
  const res = [];
  for (const nom of noms) {
    if (nom.startsWith('.')) continue;
    let st;
    try { st = fs.lstatSync(path.join(d, nom)); } catch { continue; }
    if (!st.isFile()) continue; // ni dossier, ni lien symbolique
    res.push({ nom, taille: st.size, modifie: st.mtime.toISOString(), texte: /\.(md|markdown|txt|csv)$/i.test(nom) });
  }
  return res.sort((a, b) => b.modifie.localeCompare(a.modifie));
}

function deposer(nomBrut, buf) {
  if (!buf || !buf.length) return { code: 400, erreur: 'Le fichier est vide.' };
  if (buf.length > MAX_DOCUMENT) return { code: 413, erreur: 'Le fichier dépasse 20 Mo.' };
  const nom = nettoyerNom(nomBrut);
  const ext = path.extname(nom).toLowerCase();
  if (!nom || !EXTENSIONS[ext]) return { code: 415, erreur: 'Format refusé : texte, Markdown, PDF, CSV ou image (PNG, JPEG, GIF, WebP).' };
  const reel = typeReel(buf);
  if (reel !== EXTENSIONS[ext]) return { code: 415, erreur: 'Le contenu du fichier ne correspond pas à son extension.' };
  const final = nomLibre(DOCUMENTS, nom);
  ecrireFichier(path.join(DOCUMENTS, final), buf, 0o644);
  const st = fs.statSync(path.join(DOCUMENTS, final));
  return { code: 200, ok: true, document: { nom: final, taille: st.size, modifie: st.mtime.toISOString() } };
}

function cheminSur(dossier, nom) {
  const d = DOSSIERS[dossier];
  if (!d || !nomValide(nom)) return null;
  const complet = path.join(d, nom);
  if (path.dirname(complet) !== d) return null;
  let st;
  try { st = fs.lstatSync(complet); } catch { return null; }
  if (!st.isFile()) return null; // aucun lien symbolique suivi
  return { complet, st };
}

function supprimer(dossier, nom) {
  const f = cheminSur(dossier, nom);
  if (!f) return { code: 404, erreur: 'Fichier introuvable.' };
  fs.unlinkSync(f.complet);
  return { code: 200, ok: true };
}

function existe(dossier, nom) { return Boolean(cheminSur(dossier, nom)); }

// Téléchargement (ou aperçu texte) d'un fichier de documents/ ou work/, derrière la connexion.
function servirFichier(res, dossier, nom, apercu) {
  const f = cheminSur(dossier, nom);
  if (!f) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end('Fichier introuvable'); }
  const ext = path.extname(nom).toLowerCase();
  if (apercu) {
    if (!/\.(md|markdown|txt|csv)$/.test(ext)) { res.writeHead(415, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Pas d\'aperçu'); }
    const buf = fs.readFileSync(f.complet).subarray(0, 512 * 1024);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    return res.end(buf);
  }
  const type = TYPES_MIME[ext] || 'application/octet-stream';
  const ascii = nom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': f.st.size,
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nom)}`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  fs.createReadStream(f.complet).pipe(res);
}

// Un chemin écrit par l'agent est-il dans work/ ? Renvoie le nom du fichier, sinon null.
function nomDansWork(chemin) {
  if (!chemin) return null;
  const complet = path.resolve(DOSSIER_AGENT, String(chemin));
  if (path.dirname(complet) !== WORK) return null;
  const nom = path.basename(complet);
  return nomValide(nom) ? nom : null;
}

function init(options) {
  NOM_OUTIL_SERVICE = options.nomOutil || NOM_OUTIL_SERVICE;
  NOM_AGENT_SERVICE = options.nomAgent || NOM_AGENT_SERVICE;
  surChangementNom = options.surChangementNom || surChangementNom;
  // Au démarrage, la fiche porte le nom en vigueur.
  majFiche(identite().nomAgent);
}

module.exports = {
  init, identite, marque, changerIdentite, enregistrerLogo, retirerLogo, servirLogo,
  lireContexte, ecrireContexte, missionRemplie,
  lister, deposer, supprimer, existe, servirFichier, nomDansWork, nettoyerNom,
  MAX_LOGO, MAX_DOCUMENT, MODELE_CONTEXTE,
};
