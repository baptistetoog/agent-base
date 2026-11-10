#!/usr/bin/env node
'use strict';
// mcp-pont.js — pont stdio ↔ « Streamable HTTP » pour un serveur MCP distant (sans dépendance).
// Lancé par Claude (ou par « Tester ») avec le NOM de la connexion : node mcp-pont.js <nom>.
// Il relit lui-même le secret dans data/ (interdit à l'agent) :
//   - type « jeton » : data/connexions.json (en-tête, préfixe, jeton) ;
//   - type « oauth » : data/oauth/<nom>.json (jetons) ; renouvelle l'accès avec le refresh_token
//     quand il expire ou sur une erreur 401, et réécrit le fichier (600).
// Il garde l'en-tête mcp-session-id, gère les réponses JSON et text/event-stream,
// et masque les jetons dans tous les messages d'erreur.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RACINE = path.resolve(__dirname, '..');
const DATA = path.join(RACINE, 'data');
const NOM = String(process.argv[2] || process.env.CONNEXION || '');
const DELAI = 120 * 1000;

process.umask(0o077);

function journal(t) { process.stderr.write(`pont ${NOM} : ${masquer(t)}\n`); }
function lireJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function ecrireJSON(f, v) {
  const tmp = f + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, f);
}

function chargerConnexion() {
  const d = lireJSON(path.join(DATA, 'connexions.json'));
  const c = d && Array.isArray(d.connexions) ? d.connexions.find((x) => x.nom === NOM) : null;
  return c && (c.type === 'oauth' || c.type === 'jeton') ? c : null;
}

const connexion = chargerConnexion();
const FICHIER_OAUTH = path.join(DATA, 'oauth', NOM + '.json');
const RECONNECTER = `La connexion « ${NOM} » a expiré ou a été refusée : un admin doit reconnecter ${NOM} dans Connexions.`;

function secrets() {
  const s = [];
  if (connexion && connexion.secret) s.push(connexion.secret);
  const o = connexion && connexion.type === 'oauth' ? lireJSON(FICHIER_OAUTH) : null;
  if (o && o.jetons) s.push(o.jetons.access_token, o.jetons.refresh_token);
  if (o && o.client && o.client.client_secret) s.push(o.client.client_secret);
  return s.filter((x) => x && String(x).length >= 6);
}

function masquer(texte) {
  let t = String(texte || '');
  try { for (const s of secrets()) t = t.split(String(s)).join('***'); } catch { /* rien */ }
  return t.replace(/(bearer\s+)[A-Za-z0-9._~+\/=-]{12,}/gi, '$1***');
}

// ---------- Jetons ----------

let renouvellement = null;

async function renouveler() {
  if (renouvellement) return renouvellement;
  renouvellement = (async () => {
    const o = lireJSON(FICHIER_OAUTH);
    if (!o || !o.jetons || !o.jetons.refresh_token || !o.metadonnees || !o.client) return false;
    const corps = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: o.jetons.refresh_token });
    if (o.ressource) corps.set('resource', o.ressource);
    const entetes = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
    if (o.client.client_secret && o.client.methode === 'client_secret_basic') {
      entetes.Authorization = 'Basic ' + Buffer.from(encodeURIComponent(o.client.client_id) + ':' + encodeURIComponent(o.client.client_secret)).toString('base64');
    } else {
      corps.set('client_id', o.client.client_id);
      if (o.client.client_secret) corps.set('client_secret', o.client.client_secret);
    }
    try {
      const r = await fetch(o.metadonnees.token_endpoint, { method: 'POST', headers: entetes, body: corps.toString(), signal: AbortSignal.timeout(20000) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || !j.access_token) { journal(`renouvellement refusé (HTTP ${r.status})`); return false; }
      const frais = lireJSON(FICHIER_OAUTH) || o;
      frais.jetons = {
        access_token: String(j.access_token),
        refresh_token: j.refresh_token ? String(j.refresh_token) : o.jetons.refresh_token,
        token_type: j.token_type || 'Bearer', scope: j.scope || o.jetons.scope || null,
        expire: j.expires_in ? Date.now() + Number(j.expires_in) * 1000 : null,
      };
      ecrireJSON(FICHIER_OAUTH, frais);
      journal('jeton renouvelé');
      return true;
    } catch (e) { journal('renouvellement impossible : ' + e.message); return false; }
  })();
  try { return await renouvellement; } finally { renouvellement = null; }
}

