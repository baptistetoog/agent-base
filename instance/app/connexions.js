'use strict';
// connexions.js — les outils externes branchés à l'agent (Réglages › Connexions, admin).
//
// Trois types :
//   oauth : serveur MCP avec connexion par compte (OAuth 2.1 : découverte, enregistrement
//           automatique du client, PKCE S256, paramètre resource, state à usage unique lié à la session).
//   jeton : serveur MCP avec un jeton fixe (en-tête + préfixe + jeton).
//   api   : API avec une clé, exposée à l'agent par app/mcp-api.js (lire_api, appel_api).
//
// Les secrets sont rangés dans data/connexions.json et data/oauth/<nom>.json (600) et ne sortent
// jamais en entier : le navigateur ne voit que les 4 derniers caractères. Rien de secret dans les journaux.
// L'agent ne les voit jamais : Claude lance app/mcp-pont.js ou app/mcp-api.js avec le seul NOM de la
// connexion ; ces petits programmes relisent eux-mêmes le secret dans data/ (interdit à l'agent).

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const DATA = path.join(RACINE, 'data');
const FICHIER = path.join(DATA, 'connexions.json');
const DOSSIER_OAUTH = path.join(DATA, 'oauth');
const PONT = path.join(__dirname, 'mcp-pont.js');
const API = path.join(__dirname, 'mcp-api.js');

const DOMAINE = process.env.DOMAINE || 'agentforma.toog-expertise.app';
const RETOUR = `https://${DOMAINE}/api/oauth/retour`;
const NOM_VALIDE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NOMS_RESERVES = new Set(['approbation', 'plateforme', 'claude', 'ide']);
const TYPES = { oauth: 'Serveur MCP (connexion par compte, OAuth)', jeton: 'Serveur MCP (avec un jeton)', api: 'API avec clé' };
const DUREE_STATE = 10 * 60 * 1000;   // une autorisation doit être terminée en 10 minutes
const DUREE_TEST = 45 * 1000;
const DELAI_HTTP = 15 * 1000;

// ---------- Fichiers ----------

function lireJSON(fichier, defaut) {
  try { return JSON.parse(fs.readFileSync(fichier, 'utf8')); } catch { return defaut; }
}
function ecrireJSON(fichier, valeur) {
  const tmp = fichier + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(valeur, null, 2), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, fichier);
}
function charger() {
  const d = lireJSON(FICHIER, { connexions: [] });
  return Array.isArray(d.connexions) ? d.connexions : [];
}
function sauver(liste) { ecrireJSON(FICHIER, { connexions: liste }); }
function fichierOAuth(nom) { return path.join(DOSSIER_OAUTH, nom + '.json'); }
function lireOAuth(nom) { return lireJSON(fichierOAuth(nom), null); }
function ecrireOAuth(nom, valeur) {
  if (!fs.existsSync(DOSSIER_OAUTH)) fs.mkdirSync(DOSSIER_OAUTH, { mode: 0o700, recursive: true });
  ecrireJSON(fichierOAuth(nom), valeur);
}
function trouver(nom) { return charger().find((c) => c.nom === nom) || null; }
function majConnexion(nom, champs) {
  const liste = charger();
  const c = liste.find((x) => x.nom === nom);
  if (!c) return null;
  Object.assign(c, champs);
  sauver(liste);
  return c;
}

// ---------- Vérifications des saisies ----------

function nettoyerNom(brut) { return String(brut || '').trim().toLowerCase(); }

function verifierNom(nom) {
  if (!nom) return 'Donnez un nom à la connexion.';
  if (nom.length > 40 || !NOM_VALIDE.test(nom)) return 'Nom invalide : minuscules, chiffres et tirets seulement (ex. notion ou crm-clients).';
  if (NOMS_RESERVES.has(nom)) return `Le nom « ${nom} » est réservé : choisissez-en un autre.`;
  return null;
}

function verifierURL(brut) {
  let u;
  try { u = new URL(String(brut || '').trim()); } catch { return { erreur: 'Adresse invalide : elle doit commencer par https://' }; }
  if (u.protocol !== 'https:') return { erreur: 'L\'adresse doit commencer par https://' };
  if (u.username || u.password) return { erreur: 'L\'adresse ne doit pas contenir d\'identifiant : mettez la clé dans le champ prévu.' };
  u.hash = '';
  return { url: u.toString() };
}

