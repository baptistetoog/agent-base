'use strict';
// Espace agent : serveur web sans dépendance npm (Node.js 22).
// Écoute seulement sur 127.0.0.1 ; nginx sera placé devant plus tard.

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const agent = require('./agent');
const espace = require('./espace');
const skills = require('./skills');
const connexions = require('./connexions');
const validations = require('./validations');
const automatisations = require('./automatisations');

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
const PUBLICS = new Set(['/connexion.html', '/connexion.js', '/design.css']);

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

// Empreinte sha256 de l'importmap en ligne de index.html (recalculée si la page change),
// pour l'autoriser dans la CSP sans ouvrir les scripts en ligne en général.
let empreinteImportmap = { mtime: 0, valeurs: [] };
function empreintesImportmap() {
  const fichier = path.join(PUBLIC, 'index.html');
  let st;
  try { st = fs.statSync(fichier); } catch { return []; }
  if (st.mtimeMs !== empreinteImportmap.mtime) {
    const html = fs.readFileSync(fichier, 'utf8');
    const valeurs = [];
    const re = /<script type="importmap">([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html))) valeurs.push(`'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
    empreinteImportmap = { mtime: st.mtimeMs, valeurs };
  }
  return empreinteImportmap.valeurs;
}

function entetesSecurite(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  // three.js vient de cdn.jsdelivr.net ; l'importmap est autorisée par son empreinte.
  // style-src 'unsafe-inline' : nécessaire à l'illustration de secours (SVG) de bureau3d.js
  // quand WebGL n'est pas disponible (styles en ligne dans le SVG).
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
    `img-src 'self' data: blob:; script-src 'self' https://cdn.jsdelivr.net ${empreintesImportmap().join(' ')}; ` +
    "connect-src 'self'; worker-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
}

// ---------- Temps réel (Server-Sent Events) ----------

const abonnes = new Set();
function diffuser(evenement, donnees) {
  const morceau = `event: ${evenement}\ndata: ${JSON.stringify(donnees)}\n\n`;
  for (const res of abonnes) { try { res.write(morceau); } catch { abonnes.delete(res); } }
}
setInterval(() => { for (const res of abonnes) { try { res.write(': ping\n\n'); } catch { abonnes.delete(res); } } }, 20000).unref();

// Identité de l'espace : data/identite.json est prioritaire sur NOM_OUTIL / NOM_AGENT du service.
espace.init({
  nomOutil: NOM_OUTIL, nomAgent: NOM_AGENT,
  surChangementNom: (nom) => agent.changerNomAgent(nom),
});
agent.init({
  diffuser, nomAgent: espace.identite().nomAgent,
  surFinAutomatisation: (id, fin) => automatisations.finir(id, fin),
  ligneAutomatisations: () => automatisations.ligneAgent(),
});
// Le planificateur des automatisations : toutes les 15 s, les automatisations actives arrivées à échéance
// partent dans la file de l'agent (sans rattrapage des passages manqués pendant un arrêt).
automatisations.init({ diffuser, lancer: (a) => agent.envoyerAutomatisation(a) });

// Les cartes « À valider » sont créées par app/mcp-plateforme.js (autre processus) : on surveille le fichier
// et on prévient les pages (onglet « À valider », « ! » de la scène 3D).
function signalerValidations() {
  let n = 0;
  try { n = validations.nombreEnAttente(); } catch { return; }
  diffuser('validations', { enAttente: n });
}
fs.watchFile(validations.FICHIER, { interval: 1000 }, (cur, prev) => { if (cur.mtimeMs !== prev.mtimeMs) signalerValidations(); });

// État de la mise en route et voyants du système.
// Étape 4 (« Lui confier une première mission automatique ») : cochée dès qu'une automatisation est active.
function etatSysteme() {
  const claude = agent.etatClaude();
  const contexte = espace.missionRemplie(); // « Sa mission » de CONTEXTE.md n'est plus « À compléter »
  const nbConnexions = connexions.nombreQuiMarchent(); // connexions dont le dernier test a réussi
  const nbAutomatisations = automatisations.actives().length; // automatisations actives
  const prochaine = automatisations.prochaine();               // { nom, quand, texte } ou null
  const etapes = [
    { id: 'claude', titre: 'Connecter Claude', disponible: true, fait: claude.connecte },
    { id: 'contexte', titre: 'Donner son contexte à l\'agent', disponible: true, fait: contexte },
    { id: 'outil', titre: 'Brancher un premier outil (MCP ou clé API)', disponible: true, fait: nbConnexions > 0 },
    { id: 'mission', titre: 'Lui confier une première mission automatique', disponible: true, fait: nbAutomatisations > 0 },
  ];
  return {
    claude,
    agent: agent.statut(),
    mode: validations.mode(),
    validations: { enAttente: validations.nombreEnAttente() },
    miseEnRoute: { etapes, terminee: etapes.every((e) => e.fait) },
    voyants: {
      claude: { disponible: true, ok: claude.connecte, texte: claude.connecte ? 'Connecté' : 'Non connecté' },
      contexte: { disponible: true, ok: contexte, texte: contexte ? 'Mission définie' : 'Mission à compléter' },
      connexions: {
        disponible: true, ok: nbConnexions > 0,
        texte: nbConnexions === 0 ? 'Aucune connexion qui marche' : (nbConnexions === 1 ? '1 connexion qui marche' : `${nbConnexions} connexions qui marchent`),
      },
      automatisation: {
        disponible: true, ok: Boolean(prochaine),
        texte: prochaine ? `${prochaine.nom} · ${prochaine.texte}` : 'Aucune automatisation active',
        quand: prochaine ? prochaine.quand : null,
      },
    },
  };
}

function json(res, code, objet, entetes = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...entetes });
  res.end(JSON.stringify(objet));
}

