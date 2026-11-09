#!/usr/bin/env node
'use strict';
// mcp-approbation.js — petit serveur MCP (stdio, sans dépendance) passé à Claude avec
// --permission-prompt-tool mcp__approbation__approuver.
//
// Claude Code refuse par défaut que l'agent écrive dans son dossier .claude/. Quand une action
// demande une autorisation, Claude interroge ce serveur. Il répond « oui » UNIQUEMENT pour écrire
// ou modifier agent/.claude/skills/<identifiant>/SKILL.md avec un en-tête valide, et « non » à
// tout le reste. Les règles deny de agent/.claude/settings.json passent avant lui.

const fs = require('fs');
const path = require('path');

const DOSSIER_AGENT = path.resolve(__dirname, '..', 'agent');
const SKILLS = path.join(DOSSIER_AGENT, '.claude', 'skills');
const ID_VALIDE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_TAILLE = 100 * 1024;

// ---------- Les règles ----------

function non(message) { return { behavior: 'deny', message }; }

// Le chemin visé est-il exactement agent/.claude/skills/<identifiant>/SKILL.md ? Renvoie l'identifiant.
function identifiantDuChemin(brut) {
  if (typeof brut !== 'string' || !brut) return null;
  const complet = path.resolve(DOSSIER_AGENT, brut);
  if (path.basename(complet) !== 'SKILL.md') return null;
  const dossier = path.dirname(complet);
  if (path.dirname(dossier) !== SKILLS) return null;
  const id = path.basename(dossier);
  if (!ID_VALIDE.test(id) || id.length > 60) return null;
  // Aucun lien symbolique sur le chemin (le dossier skills, celui du skill, le fichier).
  for (const p of [path.join(DOSSIER_AGENT, '.claude'), SKILLS, dossier, complet]) {
    try { if (fs.lstatSync(p).isSymbolicLink()) return null; } catch { /* pas encore créé : normal */ }
  }
  return id;
}

// En-tête attendu :
// ---
// name: <identifiant>
// description: <une ou deux phrases>
// ---
// puis la méthode.
function verifierContenu(texte, id) {
  if (typeof texte !== 'string') return 'contenu manquant';
  if (Buffer.byteLength(texte) > MAX_TAILLE) return 'fichier trop long (100 Ko au maximum)';
  const m = texte.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/);
  if (!m) return 'le fichier doit commencer par un en-tête entre deux lignes « --- »';
  const champs = {};
  for (const ligne of m[1].split(/\r?\n/)) {
    if (!ligne.trim()) continue;
    const c = ligne.match(/^([a-z][a-z0-9_-]*):[ \t]*(.*)$/i);
    if (!c) return `ligne d'en-tête incomprise : « ${ligne.slice(0, 60)} » (une seule ligne par champ)`;
    champs[c[1]] = c[2].trim();
  }
  for (const cle of Object.keys(champs)) {
    if (cle !== 'name' && cle !== 'description') return `champ d'en-tête non autorisé : ${cle} (seulement name et description)`;
  }
  if (champs.name !== id) return `name doit être exactement « ${id} » (le nom du dossier)`;
  const d = champs.description || '';
  if (!d) return 'description manquante';
  const guillemets = /^"(?:[^"\\]|\\.)*"$/.test(d) || /^'(?:[^']|'')*'$/.test(d);
  if (!guillemets && (/:\s/.test(d) || /\s#/.test(d) || /^[-?:,[\]{}#&*!|>'"%@`]/.test(d))) {
    return 'mettez la description entre guillemets droits ("…") : elle contient « : », « # » ou commence par un signe spécial';
  }
  if (!m[2].trim()) return 'la méthode (le texte sous l\'en-tête) est vide';
  return null;
}

function decider(nomOutil, entree) {
  const e = entree || {};
  if (nomOutil !== 'Write' && nomOutil !== 'Edit') {
    return non(`Action non autorisée (${nomOutil}). Seule l'écriture d'un skill (.claude/skills/<identifiant>/SKILL.md) peut être approuvée.`);
  }
  const id = identifiantDuChemin(e.file_path);
  if (!id) {
    return non('Écriture refusée : seul un fichier .claude/skills/<identifiant>/SKILL.md (identifiant en minuscules, chiffres et tirets) peut être écrit ici.');
  }
  let final;
  if (nomOutil === 'Write') {
    final = e.content;
  } else {
    let actuel;
    try { actuel = fs.readFileSync(path.resolve(DOSSIER_AGENT, e.file_path), 'utf8'); } catch { return non('Ce skill n\'existe pas encore : créez-le avec Write.'); }
    if (typeof e.old_string !== 'string' || typeof e.new_string !== 'string' || !e.old_string) return non('Modification incomprise.');
    if (!actuel.includes(e.old_string)) return non('Le texte à remplacer est introuvable dans le skill.');
    final = e.replace_all ? actuel.split(e.old_string).join(e.new_string) : actuel.replace(e.old_string, () => e.new_string);
  }
  const pb = verifierContenu(final, id);
  if (pb) return non(`Skill refusé : ${pb}.`);
  return { behavior: 'allow', updatedInput: e };
}

// ---------- Le protocole MCP (JSON-RPC 2.0, un message JSON par ligne) ----------

const OUTIL = {
  name: 'approuver',
  description: 'Approbation automatique des écritures de skills (usage interne de Claude Code).',
  inputSchema: {
    type: 'object',
    properties: {
      tool_name: { type: 'string' },
      input: { type: 'object' },
      tool_use_id: { type: 'string' },
    },
    required: ['tool_name', 'input'],
  },
};

function envoyer(message) { process.stdout.write(JSON.stringify(message) + '\n'); }
function repondre(id, result) { envoyer({ jsonrpc: '2.0', id, result }); }
function erreur(id, code, message) { envoyer({ jsonrpc: '2.0', id, error: { code, message } }); }

function traiter(msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return;
  const { id, method, params } = msg;
  const estRequete = id !== undefined && id !== null;
  switch (method) {
    case 'initialize':
      return repondre(id, {
        protocolVersion: (params && params.protocolVersion) || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'approbation', version: '1.0.0' },
      });
    case 'ping':
      return repondre(id, {});
    case 'tools/list':
      return repondre(id, { tools: [OUTIL] });
    case 'tools/call': {
      const nom = params && params.name;
      if (nom !== 'approuver') return erreur(id, -32602, 'Outil inconnu');
      const a = (params && params.arguments) || {};
      let decision;
      try { decision = decider(a.tool_name, a.input); } catch { decision = non('Erreur de vérification : écriture refusée.'); }
      const fichier = a.input && a.input.file_path ? path.basename(path.dirname(String(a.input.file_path))) + '/' + path.basename(String(a.input.file_path)) : '';
      process.stderr.write(`approbation : ${decision.behavior === 'allow' ? 'oui' : 'non'} (${a.tool_name}${fichier ? ' ' + fichier : ''})\n`);
      return repondre(id, { content: [{ type: 'text', text: JSON.stringify(decision) }] });
    }
    default:
      if (estRequete) return erreur(id, -32601, 'Méthode inconnue');
      return undefined; // notifications (initialized, cancelled…) : rien à répondre
  }
}

if (require.main === module) {
  let tampon = '';
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
      traiter(msg);
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

module.exports = { decider, verifierContenu, identifiantDuChemin };