function verifierEntete(brut, defaut) {
  const e = String(brut || '').trim() || defaut;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(e)) return { erreur: 'Nom d\'en-tête invalide (lettres, chiffres et tirets, ex. Authorization ou X-API-Key).' };
  return { entete: e };
}

function verifierPrefixe(brut) {
  const p = String(brut === undefined || brut === null ? '' : brut).trim();
  if (p.length > 30 || /[^A-Za-z0-9 _.-]/.test(p)) return { erreur: 'Préfixe invalide (ex. Bearer, ou laissez vide).' };
  return { prefixe: p };
}

function verifierSecret(brut, quoi) {
  const s = String(brut || '').trim();
  if (!s) return { erreur: `Collez ${quoi}.` };
  if (s.length > 4096 || /[\r\n\0]/.test(s)) return { erreur: `${quoi[0].toUpperCase() + quoi.slice(1)} semble abîmé(e) : recopiez-le en entier.` };
  return { secret: s };
}

function finSecret(s) {
  const t = String(s || '');
  return t ? '••••' + t.slice(-4) : null;
}

// Masque toutes les valeurs secrètes connues dans un texte (messages d'erreur, sorties des ponts).
function masquerTexte(texte, secrets) {
  let t = String(texte || '');
  for (const s of secrets) {
    if (s && String(s).length >= 6) t = t.split(String(s)).join('***');
  }
  return t.replace(/(bearer\s+)[A-Za-z0-9._~+\/=-]{12,}/gi, '$1***');
}

// ---------- Le tri des outils : lecture (libre) ou action (à valider) ----------
// Un outil est pré-coché « Action » si son nom (ou, à défaut d'un verbe de lecture dans le nom,
// sa description) parle d'écrire. Les outils de lecture restent libres. L'admin peut corriger :
// le tri est enregistré par connexion (champ « actions » : { outil: true|false }).
// Pour une « API avec clé » : appel_api est toujours une action, lire_api toujours libre (non modifiables).

const MOTS_ECRITURE = ['create', 'update', 'delete', 'del', 'reply', 'post', 'publish', 'send', 'add', 'remove', 'patch', 'upload',
  'write', 'edit', 'insert', 'put', 'set', 'modify', 'move', 'rename', 'archive', 'cancel', 'comment', 'invite', 'share', 'submit',
  'assign', 'schedule', 'trigger', 'execute', 'run', 'append', 'replace', 'merge', 'close', 'approve', 'book', 'pay', 'charge',
  'refund', 'transfer', 'import', 'sync', 'save', 'store', 'notify', 'duplicate', 'restore', 'deploy', 'push', 'commit',
  'start', 'stop', 'reset', 'grant', 'revoke', 'enable', 'disable', 'launch', 'order', 'buy',
  'creer', 'modifier', 'supprimer', 'envoyer', 'publier', 'ajouter', 'retirer', 'repondre', 'ecrire', 'appel'];
const MOTS_LECTURE = ['get', 'list', 'search', 'find', 'read', 'fetch', 'query', 'lookup', 'view', 'show', 'describe', 'count',
  'retrieve', 'download', 'export', 'check', 'browse', 'lire', 'chercher', 'lister', 'voir'];

