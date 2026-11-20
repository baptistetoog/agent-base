#!/usr/bin/env node
'use strict';
// =============================================================================
// mcp-plateforme.js — serveur MCP stdio intégré (sans dépendance), toujours branché à l'agent.
// Outil : demander_validation(titre, ce_que_je_vais_faire, outil_prevu, contenu_exact)
//   → crée une carte « en attente » dans data/validations.json (sous verrou) et répond
//     « Demande n°X envoyée, attends la réponse. »
// Sa description liste les outils marqués « Action » : en mode « Propose », l'agent ne les voit plus,
// il en a besoin pour remplir outil_prevu.
// Variables reçues du serveur (configuration MCP du lancement) : AUTEUR_NOM, AUTEUR_EMAIL, MESSAGE_ID.
// =============================================================================

const validations = require('./validations');
const connexions = require('./connexions');
const automatisations = require('./automatisations');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// Lien public d'une photo de documents/ (pour la publier : Google exige une adresse publique).
// Copie dans data/photos-publiques/<id aléatoire>.<ext>, servie par /photo/<id>.<ext>. Aucune autre donnée n'est exposée.
const DOSSIER_DOCUMENTS = path.resolve(__dirname, '..', 'agent', 'documents');
const DOSSIER_PUBLIC = path.resolve(__dirname, '..', 'data', 'photos-publiques');
const EXT_PHOTO = { '.jpg': 'jpg', '.jpeg': 'jpg', '.png': 'png', '.webp': 'webp', '.pdf': 'pdf' };
function lienPublicPhoto(fichier) {
  const nom = String(fichier || '').replace(/^documents\//, '');
  const source = path.resolve(DOSSIER_DOCUMENTS, nom);
  if (!source.startsWith(DOSSIER_DOCUMENTS + path.sep)) return { erreur: 'Donne le nom d\'une photo de documents/.' };
  const ext = EXT_PHOTO[path.extname(source).toLowerCase()];
  if (!ext) return { erreur: 'Seules les photos (JPG, PNG, WEBP) et les PDF (une plaquette, par exemple) peuvent avoir un lien public.' };
  let st;
  try { st = fs.lstatSync(source); } catch { return { erreur: 'Photo introuvable dans documents/ : ' + nom }; }
  if (!st.isFile() || st.isSymbolicLink()) return { erreur: 'Photo introuvable dans documents/ : ' + nom };
  if (st.size > 10 * 1024 * 1024) return { erreur: 'Photo trop lourde (10 Mo au maximum).' };
  const base = String(process.env.ADRESSE_OUTIL || '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) return { erreur: 'Adresse publique de l\'outil inconnue : ouvrez l\'outil dans le navigateur, puis réessayez.' };
  fs.mkdirSync(DOSSIER_PUBLIC, { recursive: true, mode: 0o700 });
  const id = crypto.randomBytes(16).toString('hex');
  fs.copyFileSync(source, path.join(DOSSIER_PUBLIC, `${id}.${ext}`));
  return { url: `${base}/photo/${id}.${ext}` };
}

// PDF (export de Claude Design) -> images PNG de 1080 px de large dans documents/, une par page (10 au maximum).
function pdfEnImages(fichier) {
  const nom = String(fichier || '').replace(/^documents\//, '');
  const source = path.resolve(DOSSIER_DOCUMENTS, nom);
  if (!source.startsWith(DOSSIER_DOCUMENTS + path.sep) || path.extname(source).toLowerCase() !== '.pdf') return { erreur: 'Donne le nom d\'un PDF de documents/ (ex. visuel.pdf).' };
  let st;
  try { st = fs.lstatSync(source); } catch { return { erreur: 'PDF introuvable dans documents/ : ' + nom }; }
  if (!st.isFile() || st.isSymbolicLink()) return { erreur: 'PDF introuvable dans documents/ : ' + nom };
  if (st.size > 20 * 1024 * 1024) return { erreur: 'PDF trop lourd (20 Mo au maximum).' };
  let largeur = 0;
  try {
    const m = fs.readFileSync(source, 'latin1').match(/\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/);
    if (m) largeur = parseFloat(m[3]) - parseFloat(m[1]);
  } catch {}
  const dpi = largeur > 0 ? Math.min(600, Math.max(36, Math.round(1080 * 72 / largeur))) : 150;
  const racine = path.basename(nom, path.extname(nom)).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60) || 'visuel';
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pdf-'));
  try {
    execFileSync('gs', ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=png16m', '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4',
      '-r' + dpi, '-dFirstPage=1', '-dLastPage=10', '-sOutputFile=' + path.join(tmp, 'p-%02d.png'), source], { timeout: 90000, stdio: 'ignore' });
    const pages = fs.readdirSync(tmp).filter((f) => /^p-\d+\.png$/.test(f)).sort();
    if (!pages.length) return { erreur: 'Aucune page lisible dans ce PDF.' };
    const noms = pages.map((p, i) => {
      const sortie = `${racine}-${pages.length > 1 ? 'page-' + (i + 1) : 'image'}.png`;
      fs.copyFileSync(path.join(tmp, p), path.join(DOSSIER_DOCUMENTS, sortie));
      return sortie;
    });
    return { noms, dpi };
  } catch (e) {
    return { erreur: 'Conversion impossible : ' + (e.message || e).toString().slice(0, 200) };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

// Aperçu d'une vidéo (lien Google Drive partagé « Tous les utilisateurs disposant du lien », ou vidéo de documents/) :
// durée, format et 4 images JPEG dans documents/, que l'agent regarde avec Read. La vidéo elle-même n'est pas gardée.
function apercuVideo(source) {
  const src = String(source || '').trim();
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'video-'));
  try {
    let fichier, racine;
    const id = (src.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/) || src.match(/[?&]id=([A-Za-z0-9_-]{10,})/) || [])[1];
    if (id) {
      fichier = path.join(tmp, 'v');
      execFileSync('curl', ['-sSL', '--max-filesize', '1500000000', '--max-time', '300', '-o', fichier,
        `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`], { timeout: 320000, stdio: 'ignore' });
      const debut = fs.readFileSync(fichier).subarray(0, 200).toString('latin1');
      if (/<html|<!DOCTYPE/i.test(debut)) return { erreur: 'Google Drive refuse le téléchargement : la vidéo doit être partagée « Tous les utilisateurs disposant du lien ».' };
      racine = 'video-' + id.slice(0, 8);
    } else {
      const nom = src.replace(/^documents\//, '');
      fichier = path.resolve(DOSSIER_DOCUMENTS, nom);
      if (!fichier.startsWith(DOSSIER_DOCUMENTS + path.sep) || !fs.existsSync(fichier)) return { erreur: 'Donne le lien Google Drive de la vidéo, ou le nom d\'une vidéo de documents/.' };
      racine = path.basename(nom, path.extname(nom)).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60) || 'video';
    }
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_entries', 'format=duration:stream=width,height,codec_type', fichier], { timeout: 60000 }).toString());
    const duree = parseFloat((info.format || {}).duration) || 0;
    const vs = (info.streams || []).find((x) => x.codec_type === 'video');
    if (!vs || !duree) return { erreur: 'Ce fichier n\'est pas une vidéo lisible.' };
    const images = [0.1, 0.35, 0.6, 0.85].map((p, i) => {
      const sortie = `${racine}-apercu-${i + 1}.jpg`;
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String((duree * p).toFixed(2)), '-i', fichier, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4',
        path.join(DOSSIER_DOCUMENTS, sortie)], { timeout: 60000, stdio: 'ignore' });
      return sortie;
    });
    const format = vs.height > vs.width ? 'verticale (Reel, Story, TikTok)' : vs.height === vs.width ? 'carrée' : 'horizontale';
    return { duree: Math.round(duree), largeur: vs.width, hauteur: vs.height, format, images };
  } catch (e) {
    return { erreur: 'Aperçu impossible : ' + (e.message || e).toString().slice(0, 200) };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

function description() {
  const actions = connexions.outilsAction();
  const liste = actions.length
    ? actions.map((o) => `- ${o.nom}${o.description ? ' : ' + o.description.replace(/\s+/g, ' ').slice(0, 140) : ''}`).join('\n')
    : '- (aucun outil d\'action branché pour l\'instant)';
  return 'Demande à un admin de valider une action qui modifie quelque chose dans le monde réel (envoyer, publier, créer, ' +
    'modifier, supprimer dans un outil branché). Prépare tout avant, donne le contenu EXACT (texte du mail, du message, ' +
    'données envoyées…), puis arrête-toi : tu seras relancé si l\'action est validée.\n\n' +
    'Outils d\'action possibles pour outil_prevu (nom complet) :\n' + liste;
}

function outils() {
  return [{
    name: 'demander_validation',
    description: description(),
    inputSchema: {
      type: 'object',
      properties: {
        titre: { type: 'string', description: 'Titre court de la carte (ex. « Envoyer le devis à la société Martin »).' },
        ce_que_je_vais_faire: { type: 'string', description: 'En une ou deux phrases, ce que tu vas faire exactement et pourquoi.' },
        outil_prevu: { type: 'string', description: 'Nom complet de l\'outil d\'action à utiliser (ex. mcp__crm__create_contact).' },
        contenu_exact: { description: 'Le contenu exact qui sera envoyé ou écrit (texte, ou objet JSON des paramètres de l\'outil).' },
      },
      required: ['titre', 'ce_que_je_vais_faire', 'outil_prevu', 'contenu_exact'],
    },
  }, {
    name: 'lien_public_photo',
    description: 'Donne un lien public (https) à une photo ou à un PDF de documents/, pour le publier dans un outil qui demande l\'adresse ' +
      'd\'un fichier (le champ « Photo URL » d\'un post Google, la plaquette jointe à un mail de campagne…). Le lien est impossible à deviner, mais toute personne ' +
      'qui l\'a peut voir la photo : ne l\'utilise que pour une photo qui va être publiée.',
    inputSchema: {
      type: 'object',
      properties: { fichier: { type: 'string', description: 'Nom de la photo ou du PDF dans documents/ (ex. photo-03.jpg, plaquette.pdf).' } },
      required: ['fichier'],
    },
  }, {
    name: 'pdf_en_images',
    description: 'Transforme un PDF de documents/ (un visuel exporté de Claude Design, une affiche…) en images PNG de 1080 px de large, ' +
      'une par page (10 au maximum), enregistrées dans documents/. Ensuite, lien_public_photo donne à chaque image l\'adresse publique ' +
      'à mettre dans le post (Metricool, Google…).',
    inputSchema: {
      type: 'object',
      properties: { fichier: { type: 'string', description: 'Nom du PDF dans documents/ (ex. visuel-noel.pdf).' } },
      required: ['fichier'],
    },
  }, {
    name: 'apercu_video',
    description: 'Regarde une vidéo : à partir de son lien Google Drive (partagé « Tous les utilisateurs disposant du lien ») ou d\'une vidéo de documents/, ' +
      'donne sa durée, son format (verticale, carrée, horizontale) et 4 images prises au fil de la vidéo, enregistrées dans documents/. ' +
      'Regarde ensuite ces images avec Read pour savoir ce que montre la vidéo.',
    inputSchema: {
      type: 'object',
      properties: { source: { type: 'string', description: 'Lien Google Drive de la vidéo (https://drive.google.com/file/d/…) ou nom d\'une vidéo de documents/.' } },
      required: ['source'],
    },
  }, {
    name: 'proposer_automatisation',
    description: 'Propose une automatisation (une mission que tu feras tout seul à heure fixe, heure de Paris). Crée une carte ' +
      '« Automatisation » dans « À valider » : un admin l\'active en un clic. Utilise-la après l\'entretien de démarrage, ' +
      'quand on te dit « automatise ça », ou quand on te demande souvent la même chose. Tu ne peux pas changer le mode ' +
      'toi-même : recommande-le (mode_recommande), l\'admin l\'applique avec l\'interrupteur.',
    inputSchema: {
      type: 'object',
      properties: {
        nom: { type: 'string', description: 'Nom court (ex. « Point du matin »).' },
        consigne: { type: 'string', description: 'La mission complète, telle que tu la recevras à chaque passage.' },
        frequence: { type: 'string', enum: ['jour', 'semaine', 'mois'], description: 'jour = tous les jours ; semaine = chaque semaine tel jour ; mois = chaque mois tel jour.' },
        jour: { description: 'semaine : 1 (lundi) à 7 (dimanche) ; mois : 1 à 31 ; jour : rien.' },
        heure: { type: 'string', description: 'Heure de Paris, HH:MM (ex. 09:00).' },
        mode_recommande: { type: 'string', enum: ['propose', 'agit'], description: 'Facultatif : le mode conseillé d\'après l\'entretien.' },
        pourquoi: { type: 'string', description: 'Facultatif : en une phrase, pourquoi cette automatisation.' },
      },
      required: ['nom', 'consigne', 'frequence', 'heure'],
    },
  }];
}

function proposer(a) {
  const n = automatisations.normaliser(a);
  if (n.erreur) return { erreur: n.erreur };
  const mode = a.mode_recommande === 'agit' || a.mode_recommande === 'propose' ? a.mode_recommande : null;
  const texte = `Nom : ${n.nom}\nQuand : ${automatisations.texteFrequence(n)} (heure de Paris)\n` +
    (mode ? `Mode recommandé : ${mode === 'agit' ? 'Agit seul' : 'Propose'} (à régler avec l'interrupteur)\n` : '') + `\nMission :\n${n.consigne}`;
  return validations.creer({
    type: 'automatisation', titre: 'Automatisation : ' + n.nom, action: String(a.pourquoi || 'Mission régulière proposée par l\'agent.'),
    outil: '', contenu: texte, proposition: { ...n, modeRecommande: mode },
    demandePar: process.env.AUTEUR_EMAIL ? { nom: process.env.AUTEUR_NOM || '', email: process.env.AUTEUR_EMAIL, message: process.env.MESSAGE_ID || null } : null,
  });
}

function ecrire(m) { process.stdout.write(JSON.stringify(m) + '\n'); }

function traiter(msg) {
  const { id, method, params } = msg;
  const repondre = (result) => { if (id !== undefined && id !== null) ecrire({ jsonrpc: '2.0', id, result }); };
  const erreur = (code, message) => { if (id !== undefined && id !== null) ecrire({ jsonrpc: '2.0', id, error: { code, message } }); };
  switch (method) {
    case 'initialize':
      return repondre({ protocolVersion: (params && params.protocolVersion) || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'plateforme', version: '1.0.0' } });
    case 'notifications/initialized': case 'notifications/cancelled': return undefined;
    case 'ping': return repondre({});
    case 'tools/list': return repondre({ tools: outils() });
    case 'tools/call': {
      if (params && params.name === 'lien_public_photo') {
        let r;
        try { r = lienPublicPhoto((params.arguments || {}).fichier); } catch (e) { r = { erreur: e.message }; }
        if (r.erreur) return repondre({ content: [{ type: 'text', text: r.erreur }], isError: true });
        return repondre({ content: [{ type: 'text', text: 'Lien public de la photo : ' + r.url }] });
      }
      if (params && params.name === 'pdf_en_images') {
        let r;
        try { r = pdfEnImages((params.arguments || {}).fichier); } catch (e) { r = { erreur: e.message }; }
        if (r.erreur) return repondre({ content: [{ type: 'text', text: r.erreur }], isError: true });
        return repondre({ content: [{ type: 'text', text: `Images créées dans documents/ (1080 px de large) : ${r.noms.join(', ')}` }] });
      }
      if (params && params.name === 'apercu_video') {
        let r;
        try { r = apercuVideo((params.arguments || {}).source); } catch (e) { r = { erreur: e.message }; }
        if (r.erreur) return repondre({ content: [{ type: 'text', text: r.erreur }], isError: true });
        return repondre({ content: [{ type: 'text', text: `Vidéo de ${r.duree} s, ${r.format} (${r.largeur}×${r.hauteur}). Images à regarder dans documents/ : ${r.images.join(', ')}` }] });
      }
      if (params && params.name === 'proposer_automatisation') {
        let carte;
        try { carte = proposer(params.arguments || {}); } catch (e) { carte = { erreur: e.message }; }
        if (carte.erreur) return repondre({ content: [{ type: 'text', text: 'Proposition incomplète : ' + carte.erreur }], isError: true });
        return repondre({ content: [{ type: 'text', text: `Proposition n°${carte.id} envoyée : un admin peut l'activer dans « À valider ».` }] });
      }
      if (!params || params.name !== 'demander_validation') return erreur(-32602, 'Outil inconnu');
      const a = params.arguments || {};
      if (!a.titre || !a.ce_que_je_vais_faire || a.contenu_exact === undefined) {
        return repondre({ content: [{ type: 'text', text: 'Demande incomplète : donne titre, ce_que_je_vais_faire, outil_prevu et contenu_exact.' }], isError: true });
      }
      const contenu = typeof a.contenu_exact === 'string' ? a.contenu_exact : JSON.stringify(a.contenu_exact, null, 2);
      let carte;
      try {
        carte = validations.creer({
          titre: a.titre, action: a.ce_que_je_vais_faire, outil: a.outil_prevu, contenu,
          demandePar: process.env.AUTEUR_EMAIL ? { nom: process.env.AUTEUR_NOM || '', email: process.env.AUTEUR_EMAIL, message: process.env.MESSAGE_ID || null } : null,
        });
      } catch (e) {
        return repondre({ content: [{ type: 'text', text: 'La demande n\'a pas pu être enregistrée : ' + e.message }], isError: true });
      }
      return repondre({ content: [{ type: 'text', text: `Demande n°${carte.id} envoyée, attends la réponse. N'exécute pas l'action : arrête-toi ici et dis à la personne qu'un admin doit la valider dans « À valider ».` }] });
    }
    default: return erreur(-32601, 'Méthode inconnue');
  }
}

if (require.main === module) {
  let tampon = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (m) => {
    tampon += m;
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
