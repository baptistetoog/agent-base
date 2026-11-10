#!/usr/bin/env node
'use strict';
// mcp-plateforme.js — petit serveur MCP (stdio, sans dépendance), TOUJOURS branché à l'agent.
// Un outil : demander_validation(titre, ce_que_je_vais_faire, outil_prevu, contenu_exact).
// Il crée une carte « en attente » dans data/validations.json (voir app/validations.js) et répond
// à l'agent « Demande n°X envoyée, attends la réponse. ». Le serveur voit la carte (surveillance
// du fichier), l'affiche dans l'onglet « À valider » et allume le « ! » de la scène 3D.
//
// Contexte passé par app/agent.js dans la configuration MCP (variables d'environnement) :
//   DISCUSSION (discussion en cours), LANCEMENT (identifiant du lancement), DEMANDE_PAR_NOM / DEMANDE_PAR_EMAIL.
// La description de l'outil liste les outils d'action des connexions (noms et descriptions seulement,
// aucun secret) : en mode « Propose », l'agent ne les voit pas directement.

const validations = require('./validations');

let connexions = null;
try { connexions = require('./connexions'); } catch { /* liste des actions indisponible : pas grave */ }

function listeActions() {
  try {
    const l = connexions ? connexions.outilsActions() : [];
    if (!l.length) return 'Aucun outil d\'action branché pour l\'instant.';
    return 'Outils d\'action branchés (à indiquer dans outil_prevu) :\n' + l.map((o) => `- ${o.complet}${o.description ? ' : ' + o.description.slice(0, 160) : ''}`).join('\n');
  } catch { return ''; }
}

function outil() {
  return {
    name: 'demander_validation',
    description: [
      'Demande à l\'équipe de valider une action qui modifie quelque chose dans un outil branché (envoyer, publier, créer, modifier, supprimer).',
      'Prépare tout avant : contenu_exact doit contenir EXACTEMENT ce qui sera envoyé (texte complet du mail ou du message, données JSON, méthode et chemin pour une API…), sans « … » ni partie à compléter.',
      'Après l\'appel, arrête-toi : dis en une phrase que la demande attend une validation. Tu seras relancé si elle est validée.',
      listeActions(),
    ].filter(Boolean).join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        titre: { type: 'string', description: 'Titre court de l\'action (ex. « Envoyer le devis à Mme Durand »).' },
        ce_que_je_vais_faire: { type: 'string', description: 'En une ou deux phrases simples : ce que tu vas faire, où, pour qui.' },
        outil_prevu: { type: 'string', description: 'Nom complet de l\'outil que tu utiliseras (ex. mcp__crm__appel_api).' },
        contenu_exact: { type: 'string', description: 'Le contenu exact qui sera envoyé ou écrit (l\'admin peut le corriger avant de valider).' },
      },
      required: ['titre', 'ce_que_je_vais_faire', 'outil_prevu', 'contenu_exact'],
    },
  };
}

function envoyer(message) { process.stdout.write(JSON.stringify(message) + '\n'); }
function repondre(id, result) { envoyer({ jsonrpc: '2.0', id, result }); }
function erreur(id, code, message) { envoyer({ jsonrpc: '2.0', id, error: { code, message } }); }
function texte(id, t, estErreur) { repondre(id, { content: [{ type: 'text', text: t }], ...(estErreur ? { isError: true } : {}) }); }

function traiter(msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return;
  const { id, method, params } = msg;
  const estRequete = id !== undefined && id !== null;
  switch (method) {
    case 'initialize':
      return repondre(id, {
        protocolVersion: (params && params.protocolVersion) || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'plateforme', version: '1.0.0' },
      });
    case 'ping':
      return repondre(id, {});
    case 'tools/list':
      return repondre(id, { tools: [outil()] });
    case 'tools/call': {
      if (!params || params.name !== 'demander_validation') return erreur(id, -32602, 'Outil inconnu');
      const a = params.arguments || {};
      let r;
      try {
        r = validations.creer(a, {
          discussion: process.env.DISCUSSION || null,
          lancement: process.env.LANCEMENT || null,
          demandePar: process.env.DEMANDE_PAR_EMAIL ? { nom: process.env.DEMANDE_PAR_NOM || '', email: process.env.DEMANDE_PAR_EMAIL } : null,
        });
      } catch (e) { r = { erreur: 'La demande n\'a pas pu être enregistrée (' + e.message + '). Réessaie une fois.' }; }
      if (r.erreur) return texte(id, r.erreur, true);
      process.stderr.write(`plateforme : demande n°${r.carte.n} créée\n`);
      return texte(id, `Demande n°${r.carte.n} envoyée, attends la réponse.`);
    }
    default:
      if (estRequete) return erreur(id, -32601, 'Méthode inconnue');
      return undefined;
  }
}

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