function mots(texte) {
  return String(texte || '').replace(/([a-z])([A-Z])/g, '$1 $2').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
function estActionParDefaut(nom, description) {
  const m = mots(nom);
  // Le premier verbe du nom décide (get_post = lecture, create_post = action)…
  const verbe = m.find((x) => MOTS_ECRITURE.includes(x) || MOTS_LECTURE.includes(x));
  if (verbe) return MOTS_ECRITURE.includes(verbe);
  // … sinon la description.
  const d = mots(description);
  return d.some((x) => MOTS_ECRITURE.includes(x) || MOTS_ECRITURE.includes(x.replace(/(e?s|ed|ing)$/, '')));
}
// Outils fixés pour le type « api ».
function triFixe(c, outil) {
  if (c.type !== 'api') return null;
  if (outil === 'appel_api') return true;
  if (outil === 'lire_api') return false;
  return null;
}
// Liste des outils d'une connexion avec leur tri. Type api : lire_api toujours, appel_api si l'écriture est autorisée.
function outilsTries(c) {
  let noms = Array.isArray(c.outils) ? c.outils.slice() : [];
  if (c.type === 'api') noms = ['lire_api', ...(c.ecriture ? ['appel_api'] : [])];
  const desc = c.descriptions || {};
  const actions = c.actions || {};
  return noms.map((nom) => {
    const fixe = triFixe(c, nom);
    const action = fixe !== null ? fixe : (typeof actions[nom] === 'boolean' ? actions[nom] : estActionParDefaut(nom, desc[nom]));
    return { nom, description: desc[nom] || (c.type === 'api' ? (nom === 'appel_api' ? 'Appel en écriture (POST, PUT, PATCH, DELETE).' : 'Lecture (GET).') : ''), action, verrouille: fixe !== null };
  });
}
// Après un test réussi : on garde le tri déjà fait, on pré-trie les nouveaux outils.
function trierApresTest(c, outils) {
  const actions = {};
  const descriptions = {};
  for (const o of outils) {
    descriptions[o.nom] = o.description || '';
    const fixe = triFixe(c, o.nom);
    actions[o.nom] = fixe !== null ? fixe : (c.actions && typeof c.actions[o.nom] === 'boolean' ? c.actions[o.nom] : estActionParDefaut(o.nom, o.description));
  }
  return { actions, descriptions };
}
function changerAction(nomBrut, outil, action) {
  const c = trouver(nettoyerNom(nomBrut));
  if (!c) return { code: 404, erreur: 'Connexion introuvable.' };
  const o = String(outil || '');
  if (!outilsTries(c).some((x) => x.nom === o)) return { code: 404, erreur: 'Outil inconnu pour cette connexion : relancez « Tester ».' };
  if (triFixe(c, o) !== null) return { code: 400, erreur: o === 'appel_api' ? 'appel_api est toujours une action à valider.' : 'lire_api reste toujours libre.' };
  const actions = { ...(c.actions || {}), [o]: action === true };
  majConnexion(c.nom, { actions });
  return { code: 200, ok: true, connexion: vue(trouver(c.nom)) };
}
// Tous les outils « Action » des connexions actives, au format Claude Code (mcp__<connexion>__<outil>).
function outilsActions() {
  const res = [];
  for (const c of actives()) {
    for (const o of outilsTries(c)) if (o.action) res.push({ connexion: c.nom, outil: o.nom, complet: `mcp__${c.nom}__${o.nom}`, description: o.description });
  }
  return res;
}

// ---------- Vue publique (jamais de secret entier) ----------

function vue(c) {
  const o = c.type === 'oauth' ? lireOAuth(c.nom) : null;
  const v = {
    nom: c.nom, type: c.type, typeLibelle: TYPES[c.type], url: c.url,
    statut: c.statut || 'erreur', erreur: c.erreur || null,
    outils: Array.isArray(c.outils) ? c.outils : [],
    outilsTri: outilsTries(c),
    testeLe: c.testeLe || null, creeLe: c.creeLe || null, creePar: c.creePar || null,
  };
  if (c.type === 'jeton' || c.type === 'api') {
    v.entete = c.entete;
    v.prefixe = c.prefixe || '';
    v.secretFin = finSecret(c.secret);
  }
  if (c.type === 'api') v.ecriture = Boolean(c.ecriture);
  if (c.type === 'oauth') {
    v.connecteLe = (o && o.connecteLe) || null;
    v.jetonFin = o && o.jetons && o.jetons.access_token ? finSecret(o.jetons.access_token) : null;
    v.autorisationServeur = o && o.metadonnees ? o.metadonnees.issuer || null : null;
  }
  return v;
}

function lister() { return charger().map(vue); }

// Les connexions passées à l'agent : complètes (OAuth : jetons obtenus).
function actives() {
  return charger().filter((c) => {
    if (c.type === 'oauth') { const o = lireOAuth(c.nom); return Boolean(o && o.jetons && o.jetons.access_token); }
    return Boolean(c.secret && c.url);
  });
}

// Configuration MCP de chaque connexion active : seulement le programme et le NOM (aucun secret).
function serveursMCP() {
  const serveurs = {};
  for (const c of actives()) {
    serveurs[c.nom] = { type: 'stdio', command: process.execPath, args: [c.type === 'api' ? API : PONT, c.nom], env: { CONNEXION: c.nom } };
  }
  return serveurs;
}

function nombreQuiMarchent() { return charger().filter((c) => c.statut === 'connecte').length; }

// ---------- HTTP ----------

async function requete(url, options = {}) {
  const ctrl = new AbortController();
  const minuterie = setTimeout(() => ctrl.abort(), options.delai || DELAI_HTTP);
  try {
    return await fetch(url, { redirect: 'follow', ...options, signal: ctrl.signal, headers: { 'User-Agent': 'espace-agent/1.0', ...(options.headers || {}) } });
  } finally { clearTimeout(minuterie); }
}

async function lireJSONDistant(url) {
  try {
    const r = await requete(url, { headers: { Accept: 'application/json', 'MCP-Protocol-Version': '2025-06-18' } });
    if (!r.ok) return null;
    const t = await r.text();
    const o = JSON.parse(t);
    return o && typeof o === 'object' ? o : null;
  } catch { return null; }
}

function urlsBienConnues(base, suffixe) {
  // RFC 8414 / RFC 9728 : /.well-known/<suffixe><chemin>, puis /.well-known/<suffixe> à la racine.
  const u = new URL(base);
  const chemin = u.pathname.replace(/\/+$/, '');
  const liste = [];
  if (chemin) liste.push(`${u.origin}/.well-known/${suffixe}${chemin}`);
  liste.push(`${u.origin}/.well-known/${suffixe}`);
  return liste;
}

// ---------- OAuth : découverte ----------

async function decouvrir(urlServeur) {
  const trouve = { ressource: null, metadonnees: null, adresses: [] };
  // 1. Le serveur MCP peut annoncer ses métadonnées dans l'en-tête WWW-Authenticate d'une réponse 401.
  let annonce = null;
  try {
    const r = await requete(urlServeur, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'espace-agent', version: '1.0' } } }),
    });
    const www = r.headers.get('www-authenticate') || '';
    const m = www.match(/resource_metadata="?([^",\s]+)"?/i);
    if (m) annonce = m[1];
    try { await r.body?.cancel(); } catch { /* rien */ }
  } catch { /* le serveur ne répond pas : on essaie quand même les adresses connues */ }

  // 2. Métadonnées de la ressource protégée (/.well-known/oauth-protected-resource).
  const candidatsPR = [...(annonce ? [annonce] : []), ...urlsBienConnues(urlServeur, 'oauth-protected-resource')];
  for (const adr of candidatsPR) {
    const o = await lireJSONDistant(adr);
    if (o && Array.isArray(o.authorization_servers) && o.authorization_servers.length) {
      trouve.ressource = o; trouve.adresses.push(adr); break;
    }
  }

  // 3. Métadonnées du serveur d'autorisation : celui annoncé par la ressource, sinon l'origine du serveur MCP.
  const serveurAuth = trouve.ressource ? String(trouve.ressource.authorization_servers[0]) : new URL(urlServeur).origin;
  const candidatsAS = [...urlsBienConnues(serveurAuth, 'oauth-authorization-server'), ...urlsBienConnues(serveurAuth, 'openid-configuration')];
  for (const adr of candidatsAS) {
    const o = await lireJSONDistant(adr);
    if (o && o.authorization_endpoint && o.token_endpoint) { trouve.metadonnees = o; trouve.adresses.push(adr); break; }
  }
  return trouve;
}

