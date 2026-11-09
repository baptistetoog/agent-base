'use strict';
// Espace agent : serveur web sans dépendance npm (Node.js 22).
// Écoute seulement sur 127.0.0.1 ; nginx sera placé devant plus tard.

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.umask(0o077); // tout fichier créé par le serveur n'est lisible que par son propriétaire

const RACINE = path.resolve(__dirname, '..');
const PUBLIC = path.join(__dirname, 'public');
const DATA = path.join(RACINE, 'data');
const FICHIER_COMPTES = path.join(DATA, 'comptes.json');
const FICHIER_SESSIONS = path.join(DATA, 'sessions.json');

const HOTE = '127.0.0.1';
const PORT = parseInt(process.env.PORT || '4910', 10);
const NOM_OUTIL = process.env.NOM_OUTIL || 'Outil';
const NOM_AGENT = process.env.NOM_AGENT || 'Agent';

const DUREE_SESSION = 30 * 24 * 3600 * 1000; // 30 jours
const FENETRE_ECHECS = 15 * 60 * 1000;       // 15 minutes
const MAX_ECHECS = 5;
const DUREE_BLOCAGE = 15 * 60 * 1000;        // 15 minutes
const NOM_COOKIE = 'session';

// Fichiers accessibles sans être connecté (la page de connexion et ses fichiers).
const PUBLICS = new Set(['/connexion.html', '/connexion.js', '/style.css']);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// ---------- Fichiers JSON (écriture atomique) ----------

if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { mode: 0o700, recursive: true });

function lireJSON(fichier, defaut) {
  try { return JSON.parse(fs.readFileSync(fichier, 'utf8')); } catch { return defaut; }
}

function ecrireJSON(fichier, valeur) {
  const tmp = fichier + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(valeur, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, fichier);
}

// ---------- Comptes ----------

function chargerComptes() {
  const c = lireJSON(FICHIER_COMPTES, { comptes: [] });
  return Array.isArray(c.comptes) ? c.comptes : [];
}

function trouverCompte(email) {
  const e = String(email || '').trim().toLowerCase();
  return chargerComptes().find((c) => c.email === e) || null;
}

const PARAMS_SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const HASH_LEURRE = { sel: crypto.randomBytes(16).toString('hex'), hash: crypto.randomBytes(64).toString('hex') };

function verifierMotDePasse(motDePasse, compte) {
  const cible = compte && compte.motDePasse ? compte.motDePasse : HASH_LEURRE;
  return new Promise((resolve) => {
    crypto.scrypt(String(motDePasse), Buffer.from(cible.sel, 'hex'), 64, PARAMS_SCRYPT, (err, cle) => {
      if (err) return resolve(false);
      const attendu = Buffer.from(cible.hash, 'hex');
      const ok = attendu.length === cle.length && crypto.timingSafeEqual(attendu, cle);
      resolve(Boolean(compte) && ok);
    });
  });
}

// ---------- Sessions (fichier relu s'il a changé, ex. après creer-compte.js --supprimer) ----------

let sessions = {};
let mtimeSessions = 0;

function rafraichirSessions() {
  let m = 0;
  try { m = fs.statSync(FICHIER_SESSIONS).mtimeMs; } catch { m = 0; }
  if (m !== mtimeSessions) {
    sessions = lireJSON(FICHIER_SESSIONS, {}) || {};
    mtimeSessions = m;
  }
}

function sauverSessions() {
  ecrireJSON(FICHIER_SESSIONS, sessions);
  try { mtimeSessions = fs.statSync(FICHIER_SESSIONS).mtimeMs; } catch { /* rien */ }
}

function empreinte(jeton) {
  return crypto.createHash('sha256').update(jeton).digest('hex');
}

function nettoyerSessions() {
  rafraichirSessions();
  const maintenant = Date.now();
  let change = false;
  for (const [cle, s] of Object.entries(sessions)) {
    if (!s || s.expire < maintenant) { delete sessions[cle]; change = true; }
  }
  if (change) sauverSessions();
}

