'use strict';
// skills.js — les skills de l'agent (format natif de Claude Code) :
// agent/.claude/skills/<identifiant>/SKILL.md, avec en tête
// ---
// name: <identifiant>
// description: <quand utiliser ce skill>
// ---
// puis la méthode en Markdown.
// L'identifiant est toujours nettoyé (minuscules, chiffres, tirets) : on ne peut rien écrire
// ailleurs que dans agent/.claude/skills/.

const fs = require('fs');
const path = require('path');

const DOSSIER_AGENT = path.resolve(__dirname, '..', 'agent');
const SKILLS = path.join(DOSSIER_AGENT, '.claude', 'skills');
const ID_VALIDE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID = 60;
const MAX_DESCRIPTION = 400;
const MAX_METHODE = 60 * 1024;

// « Synthèse de document ! » → « synthese-de-document »
function nettoyerId(brut) {
  return String(brut || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ID)
    .replace(/-+$/g, '');
}

function idValide(id) { return typeof id === 'string' && id.length <= MAX_ID && ID_VALIDE.test(id); }

function dossierSkill(id) {
  if (!idValide(id)) return null;
  const d = path.join(SKILLS, id);
  if (path.dirname(d) !== SKILLS) return null;
  return d;
}

function estLien(p) { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } }

// Valeur d'en-tête : retire les guillemets YAML éventuels.
function valeurEntete(v) {
  const t = String(v || '').trim();
  if (/^"(?:[^"\\]|\\.)*"$/.test(t)) { try { return JSON.parse(t); } catch { return t.slice(1, -1); } }
  if (/^'(?:[^']|'')*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

function lireFichier(texte) {
  const m = String(texte || '').replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/);
  if (!m) return { name: '', description: '', methode: String(texte || '').trim() };
  const champs = {};
  for (const ligne of m[1].split(/\r?\n/)) {
    const c = ligne.match(/^([a-z][a-z0-9_-]*):[ \t]*(.*)$/i);
    if (c) champs[c[1]] = valeurEntete(c[2]);
  }
  return { name: champs.name || '', description: champs.description || '', methode: m[2].replace(/^\s*\n/, '').trimEnd() };
}

function lister() {
  let noms = [];
  try { noms = fs.readdirSync(SKILLS); } catch { return []; }
  const res = [];
  for (const id of noms) {
    const d = dossierSkill(id);
    if (!d || estLien(d)) continue;
    const f = path.join(d, 'SKILL.md');
    let st;
    try { st = fs.lstatSync(f); } catch { continue; }
    if (!st.isFile()) continue;
    let texte = '';
    try { texte = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const s = lireFichier(texte);
    res.push({ id, description: s.description, methode: s.methode, modifie: st.mtime.toISOString(), valide: s.name === id && Boolean(s.description) });
  }
  return res.sort((a, b) => a.id.localeCompare(b.id));
}

function existe(id) {
  const d = dossierSkill(id);
  if (!d || estLien(d)) return false;
  try { return fs.lstatSync(path.join(d, 'SKILL.md')).isFile(); } catch { return false; }
}

// La description est toujours écrite entre guillemets : le « : » français ne casse pas l'en-tête.
function fabriquer(id, description, methode) {
  return `---\nname: ${id}\ndescription: ${JSON.stringify(description)}\n---\n\n${methode.trim()}\n`;
}

// Créer ou modifier. corps : { nom, description, methode, ancien? (identifiant avant renommage) }
function enregistrer(corps) {
  const id = nettoyerId(corps.nom);
  const description = String(corps.description || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const methode = String(corps.methode || '').replace(/\r\n/g, '\n');
  const ancien = corps.ancien ? String(corps.ancien) : null;
  if (!id) return { code: 400, erreur: 'Donnez un nom au skill (lettres, chiffres ou tirets).' };
  if (!description) return { code: 400, erreur: 'Dites en une ou deux phrases quand utiliser ce skill.' };
  if (description.length > MAX_DESCRIPTION) return { code: 400, erreur: `Description trop longue (${MAX_DESCRIPTION} caractères au maximum).` };
  if (!methode.trim()) return { code: 400, erreur: 'Écrivez la méthode que l\'agent doit suivre.' };
  if (Buffer.byteLength(methode) > MAX_METHODE) return { code: 413, erreur: 'Méthode trop longue (60 Ko au maximum).' };
  if (ancien !== null && !existe(ancien)) return { code: 404, erreur: 'Ce skill n\'existe plus.' };
  if ((ancien === null || ancien !== id) && existe(id)) return { code: 409, erreur: `Un skill « ${id} » existe déjà.` };
  if (estLien(path.join(DOSSIER_AGENT, '.claude')) || estLien(SKILLS)) return { code: 400, erreur: 'Dossier des skills refusé.' };

  fs.mkdirSync(SKILLS, { recursive: true, mode: 0o755 });
  const d = dossierSkill(id);
  if (ancien !== null && ancien !== id) fs.renameSync(dossierSkill(ancien), d);
  else fs.mkdirSync(d, { recursive: true, mode: 0o755 });
  if (estLien(d)) return { code: 400, erreur: 'Dossier refusé.' };
  const f = path.join(d, 'SKILL.md');
  if (estLien(f)) return { code: 400, erreur: 'Fichier refusé.' };
  const tmp = path.join(d, '.SKILL.md.' + process.pid + '.tmp');
  fs.writeFileSync(tmp, fabriquer(id, description, methode), { mode: 0o644 });
  fs.renameSync(tmp, f);
  return { code: 200, ok: true, skill: lister().find((s) => s.id === id) };
}

function supprimer(idBrut) {
  const id = String(idBrut || '');
  const d = dossierSkill(id);
  if (!d || !existe(id)) return { code: 404, erreur: 'Skill introuvable.' };
  fs.rmSync(d, { recursive: true, force: true });
  return { code: 200, ok: true };
}

// Le chemin écrit par l'agent est-il un SKILL.md ?
function estFichierSkill(chemin) {
  if (!chemin) return false;
  const complet = path.resolve(DOSSIER_AGENT, String(chemin));
  return path.basename(complet) === 'SKILL.md' && path.dirname(path.dirname(complet)) === SKILLS;
}

module.exports = { lister, enregistrer, supprimer, existe, nettoyerId, idValide, estFichierSkill, lireFichier };
