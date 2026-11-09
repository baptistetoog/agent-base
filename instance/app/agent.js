'use strict';
// Le cerveau de l'agent : chaque message lance Claude Code (claude -p) dans /home/agentforma/agent.
// Un seul travail à la fois (les autres messages attendent dans une file), 10 minutes maximum,
// discussion continue grâce au session_id (--resume), historique dans data/historique.jsonl.
// La clé Claude est relue dans /home/agentforma/.claude-token.env à CHAQUE lancement.
// Elle n'est jamais renvoyée au navigateur ni écrite dans les journaux.

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const DOSSIER_AGENT = path.join(RACINE, 'agent');
const DATA = path.join(RACINE, 'data');
const FICHIER_HISTORIQUE = path.join(DATA, 'historique.jsonl');
const FICHIER_ETAT = path.join(DATA, 'agent-etat.json');
const FICHIER_CLAUDE = path.join(DATA, 'claude.json');
const FICHIER_JETON = path.join(RACINE, '.claude-token.env');
const CLAUDE = path.join(RACINE, '.local', 'bin', 'claude');

const DUREE_MAX = 10 * 60 * 1000;      // 10 minutes par message
const DUREE_TEST = 90 * 1000;          // test d'une clé
const PREFIXE = 'sk-ant-oat01-';
const MAX_MESSAGES_RENVOYES = 300;

// Options communes à chaque lancement de l'agent.
const OPTIONS_AGENT = [
  '-p',
  '--output-format', 'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--model', 'sonnet',
  '--setting-sources', 'project',
  '--strict-mcp-config',
  '--permission-mode', 'acceptEdits',
  '--allowedTools', 'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Skill',
  '--disallowedTools', 'Bash', 'Task', 'Agent', 'NotebookEdit',
];

// Le service systemd charge aussi ce fichier au démarrage : on oublie cette copie,
// la clé est relue dans le fichier à chaque lancement (et peut donc changer sans redémarrage).
delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

let diffuser = () => {};
let NOM_AGENT = 'Agent';

// ---------- Petits outils ----------

function nouvelId() { return crypto.randomBytes(9).toString('base64url'); }
function maintenant() { return new Date().toISOString(); }

function lireJSON(fichier, defaut) {
  try { return JSON.parse(fs.readFileSync(fichier, 'utf8')); } catch { return defaut; }
}
function ecrireJSON(fichier, valeur) {
  const tmp = fichier + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(valeur, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, fichier);
}

// Masque toute clé qui traînerait dans un texte destiné aux journaux.
function masquer(texte) {
  return String(texte || '').replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-***');
}