function creerSession(email) {
  rafraichirSessions();
  const jeton = crypto.randomBytes(32).toString('base64url');
  const maintenant = Date.now();
  sessions[empreinte(jeton)] = { email, cree: maintenant, expire: maintenant + DUREE_SESSION };
  sauverSessions();
  return jeton;
}

function lireCookies(req) {
  const res = {};
  for (const morceau of String(req.headers.cookie || '').split(';')) {
    const i = morceau.indexOf('=');
    if (i > 0) res[morceau.slice(0, i).trim()] = morceau.slice(i + 1).trim();
  }
  return res;
}

function utilisateurConnecte(req) {
  const jeton = lireCookies(req)[NOM_COOKIE];
  if (!jeton) return null;
  rafraichirSessions();
  const cle = empreinte(jeton);
  const s = sessions[cle];
  if (!s) return null;
  if (s.expire < Date.now()) { delete sessions[cle]; sauverSessions(); return null; }
  const compte = trouverCompte(s.email);
  if (!compte) { delete sessions[cle]; sauverSessions(); return null; }
  return { compte, cle };
}

function cookieSession(jeton, dureeMs) {
  return `${NOM_COOKIE}=${jeton}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(dureeMs / 1000)}`;
}

// ---------- Limitation des essais (par adresse IP, en mémoire) ----------

const essais = new Map(); // ip -> { echecs: [horodatages], bloqueJusqua }

function adresseIP(req) {
  const distante = req.socket.remoteAddress || '';
  // On ne fait confiance aux en-têtes du proxy que si la requête vient de la machine elle-même (nginx).
  if (distante === '127.0.0.1' || distante === '::1' || distante === '::ffff:127.0.0.1') {
    const reelle = req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (reelle) return reelle;
  }
  return distante;
}

function estBloque(ip) {
  const e = essais.get(ip);
  return Boolean(e && e.bloqueJusqua && e.bloqueJusqua > Date.now());
}

function noterEchec(ip) {
  const maintenant = Date.now();
  const e = essais.get(ip) || { echecs: [], bloqueJusqua: 0 };
  e.echecs = e.echecs.filter((t) => maintenant - t < FENETRE_ECHECS);
  e.echecs.push(maintenant);
  if (e.echecs.length >= MAX_ECHECS) { e.bloqueJusqua = maintenant + DUREE_BLOCAGE; e.echecs = []; }
  essais.set(ip, e);
}

setInterval(() => {
  const maintenant = Date.now();
  for (const [ip, e] of essais) {
    if ((!e.bloqueJusqua || e.bloqueJusqua < maintenant) && e.echecs.every((t) => maintenant - t >= FENETRE_ECHECS)) essais.delete(ip);
  }
  nettoyerSessions();
}, 10 * 60 * 1000).unref();

// ---------- Réponses ----------

function entetesSecurite(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
    "img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
}

function json(res, code, objet, entetes = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...entetes });
  res.end(JSON.stringify(objet));
}

function rediriger(res, vers) {
  res.writeHead(302, { Location: vers, 'Cache-Control': 'no-store' });
  res.end();
}

