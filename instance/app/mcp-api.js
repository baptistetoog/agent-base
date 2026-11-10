#!/usr/bin/env node
'use strict';
// mcp-api.js — petit serveur MCP (stdio, sans dépendance) pour une « API avec clé ».
// Lancé par Claude (ou par « Tester ») avec le NOM de la connexion : node mcp-api.js <nom>.
// Il relit lui-même l'URL de base, l'en-tête, le préfixe et la clé dans data/connexions.json
// (interdit à l'agent). Deux outils :
//   lire_api(chemin)                  : GET seulement ;
//   appel_api(methode, chemin, corps) : seulement si « Autoriser l'écriture » est coché.
// Seuls les chemins SOUS l'URL de base sont acceptés ; la clé est ajoutée ici ; les réponses
// sont coupées à 50 000 caractères et la clé est masquée si elle apparaît.

const fs = require('fs');
const path = require('path');

const DATA = path.resolve(__dirname, '..', 'data');
const NOM = String(process.argv[2] || process.env.CONNEXION || '');
const MAX = 50000;
const DELAI = 60 * 1000;
const METHODES = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function charger() {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(DATA, 'connexions.json'), 'utf8'));
    const c = (d.connexions || []).find((x) => x.nom === NOM && x.type === 'api');
    return c || null;
  } catch { return null; }
}

const connexion = charger();

function masquer(texte) {
  let t = String(texte || '');
  if (connexion && connexion.secret && connexion.secret.length >= 4) t = t.split(connexion.secret).join('***');
  return t;
}

// Résout le chemin demandé et vérifie qu'il reste sous l'URL de base (même origine, même début de chemin).
function adresse(chemin) {
  const base = new URL(connexion.url);
  const brut = String(chemin === undefined || chemin === null ? '' : chemin).trim();
  if (/[\r\n\0]/.test(brut)) return { erreur: 'Chemin invalide.' };
  let u;
  try { u = new URL(brut.replace(/^\/+/, ''), base); } catch { return { erreur: 'Chemin invalide.' }; }
  const prefixe = base.pathname.endsWith('/') ? base.pathname : base.pathname + '/';
  if (u.origin !== base.origin || !(u.pathname + '/').startsWith(prefixe) || /(^|\/)\.\.?(\/|$)/.test(decodeURIComponent(u.pathname))) {
    return { erreur: `Chemin refusé : seules les adresses sous ${connexion.url} sont autorisées.` };
  }
  u.hash = '';
  return { url: u };
}

