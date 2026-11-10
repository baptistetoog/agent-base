#!/usr/bin/env node
'use strict';
// mcp-plateforme.js — petit serveur MCP (stdio, sans dépendance), TOUJOURS branché à l'agent.
// Deux outils :
// - demander_validation(titre, ce_que_je_vais_faire, outil_prevu, contenu_exact) ;
// - proposer_automatisation(nom, consigne, frequence, jour, heure [, mode_recommande, pourquoi]) (étape 10) :
//   crée une carte « Automatisation » (bouton « Activer » pour un admin). Rien n'est créé ni activé sans ce clic ;
//   ce programme n'écrit jamais dans data/automatisations.json.
// Il crée une carte « en attente » dans data/validations.json (voir app/validations.js) et répond
// à l'agent « Demande n°X envoyée, attends la réponse. ». Le serveur voit la carte (surveillance
// du fichier), l'affiche dans l'onglet « À valider » et allume le « ! » de la scène 3D.
//
// Contexte passé par app/agent.js dans la configuration MCP (variables d'environnement) :
//   DISCUSSION (discussion en cours), LANCEMENT (identifiant du lancement), DEMANDE_PAR_NOM / DEMANDE_PAR_EMAIL.
// La description de l'outil liste les outils d'action des connexions (noms et descriptions seulement,
// aucun secret) : en mode « Propose », l'agent ne les voit pas directement.

const validations = require('./validations');
const automatisations = require('./automatisations'); // seulement normaliser / texteFrequence (fonctions pures)

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

function outilAutomatisation() {
  return {
    name: 'proposer_automatisation',
    description: [
      'Propose à l\'équipe une automatisation : une mission que tu feras tout seul, à heure fixe (fuseau Europe/Paris).',
      'Cela crée une carte « Automatisation » dans l\'onglet « À valider » : rien n\'est créé ni activé tant qu\'un admin n\'a pas cliqué « Activer ».',
      'Une automatisation par appel. La consigne est écrite comme un message qu\'on t\'enverrait, complète et autonome (personne ne sera là pour répondre à une question).',
      'mode_recommande : la réponse à la question « Je vous propose tout avant d\'agir, ou je peux agir seul ? » (propose ou seul). Tu ne changes pas le mode toi-même : l\'admin l\'applique avec l\'interrupteur.',
      'Après l\'appel, dis en une phrase que la proposition attend un clic sur « Activer » dans l\'onglet « À valider ».',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        nom: { type: 'string', description: 'Nom court (ex. « Point du matin »), 60 caractères au maximum.' },
        consigne: { type: 'string', description: 'La mission exacte que tu recevras à chaque passage.' },
        frequence: { type: 'string', enum: ['jour', 'semaine', 'mois'], description: 'jour = tous les jours ; semaine = chaque semaine tel jour ; mois = chaque mois tel jour du mois.' },
        jour: { type: 'string', description: 'semaine : lundi … dimanche ; mois : 1 à 31 ; jour : laisser vide.' },
        heure: { type: 'string', description: 'Heure de Paris au format HH:MM (ex. 09:00).' },
        mode_recommande: { type: 'string', enum: ['propose', 'seul'], description: 'Facultatif : le mode recommandé d\'après l\'entretien.' },
        pourquoi: { type: 'string', description: 'Facultatif : en une phrase, pourquoi tu proposes cette automatisation.' },
      },
      required: ['nom', 'consigne', 'frequence', 'heure'],
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
      return repondre(id, { tools: [outil(), outilAutomatisation()] });
    case 'tools/call': {
      const contexte = {
        discussion: process.env.DISCUSSION || null,
        lancement: process.env.LANCEMENT || null,
        demandePar: (process.env.DEMANDE_PAR_EMAIL || process.env.DEMANDE_PAR_NOM) ? { nom: process.env.DEMANDE_PAR_NOM || '', email: process.env.DEMANDE_PAR_EMAIL || '' } : null,
      };
      if (params && params.name === 'proposer_automatisation') {
        const a = params.arguments || {};
        const prop = automatisations.normaliser(a);
        if (prop.erreur) return texte(id, prop.erreur + ' Corrige et réessaie une fois.', true);
        let r;
        try {
          r = validations.creerAutomatisation(prop, { texteFrequence: automatisations.texteFrequence(prop), modeRecommande: a.mode_recommande, pourquoi: a.pourquoi }, contexte);
        } catch (e) { r = { erreur: 'La proposition n\'a pas pu être enregistrée (' + e.message + '). Réessaie une fois.' }; }
        if (r.erreur) return texte(id, r.erreur, true);
        process.stderr.write(`plateforme : automatisation proposée (carte n°${r.carte.n})\n`);
        return texte(id, `Proposition n°${r.carte.n} envoyée : « ${prop.nom} », ${automatisations.texteFrequence(prop).toLowerCase()}. Elle attend un clic sur « Activer » dans l'onglet « À valider ».`);
      }
      if (!params || params.name !== 'demander_validation') return erreur(id, -32602, 'Outil inconnu');
      const a = params.arguments || {};
      let r;
      try {
        r = validations.creer(a, contexte);
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