function lireCorps(req, max = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let taille = 0;
    const morceaux = [];
    req.on('data', (m) => {
      taille += m.length;
      if (taille > max) { reject(new Error('trop gros')); req.destroy(); return; }
      morceaux.push(m);
    });
    req.on('end', () => {
      const brut = Buffer.concat(morceaux).toString('utf8');
      const type = String(req.headers['content-type'] || '');
      try {
        if (type.includes('application/json')) return resolve(brut ? JSON.parse(brut) : {});
        if (type.includes('application/x-www-form-urlencoded')) return resolve(Object.fromEntries(new URLSearchParams(brut)));
        resolve({});
      } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function servirFichier(res, chemin) {
  const complet = path.normalize(path.join(PUBLIC, chemin));
  if (!complet.startsWith(PUBLIC + path.sep)) return json(res, 404, { erreur: 'Introuvable' });
  fs.stat(complet, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Page introuvable');
    }
    const type = TYPES[path.extname(complet).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': type.startsWith('text/html') ? 'no-store' : 'no-cache' });
    fs.createReadStream(complet).pipe(res);
  });
}

function prenom(nom) {
  return String(nom || '').trim().split(/\s+/)[0] || '';
}

// ---------- Routes ----------

async function traiter(req, res) {
  entetesSecurite(res);
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { return json(res, 400, { erreur: 'Adresse invalide' }); }
  let chemin;
  try { chemin = decodeURIComponent(url.pathname); } catch { return json(res, 400, { erreur: 'Adresse invalide' }); }
  const methode = req.method;

  // Route publique : la marque (nom de l'outil, de l'agent, initiale).
  if (chemin === '/api/marque' && methode === 'GET') {
    return json(res, 200, {
      nomOutil: NOM_OUTIL,
      nomAgent: NOM_AGENT,
      initiale: (NOM_OUTIL.trim()[0] || '?').toUpperCase(),
    });
  }

  // Connexion.
  if (chemin === '/api/connexion' && methode === 'POST') {
    const ip = adresseIP(req);
    if (estBloque(ip)) {
      return json(res, 429, { erreur: 'Trop de tentatives. Réessayez dans 15 minutes.' });
    }
    let corps;
    try { corps = await lireCorps(req); } catch { return json(res, 413, { erreur: 'Requête trop grosse' }); }
    const compte = trouverCompte(corps.email);
    const ok = await verifierMotDePasse(corps.motDePasse || corps.password || '', compte);
    if (!ok) {
      noterEchec(ip);
      if (estBloque(ip)) return json(res, 429, { erreur: 'Trop de tentatives. Réessayez dans 15 minutes.' });
      return json(res, 401, { erreur: 'E-mail ou mot de passe incorrect.' });
    }
    essais.delete(ip);
    const jeton = creerSession(compte.email);
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookieSession(jeton, DUREE_SESSION) });
  }

  // Page de connexion et ses fichiers : accessibles à tous.
  if (methode === 'GET' && PUBLICS.has(chemin)) {
    if (chemin === '/connexion.html' && utilisateurConnecte(req)) return rediriger(res, '/');
    return servirFichier(res, chemin);
  }

  // Tout le reste exige d'être connecté.
  const session = utilisateurConnecte(req);
  if (!session) {
    if (chemin.startsWith('/api/')) return json(res, 401, { erreur: 'Non connecté', connexion: '/connexion.html' });
    return rediriger(res, '/connexion.html');
  }

  if (chemin === '/api/deconnexion' && methode === 'POST') {
    rafraichirSessions();
    delete sessions[session.cle];
    sauverSessions();
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookieSession('', 0) });
  }

  if (chemin === '/api/moi' && methode === 'GET') {
    const c = session.compte;
    return json(res, 200, { email: c.email, nom: c.nom, prenom: prenom(c.nom), role: c.role });
  }

  if (chemin.startsWith('/api/')) return json(res, 404, { erreur: 'Introuvable' });

  if (methode !== 'GET' && methode !== 'HEAD') return json(res, 405, { erreur: 'Méthode non autorisée' });
  return servirFichier(res, chemin === '/' ? '/index.html' : chemin);
}

const serveur = http.createServer((req, res) => {
  traiter(req, res).catch((err) => {
    console.error('Erreur :', err);
    if (!res.headersSent) json(res, 500, { erreur: 'Erreur interne' });
    else res.end();
  });
});

serveur.listen(PORT, HOTE, () => {
  nettoyerSessions();
  console.log(`${NOM_OUTIL} écoute sur http://${HOTE}:${PORT}`);
});