function rediriger(res, vers) {
  res.writeHead(302, { Location: vers, 'Cache-Control': 'no-store' });
  res.end();
}

// Corps brut (envoi d'un fichier).
function lireBrut(req, max) {
  return new Promise((resolve, reject) => {
    const annonce = parseInt(req.headers['content-length'] || '0', 10);
    if (annonce > max) { reject(new Error('trop gros')); req.resume(); return; }
    let taille = 0;
    const morceaux = [];
    req.on('data', (m) => {
      taille += m.length;
      if (taille > max) { reject(new Error('trop gros')); req.destroy(); return; }
      morceaux.push(m);
    });
    req.on('end', () => resolve(Buffer.concat(morceaux)));
    req.on('error', reject);
  });
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

// Pages et fichiers de app/public : « Cache-Control: no-cache » + ETag (taille + date de modification).
// Le navigateur redemande toujours au serveur ; si le fichier n'a pas changé, réponse 304 (rien à retélécharger).
// Une actualisation normale affiche donc toujours la dernière version.
function servirFichier(res, chemin, req) {
  const complet = path.normalize(path.join(PUBLIC, chemin));
  if (!complet.startsWith(PUBLIC + path.sep)) return json(res, 404, { erreur: 'Introuvable' });
  fs.stat(complet, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('Page introuvable');
    }
    const type = TYPES[path.extname(complet).toLowerCase()] || 'application/octet-stream';
    const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const entetes = { 'Cache-Control': 'no-cache', ETag: etag, 'Last-Modified': st.mtime.toUTCString() };
    const demande = req && req.headers['if-none-match'];
    if (demande && demande.split(',').map((e) => e.trim().replace(/^W\//, '')).includes(etag)) {
      res.writeHead(304, entetes);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, ...entetes });
    if (req && req.method === 'HEAD') return res.end();
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

  // Routes publiques : la marque (nom de l'espace, de l'agent, initiale, badge, logo) et le logo.
  if (chemin === '/api/marque' && methode === 'GET') return json(res, 200, espace.marque());
  if (chemin === '/api/logo' && (methode === 'GET' || methode === 'HEAD')) return espace.servirLogo(res);

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
    return servirFichier(res, chemin, req);
  }

  // Tout le reste exige d'être connecté.
  const session = utilisateurConnecte(req);
  // Retour d'une autorisation OAuth sans session : on renvoie vers la connexion (le state reste valable 10 min).
  if (!session && chemin === '/api/oauth/retour') return rediriger(res, '/connexion.html');
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

  const estAdmin = session.compte.role === 'admin';

  if (chemin === '/api/etat' && methode === 'GET') return json(res, 200, etatSysteme());

  if (chemin === '/api/discussion' && methode === 'GET') return json(res, 200, agent.discussion());

  if (chemin === '/api/flux' && methode === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });
    res.write('retry: 3000\n\n');
    res.write(`event: etat\ndata: ${JSON.stringify({ agent: agent.statut(), claude: agent.etatClaude(), enCours: agent.enCours() })}\n\n`);
    abonnes.add(res);
    req.on('close', () => abonnes.delete(res));
    return;
  }

  // Envois de fichiers (corps brut) : en-tête X-Nom-Fichier obligatoire. Un autre site ne peut pas
  // poser cet en-tête sans autorisation CORS : même protection que l'exigence de JSON ci-dessous.
  const ENVOIS = new Set(['/api/identite/logo', '/api/documents', '/api/joindre']);
  if (methode === 'POST' && ENVOIS.has(chemin)) {
    if (!req.headers['x-nom-fichier']) return json(res, 415, { erreur: 'Envoi de fichier attendu.' });
    let nom;
    try { nom = decodeURIComponent(String(req.headers['x-nom-fichier'])); } catch { return json(res, 400, { erreur: 'Nom de fichier invalide.' }); }
    if (chemin === '/api/identite/logo') {
      if (!estAdmin) return json(res, 403, { erreur: 'Seul un admin peut changer le logo.' });
      let buf;
      try { buf = await lireBrut(req, espace.MAX_LOGO); } catch { return json(res, 413, { erreur: 'Le logo dépasse 2 Mo.' }); }
      const r = espace.enregistrerLogo(buf);
      if (r.erreur) return json(res, 400, r);
      console.log(`Logo changé par ${session.compte.email}.`);
      diffuser('marque', r.marque);
      return json(res, 200, r);
    }
    // Documents (Réglages, admin) ou fichier joint à un message (trombone, tout compte connecté).
    if (chemin === '/api/documents' && !estAdmin) return json(res, 403, { erreur: 'Seul un admin peut déposer des documents.' });
    let buf;
    try { buf = await lireBrut(req, espace.MAX_DOCUMENT); } catch { return json(res, 413, { erreur: 'Le fichier dépasse 20 Mo.' }); }
    const r = espace.deposer(nom, buf);
    const { code, ...reste } = r;
    if (r.ok) console.log(`Document déposé par ${session.compte.email} : ${r.document.nom}`);
    return json(res, code, reste);
  }

  if (methode === 'POST' && chemin.startsWith('/api/')) {
    // Les envois de l'interface sont toujours en JSON (protection contre les formulaires d'autres sites).
    if (!String(req.headers['content-type'] || '').includes('application/json')) {
      return json(res, 415, { erreur: 'Format attendu : JSON' });
    }
  }

  // ----- Identité de l'espace -----
  if (chemin === '/api/identite' && methode === 'POST') {
    if (!estAdmin) return json(res, 403, { erreur: 'Seul un admin peut modifier l\'identité.' });
    let corps;
    try { corps = await lireCorps(req); } catch { return json(res, 413, { erreur: 'Requête trop grosse' }); }
    const r = espace.changerIdentite(corps);
    if (r.erreur) return json(res, 400, r);
    console.log(`Identité modifiée par ${session.compte.email}.`);
    diffuser('marque', r.marque);
    return json(res, 200, r);
  }
  if (chemin === '/api/identite/logo/retirer' && methode === 'POST') {
    if (!estAdmin) return json(res, 403, { erreur: 'Seul un admin peut retirer le logo.' });
    const r = espace.retirerLogo();
    diffuser('marque', r.marque);
    return json(res, 200, r);
  }

  // ----- Contexte et mémoire (seuls CONTEXTE.md, memoire.md, regles.md, CLAUDE.md) -----
  if (chemin === '/api/contexte' && methode === 'GET') return json(res, 200, { ...espace.lireContexte(), admin: estAdmin });
  if (chemin === '/api/contexte/remplir' && methode === 'GET') return json(res, 200, agent.etatRemplissage());
  if (chemin === '/api/contexte/remplir' && methode === 'POST') {
    if (!estAdmin) return json(res, 403, { erreur: 'Seul un admin peut remplir le contexte.' });
    let corps;
    try { corps = await lireCorps(req); } catch { return json(res, 413, { erreur: 'Adresse trop longue' }); }
    const r = agent.remplirDepuisSite(corps.url, espace.MODELE_CONTEXTE);
    const { code, ...reste } = r;
    return json(res, code, reste);
  }
  if (chemin === '/api/contexte/remplir/annuler' && methode === 'POST') {
    if (!estAdmin) return json(res, 403, { erreur: 'Réservé aux admins.' });
    return json(res, 200, agent.annulerRemplissage());
  }
  const mContexte = chemin.match(/^\/api\/contexte\/(contexte|memoire|regles|fiche)$/);
  if (mContexte && methode === 'POST') {
    if (!estAdmin) return json(res, 403, { erreur: 'Seul un admin peut modifier ces fichiers.' });
    let corps;
    try { corps = await lireCorps(req, 400 * 1024); } catch { return json(res, 413, { erreur: 'Texte trop long (200 Ko au maximum).' }); }
    const r = espace.ecrireContexte(mContexte[1], corps.contenu);
    const { code, ...reste } = r;
    if (r.ok) {
      console.log(`${mContexte[1]} modifié par ${session.compte.email}.`);
      diffuser('contexte', { id: mContexte[1], missionRemplie: r.missionRemplie });
    }
    return json(res, code, reste);
  }

  // ----- Documents déposés et fichiers de l'agent -----
  if (chemin === '/api/documents' && methode === 'GET') return json(res, 200, { documents: espace.lister('documents'), admin: estAdmin });
  if (chemin === '/api/fichiers' && methode === 'GET') return json(res, 200, { fichiers: espace.lister('work'), admin: estAdmin });
  if ((chemin === '/api/documents/supprimer' || chemin === '/api/fichiers/supprimer') && methode === 'POST') {
    if (!estAdmin) return json(res, 403, { erreur: 'Seul un admin peut supprimer un fichier.' });
    let corps;
    try { corps = await lireCorps(req); } catch { return json(res, 413, { erreur: 'Requête trop grosse' }); }
    const dossier = chemin === '/api/documents/supprimer' ? 'documents' : 'work';
    const r = espace.supprimer(dossier, corps.nom);
    const { code, ...reste } = r;
    if (r.ok) console.log(`Fichier supprimé par ${session.compte.email} : ${dossier}/${corps.nom}`);
    return json(res, code, reste);
  }
  if (chemin === '/api/telecharger' && methode === 'GET') {
    const dossier = url.searchParams.get('dossier');
    if (dossier !== 'work' && dossier !== 'documents') return json(res, 404, { erreur: 'Introuvable' });
    return espace.servirFichier(res, dossier, url.searchParams.get('nom'), url.searchParams.get('apercu') === '1');
  }

  // ----- Skills (agent/.claude/skills/<identifiant>/SKILL.md) : lecture pour tous, modification admin -----
  if (chemin === '/api/skills' && methode === 'GET') return json(res, 200, { skills: skills.lister(), admin: estAdmin });
  if (chemin === '/api/skills' && methode === 'POST') {
    if (!estAdmin) return json(res, 403, { erreur: 'Seul un admin peut créer ou modifier un skill.' });
    let corps;
    try { corps = await lireCorps(req, 128 * 1024); } catch { return json(res, 413, { erreur: 'Skill trop long.' }); }
    const r = skills.enregistrer(corps);
    const { code, ...reste } = r;
    if (r.ok) {
      console.log(`Skill ${corps.ancien ? 'modifié' : 'créé'} par ${session.compte.email} : ${r.skill.id}`);
      diffuser('skills', {});
    }
    return json(res, code, reste);
  }
  if (chemin === '/api/skills/supprimer' && methode === 'POST') {
    if (!estAdmin) return json(res, 403, { erreur: 'Seul un admin peut supprimer un skill.' });
    let corps;
    try { corps = await lireCorps(req); } catch { return json(res, 413, { erreur: 'Requête trop grosse' }); }
    const r = skills.supprimer(corps.id);
    const { code, ...reste } = r;
    if (r.ok) { console.log(`Skill supprimé par ${session.compte.email} : ${corps.id}`); diffuser('skills', {}); }
    return json(res, code, reste);
  }

  // ----- Mode de l'agent (« Propose » / « Agit seul ») : lecture pour tous, changement admin -----
  if (chemin === '/api/reglages' && methode === 'GET') return json(res, 200, validations.reglages());
  if (chemin === '/api/reglages/mode' && methode === 'POST') {
    if (!estAdmin) return json(res, 403, { erreur: 'Seul un admin peut changer le mode de l\'agent.' });
    let corps;
    try { corps = await lireCorps(req); } catch { return json(res, 413, { erreur: 'Requête trop grosse' }); }
    const r = validations.changerMode(String(corps.mode || ''), session.compte);
    const { code, ...reste } = r;
    if (r.ok) { console.log(`Mode de l'agent : ${r.reglages.mode} (par ${session.compte.email}).`); diffuser('reglages', r.reglages); }
    return json(res, code, reste);
  }

  // ----- Automatisations : lecture pour tous, création / modification / lancement réservés aux admins -----
  if (chemin === '/api/automatisations' && methode === 'GET') return json(res, 200, { ...automatisations.lister(), admin: estAdmin });
  if (chemin.startsWith('/api/automatisations') && methode === 'POST') {
    if (!estAdmin) return json(res, 403, { erreur: 'Seul un admin peut gérer les automatisations.' });
    let corps;
    try { corps = await lireCorps(req, 32 * 1024); } catch { return json(res, 413, { erreur: 'Requête trop grosse' }); }
    let r;
    if (chemin === '/api/automatisations') {
      r = corps.id ? automatisations.modifier(corps.id, corps) : automatisations.creer(corps, session.compte, { actif: Boolean(corps.actif) });
    } else if (chemin === '/api/automatisations/modele') r = automatisations.ajouterModele(corps.modele, session.compte);
    else if (chemin === '/api/automatisations/actif') r = automatisations.changerActif(corps.id, corps.actif);
    else if (chemin === '/api/automatisations/lancer') r = automatisations.lancer(corps.id, 'manuel');
    else if (chemin === '/api/automatisations/supprimer') r = automatisations.supprimer(corps.id);
    else return json(res, 404, { erreur: 'Introuvable' });
    if (r.ok) console.log(`Automatisations : ${chemin.split('/').pop()} par ${session.compte.email}.`);
    const { code, ...reste } = r;
    return json(res, code || 200, reste);
  }

  // ----- Cartes « À valider » : réservées aux admins -----
  if (chemin.startsWith('/api/validations')) {
    if (!estAdmin) return json(res, 403, { erreur: 'Seul un admin peut voir et décider des validations.' });
    if (chemin === '/api/validations' && methode === 'GET') return json(res, 200, validations.lister());
    if (methode !== 'POST') return json(res, 405, { erreur: 'Méthode non autorisée' });
    let corps;
    try { corps = await lireCorps(req, 64 * 1024); } catch { return json(res, 413, { erreur: 'Contenu trop long' }); }
    const n = parseInt(corps.n, 10);
    const qui = prenom(session.compte.nom) || session.compte.email;
    let r;
    if (chemin === '/api/validations/valider') {
      if (!agent.etatClaude().connecte) return json(res, 409, { erreur: 'Claude n\'est pas connecté : l\'agent ne peut pas exécuter l\'action.' });
      r = validations.valider(n, typeof corps.contenu === 'string' ? corps.contenu : null, session.compte);
      if (r.ok) {
        const c = r.carte;
        console.log(`Validation n°${c.n} accordée par ${session.compte.email}.`);
        const envoi = agent.envoyerDecision(`Validation n°${c.n} accordée par ${qui}. Exécute exactement cette action, rien d'autre : ${c.contenuFinal}. Puis confirme en une phrase.`, session.compte, c.n, { validation: c.n });
        if (!envoi.ok) {
          validations.finir(c.n, false, envoi.erreur);
          r = { code: envoi.code, erreur: envoi.erreur };
        }
      }
    } else if (chemin === '/api/validations/activer') {
      // Carte « Automatisation » proposée par l'agent : l'automatisation est créée et activée.
      r = validations.activer(n, session.compte, (p) => automatisations.creer(p, session.compte, { actif: true, origine: 'agent' }));
      if (r.ok) console.log(`Automatisation de la carte n°${r.carte.n} activée par ${session.compte.email}.`);
    } else if (chemin === '/api/validations/refuser') {
      r = validations.refuser(n, corps.motif, session.compte);
      // Une proposition d'automatisation refusée ne relance pas l'agent (pas de consommation inutile).
      if (r.ok && r.carte.type === 'automatisation') console.log(`Proposition d'automatisation n°${r.carte.n} refusée par ${session.compte.email}.`);
      else if (r.ok) {
        const c = r.carte;
        console.log(`Validation n°${c.n} refusée par ${session.compte.email}.`);
        const motif = c.motif ? `Motif : ${c.motif}` : 'Aucun motif donné.';
        agent.envoyerDecision(`Validation n°${c.n} refusée par ${qui} (« ${c.titre} »). ${motif} Ne fais pas cette action. Si ce motif est utile pour la suite, retiens-le dans ta mémoire. Réponds en une phrase.`, session.compte, c.n);
      }
    } else if (chemin === '/api/validations/supprimer') {
      r = validations.supprimer(Array.isArray(corps.numeros) ? corps.numeros : []);
      if (r.ok) console.log(`${r.supprimees} carte(s) de validation supprimée(s) par ${session.compte.email}.`);
    } else return json(res, 404, { erreur: 'Introuvable' });
    signalerValidations();
    const { code, ...reste } = r;
    return json(res, code || 200, reste);
  }

  // ----- Connexions (outils externes) : réservées aux admins -----
  // Retour d'une autorisation OAuth (navigation du navigateur, donc GET) : échange du code côté serveur,
  // puis retour au bureau. Les jetons ne sont jamais renvoyés au navigateur.
  if (chemin === '/api/oauth/retour' && methode === 'GET') {
    if (!estAdmin) return rediriger(res, '/?oauth=erreur&message=' + encodeURIComponent('Seul un admin peut connecter un outil.'));
    const r = await connexions.retourOAuth(url.searchParams, session.cle);
    const q = new URLSearchParams({ oauth: r.ok ? 'ok' : 'erreur' });
    if (r.nom) q.set('nom', r.nom);
    if (!r.ok) q.set('message', r.erreur);
    diffuser('connexions', {});
    if (r.ok) {
      // Test tout de suite (initialize + tools/list) : la mise en route et le voyant suivent.
      connexions.tester(r.nom).then(() => diffuser('connexions', {})).catch(() => {});
    }
    return rediriger(res, '/?' + q.toString());
  }
  if (chemin.startsWith('/api/connexions')) {
    if (!estAdmin) return json(res, 403, { erreur: 'Seul un admin peut gérer les connexions.' });
    if (chemin === '/api/connexions' && methode === 'GET') return json(res, 200, { connexions: connexions.lister(), retour: connexions.RETOUR });
    if (methode !== 'POST') return json(res, 405, { erreur: 'Méthode non autorisée' });
    let corps;
    try { corps = await lireCorps(req, 16 * 1024); } catch { return json(res, 413, { erreur: 'Requête trop grosse' }); }
    let r;
    if (chemin === '/api/connexions') r = await connexions.creer(corps, session.compte, session.cle);
    else if (chemin === '/api/connexions/tester') { const t = await connexions.tester(corps.nom); r = { code: 200, ...t }; }
    else if (chemin === '/api/connexions/reconnecter') r = await connexions.reconnecter(corps.nom, session.cle);
    else if (chemin === '/api/connexions/ecriture') r = connexions.changerEcriture(corps.nom, corps.ecriture);
    else if (chemin === '/api/connexions/actions') r = connexions.changerAction(corps.nom, corps.outil, corps.action);
    else if (chemin === '/api/connexions/supprimer') {
      r = connexions.supprimer(corps.nom);
      if (r.ok) console.log(`Connexion ${String(corps.nom)} supprimée par ${session.compte.email}.`);
    } else return json(res, 404, { erreur: 'Introuvable' });
    const { code, ...reste } = r;
    diffuser('connexions', {});
    return json(res, code || 200, reste);
  }

  if (chemin === '/api/message' && methode === 'POST') {
    let corps;
    try { corps = await lireCorps(req, 128 * 1024); } catch { return json(res, 413, { erreur: 'Message trop long' }); }
    const fichier = corps.fichier ? String(corps.fichier) : null;
    const r = agent.envoyer(corps.texte, session.compte, fichier, corps.skill ? String(corps.skill) : null);
    const { code, ...reste } = r;
    return json(res, code, reste);
  }

  if (chemin === '/api/arreter' && methode === 'POST') return json(res, 200, { ok: true, arrete: agent.arreter() });

  if (chemin === '/api/nouvelle' && methode === 'POST') return json(res, 200, { ok: true, ...agent.nouvelleDiscussion(session.compte) });

  if (chemin === '/api/claude/connecter' && methode === 'POST') {
    if (!estAdmin) return json(res, 403, { erreur: 'Seul un admin peut connecter Claude.' });
    let corps;
    try { corps = await lireCorps(req); } catch { return json(res, 413, { erreur: 'Clé trop longue' }); }
    const r = await agent.connecterClaude(corps.cle, session.compte);
    return json(res, r.ok ? 200 : 400, r);
  }

  // Connexion sans Terminal : le serveur lance claude setup-token et renvoie le lien d'autorisation.
  if (chemin === '/api/claude/lien' && methode === 'POST') {
    if (!estAdmin) return json(res, 403, { erreur: 'Seul un admin peut connecter Claude.' });
    const r = await agent.demarrerConnexion(session.compte);
    return json(res, r.ok ? 200 : 400, r);
  }

  // Puis la page envoie le code copié chez Claude : le serveur l'échange contre la clé, la teste et l'enregistre.
  if (chemin === '/api/claude/code' && methode === 'POST') {
    if (!estAdmin) return json(res, 403, { erreur: 'Seul un admin peut connecter Claude.' });
    let corps;
    try { corps = await lireCorps(req); } catch { return json(res, 413, { erreur: 'Code trop long' }); }
    const r = await agent.finirConnexion(corps.code, session.compte);
    return json(res, r.ok ? 200 : 400, r);
  }

  if (chemin === '/api/claude/deconnecter' && methode === 'POST') {
    if (!estAdmin) return json(res, 403, { erreur: 'Seul un admin peut déconnecter Claude.' });
    return json(res, 200, { ok: true, claude: agent.deconnecterClaude(session.compte) });
  }

  if (chemin.startsWith('/api/')) return json(res, 404, { erreur: 'Introuvable' });

  if (methode !== 'GET' && methode !== 'HEAD') return json(res, 405, { erreur: 'Méthode non autorisée' });
  return servirFichier(res, chemin === '/' ? '/index.html' : chemin, req);
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