function verifierEndpoint(brut) {
  try { const u = new URL(String(brut)); return u.protocol === 'https:' ? u.toString() : null; } catch { return null; }
}

// ---------- OAuth : préparation (découverte + enregistrement + lien) ----------

const attentes = new Map(); // state -> { nom, verifier, session, expire }

setInterval(() => {
  const t = Date.now();
  for (const [s, a] of attentes) if (a.expire < t) attentes.delete(s);
}, 60 * 1000).unref();

function base64url(buf) { return Buffer.from(buf).toString('base64url'); }

async function preparerOAuth(c, cleSession) {
  const d = await decouvrir(c.url);
  if (!d.metadonnees) {
    return { code: 400, erreur: 'Ce serveur ne propose pas la connexion par compte (aucune découverte OAuth trouvée). Essayez « Serveur MCP (avec un jeton) ».' };
  }
  const m = d.metadonnees;
  const autorisation = verifierEndpoint(m.authorization_endpoint);
  const jetonURL = verifierEndpoint(m.token_endpoint);
  if (!autorisation || !jetonURL) return { code: 400, erreur: 'Le serveur d\'autorisation annonce des adresses invalides (https obligatoire).' };
  const methodes = Array.isArray(m.code_challenge_methods_supported) ? m.code_challenge_methods_supported : null;
  if (methodes && !methodes.includes('S256')) return { code: 400, erreur: 'Ce serveur n\'accepte pas PKCE S256 : connexion impossible en toute sécurité.' };
  const ressource = (d.ressource && d.ressource.resource) ? String(d.ressource.resource) : c.url;

  // Client déjà enregistré pour ce serveur et cette adresse de retour : on le garde.
  const ancien = lireOAuth(c.nom);
  let client = ancien && ancien.client && ancien.metadonnees && ancien.metadonnees.issuer === m.issuer && ancien.retour === RETOUR ? ancien.client : null;
  if (!client) {
    const enregistrement = verifierEndpoint(m.registration_endpoint);
    if (!enregistrement) return { code: 400, erreur: 'Ce serveur ne permet pas l\'enregistrement automatique du client (Dynamic Client Registration) : connexion par compte impossible ici.' };
    let r, o;
    try {
      r = await requete(enregistrement, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_name: 'Espace agent (' + DOMAINE + ')',
          redirect_uris: [RETOUR],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        }),
      });
      o = await r.json().catch(() => null);
    } catch { return { code: 502, erreur: 'Le serveur d\'autorisation ne répond pas. Réessayez dans un instant.' }; }
    if (!r.ok || !o || !o.client_id) return { code: 502, erreur: `Enregistrement du client refusé par le serveur (HTTP ${r.status}).` };
    client = { client_id: String(o.client_id) };
    if (o.client_secret) client.client_secret = String(o.client_secret);
    if (o.token_endpoint_auth_method) client.methode = String(o.token_endpoint_auth_method);
  }

  const verifier = base64url(crypto.randomBytes(48));
  const defi = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(24));
  const lien = new URL(autorisation);
  lien.searchParams.set('response_type', 'code');
  lien.searchParams.set('client_id', client.client_id);
  lien.searchParams.set('redirect_uri', RETOUR);
  lien.searchParams.set('code_challenge', defi);
  lien.searchParams.set('code_challenge_method', 'S256');
  lien.searchParams.set('state', state);
  lien.searchParams.set('resource', ressource);
  const portees = d.ressource && Array.isArray(d.ressource.scopes_supported) ? d.ressource.scopes_supported : null;
  if (portees && portees.length) lien.searchParams.set('scope', portees.join(' '));

  ecrireOAuth(c.nom, {
    serveur: c.url, ressource, retour: RETOUR,
    decouverte: d.adresses,
    metadonnees: { issuer: m.issuer || null, authorization_endpoint: autorisation, token_endpoint: jetonURL, registration_endpoint: m.registration_endpoint || null },
    client,
    jetons: ancien && ancien.jetons ? ancien.jetons : null,
    connecteLe: ancien ? ancien.connecteLe || null : null,
  });
  attentes.set(state, { nom: c.nom, verifier, session: cleSession, expire: Date.now() + DUREE_STATE });
  return { code: 200, ok: true, lien: lien.toString(), decouverte: d.adresses, clientId: client.client_id, ressource };
}