async function appeler(methode, chemin, corps) {
  const a = adresse(chemin);
  if (a.erreur) return { texte: a.erreur, erreur: true };
  const entetes = { Accept: 'application/json, text/plain;q=0.9, */*;q=0.5', 'User-Agent': 'espace-agent-api/1.0' };
  entetes[connexion.entete] = (connexion.prefixe ? connexion.prefixe + ' ' : '') + connexion.secret;
  const options = { method: methode, headers: entetes, redirect: 'manual', signal: AbortSignal.timeout(DELAI) };
  if (corps !== undefined && corps !== null && corps !== '' && methode !== 'GET' && methode !== 'DELETE') {
    if (typeof corps === 'string') {
      options.body = corps;
      entetes['Content-Type'] = /^\s*[[{]/.test(corps) ? 'application/json' : 'text/plain; charset=utf-8';
    } else {
      options.body = JSON.stringify(corps);
      entetes['Content-Type'] = 'application/json';
    }
  }
  let url = a.url;
  let r;
  try {
    // Redirections suivies seulement si elles restent sous l'URL de base (la clé ne part jamais ailleurs).
    for (let n = 0; ; n++) {
      r = await fetch(url, options);
      if (r.status < 300 || r.status >= 400 || !r.headers.get('location')) break;
      if (n >= 3) return { texte: 'Trop de redirections.', erreur: true };
      const suite = adresse(new URL(r.headers.get('location'), url).toString());
      if (suite.erreur) return { texte: `Redirection refusée (vers une adresse hors de ${connexion.url}).`, erreur: true };
      url = suite.url;
    }
  } catch (e) {
    return { texte: masquer(`L'API « ${NOM} » ne répond pas (${e.name === 'TimeoutError' ? 'délai dépassé' : e.message}).`), erreur: true };
  }
  let texte = await r.text().catch(() => '');
  const type = r.headers.get('content-type') || '';
  if (/json/i.test(type)) { try { texte = JSON.stringify(JSON.parse(texte), null, 1); } catch { /* tel quel */ } }
  texte = masquer(texte);
  let coupe = '';
  if (texte.length > MAX) { coupe = `\n\n[Réponse coupée : ${texte.length} caractères, seuls les ${MAX} premiers sont affichés. Demandez une page plus petite ou un filtre.]`; texte = texte.slice(0, MAX); }
  const entete = `HTTP ${r.status} ${methode} ${masquer(url.pathname + url.search)}${type ? ' (' + type.split(';')[0] + ')' : ''}`;
  let suite = '';
  if (r.status === 401 || r.status === 403) suite = `\n\nAccès refusé par l'API : un admin doit vérifier la clé de « ${NOM} » dans Connexions.`;
  return { texte: `${entete}\n\n${texte}${coupe}${suite}`, erreur: r.status >= 400 };
}

// ---------- Outils ----------

function outils() {
  const liste = [{
    name: 'lire_api',
    description: `Lit l'API « ${NOM} » (GET seulement). URL de base : ${connexion ? connexion.url : '?'} . Donnez le chemin relatif (ex. « repos/anthropics/claude-code ») avec ses paramètres éventuels (?page=1). La clé est ajoutée automatiquement.`,
    inputSchema: { type: 'object', properties: { chemin: { type: 'string', description: 'Chemin sous l\'URL de base, avec les paramètres de requête éventuels.' } }, required: ['chemin'] },
    annotations: { readOnlyHint: true },
  }];
  if (connexion && connexion.ecriture) {
    liste.push({
      name: 'appel_api',
      description: `Appelle l'API « ${NOM} » avec n'importe quelle méthode (${METHODES.join(', ')}). C'est une action : sauf mode « Agit seul » ou validation accordée, passe d'abord par demander_validation.`,
      inputSchema: {
        type: 'object',
        properties: {
          methode: { type: 'string', enum: METHODES },
          chemin: { type: 'string', description: 'Chemin sous l\'URL de base.' },
          corps: { description: 'Corps de la requête (objet JSON ou texte), facultatif.' },
        },
        required: ['methode', 'chemin'],
      },
      annotations: { destructiveHint: true },
    });
  }
  return liste;
}

// ---------- Protocole MCP (JSON-RPC 2.0, un message par ligne) ----------

function envoyer(m) { process.stdout.write(JSON.stringify(m) + '\n'); }
function repondre(id, result) { envoyer({ jsonrpc: '2.0', id, result }); }
function erreur(id, code, message) { envoyer({ jsonrpc: '2.0', id, error: { code, message } }); }
function resultat(id, r) { repondre(id, { content: [{ type: 'text', text: r.texte }], isError: Boolean(r.erreur) }); }

async function traiter(msg) {
  if (!msg || msg.jsonrpc !== '2.0') return;
  const { id, method, params } = msg;
  const estRequete = id !== undefined && id !== null;
  if (!connexion && estRequete && method !== 'ping') {
    return erreur(id, -32000, `La connexion « ${NOM} » n'existe plus : un admin doit la rajouter dans Connexions.`);
  }
  switch (method) {
    case 'initialize':
      return repondre(id, {
        protocolVersion: (params && params.protocolVersion) || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'api-' + NOM, version: '1.0.0' },
        instructions: `API « ${NOM} » (${connexion.url}). lire_api pour lire${connexion.ecriture ? ', appel_api pour écrire (avec l\'accord de la personne)' : ' ; l\'écriture n\'est pas autorisée'}.`,
      });
    case 'ping': return repondre(id, {});
    case 'tools/list': return repondre(id, { tools: outils() });
    case 'tools/call': {
      const nom = params && params.name;
      const a = (params && params.arguments) || {};
      if (nom === 'lire_api') return resultat(id, await appeler('GET', a.chemin));
      if (nom === 'appel_api') {
        if (!connexion.ecriture) return resultat(id, { texte: `L'écriture n'est pas autorisée pour « ${NOM} » : un admin peut cocher « Autoriser l'écriture » dans Connexions.`, erreur: true });
        const m = String(a.methode || '').toUpperCase();
        if (!METHODES.includes(m)) return resultat(id, { texte: `Méthode refusée : ${METHODES.join(', ')} seulement.`, erreur: true });
        return resultat(id, await appeler(m, a.chemin, a.corps));
      }
      return erreur(id, -32602, 'Outil inconnu : ' + String(nom).slice(0, 60));
    }
    default:
      if (estRequete) return erreur(id, -32601, 'Méthode inconnue');
      return undefined;
  }
}

let tampon = '';
let enCours = Promise.resolve();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (morceau) => {
  tampon += morceau;
  if (tampon.length > 4 * 1024 * 1024) tampon = '';
  let i;
  while ((i = tampon.indexOf('\n')) >= 0) {
    const ligne = tampon.slice(0, i).trim();
    tampon = tampon.slice(i + 1);
    if (!ligne) continue;
    let msg;
    try { msg = JSON.parse(ligne); } catch { continue; }
    const p = traiter(msg).catch((e) => { if (msg.id !== undefined) erreur(msg.id, -32000, masquer('Erreur : ' + e.message)); });
    enCours = enCours.then(() => p);
  }
});
process.stdin.on('end', () => { enCours.finally(() => setTimeout(() => process.exit(0), 50)); });