async function enteteAuth() {
  if (connexion.type === 'jeton') {
    return [connexion.entete || 'Authorization', (connexion.prefixe ? connexion.prefixe + ' ' : '') + connexion.secret];
  }
  let o = lireJSON(FICHIER_OAUTH);
  if (!o || !o.jetons || !o.jetons.access_token) return null;
  if (o.jetons.expire && o.jetons.expire < Date.now() + 60 * 1000) {
    if (!(await renouveler())) return null;
    o = lireJSON(FICHIER_OAUTH);
  }
  return ['Authorization', 'Bearer ' + o.jetons.access_token];
}

// ---------- Sortie vers Claude ----------

function ecrire(m) { process.stdout.write(JSON.stringify(m) + '\n'); }
function erreurRPC(id, message) {
  if (id === undefined || id === null) { journal(message); return; }
  ecrire({ jsonrpc: '2.0', id, error: { code: -32000, message: masquer(message) } });
}

// ---------- Envoi d'un message au serveur MCP ----------

let sessionId = null;
let versionProtocole = null;

async function lireSSE(reponse, idAttendu) {
  // Flux text/event-stream : chaque événement « data: » contient un message JSON-RPC.
  const lecteur = reponse.body.getReader();
  const decodeur = new TextDecoder();
  let tampon = '', donnees = [], repondu = false;
  const traiterEvenement = () => {
    if (!donnees.length) return;
    const brut = donnees.join('\n');
    donnees = [];
    let m;
    try { m = JSON.parse(brut); } catch { return; }
    for (const x of Array.isArray(m) ? m : [m]) {
      // La version de protocole négociée (réponse à initialize) sert aux requêtes suivantes.
      if (x && x.result && x.result.protocolVersion && x.result.serverInfo) versionProtocole = String(x.result.protocolVersion);
      ecrire(x);
      if (idAttendu !== undefined && x && x.id === idAttendu && (x.result !== undefined || x.error !== undefined)) repondu = true;
    }
  };
  for (;;) {
    const { value, done } = await lecteur.read();
    if (done) break;
    tampon += decodeur.decode(value, { stream: true });
    let i;
    while ((i = tampon.search(/\r?\n/)) >= 0) {
      const ligne = tampon.slice(0, i);
      tampon = tampon.slice(tampon[i] === '\r' ? i + 2 : i + 1);
      if (ligne === '') traiterEvenement();
      else if (ligne.startsWith('data:')) donnees.push(ligne.slice(5).replace(/^ /, ''));
    }
    if (repondu) { try { await lecteur.cancel(); } catch { /* rien */ } break; }
  }
  traiterEvenement();
  return repondu;
}