// ---------- OAuth : retour (échange du code contre les jetons) ----------

async function demanderJetons(o, params) {
  const corps = new URLSearchParams(params);
  const entetes = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  if (o.client.client_secret && o.client.methode === 'client_secret_basic') {
    entetes.Authorization = 'Basic ' + Buffer.from(encodeURIComponent(o.client.client_id) + ':' + encodeURIComponent(o.client.client_secret)).toString('base64');
  } else {
    corps.set('client_id', o.client.client_id);
    if (o.client.client_secret) corps.set('client_secret', o.client.client_secret);
  }
  const r = await requete(o.metadonnees.token_endpoint, { method: 'POST', headers: entetes, body: corps.toString() });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.access_token) return { erreur: (j && (j.error_description || j.error)) || `HTTP ${r.status}` };
  return { jetons: j };
}

function rangerJetons(j, anciens) {
  return {
    access_token: String(j.access_token),
    refresh_token: j.refresh_token ? String(j.refresh_token) : (anciens && anciens.refresh_token) || null,
    token_type: j.token_type || 'Bearer',
    scope: j.scope || null,
    expire: j.expires_in ? Date.now() + Number(j.expires_in) * 1000 : null,
  };
}

// Renvoie { ok, nom, erreur } ; ne renvoie jamais de jeton.
async function retourOAuth(params, cleSession) {
  const state = String(params.get('state') || '');
  const a = state ? attentes.get(state) : null;
  if (!a) return { ok: false, erreur: 'Lien d\'autorisation inconnu, déjà utilisé ou expiré : recommencez depuis Connexions.' };
  attentes.delete(state); // usage unique, dans tous les cas
  if (a.expire < Date.now()) return { ok: false, nom: a.nom, erreur: 'L\'autorisation a pris plus de 10 minutes : recommencez.' };
  if (a.session !== cleSession) return { ok: false, nom: a.nom, erreur: 'Cette autorisation a été lancée depuis une autre session : recommencez depuis Connexions.' };
  if (params.get('error')) {
    majConnexion(a.nom, { statut: 'a-reconnecter', erreur: 'Autorisation refusée ou annulée.' });
    return { ok: false, nom: a.nom, erreur: 'Autorisation refusée ou annulée sur le site de l\'outil.' };
  }
  const code = String(params.get('code') || '');
  const o = lireOAuth(a.nom);
  if (!code || !o || !o.client) return { ok: false, nom: a.nom, erreur: 'Réponse incomplète du serveur d\'autorisation : recommencez.' };
  let r;
  try {
    r = await demanderJetons(o, { grant_type: 'authorization_code', code, redirect_uri: o.retour || RETOUR, code_verifier: a.verifier, resource: o.ressource });
  } catch { r = { erreur: 'le serveur ne répond pas' }; }
  if (r.erreur) {
    const msg = masquerTexte(String(r.erreur), [code, o.client.client_secret]).slice(0, 200);
    majConnexion(a.nom, { statut: 'a-reconnecter', erreur: 'Échange du code refusé : ' + msg });
    console.error(`Connexion ${a.nom} : échange du code refusé.`);
    return { ok: false, nom: a.nom, erreur: 'Le serveur a refusé l\'échange du code : recommencez.' };
  }
  o.jetons = rangerJetons(r.jetons, o.jetons);
  o.connecteLe = new Date().toISOString();
  ecrireOAuth(a.nom, o);
  majConnexion(a.nom, { statut: 'connecte', erreur: null });
  console.log(`Connexion ${a.nom} : connectée (OAuth).`);
  return { ok: true, nom: a.nom };
}