function court(texte, n = 48) {
  const t = String(texte || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function sansAccents(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// ---------- La clé Claude ----------

function lireJeton() {
  let brut;
  try { brut = fs.readFileSync(FICHIER_JETON, 'utf8'); } catch { return null; }
  for (const ligne of brut.split(/\r?\n/)) {
    const m = ligne.match(/^\s*(?:export\s+)?CLAUDE_CODE_OAUTH_TOKEN\s*=\s*["']?([^"'\s]+)["']?\s*$/);
    if (m && m[1].startsWith(PREFIXE)) return m[1];
  }
  return null;
}

function etatClaude() {
  const connecte = Boolean(lireJeton());
  let depuis = null;
  if (connecte) {
    const info = lireJSON(FICHIER_CLAUDE, {});
    depuis = info.connecteLe || null;
    if (!depuis) { try { depuis = fs.statSync(FICHIER_JETON).mtime.toISOString(); } catch { /* rien */ } }
  }
  return { connecte, depuis };
}

// Nettoie ce que la personne a collé : espaces, retours à la ligne, guillemets,
// « export », « CLAUDE_CODE_OAUTH_TOKEN= », clé collée deux fois.
function nettoyerCle(brut) {
  let s = String(brut || '').replace(/^﻿/, '').trim();
  s = s.replace(/CLAUDE_CODE_OAUTH_TOKEN\s*[=:]/g, ' ');
  s = s.replace(/^\s*(?:export\s+)+/i, '');
  s = s.replace(/["'`«»“”‘’\s]/g, '');
  if (!s) return { erreur: 'Collez la clé affichée par le Terminal.' };
  if (!s.startsWith(PREFIXE)) return { erreur: 'Ce n\'est pas la bonne clé : elle doit commencer par sk-ant-oat01-. Refaites claude setup-token.' };
  const corps = s.slice(PREFIXE.length).split(PREFIXE)[0]; // clé collée deux fois : on garde la première
  if (!/^[A-Za-z0-9_-]{20,}$/.test(corps)) return { erreur: 'La clé semble incomplète ou abîmée. Recopiez-la en entier depuis le Terminal.' };
  return { cle: PREFIXE + corps };
}

function environnement(jeton) {
  return {
    HOME: RACINE,
    USER: 'agentforma',
    LOGNAME: 'agentforma',
    SHELL: '/bin/bash',
    PATH: `${path.join(RACINE, '.local', 'bin')}:/usr/local/bin:/usr/bin:/bin`,
    LANG: 'C.UTF-8',
    TMPDIR: '/tmp',
    CLAUDE_CODE_OAUTH_TOKEN: jeton,
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    DISABLE_AUTOUPDATER: '1',
  };
}

function tuer(proc) {
  if (!proc || proc.exitCode !== null) return;
  try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch { /* rien */ } }
  setTimeout(() => {
    if (proc.exitCode === null) { try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* rien */ } }
  }, 3000).unref();
}

function ressembleRefusCle(texte) {
  return /(401|unauthori[sz]ed|invalid[^.\n]{0,30}(token|api key|bearer|credential)|authenticat|oauth|token[^.\n]{0,20}(expired|revoked)|not logged in|please run \/login)/i.test(texte);
}
function ressembleLimite(texte) {
  return /(rate.?limit|usage limit|limit reached|429|overloaded|quota)/i.test(texte);
}

let testEnCours = false;

// Teste une clé : claude -p "Réponds seulement : prêt". Rien n'est enregistré ici.
function testerCle(cle) {
  return new Promise((resolve) => {
    const args = [
      '-p', 'Réponds seulement : prêt',
      '--output-format', 'json',
      '--model', 'sonnet',
      '--setting-sources', 'project',
      '--strict-mcp-config',
      '--disallowedTools', 'Bash', 'Task', 'Agent', 'NotebookEdit', 'Write', 'Edit',
    ];
    let proc;
    try {
      proc = spawn(CLAUDE, args, { cwd: DOSSIER_AGENT, env: environnement(cle), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (e) {
      return resolve({ ok: false, raison: 'technique' });
    }
    let sortie = '', erreurs = '', fini = false;
    const minuterie = setTimeout(() => { if (!fini) { tuer(proc); } }, DUREE_TEST);
    proc.stdout.on('data', (d) => { sortie += d; if (sortie.length > 200000) sortie = sortie.slice(-100000); });
    proc.stderr.on('data', (d) => { erreurs += d; if (erreurs.length > 20000) erreurs = erreurs.slice(-10000); });
    proc.on('error', () => { if (!fini) { fini = true; clearTimeout(minuterie); resolve({ ok: false, raison: 'technique' }); } });
    proc.on('close', (code, signal) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuterie);
      let resultat = null;
      for (const ligne of sortie.trim().split('\n').reverse()) {
        try { const o = JSON.parse(ligne); if (o && o.type === 'result') { resultat = o; break; } } catch { /* ligne suivante */ }
      }
      const texte = resultat ? String(resultat.result || '') : '';
      if (resultat && !resultat.is_error && sansAccents(texte).includes('pret')) return resolve({ ok: true });
      const tout = texte + '\n' + erreurs + '\n' + sortie.slice(-2000);
      console.error('Test de la clé Claude refusé :', court(masquer(texte || erreurs || ('code ' + code + ' ' + (signal || ''))), 200));
      if (signal) return resolve({ ok: false, raison: 'delai' });
      if (ressembleLimite(tout) && !ressembleRefusCle(tout)) return resolve({ ok: false, raison: 'limite' });
      if (ressembleRefusCle(tout) || (resultat && resultat.is_error)) return resolve({ ok: false, raison: 'refusee' });
      if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|fetch failed/i.test(tout)) return resolve({ ok: false, raison: 'reseau' });
      return resolve({ ok: false, raison: resultat ? 'reponse' : 'refusee' });
    });
  });
}

const MESSAGES_TEST = {
  refusee: 'Clé refusée par Claude : refaites claude setup-token, puis collez la nouvelle clé.',
  limite: 'La clé est bonne, mais la limite d\'utilisation de votre abonnement Claude est atteinte. Réessayez plus tard.',
  reseau: 'Le serveur n\'arrive pas à joindre Claude. Réessayez dans un instant.',
  delai: 'Claude n\'a pas répondu à temps. Réessayez dans un instant.',
  reponse: 'Claude a répondu de façon inattendue. Réessayez ; si cela recommence, refaites claude setup-token.',
  technique: 'Le programme Claude ne démarre pas sur le serveur. Prévenez la personne qui l\'a installé.',
};

async function connecterClaude(brut, compte) {
  const n = nettoyerCle(brut);
  if (n.erreur) return { ok: false, erreur: n.erreur };
  if (testEnCours) return { ok: false, erreur: 'Une vérification est déjà en cours. Patientez quelques secondes.' };
  testEnCours = true;
  try {
    const r = await testerCle(n.cle);
    if (!r.ok) return { ok: false, erreur: MESSAGES_TEST[r.raison] || MESSAGES_TEST.refusee };
    const tmp = FICHIER_JETON + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, `CLAUDE_CODE_OAUTH_TOKEN=${n.cle}\n`, { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, FICHIER_JETON);
    ecrireJSON(FICHIER_CLAUDE, { connecteLe: maintenant(), par: compte ? compte.email : null });
    console.log(`Claude connecté par ${compte ? compte.email : 'inconnu'}.`);
    diffuser('claude', etatClaude());
    return { ok: true, claude: etatClaude() };
  } finally {
    testEnCours = false;
  }
}

function deconnecterClaude(compte) {
  try { fs.unlinkSync(FICHIER_JETON); } catch { /* déjà absent */ }
  try { fs.unlinkSync(FICHIER_CLAUDE); } catch { /* rien */ }
  console.log(`Claude déconnecté par ${compte ? compte.email : 'inconnu'}.`);
  diffuser('claude', etatClaude());
  return etatClaude();
}

// ---------- Historique ----------

function ajouterHistorique(entree) {
  fs.appendFileSync(FICHIER_HISTORIQUE, JSON.stringify(entree) + '\n', { mode: 0o600 });
}

function lireHistorique() {
  let brut = '';
  try { brut = fs.readFileSync(FICHIER_HISTORIQUE, 'utf8'); } catch { return []; }
  const res = [];
  for (const ligne of brut.split('\n')) {
    if (!ligne.trim()) continue;
    try { res.push(JSON.parse(ligne)); } catch { /* ligne abîmée : ignorée */ }
  }
  return res;
}

// ---------- L'agent ----------

const etat = {
  etat: 'repos', detail: null, libelle: null,
  file: [],          // messages en attente : { entree, compte }
  courant: null,     // travail en cours
  sessionId: null,   // conversation Claude à reprendre (--resume)
  discussion: null,  // identifiant de la discussion affichée
};
let minuterieRepos = null;

function chargerEtat() {
  const e = lireJSON(FICHIER_ETAT, {});
  etat.sessionId = e.sessionId || null;
  etat.discussion = e.discussion || null;
  if (!etat.discussion) { etat.discussion = nouvelId(); sauverEtat(); }
}
function sauverEtat() {
  ecrireJSON(FICHIER_ETAT, { sessionId: etat.sessionId, discussion: etat.discussion });
}

function statut() {
  return {
    etat: etat.etat, detail: etat.detail, libelle: etat.libelle,
    occupe: Boolean(etat.courant), file: etat.file.length,
  };
}

function changerStatut(e, extra = {}) {
  etat.etat = e;
  etat.detail = extra.detail || null;
  etat.libelle = extra.libelle || null;
  if (minuterieRepos) { clearTimeout(minuterieRepos); minuterieRepos = null; }
  diffuser('statut', statut());
}

const OUTILS = {
  Read: 'Lit un fichier', Glob: 'Cherche des fichiers', Grep: 'Cherche dans les fichiers',
  WebSearch: 'Cherche sur le web', WebFetch: 'Lit une page web', Skill: 'Utilise une compétence',
  Write: 'Écrit un fichier', Edit: 'Modifie un fichier', MultiEdit: 'Modifie un fichier',
  TodoWrite: 'Organise son travail', LS: 'Regarde un dossier',
};

function libelleOutil(nom) { return OUTILS[nom] || 'Utilise un outil'; }

function phraseOutil(nom, entree) {
  const e = entree || {};
  const f = e.file_path || e.path || e.notebook_path;
  const base = f ? court(path.basename(String(f)), 40) : '';
  switch (nom) {
    case 'Read': return base ? `Je lis ${base}…` : 'Je lis le document…';
    case 'Write': return base ? `J'écris ${base}…` : 'J\'écris un fichier…';
    case 'Edit': case 'MultiEdit': return base ? `Je modifie ${base}…` : 'Je modifie un fichier…';
    case 'Glob': return 'Je cherche des fichiers…';
    case 'Grep': return e.pattern ? `Je cherche « ${court(e.pattern, 30)} »…` : 'Je fouille dans les fichiers…';
    case 'WebSearch': return e.query ? `Je cherche « ${court(e.query, 34)} » sur le web…` : 'Je cherche sur le web…';
    case 'WebFetch': {
      try { return `Je lis ${new URL(e.url).hostname}…`; } catch { return 'Je lis une page web…'; }
    }
    case 'Skill': return (e.skill || e.command) ? `J'utilise la compétence ${court(e.skill || e.command, 30)}…` : 'J\'utilise une compétence…';
    case 'TodoWrite': return 'Je fais ma liste…';
    default: return 'Je travaille…';
  }
}

function majOutil(c, id, nom, entree) {
  let o = c.outils.find((x) => x.id === id);
  if (!o) {
    o = { id, nom, libelle: libelleOutil(nom), detail: phraseOutil(nom, entree) };
    c.outils.push(o);
  } else if (entree && Object.keys(entree).length) {
    o.detail = phraseOutil(nom, entree);
  }
  changerStatut('outil', { detail: o.detail, libelle: o.libelle });
  diffuser('outils', { id: c.id, outils: c.outils.map(({ nom: n, libelle, detail }) => ({ nom: n, libelle, detail })) });
}

function traiterLigne(c, ligne) {
  let o;
  try { o = JSON.parse(ligne); } catch { return; }
  if (!o || typeof o !== 'object') return;
  switch (o.type) {
    case 'system':
      if (o.subtype === 'init') {
        if (o.session_id) c.sessionId = o.session_id;
        changerStatut('reflechit');
      }
      break;
    case 'stream_event': {
      const ev = o.event || {};
      if (ev.type === 'content_block_start' && ev.content_block) {
        const b = ev.content_block;
        if (b.type === 'tool_use') majOutil(c, b.id, b.name, b.input);
        else if (b.type === 'thinking' && etat.etat !== 'reflechit') changerStatut('reflechit');
        else if (b.type === 'text' && c.texte && !c.texte.endsWith('\n\n')) c.separer = true;
      } else if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta' && ev.delta.text) {
        let t = ev.delta.text;
        if (c.separer) { t = '\n\n' + t; c.separer = false; }
        c.texte += t;
        if (etat.etat !== 'repond') changerStatut('repond');
        diffuser('morceau', { id: c.id, texte: t });
      }
      break;
    }
    case 'assistant': {
      const contenu = (o.message && o.message.content) || [];
      for (const b of contenu) if (b && b.type === 'tool_use') majOutil(c, b.id, b.name, b.input);
      break;
    }
    case 'user': {
      const contenu = (o.message && o.message.content) || [];
      if (Array.isArray(contenu) && contenu.some((b) => b && b.type === 'tool_result')) changerStatut('reflechit');
      break;
    }
    case 'result':
      c.resultat = o;
      if (o.session_id) c.sessionId = o.session_id;
      break;
    default:
      break;
  }
}

function messageErreur(c) {
  const r = c.resultat;
  const tout = (r ? String(r.result || '') + ' ' + JSON.stringify(r.errors || '') : '') + '\n' + c.erreurs;
  if (!lireJeton()) return 'Claude n\'est pas connecté. Un admin doit coller la clé dans « Connecter Claude ».';
  if (ressembleLimite(tout) && !ressembleRefusCle(tout)) return 'La limite d\'utilisation de l\'abonnement Claude est atteinte. Réessayez un peu plus tard.';
  if (ressembleRefusCle(tout)) return 'Claude a refusé la clé enregistrée. Un admin doit la changer dans Réglages › Claude (« Changer la clé »).';
  return 'L\'agent a rencontré un problème et n\'a pas pu répondre. Réessayez dans un instant.';
}

function lancer(travail, relance, idExistant) {
  const jeton = lireJeton();
  const c = {
    id: idExistant || nouvelId(), travail, discussion: etat.discussion,
    debut: Date.now(), texte: '', outils: [], erreurs: '', tampon: '',
    resultat: null, sessionId: null, raison: null, separer: false, proc: null,
  };
  etat.courant = c;
  if (!idExistant) {
    diffuser('debut', { id: c.id, pour: travail.entree.id, discussion: c.discussion, quand: maintenant() });
    changerStatut('message');
  }
  if (!jeton) { c.raison = 'sans-cle'; return terminer(c); }

  const args = [...OPTIONS_AGENT];
  if (etat.sessionId) args.push('--resume', etat.sessionId);
  try {
    c.proc = spawn(CLAUDE, args, { cwd: DOSSIER_AGENT, env: environnement(jeton), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  } catch (e) {
    console.error('Impossible de lancer Claude :', masquer(e.message));
    c.raison = 'technique';
    return terminer(c);
  }
  c.proc.stdin.on('error', () => {});
  c.proc.stdin.end(travail.entree.texte);
  c.minuterie = setTimeout(() => { c.raison = 'delai'; tuer(c.proc); }, DUREE_MAX);
  c.proc.stdout.setEncoding('utf8');
  c.proc.stdout.on('data', (d) => {
    c.tampon += d;
    let i;
    while ((i = c.tampon.indexOf('\n')) >= 0) {
      const ligne = c.tampon.slice(0, i);
      c.tampon = c.tampon.slice(i + 1);
      if (ligne.trim()) traiterLigne(c, ligne);
    }
  });
  c.proc.stderr.on('data', (d) => { c.erreurs += d; if (c.erreurs.length > 20000) c.erreurs = c.erreurs.slice(-10000); });
  c.proc.on('error', (e) => { console.error('Claude :', masquer(e.message)); });
  c.proc.on('close', (code) => {
    clearTimeout(c.minuterie);
    if (c.tampon.trim()) traiterLigne(c, c.tampon);
    // La conversation à reprendre n'existe plus : on repart d'une conversation neuve, une seule fois.
    if (!relance && !c.raison && etat.sessionId && !c.resultat && !c.texte
        && /no conversation found|session/i.test(c.erreurs)) {
      etat.sessionId = null;
      sauverEtat();
      return lancer(travail, true, c.id);
    }
    c.code = code;
    terminer(c);
  });
}

function terminer(c) {
  let statutFin = 'ok';
  let texte = c.texte.trim() || (c.resultat && !c.resultat.is_error ? String(c.resultat.result || '').trim() : '');
  if (c.raison === 'arret') {
    statutFin = 'arrete';
    texte = (texte ? texte + '\n\n' : '') + '_Arrêté à votre demande._';
  } else if (c.raison === 'delai') {
    statutFin = 'delai';
    texte = (texte ? texte + '\n\n' : '') + '_Arrêté : la limite de 10 minutes de travail est dépassée._';
  } else if (c.raison === 'sans-cle' || c.raison === 'technique' || !c.resultat || c.resultat.is_error) {
    statutFin = 'erreur';
    if (c.raison === 'technique') texte = 'Le programme Claude ne démarre pas sur le serveur.';
    else texte = messageErreur(c);
    if (c.erreurs) console.error('Claude (erreur) :', court(masquer(c.erreurs), 400));
    else if (c.resultat) console.error('Claude (erreur) :', court(masquer(c.resultat.result || c.resultat.subtype), 400));
  }

  if (c.sessionId && etat.discussion === c.discussion && statutFin !== 'erreur') {
    etat.sessionId = c.sessionId;
    sauverEtat();
  }

  const entree = {
    type: 'message', id: c.id, discussion: c.discussion, role: 'agent',
    quand: maintenant(), debut: new Date(c.debut).toISOString(), pour: c.travail.entree.id,
    qui: { nom: NOM_AGENT }, texte,
    outils: c.outils.map(({ nom, libelle, detail }) => ({ nom, libelle, detail })),
    dureeMs: Date.now() - c.debut,
    coutUSD: c.resultat && typeof c.resultat.total_cost_usd === 'number' ? c.resultat.total_cost_usd : null,
    statut: statutFin,
  };
  try { ajouterHistorique(entree); } catch (e) { console.error('Historique :', e.message); }
  etat.courant = null;
  diffuser('fin', entree);
  changerStatut(statutFin === 'ok' ? 'fini' : 'repos');
  if (etat.file.length) return setImmediate(suivant);
  minuterieRepos = setTimeout(() => { if (!etat.courant) changerStatut('repos'); }, 4000);
}

function suivant() {
  if (etat.courant || !etat.file.length) return;
  const travail = etat.file.shift();
  diffuser('file', { n: etat.file.length });
  lancer(travail, false);
}

// ---------- Ce que le serveur appelle ----------

function init(options) {
  diffuser = options.diffuser || diffuser;
  NOM_AGENT = options.nomAgent || NOM_AGENT;
  chargerEtat();
}

function envoyer(texte, compte) {
  const t = String(texte || '').replace(/\r\n/g, '\n').trim();
  if (!t) return { code: 400, erreur: 'Le message est vide.' };
  if (t.length > 20000) return { code: 413, erreur: 'Message trop long (20 000 caractères au maximum).' };
  if (!lireJeton()) {
    if (compte.role === 'admin') return { code: 409, erreur: 'Claude n\'est pas encore connecté : collez votre clé dans « Connecter Claude ».', connecter: true };
    return { code: 409, erreur: 'L\'agent n\'est pas encore connecté : demandez à un admin.' };
  }
  if (etat.file.length >= 20) return { code: 429, erreur: 'Trop de messages en attente. Patientez un peu.' };
  const entree = {
    type: 'message', id: nouvelId(), discussion: etat.discussion, role: 'utilisateur',
    quand: maintenant(), qui: { email: compte.email, nom: compte.nom }, texte: t,
  };
  ajouterHistorique(entree);
  diffuser('message', entree);
  const occupe = Boolean(etat.courant);
  etat.file.push({ entree, compte: { email: compte.email, nom: compte.nom, role: compte.role } });
  if (occupe) diffuser('file', { n: etat.file.length });
  else suivant();
  return { code: 200, ok: true, message: entree, enAttente: occupe ? etat.file.length : 0 };
}

function arreter() {
  if (!etat.courant) return false;
  etat.courant.raison = 'arret';
  if (etat.courant.proc) tuer(etat.courant.proc);
  return true;
}

function nouvelleDiscussion(compte) {
  etat.file = [];
  diffuser('file', { n: 0 });
  arreter();
  etat.sessionId = null;
  etat.discussion = nouvelId();
  sauverEtat();
  ajouterHistorique({ type: 'nouvelle', discussion: etat.discussion, quand: maintenant(), qui: { email: compte.email, nom: compte.nom } });
  diffuser('nouvelle', { discussion: etat.discussion });
  return { discussion: etat.discussion };
}

function enCours() {
  const c = etat.courant;
  if (!c || c.discussion !== etat.discussion) return null;
  return { id: c.id, pour: c.travail.entree.id, texte: c.texte, outils: c.outils.map(({ nom, libelle, detail }) => ({ nom, libelle, detail })) };
}

function discussion() {
  const messages = lireHistorique()
    .filter((e) => e.type === 'message' && e.discussion === etat.discussion)
    .slice(-MAX_MESSAGES_RENVOYES)
    .map((e) => ({ ...e, qui: { nom: e.qui && e.qui.nom, email: e.qui && e.qui.email } }));
  return { discussion: etat.discussion, messages, enCours: enCours(), statut: statut() };
}

module.exports = {
  init, envoyer, arreter, nouvelleDiscussion, discussion, statut, enCours,
  etatClaude, connecterClaude, deconnecterClaude, nettoyerCle,
};