async function transmettre(message, deuxiemeEssai = false) {
  const id = message && message.id;
  const estRequete = id !== undefined && id !== null && message.method;
  const auth = await enteteAuth();
  if (!auth) return erreurRPC(id, RECONNECTER);
  const entetes = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'User-Agent': 'espace-agent-pont/1.0' };
  entetes[auth[0]] = auth[1];
  if (sessionId) entetes['Mcp-Session-Id'] = sessionId;
  if (versionProtocole) entetes['MCP-Protocol-Version'] = versionProtocole;
  let r;
  try {
    r = await fetch(connexion.url, { method: 'POST', headers: entetes, body: JSON.stringify(message), signal: AbortSignal.timeout(DELAI) });
  } catch (e) {
    return erreurRPC(id, `Le serveur MCP « ${NOM} » ne répond pas (${e.name === 'TimeoutError' ? 'délai dépassé' : e.message}).`);
  }
  const sid = r.headers.get('mcp-session-id');
  if (sid) sessionId = sid;

  if (r.status === 401 || r.status === 403) {
    try { await r.body?.cancel(); } catch { /* rien */ }
    if (connexion.type === 'oauth' && !deuxiemeEssai && r.status === 401 && (await renouveler())) return transmettre(message, true);
    if (connexion.type === 'oauth') return erreurRPC(id, RECONNECTER);
    return erreurRPC(id, `Le serveur MCP « ${NOM} » refuse le jeton (HTTP ${r.status}) : un admin doit vérifier ${NOM} dans Connexions.`);
  }
  if (r.status === 404 && sessionId && !deuxiemeEssai) {
    // Session expirée côté serveur : on l'oublie ; Claude devra relancer initialize.
    sessionId = null;
    try { await r.body?.cancel(); } catch { /* rien */ }
    return erreurRPC(id, `La session avec « ${NOM} » a expiré. Réessayez.`);
  }
  if (r.status === 202 || r.status === 204) { try { await r.body?.cancel(); } catch { /* rien */ } return undefined; }
  if (!r.ok) {
    const t = (await r.text().catch(() => '')).slice(0, 400);
    return erreurRPC(id, `Le serveur MCP « ${NOM} » a répondu HTTP ${r.status}${t ? ' : ' + t.replace(/\s+/g, ' ') : ''}`);
  }
  const type = String(r.headers.get('content-type') || '');
  if (type.includes('text/event-stream')) {
    const ok = await lireSSE(r, estRequete ? id : undefined);
    if (estRequete && !ok) erreurRPC(id, `Le serveur MCP « ${NOM} » a fermé le flux sans répondre.`);
    return undefined;
  }
  const texte = await r.text().catch(() => '');
  if (!texte.trim()) { if (estRequete) erreurRPC(id, `Réponse vide du serveur MCP « ${NOM} ».`); return undefined; }
  let m;
  try { m = JSON.parse(texte); } catch { return erreurRPC(id, `Réponse illisible du serveur MCP « ${NOM} ».`); }
  for (const x of Array.isArray(m) ? m : [m]) {
    if (message.method === 'initialize' && x && x.id === id && x.result && x.result.protocolVersion) versionProtocole = String(x.result.protocolVersion);
    ecrire(x);
  }
  return undefined;
}

// ---------- Boucle principale ----------

// Connexion introuvable : on répond quand même proprement à Claude pour qu'il comprenne.
if (!connexion || !connexion.url) journal('connexion introuvable dans data/connexions.json');

let file = Promise.resolve();
let tampon = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (morceau) => {
  tampon += morceau;
  if (tampon.length > 8 * 1024 * 1024) tampon = '';
  let i;
  while ((i = tampon.indexOf('\n')) >= 0) {
    const ligne = tampon.slice(0, i).trim();
    tampon = tampon.slice(i + 1);
    if (!ligne) continue;
    let msg;
    try { msg = JSON.parse(ligne); } catch { continue; }
    if (!connexion || !connexion.url) { erreurRPC(msg.id, `La connexion « ${NOM} » n'existe plus : un admin doit la rajouter dans Connexions.`); continue; }
    // initialize passe en premier et seul (il fixe la session) ; le reste part en parallèle.
    if (msg.method === 'initialize') {
      file = file.then(() => transmettre(msg)).catch((e) => erreurRPC(msg.id, 'Erreur du pont : ' + e.message));
    } else {
      const p = file.then(() => transmettre(msg)).catch((e) => erreurRPC(msg.id, 'Erreur du pont : ' + e.message));
      if (msg.method === 'notifications/initialized') file = p;
    }
  }
});
process.stdin.on('end', () => { file.finally(() => setTimeout(() => process.exit(0), 50)); });