// ---------- Création, suppression, écriture ----------

async function creer(corps, compte, cleSession) {
  const type = String(corps.type || '');
  if (!TYPES[type]) return { code: 400, erreur: 'Choisissez le type de connexion.' };
  const nom = nettoyerNom(corps.nom);
  const pbNom = verifierNom(nom);
  if (pbNom) return { code: 400, erreur: pbNom, champ: 'nom' };
  if (trouver(nom)) return { code: 409, erreur: `Une connexion « ${nom} » existe déjà : choisissez un autre nom ou supprimez-la.`, champ: 'nom' };
  const u = verifierURL(corps.url);
  if (u.erreur) return { code: 400, erreur: u.erreur, champ: 'url' };
  const c = { nom, type, url: u.url, statut: 'a-reconnecter', erreur: null, outils: [], creeLe: new Date().toISOString(), creePar: compte.email };

  if (type === 'jeton' || type === 'api') {
    const e = verifierEntete(corps.entete, type === 'jeton' ? 'Authorization' : '');
    if (e.erreur || !e.entete) return { code: 400, erreur: e.erreur || 'Donnez le nom de l\'en-tête (ex. Authorization ou X-API-Key).', champ: 'entete' };
    const p = verifierPrefixe(corps.prefixe === undefined && type === 'jeton' ? 'Bearer' : corps.prefixe);
    if (p.erreur) return { code: 400, erreur: p.erreur, champ: 'prefixe' };
    const s = verifierSecret(corps.secret, type === 'jeton' ? 'le jeton' : 'la clé');
    if (s.erreur) return { code: 400, erreur: s.erreur, champ: 'secret' };
    Object.assign(c, { entete: e.entete, prefixe: p.prefixe, secret: s.secret, statut: 'erreur', erreur: 'Pas encore testée.' });
    if (type === 'api') {
      c.ecriture = corps.ecriture === true;
      // L'URL de base se termine par « / » pour que les chemins restent dessous.
      if (!c.url.endsWith('/')) c.url += '/';
    }
    const liste = charger();
    liste.push(c);
    sauver(liste);
    console.log(`Connexion ${nom} (${type}) ajoutée par ${compte.email}.`);
    const t = await tester(nom);
    return { code: 200, ok: true, connexion: vue(trouver(nom) || c), test: t };
  }

  // OAuth : on enregistre la connexion « à reconnecter », puis découverte + enregistrement + lien.
  const liste = charger();
  liste.push(c);
  sauver(liste);
  let r;
  try { r = await preparerOAuth(c, cleSession); } catch { r = { code: 502, erreur: 'Le serveur ne répond pas. Vérifiez l\'adresse et réessayez.' }; }
  if (!r.ok) {
    // Rien d'utilisable : on ne garde pas une connexion vide.
    supprimer(nom);
    return r;
  }
  console.log(`Connexion ${nom} (oauth) : autorisation lancée par ${compte.email}.`);
  return { code: 200, ok: true, connexion: vue(trouver(nom)), lien: r.lien, decouverte: r.decouverte, clientId: r.clientId };
}

async function reconnecter(nomBrut, cleSession) {
  const c = trouver(nettoyerNom(nomBrut));
  if (!c) return { code: 404, erreur: 'Connexion introuvable.' };
  if (c.type !== 'oauth') return { code: 400, erreur: 'Seules les connexions par compte se reconnectent. Pour changer un jeton ou une clé, supprimez puis rajoutez la connexion.' };
  let r;
  try { r = await preparerOAuth(c, cleSession); } catch { r = { code: 502, erreur: 'Le serveur ne répond pas. Réessayez.' }; }
  if (!r.ok) return r;
  return { code: 200, ok: true, lien: r.lien };
}

function supprimer(nomBrut) {
  const nom = nettoyerNom(nomBrut);
  if (verifierNom(nom) && !trouver(nom)) return { code: 404, erreur: 'Connexion introuvable.' };
  const liste = charger();
  const reste = liste.filter((c) => c.nom !== nom);
  if (reste.length === liste.length) return { code: 404, erreur: 'Connexion introuvable.' };
  sauver(reste);
  try { fs.unlinkSync(fichierOAuth(nom)); } catch { /* pas de fichier OAuth */ }
  for (const [s, a] of attentes) if (a.nom === nom) attentes.delete(s);
  return { code: 200, ok: true };
}

function changerEcriture(nomBrut, ecriture) {
  const c = trouver(nettoyerNom(nomBrut));
  if (!c) return { code: 404, erreur: 'Connexion introuvable.' };
  if (c.type !== 'api') return { code: 400, erreur: 'Seules les API avec clé ont ce réglage.' };
  majConnexion(c.nom, { ecriture: ecriture === true });
  return { code: 200, ok: true, connexion: vue(trouver(c.nom)) };
}

// ---------- Tester : lance le pont, initialize puis tools/list ----------

const testsEnCours = new Map();

function tester(nomBrut) {
  const nom = nettoyerNom(nomBrut);
  if (testsEnCours.has(nom)) return testsEnCours.get(nom);
  const p = testerVraiment(nom).finally(() => testsEnCours.delete(nom));
  testsEnCours.set(nom, p);
  return p;
}

function testerVraiment(nom) {
  const c = trouver(nom);
  if (!c) return Promise.resolve({ ok: false, erreur: 'Connexion introuvable.' });
  if (c.type === 'oauth') {
    const o = lireOAuth(nom);
    if (!o || !o.jetons || !o.jetons.access_token) {
      const erreur = `Pas encore connectée : cliquez sur « Reconnecter » pour autoriser l'accès.`;
      majConnexion(nom, { statut: 'a-reconnecter', erreur, testeLe: new Date().toISOString() });
      return Promise.resolve({ ok: false, statut: 'a-reconnecter', erreur });
    }
  }
  return new Promise((resolve) => {
    const programme = c.type === 'api' ? API : PONT;
    let proc;
    try {
      proc = spawn(process.execPath, [programme, nom], { cwd: RACINE, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: RACINE, CONNEXION: nom } });
    } catch { return resolve({ ok: false, erreur: 'Le pont ne démarre pas.' }); }
    let tampon = '', erreurs = '', fini = false;
    const conclure = (r) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuterie);
      try { proc.stdin.end(); } catch { /* rien */ }
      setTimeout(() => { try { proc.kill('SIGTERM'); } catch { /* rien */ } }, 300).unref();
      const testeLe = new Date().toISOString();
      if (r.ok) {
        const actuelle = trouver(nom) || c;
        const tri = trierApresTest(actuelle, r.outils);
        majConnexion(nom, { statut: 'connecte', erreur: null, outils: r.outils.map((o) => o.nom), ...tri, testeLe });
        r.outilsTri = outilsTries(trouver(nom) || actuelle);
      } else {
        const statut = /reconnecter/i.test(r.erreur) ? 'a-reconnecter' : 'erreur';
        r.statut = statut;
        majConnexion(nom, { statut, erreur: r.erreur, testeLe });
      }
      resolve(r);
    };
    const minuterie = setTimeout(() => conclure({ ok: false, erreur: 'Le serveur n\'a pas répondu à temps (45 s).' }), DUREE_TEST);
    const envoyer = (m) => { try { proc.stdin.write(JSON.stringify(m) + '\n'); } catch { /* rien */ } };
    proc.stdin.on('error', () => {});
    proc.stderr.on('data', (d) => { erreurs += d; if (erreurs.length > 8000) erreurs = erreurs.slice(-4000); });
    proc.on('error', () => conclure({ ok: false, erreur: 'Le pont ne démarre pas.' }));
    proc.on('close', () => conclure({ ok: false, erreur: dernierMessage(erreurs) || 'Le pont s\'est arrêté sans réponse.' }));
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (d) => {
      tampon += d;
      let i;
      while ((i = tampon.indexOf('\n')) >= 0) {
        const ligne = tampon.slice(0, i).trim();
        tampon = tampon.slice(i + 1);
        if (!ligne) continue;
        let m;
        try { m = JSON.parse(ligne); } catch { continue; }
        if (m.id === 1) {
          if (m.error) return conclure({ ok: false, erreur: String(m.error.message || 'initialize refusé') });
          envoyer({ jsonrpc: '2.0', method: 'notifications/initialized' });
          envoyer({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        } else if (m.id === 2) {
          if (m.error) return conclure({ ok: false, erreur: String(m.error.message || 'tools/list refusé') });
          const outils = ((m.result && m.result.tools) || []).map((t) => ({ nom: String(t.name), description: String(t.description || '').slice(0, 300) }));
          return conclure({ ok: true, outils });
        }
      }
    });
    envoyer({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'espace-agent-test', version: '1.0' } } });
  });
}

function dernierMessage(texte) {
  const lignes = String(texte || '').trim().split('\n').filter(Boolean);
  return lignes.length ? lignes[lignes.length - 1].slice(0, 300) : '';
}

module.exports = {
  lister, creer, supprimer, reconnecter, tester, changerEcriture, retourOAuth,
  serveursMCP, actives, nombreQuiMarchent, decouvrir, masquerTexte, RETOUR,
  changerAction, outilsActions, outilsTries, estActionParDefaut,
};
