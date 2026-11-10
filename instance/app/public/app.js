// app.js — le bureau de l'agent : scène 3D, discussion en direct, réglages, mise en route.
import { creerBureau } from './bureau3d.js';
import { markdownEnHTML } from './markdown.js';

// Apparence du personnage (voir PROJET.md, « Personnage du bureau 3D »).
const PERSONNAGE = { couleurCorps: '#4C5A70', couleurYeux: '#FFD43B', badge: 'IA', accessoire: 'aucun', fond: '#F5F6F8' };
const SUGGESTIONS = ['Présente-toi', 'Que sais-tu faire ?', 'Aide-moi à rédiger un mail'];
const TEXTES_ETAT = {
  repos: 'Au repos', message: 'Lit votre message…', reflechit: 'Réfléchit…',
  outil: 'Travaille…', repond: 'Écrit sa réponse…', fini: 'A fini',
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const app = {
  moi: null, marque: null,
  claude: { connecte: false, depuis: null },
  statut: { etat: 'repos', occupe: false, file: 0 },
  discussion: null,
  ids: new Set(),
  enCours: null,       // { id, ligne, md, outils, texte }
  bureau: null,
  fluxDejaOuvert: false,
};

// ---------- Outils ----------

function el(balise, classe, texte) {
  const e = document.createElement(balise);
  if (classe) e.className = classe;
  if (texte !== undefined) e.textContent = texte;
  return e;
}

async function api(chemin, options = {}) {
  const init = { method: options.method || 'GET', headers: {} };
  if (options.corps !== undefined) {
    init.method = options.method || 'POST';
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.corps);
  }
  const r = await fetch(chemin, init);
  if (r.status === 401) { window.location.href = '/connexion.html'; throw new Error('Non connecté'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.erreur || 'Une erreur est survenue.'); e.donnees = d; e.code = r.status; throw e; }
  return d;
}

function stockage(cle, valeur) {
  try {
    if (valeur === undefined) return JSON.parse(localStorage.getItem('agent.' + cle) || 'null');
    localStorage.setItem('agent.' + cle, JSON.stringify(valeur));
  } catch { return null; }
  return valeur;
}

function heure(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const auj = new Date();
  const h = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === auj.toDateString()) return h;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ', ' + h;
}

function dateLongue(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function prenomDe(nom) { return String(nom || '').trim().split(/\s+/)[0] || ''; }

function toast(texte, type = '') {
  const t = el('div', 'toast ' + type, texte);
  t.setAttribute('role', type === 'erreur' ? 'alert' : 'status');
  $('#toasts').append(t);
  setTimeout(() => { t.classList.add('sortie'); setTimeout(() => t.remove(), 250); }, type === 'erreur' ? 5000 : 3200);
}

// La petite tête de l'agent (mêmes couleurs que le personnage 3D).
function tete(taille = 30) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 40 40');
  s.setAttribute('width', taille);
  s.setAttribute('height', taille);
  s.setAttribute('class', 'tete-agent');
  s.setAttribute('aria-hidden', 'true');
  const ajouter = (nom, attrs) => { const n = document.createElementNS(ns, nom); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); s.append(n); return n; };
  ajouter('rect', { x: 2, y: 4, width: 36, height: 32, rx: 11, fill: PERSONNAGE.couleurCorps });
  ajouter('rect', { x: 2, y: 4, width: 36, height: 14, rx: 11, fill: '#FFFFFF', opacity: '.08' });
  ajouter('ellipse', { cx: 14, cy: 19, rx: 5, ry: 6, fill: PERSONNAGE.couleurYeux });
  ajouter('ellipse', { cx: 26, cy: 19, rx: 5, ry: 6, fill: PERSONNAGE.couleurYeux });
  ajouter('circle', { cx: 15, cy: 20, r: 2.2, fill: '#1F2430' });
  ajouter('circle', { cx: 27, cy: 20, r: 2.2, fill: '#1F2430' });
  ajouter('path', { d: 'M16 29 q4 3 8 0', stroke: '#FFFFFF', 'stroke-width': 2, 'stroke-linecap': 'round', fill: 'none', opacity: '.75' });
  return s;
}

// ---------- Marque, compte ----------

// Icône d'onglet : le logo, sinon le carré de couleur avec l'initiale.
function majFavicon(m) {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3B5BDB';
  const initiale = String(m.initiale || '?').replace(/[<&>"']/g, '');
  $('#favicon').href = m.logo || ('data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${accent}"/><text x="16" y="22" font-family="Inter,Arial,sans-serif" font-size="18" font-weight="700" fill="#fff" text-anchor="middle">${initiale}</text></svg>`));
}

function appliquerMarque() {
  const m = app.marque;
  document.title = `${m.nomAgent} · ${m.nomOutil}`;
  majFavicon(m);
  $$('[data-initiale]').forEach((e) => { e.textContent = m.initiale; e.hidden = Boolean(m.logo); });
  $$('[data-logo]').forEach((e) => { if (m.logo) { e.src = m.logo; e.alt = m.nomOutil; } e.hidden = !m.logo; });
  $$('[data-nom-outil]').forEach((e) => { e.textContent = m.nomOutil; });
  $$('[data-nom-agent]').forEach((e) => { e.textContent = m.nomAgent; });
  $$('[data-tete]').forEach((e) => { e.replaceChildren(tete(Number(e.dataset.tete) || 30)); });
  $('#zoneMessage').placeholder = `Écrivez à ${m.nomAgent}…`;
  const moi = app.moi;
  $('#entetePrenom').textContent = moi.prenom;
  $('#menuNom').textContent = moi.nom;
  $('#menuEmail').textContent = moi.email;
  $('#compteNom').textContent = moi.nom;
  $('#compteEmail').textContent = moi.email;
  $('#compteRole').textContent = moi.role === 'admin' ? 'Admin' : 'Membre';
}

const estAdmin = () => app.moi && app.moi.role === 'admin';

// La scène 3D : (re)créée avec le nom, l'espace et le badge en vigueur, sans recharger la page.
function creerScene() {
  const m = app.marque;
  if (app.bureau) { try { app.bureau.destroy(); } catch { /* rien */ } app.bureau = null; }
  try {
    app.bureau = creerBureau($('#scene3d'), {
      ...PERSONNAGE, nom: m.nomAgent, entreprise: m.nomOutil,
      badge: typeof m.badge === 'string' ? m.badge : PERSONNAGE.badge,
    });
    appliquerStatut(app.statut);
  } catch (e) { console.warn('Bureau 3D indisponible :', e); }
}

// Nouvelle marque reçue (Identité enregistrée, ici ou par un collègue).
function changerMarque(m) {
  if (!m) return;
  const avant = app.marque;
  if (avant && JSON.stringify(avant) === JSON.stringify(m)) return; // rien de neuf
  app.marque = m;
  appliquerMarque();
  remplirIdentite();
  if (!avant || avant.nomAgent !== m.nomAgent || avant.nomOutil !== m.nomOutil || avant.badge !== m.badge) creerScene();
  if ($('.accueil', fil())) afficherAccueil();
}

// ---------- Statut de l'agent (scène + étiquette + boutons) ----------

function appliquerStatut(s) {
  if (!s) return;
  app.statut = { ...app.statut, ...s };
  const st = app.statut;
  if (app.bureau) {
    app.bureau.statut(st.etat, st.etat === 'outil' ? (st.detail || 'Je travaille…') : undefined);
    app.bureau.parle(st.etat === 'repond');
  }
  let texte = st.etat === 'outil' ? (st.detail || TEXTES_ETAT.outil) : (TEXTES_ETAT[st.etat] || TEXTES_ETAT.repos);
  if (st.file > 0) texte += ` · ${st.file} message${st.file > 1 ? 's' : ''} en attente`;
  $('#etiquetteActivite').textContent = texte;
  const etiquette = $('#etiquette');
  etiquette.classList.toggle('travail', Boolean(st.occupe));
  etiquette.classList.toggle('fini', st.etat === 'fini');
  $('#boutonArreter').hidden = !st.occupe;
  if (app.enCours && st.etat === 'outil') majOutilsEnCours();
}

// ---------- Claude connecté ? ----------

function majClaude(c) {
  if (!c) return;
  app.claude = c;
  const p = $('#pastilleClaude');
  p.disabled = false;
  p.classList.toggle('ok', c.connecte);
  p.classList.toggle('attention', !c.connecte);
  p.textContent = c.connecte ? 'Claude connecté' : 'Claude non connecté';
  p.title = c.connecte ? (c.depuis ? 'Connecté depuis le ' + dateLongue(c.depuis) : 'Connecté') : 'Cliquez pour connecter Claude';

  const etat = $('#reglageClaudeEtat');
  etat.className = 'pastille ' + (c.connecte ? 'ok' : 'attention');
  etat.textContent = c.connecte ? 'Connecté' : 'Non connecté';
  $('#reglageClaudeDepuis').textContent = c.connecte
    ? (c.depuis ? 'depuis le ' + dateLongue(c.depuis) : '')
    : 'L\'agent ne peut pas encore répondre.';
  const admin = estAdmin();
  $('#reglageClaudeActions').hidden = !admin;
  $('#reglageNonAdmin').hidden = admin;
  $('#reglageConnecter span').textContent = c.connecte ? 'Changer la clé' : 'Connecter Claude';
  $('#reglageConnecter').className = c.connecte ? 'bouton-secondaire' : 'bouton';
  $('#reglageDeconnecter').hidden = !c.connecte;
}

// ---------- Mise en route + voyants ----------

async function chargerEtat() {
  try {
    const e = await api('/api/etat');
    majClaude(e.claude);
    appliquerStatut(e.agent);
    rendreMiseEnRoute(e.miseEnRoute);
    rendreVoyants(e.voyants);
  } catch (err) { /* le flux réessaiera */ }
}

function rendreMiseEnRoute(mer) {
  const carte = $('#miseEnRoute');
  if (!mer || mer.terminee) { carte.hidden = true; return; }
  carte.hidden = false;
  const faites = mer.etapes.filter((e) => e.fait).length;
  const memo = stockage('miseEnRoute') || { faites: -1, replie: false };
  if (memo.faites >= 0 && faites > memo.faites) memo.replie = false; // une étape franchie : on redéplie
  memo.faites = faites;
  stockage('miseEnRoute', memo);
  $('#merProgres').textContent = `${faites}/${mer.etapes.length}`;
  $('#merBarre').style.width = `${Math.round((faites / mer.etapes.length) * 100)}%`;
  $('#merEntete').setAttribute('aria-expanded', String(!memo.replie));
  const liste = $('#merEtapes');
  liste.hidden = memo.replie;
  liste.replaceChildren();
  let premiere = true;
  let action = null;
  const COURTS = { claude: 'Claude', contexte: 'Contexte', outil: 'Outil', mission: 'Mission' };
  mer.etapes.forEach((etape, i) => {
    const li = el('li', 'mer-etape');
    const classe = etape.fait ? 'fait' : (!etape.disponible ? 'bientot' : (premiere ? 'a-faire' : ''));
    if (classe) li.classList.add(classe);
    if (!etape.fait && etape.disponible) premiere = false;
    const coche = el('span', 'mer-coche');
    coche.append(el('span', 'mer-coche-chiffre', String(i + 1)), el('span', 'mer-coche-ok', '✓'));
    li.append(coche, el('span', 'mer-texte', etape.titre), el('span', 'mer-court', COURTS[etape.id] || etape.titre));
    li.title = etape.titre + (etape.fait ? ' : fait' : (!etape.disponible ? ' : bientôt disponible' : ''));
    if (etape.fait) {
      li.append(el('span', 'pastille ok', 'Fait'));
    } else if (!etape.disponible) {
      const b = el('span', 'pastille');
      b.append(el('span', 'long', 'Bientôt disponible'), el('span', 'court', 'Bientôt'));
      li.append(b);
    } else if (etape.id === 'contexte') {
      const b = el('button', 'bouton bouton-petit');
      b.append(el('span', 'long', estAdmin() ? 'Compléter' : 'Voir'), el('span', 'court', 'Ouvrir'));
      b.type = 'button';
      b.addEventListener('click', () => allerA('contexte'));
      li.append(b);
      if (!action) action = { texte: estAdmin() ? 'Décrivez votre structure et la mission de l\'agent.' : 'Un admin doit décrire la mission de l\'agent.', bouton: 'Ouvrir', clic: () => allerA('contexte') };
    } else if (etape.id === 'outil') {
      if (estAdmin()) {
        const b = el('button', 'bouton bouton-petit');
        b.append(el('span', 'long', 'Brancher un outil'), el('span', 'court', 'Brancher'));
        b.type = 'button';
        b.addEventListener('click', () => allerA('connexions'));
        li.append(b);
        if (!action) action = { texte: 'Branchez un premier outil (MCP ou clé API) à l\'agent.', bouton: 'Brancher', clic: () => allerA('connexions') };
      } else {
        li.append(el('span', 'pastille attention', 'À faire par un admin'));
        if (!action) action = { texte: 'Un admin doit brancher un premier outil.' };
      }
    } else if (etape.id === 'claude') {
      if (estAdmin()) {
        const b = el('button', 'bouton bouton-petit');
        b.append(el('span', 'long', 'Connecter Claude'), el('span', 'court', 'Connecter'));
        b.type = 'button';
        b.addEventListener('click', ouvrirFenetreClaude);
        li.append(b);
        action = { texte: 'Connectez Claude pour que l\'agent puisse répondre.', bouton: 'Connecter', clic: ouvrirFenetreClaude };
      } else {
        li.append(el('span', 'pastille attention', 'À faire par un admin'));
        action = { texte: 'Un admin doit connecter Claude.' };
      }
    }
    liste.append(li);
  });
  // Sur mobile, les étapes deviennent une frise compacte : l'action à faire passe dessous.
  const ligne = $('#merAction');
  ligne.replaceChildren();
  ligne.hidden = !action || memo.replie;
  if (action) {
    ligne.append(el('span', 'mer-action-texte', action.texte));
    if (action.bouton) {
      const b = el('button', 'bouton bouton-petit', action.bouton);
      b.type = 'button';
      b.addEventListener('click', action.clic);
      ligne.append(b);
    }
  }
}

function rendreVoyants(v) {
  if (!v) return;
  const liste = $('#voyants');
  liste.replaceChildren();
  const lignes = [
    ['Claude', v.claude],
    ['Contexte de l\'agent', v.contexte],
    ['Connexions (outils)', v.connexions],
    ['Prochaine automatisation', v.automatisation],
  ];
  const occupe = app.statut.occupe;
  lignes.push(['Agent', { disponible: true, ok: true, texte: occupe ? 'Au travail' : 'Au repos' }]);
  for (const [nom, x] of lignes) {
    const li = el('li', 'voyant ' + (x.ok ? 'ok' : (x.disponible ? 'attention' : '')));
    li.append(el('span', 'voyant-point'), el('span', 'voyant-nom', nom), el('span', 'voyant-etat', x.texte));
    liste.append(li);
  }
}

// ---------- Discussion ----------

const fil = () => $('#fil');

function presDuBas() {
  const f = fil();
  return f.scrollHeight - f.scrollTop - f.clientHeight < 140;
}
function defiler(forcer = false) {
  const f = fil();
  if (forcer || presDuBas()) f.scrollTop = f.scrollHeight;
}

function afficherAccueil() {
  const f = fil();
  f.replaceChildren();
  const a = el('div', 'accueil vide');
  a.append(tete(64), el('p', 'accueil-titre', `Bonjour, je suis ${app.marque.nomAgent}`),
    el('p', 'accueil-texte', 'Posez-moi une question, ou commencez par une de ces idées :'));
  const s = el('div', 'suggestions');
  for (const texte of SUGGESTIONS) {
    const b = el('button', 'suggestion', texte);
    b.type = 'button';
    b.addEventListener('click', () => envoyer(texte));
    s.append(b);
  }
  a.append(s);
  f.append(a);
}

function retirerAccueil() {
  const a = $('.accueil', fil());
  if (a) a.remove();
  const c = $('.fil-chargement', fil());
  if (c) c.remove();
}

function blocOutils(outils, actif) {
  const d = el('details', 'outils' + (actif ? ' actif' : ''));
  const resume = el('summary');
  const dernier = outils[outils.length - 1];
  const texte = actif
    ? (dernier ? dernier.libelle : 'Travaille')
    : (outils.length === 1 ? outils[0].libelle : `${outils.length} outils utilisés`);
  resume.append(document.createTextNode('🔧 '), el('span', '', texte));
  const ul = el('ul');
  for (const o of outils) ul.append(el('li', '', o.detail || o.libelle));
  d.append(resume, ul);
  return d;
}

function elementMessage(m) {
  const agent = m.role === 'agent';
  const moi = !agent && m.qui && app.moi && m.qui.email === app.moi.email;
  const ligne = el('div', 'ligne ' + (agent ? 'agent' : (moi ? 'moi' : 'autre')));
  ligne.dataset.id = m.id;
  if (agent) ligne.append(tete(30));
  const bloc = el('div', 'bulle-bloc');
  const bulle = el('div', 'bulle');
  if (agent) {
    if (m.statut === 'erreur') bulle.classList.add('bulle-erreur');
    if (m.outils && m.outils.length) bulle.append(blocOutils(m.outils, false));
    const md = el('div', 'md');
    md.innerHTML = markdownEnHTML(m.texte || '');
    bulle.append(md);
    for (const f of (m.fichiers || [])) bulle.append(carteFichier('work', f));
  } else {
    let texte = m.texte || '';
    if (m.skill) {
      texte = texte.replace(/\n*Applique le skill [a-z0-9-]+\.\s*$/, '').trim();
      if (texte === 'Voici ma demande.') texte = '';
      const tag = el('span', 'etiquette-skill');
      tag.title = 'Skill appliqué à ce message';
      tag.innerHTML = '<svg class="icone" aria-hidden="true"><use href="#i-skill"/></svg>';
      tag.append(el('span', '', m.skill));
      bulle.append(tag);
    }
    if (m.fichier) texte = texte.replace(/\n*Fichier joint : documents\/[^\n]*$/, '').trim();
    if (texte) bulle.append(el('span', 'bulle-texte', texte));
    if (m.fichier) bulle.append(carteFichier('documents', m.fichier));
  }
  let meta = heure(m.quand);
  if (!agent && !moi && m.qui) meta = `${prenomDe(m.qui.nom)} · ${meta}`;
  if (agent && m.statut === 'arrete') meta += ' · arrêté';
  bloc.append(bulle, el('div', 'meta', meta));
  ligne.append(bloc);
  return ligne;
}

function lienTelechargement(dossier, nom) {
  return `/api/telecharger?dossier=${dossier}&nom=${encodeURIComponent(nom)}`;
}

// Petite carte « 📄 nom · Télécharger » dans une bulle.
function carteFichier(dossier, nom) {
  const a = el('a', 'carte-fichier');
  a.href = lienTelechargement(dossier, nom);
  a.setAttribute('download', nom);
  a.title = 'Télécharger ' + nom;
  a.append(el('span', 'carte-fichier-icone', '📄'), el('span', 'carte-fichier-nom', nom), el('span', 'carte-fichier-action', 'Télécharger'));
  return a;
}

function ajouterMessage(m) {
  if (!m || app.ids.has(m.id)) return;
  app.ids.add(m.id);
  retirerAccueil();
  const bas = presDuBas();
  fil().append(elementMessage(m));
  defiler(bas || (app.moi && m.qui && m.qui.email === app.moi.email));
}

function creerEnCours(id, texte = '', outils = []) {
  if (app.enCours && app.enCours.id === id) return;
  retirerAccueil();
  const ligne = el('div', 'ligne agent');
  ligne.dataset.id = id;
  ligne.append(tete(30));
  const bloc = el('div', 'bulle-bloc');
  const bulle = el('div', 'bulle');
  const zoneOutils = el('div', 'zone-outils');
  const md = el('div', 'md');
  bulle.append(zoneOutils, md);
  bloc.append(bulle, el('div', 'meta', 'en train d\'écrire…'));
  ligne.append(bloc);
  fil().append(ligne);
  app.enCours = { id, ligne, md, zoneOutils, texte, outils, rendu: false };
  rendreEnCours();
  majOutilsEnCours();
  defiler(true);
}

function rendreEnCours() {
  const c = app.enCours;
  if (!c) return;
  if (!c.texte) {
    c.md.replaceChildren();
    const p = el('span', 'points');
    p.append(el('i'), el('i'), el('i'));
    c.md.append(p);
    return;
  }
  c.md.innerHTML = markdownEnHTML(c.texte);
  const dernier = c.md.lastElementChild || c.md;
  const cible = (dernier.tagName === 'UL' || dernier.tagName === 'OL') ? (dernier.lastElementChild || dernier) : dernier;
  cible.append(el('span', 'curseur'));
}

let rafPrevu = false;
function planifierRendu() {
  if (rafPrevu) return;
  rafPrevu = true;
  requestAnimationFrame(() => {
    rafPrevu = false;
    const bas = presDuBas();
    rendreEnCours();
    if (bas) defiler(true);
  });
}

function majOutilsEnCours() {
  const c = app.enCours;
  if (!c) return;
  const ouvert = c.zoneOutils.firstElementChild && c.zoneOutils.firstElementChild.open;
  c.zoneOutils.replaceChildren();
  if (c.outils.length) {
    const d = blocOutils(c.outils, app.statut.etat === 'outil');
    d.open = Boolean(ouvert);
    c.zoneOutils.append(d);
  }
}

function finaliser(m) {
  const c = app.enCours;
  if (c && c.id === m.id) {
    app.ids.add(m.id);
    const bas = presDuBas();
    c.ligne.replaceWith(elementMessage(m));
    app.enCours = null;
    if (bas) defiler(true);
  } else {
    ajouterMessage(m);
  }
}

async function chargerDiscussion() {
  try {
    const d = await api('/api/discussion');
    app.discussion = d.discussion;
    app.ids.clear();
    app.enCours = null;
    fil().replaceChildren();
    if (!d.messages.length && !d.enCours) afficherAccueil();
    for (const m of d.messages) ajouterMessage(m);
    if (d.enCours) creerEnCours(d.enCours.id, d.enCours.texte, d.enCours.outils);
    appliquerStatut(d.statut);
    if (d.messages.length || d.enCours) requestAnimationFrame(() => defiler(true));
  } catch (e) {
    if (e.code !== 401) {
      fil().replaceChildren();
      const v = el('div', 'vide');
      v.append(el('p', 'vide-titre', 'Impossible de charger la discussion'), el('p', '', 'Vérifiez votre connexion, puis rechargez la page.'));
      fil().append(v);
    }
  }
}

async function envoyer(texte) {
  const t = String(texte || '').trim();
  const piece = app.pieceJointe;
  const skill = sk.choisi;
  if (!t && !piece) return;
  if (!app.claude.connecte) {
    if (estAdmin()) { toast('Connectez d\'abord Claude pour que l\'agent puisse répondre.', 'attention'); ouvrirFenetreClaude(); }
    else toast('L\'agent n\'est pas encore connecté : demandez à un admin.', 'attention');
    return;
  }
  const zone = $('#zoneMessage');
  zone.value = '';
  ajusterZone();
  let fichier = null;
  if (piece) {
    $('#boutonEnvoyer').disabled = true;
    $('#pieceTaille').textContent = 'envoi…';
    try {
      fichier = (await envoyerFichier('/api/joindre', piece)).document.nom;
    } catch (e) {
      toast(e.message, 'erreur');
      if (!zone.value) { zone.value = t; }
      afficherPiece(piece);
      ajusterZone();
      return;
    }
    retirerPiece();
  }
  if (app.bureau) app.bureau.statut('message');
  basculerMenuSkills(false);
  choisirSkill(null);
  try {
    const r = await api('/api/message', { corps: { texte: t, fichier, skill } });
    ajouterMessage(r.message);
    defiler(true);
    if (r.enAttente) toast(`L'agent termine son travail en cours : votre message passe ensuite (${r.enAttente} en attente).`);
  } catch (e) {
    if (!zone.value) { zone.value = t; ajusterZone(); }
    if (skill && sk.liste.some((s) => s.id === skill)) choisirSkill(skill);
    toast(e.message, 'erreur');
    if (e.donnees && e.donnees.connecter) ouvrirFenetreClaude();
    appliquerStatut(app.statut);
  }
}

function ajusterZone() {
  const z = $('#zoneMessage');
  z.style.height = 'auto';
  z.style.height = Math.min(z.scrollHeight, 180) + 'px';
  $('#boutonEnvoyer').disabled = !z.value.trim() && !app.pieceJointe;
}

// ---------- Fichiers : envoi, pièce jointe, listes ----------

const MAX_FICHIER = 20 * 1024 * 1024;
const EXT_ACCEPTEES = /\.(txt|md|markdown|csv|pdf|png|jpe?g|gif|webp)$/i;

function taille(o) {
  if (o < 1024) return `${o} o`;
  if (o < 1024 * 1024) return `${Math.round(o / 102.4) / 10} Ko`.replace('.', ',');
  return `${Math.round(o / 104857.6) / 10} Mo`.replace('.', ',');
}

function verifierFichier(f) {
  if (!EXT_ACCEPTEES.test(f.name)) return 'Format refusé : texte, Markdown, PDF, CSV ou image.';
  if (f.size > MAX_FICHIER) return `« ${f.name} » dépasse 20 Mo.`;
  if (!f.size) return `« ${f.name} » est vide.`;
  return null;
}

async function envoyerFichier(route, fichier) {
  const r = await fetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Nom-Fichier': encodeURIComponent(fichier.name) },
    body: fichier,
  });
  if (r.status === 401) { window.location.href = '/connexion.html'; throw new Error('Non connecté'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erreur || (r.status === 413 ? 'Le fichier dépasse la taille permise.' : 'L\'envoi a échoué.'));
  return d;
}

function afficherPiece(f) {
  app.pieceJointe = f;
  $('#pieceNom').textContent = f.name;
  $('#pieceTaille').textContent = taille(f.size);
  $('#pieceJointe').hidden = false;
  ajusterZone();
}
function retirerPiece() {
  app.pieceJointe = null;
  $('#pieceJointe').hidden = true;
  $('#champJoindre').value = '';
  ajusterZone();
}

function ligneFichier(dossier, f, admin, surSupprimer) {
  const li = el('li', 'fichier');
  li.append(el('span', 'fichier-icone', /\.(png|jpe?g|gif|webp)$/i.test(f.nom) ? '🖼️' : (/\.pdf$/i.test(f.nom) ? '📕' : '📄')));
  const infos = el('span', 'fichier-infos');
  infos.append(el('span', 'fichier-nom', f.nom), el('span', 'fichier-meta', `${taille(f.taille)} · ${heure(f.modifie)}`));
  li.append(infos);
  const actions = el('span', 'fichier-actions');
  if (f.texte) {
    const v = el('button', 'bouton-icone');
    v.type = 'button';
    v.title = 'Aperçu';
    v.setAttribute('aria-label', 'Aperçu de ' + f.nom);
    v.innerHTML = '<svg class="icone"><use href="#i-oeil"/></svg>';
    v.addEventListener('click', () => apercu(dossier, f.nom));
    actions.append(v);
  }
  const t = el('a', 'bouton-secondaire bouton-petit');
  t.href = lienTelechargement(dossier, f.nom);
  t.setAttribute('download', f.nom);
  t.innerHTML = '<svg class="icone"><use href="#i-telecharger"/></svg>';
  t.append(el('span', 'long', 'Télécharger'));
  t.setAttribute('aria-label', 'Télécharger ' + f.nom);
  actions.append(t);
  if (admin) {
    const s = el('button', 'bouton-icone bouton-danger');
    s.type = 'button';
    s.title = 'Supprimer';
    s.setAttribute('aria-label', 'Supprimer ' + f.nom);
    s.innerHTML = '<svg class="icone"><use href="#i-poubelle"/></svg>';
    s.addEventListener('click', () => surSupprimer(f.nom));
    actions.append(s);
  }
  li.append(actions);
  return li;
}

function listeVide(ul, titre, texte) {
  const li = el('li', 'vide liste-vide');
  li.append(el('p', 'vide-titre', titre), el('p', '', texte));
  ul.append(li);
}

async function chargerDocuments() {
  try {
    const d = await api('/api/documents');
    const ul = $('#listeDocuments');
    ul.replaceChildren();
    if (!d.documents.length) listeVide(ul, 'Aucun document', estAdmin() ? 'Déposez vos tarifs, votre catalogue, vos procédures : l\'agent s\'en servira.' : 'Un admin peut déposer des documents.');
    for (const f of d.documents) ul.append(ligneFichier('documents', f, d.admin, supprimerDocument));
  } catch { /* rien */ }
}

async function chargerFichiers() {
  try {
    const d = await api('/api/fichiers');
    const ul = $('#listeFichiers');
    ul.replaceChildren();
    if (!d.fichiers.length) listeVide(ul, 'Rien pour l\'instant', 'Demandez à l\'agent de rédiger quelque chose : le fichier apparaîtra ici.');
    for (const f of d.fichiers) ul.append(ligneFichier('work', f, d.admin, supprimerFichierAgent));
  } catch { /* rien */ }
}

async function supprimerDocument(nom) {
  const ok = await confirmer('Supprimer ce document ?', `« ${nom} » sera supprimé : l'agent ne pourra plus le consulter.`, 'Supprimer');
  if (!ok) return;
  try { await api('/api/documents/supprimer', { corps: { nom } }); toast('Document supprimé.', 'ok'); chargerDocuments(); }
  catch (e) { toast(e.message, 'erreur'); }
}

async function supprimerFichierAgent(nom) {
  const ok = await confirmer('Supprimer ce fichier ?', `« ${nom} » sera supprimé définitivement.`, 'Supprimer');
  if (!ok) return;
  try { await api('/api/fichiers/supprimer', { corps: { nom } }); toast('Fichier supprimé.', 'ok'); chargerFichiers(); }
  catch (e) { toast(e.message, 'erreur'); }
}

async function deposerDocuments(liste) {
  const fichiers = Array.from(liste || []);
  for (const f of fichiers) {
    const pb = verifierFichier(f);
    if (pb) { toast(pb, 'erreur'); continue; }
    try {
      const r = await envoyerFichier('/api/documents', f);
      toast(`« ${r.document.nom} » déposé.`, 'ok');
    } catch (e) { toast(e.message, 'erreur'); }
  }
  $('#champDeposer').value = '';
  chargerDocuments();
}

async function apercu(dossier, nom) {
  $('#titreApercu').textContent = nom;
  $('#apercuTelecharger').href = lienTelechargement(dossier, nom);
  $('#apercuTelecharger').setAttribute('download', nom);
  const zone = $('#apercuContenu');
  zone.replaceChildren(el('div', 'squelette apercu-squelette'));
  ouvrirFenetre('fenetreApercu');
  try {
    const r = await fetch(lienTelechargement(dossier, nom) + '&apercu=1');
    if (!r.ok) throw new Error();
    const t = await r.text();
    if (/\.(md|markdown)$/i.test(nom)) zone.innerHTML = markdownEnHTML(t);
    else { const pre = el('pre', 'apercu-brut', t); zone.replaceChildren(pre); }
  } catch { zone.replaceChildren(el('p', 'vide', 'Aperçu impossible. Téléchargez le fichier.')); }
}

// ---------- Identité ----------

function remplirIdentite() {
  const m = app.marque;
  if (!m || !app.moi) return;
  const form = $('#formIdentite');
  if (!form.dataset.modifie) {
    $('#champNomOutil').value = m.nomOutil;
    $('#champNomAgent').value = m.nomAgent;
    $('#champBadge').value = typeof m.badge === 'string' ? m.badge : PERSONNAGE.badge;
  }
  $('#logoImage').hidden = !m.logo;
  if (m.logo) $('#logoImage').src = m.logo;
  $('#logoInitiale').hidden = Boolean(m.logo);
  $('#logoInitiale').textContent = m.initiale;
  $('#boutonRetirerLogo').hidden = !m.logo;
  $('#boutonLogo').textContent = m.logo ? 'Changer le logo' : 'Envoyer un logo';
}

async function enregistrerIdentite(ev) {
  ev.preventDefault();
  const erreur = $('#erreurIdentite');
  erreur.textContent = '';
  const b = $('#boutonIdentite');
  b.disabled = true;
  try {
    const r = await api('/api/identite', { corps: { nomOutil: $('#champNomOutil').value, nomAgent: $('#champNomAgent').value, badge: $('#champBadge').value } });
    delete $('#formIdentite').dataset.modifie;
    changerMarque(r.marque);
    toast('Identité enregistrée.', 'ok');
  } catch (e) { erreur.textContent = e.message; }
  finally { b.disabled = false; }
}

async function envoyerLogo(f) {
  if (!f) return;
  if (f.size > 2 * 1024 * 1024) { toast('Le logo dépasse 2 Mo.', 'erreur'); return; }
  try {
    const r = await envoyerFichier('/api/identite/logo', f);
    changerMarque(r.marque);
    toast('Logo enregistré.', 'ok');
  } catch (e) { toast(e.message, 'erreur'); }
  $('#champLogo').value = '';
}

async function retirerLogo() {
  try { const r = await api('/api/identite/logo/retirer', { corps: {} }); changerMarque(r.marque); toast('Logo retiré.'); }
  catch (e) { toast(e.message, 'erreur'); }
}

// ---------- Contexte et mémoire ----------

const EXPLICATIONS = {
  contexte: 'La fiche d\'identité de votre structure : qui vous êtes, ce que vous proposez, la mission de l\'agent. Il la relit à chaque message.',
  memoire: 'Ce que l\'agent a retenu d\'une discussion à l\'autre. Il l\'écrit lui-même ; vous pouvez corriger ou effacer une ligne.',
  regles: 'Les règles communes que l\'agent suit toujours. Il ne peut pas les modifier lui-même.',
  fiche: 'La fiche de poste de l\'agent (CLAUDE.md) : sa méthode, ses documents, sa mémoire. Les trois premières lignes chargent les autres fichiers : ne les retirez pas.',
};

const ctx = { fichiers: {}, sous: 'contexte', edition: false };

async function chargerContexte() {
  try {
    const d = await api('/api/contexte');
    for (const f of d.fichiers) ctx.fichiers[f.id] = f;
    if (!ctx.edition) rendreSousVue();
  } catch { /* rien */ }
}

function choisirSous(nom) {
  if (ctx.edition && nom !== ctx.sous && $('#zoneTexte').value !== (ctx.fichiers[ctx.sous] || {}).contenu) {
    if (!window.confirm('Abandonner vos modifications non enregistrées ?')) return;
  }
  ctx.sous = nom;
  ctx.edition = false;
  $$('[data-sous]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.sous === nom)));
  rendreSousVue();
  if (nom === 'documents') chargerDocuments();
}

function rendreSousVue() {
  const docs = ctx.sous === 'documents';
  $('#vueDocuments').hidden = !docs;
  $('#vueTexte').hidden = docs;
  if (docs) return;
  const f = ctx.fichiers[ctx.sous];
  if (!f) return;
  $('#texteFichier').textContent = f.fichier;
  $('#texteModifie').textContent = f.modifie ? ` · modifié ${heure(f.modifie)}` : '';
  $('#texteExplication').textContent = EXPLICATIONS[ctx.sous] || '';
  $('#boutonRemplir').hidden = !estAdmin() || ctx.sous !== 'contexte' || ctx.edition;
  $('#boutonModifier').hidden = !estAdmin() || ctx.edition;
  $('#texteEdition').hidden = !ctx.edition;
  $('#texteLecture').hidden = ctx.edition;
  if (ctx.edition) return;
  const lecture = $('#texteLecture');
  // markdown.js rend # en h3 et ## en h4 ; les mentions « À compléter » sont signalées en couleur.
  const source = f.contenu || '';
  lecture.innerHTML = source.trim() ? markdownEnHTML(source) : '<p class="vide">Fichier vide.</p>';
  for (const p of $$('p, li', lecture)) {
    if (/^\s*À compléter\s*$/.test(p.textContent)) p.classList.add('a-completer');
  }
  // Mémoire : une rubrique encore vide le dit.
  if (ctx.sous === 'memoire') {
    $$('h4', lecture).forEach((h) => {
      const suivant = h.nextElementSibling;
      if (!suivant || /^H\d$/.test(suivant.tagName)) h.after(el('p', 'a-vide', 'Rien de retenu pour l\'instant.'));
    });
  }
}

function ouvrirEdition(texte) {
  const f = ctx.fichiers[ctx.sous];
  ctx.edition = true;
  rendreSousVue();
  const z = $('#zoneTexte');
  z.value = texte !== undefined ? texte : f.contenu;
  z.focus({ preventScroll: true });
  z.setSelectionRange(0, 0);
  z.scrollTop = 0;
}

async function enregistrerTexte(id, contenu) {
  const r = await api(`/api/contexte/${id}`, { corps: { contenu } });
  ctx.fichiers[id] = { ...ctx.fichiers[id], contenu: contenu.endsWith('\n') ? contenu : contenu + '\n', modifie: r.modifie };
  return r;
}

async function sauverEdition() {
  const b = $('#boutonEnregistrerTexte');
  b.disabled = true;
  try {
    await enregistrerTexte(ctx.sous, $('#zoneTexte').value);
    ctx.edition = false;
    rendreSousVue();
    chargerEtat();
    toast(`${ctx.fichiers[ctx.sous].fichier} enregistré.`, 'ok');
  } catch (e) { toast(e.message, 'erreur'); }
  finally { b.disabled = false; }
}

// « Remplir à partir d'un site »
let suiviRemplir = null;

function vueRemplir(v) {
  $('#remplirDepart').hidden = v !== 'depart';
  $('#remplirAttente').hidden = v !== 'attente';
  $('#remplirResultat').hidden = v !== 'resultat';
}

async function ouvrirRemplir() {
  $('#erreurRemplir').textContent = '';
  vueRemplir('depart');
  ouvrirFenetre('fenetreRemplir');
  try {
    const e = await api('/api/contexte/remplir');
    if (e.etat === 'en-cours') { vueRemplir('attente'); suivreRemplir(); }
    else if (e.etat === 'fini' && e.proposition && !app.propositionVue) { $('#zoneProposition').value = e.proposition; vueRemplir('resultat'); }
    if (e.url) $('#champSite').value = e.url;
  } catch { /* rien */ }
}

function suivreRemplir() {
  clearTimeout(suiviRemplir);
  suiviRemplir = setTimeout(async () => {
    let e;
    try { e = await api('/api/contexte/remplir'); } catch { return suivreRemplir(); }
    if (e.etat === 'en-cours') {
      const s = Math.round((Date.now() - new Date(e.debut).getTime()) / 1000);
      $('#remplirDuree').textContent = `Depuis ${s} s. Une à trois minutes en général. Vous pouvez fermer cette fenêtre : la proposition vous attendra.`;
      return suivreRemplir();
    }
    if (e.etat === 'fini') {
      app.propositionVue = false;
      $('#zoneProposition').value = e.proposition;
      vueRemplir('resultat');
      if ($('#fenetreRemplir').hidden) toast('La proposition de contexte est prête : Réglages › Contexte › Remplir à partir d\'un site.', 'ok');
    } else if (e.etat === 'erreur') {
      vueRemplir('depart');
      $('#erreurRemplir').textContent = e.erreur;
    }
  }, 2500);
}

async function lancerRemplir(ev) {
  ev.preventDefault();
  const champ = $('#champSite');
  $('#erreurRemplir').textContent = '';
  if (!champ.value.trim()) { $('#erreurRemplir').textContent = 'Donnez l\'adresse du site.'; champ.focus(); return; }
  try {
    await api('/api/contexte/remplir', { corps: { url: champ.value } });
    vueRemplir('attente');
    $('#remplirDuree').textContent = 'Une à trois minutes. Vous pouvez fermer cette fenêtre : la proposition vous attendra.';
    suivreRemplir();
  } catch (e) { $('#erreurRemplir').textContent = e.message; }
}

async function garderProposition() {
  const b = $('#boutonGarderProposition');
  b.disabled = true;
  try {
    await enregistrerTexte('contexte', $('#zoneProposition').value);
    app.propositionVue = true;
    fermerFenetre('fenetreRemplir');
    choisirSous('contexte');
    chargerEtat();
    toast('CONTEXTE.md enregistré.', 'ok');
  } catch (e) { toast(e.message, 'erreur'); }
  finally { b.disabled = false; }
}

// Aller à une section des Réglages (depuis la mise en route ou le menu).
function allerA(cible) {
  choisirOnglet('reglages');
  const sections = { fichiers: '#sectionFichiers', skills: '#sectionSkills', connexions: '#sectionConnexions' };
  const section = $(sections[cible] || '#sectionContexte');
  if (cible === 'contexte') choisirSous('contexte');
  // On fait défiler la colonne des Réglages seulement (jamais la page entière).
  requestAnimationFrame(() => {
    const vue = $('#vueReglages');
    vue.scrollTo({ top: section.offsetTop - vue.offsetTop - 12, behavior: 'smooth' });
  });
}

// ---------- Skills ----------
// Les savoir-faire de l'agent (agent/.claude/skills/<identifiant>/SKILL.md).
// Tout le monde les lit ; un admin les crée, les modifie, les supprime.
// Le bouton « / » de la discussion en impose un au prochain message.

const sk = { liste: [], admin: false, choisi: null, edition: null, actif: 0 };

// Même nettoyage que le serveur (app/skills.js) : minuscules, chiffres, tirets.
function idSkill(brut) {
  return String(brut || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
}

async function chargerSkills() {
  try {
    const d = await api('/api/skills');
    sk.liste = d.skills || [];
    sk.admin = Boolean(d.admin);
    rendreSkills();
    if (sk.choisi && !sk.liste.some((s) => s.id === sk.choisi)) choisirSkill(null);
    if (!$('#menuSkills').hidden) rendreMenuSkills();
  } catch { /* rien */ }
}

function rendreSkills() {
  const ul = $('#listeSkills');
  ul.replaceChildren();
  if (!sk.liste.length) {
    listeVide(ul, 'Aucun skill pour l\'instant', sk.admin ? 'Créez une première méthode avec « Nouveau skill », ou demandez à l\'agent : « fais-en un skill ».' : 'Un admin peut en créer.');
    return;
  }
  for (const s of sk.liste) {
    const li = el('li', 'skill');
    const ouvrir = el('button', 'skill-ouvrir');
    ouvrir.type = 'button';
    ouvrir.setAttribute('aria-label', (sk.admin ? 'Modifier le skill ' : 'Lire le skill ') + s.id);
    const icone = el('span', 'skill-icone');
    icone.innerHTML = '<svg class="icone" aria-hidden="true"><use href="#i-skill"/></svg>';
    const infos = el('span', 'skill-infos');
    infos.append(el('span', 'skill-nom', s.id), el('span', 'skill-description', s.description || 'Sans description'));
    ouvrir.append(icone, infos);
    ouvrir.addEventListener('click', () => ouvrirSkill(s.id));
    li.append(ouvrir);
    if (sk.admin) {
      const actions = el('span', 'fichier-actions');
      const m = el('button', 'bouton-icone');
      m.type = 'button'; m.title = 'Modifier'; m.setAttribute('aria-label', 'Modifier ' + s.id);
      m.innerHTML = '<svg class="icone"><use href="#i-crayon"/></svg>';
      m.addEventListener('click', () => ouvrirSkill(s.id));
      const x = el('button', 'bouton-icone bouton-danger');
      x.type = 'button'; x.title = 'Supprimer'; x.setAttribute('aria-label', 'Supprimer ' + s.id);
      x.innerHTML = '<svg class="icone"><use href="#i-poubelle"/></svg>';
      x.addEventListener('click', () => supprimerSkill(s.id));
      actions.append(m, x);
      li.append(actions);
    }
    ul.append(li);
  }
}

function vueMethode(v) {
  $$('[data-skill-vue]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.skillVue === v)));
  const apercu = v === 'apercu';
  $('#champSkillMethode').hidden = apercu;
  $('#apercuSkill').hidden = !apercu;
  if (apercu) {
    const t = $('#champSkillMethode').value;
    $('#apercuSkill').innerHTML = t.trim() ? markdownEnHTML(t) : '<p class="vide">Rien à afficher pour l\'instant.</p>';
  }
}

function ajusterDescription() {
  const z = $('#champSkillDescription');
  z.style.height = 'auto';
  z.style.height = Math.min(z.scrollHeight + 2, 160) + 'px';
}

function majAideNom() {
  const brut = $('#champSkillNom').value;
  const id = idSkill(brut);
  const aide = $('#aideSkillNom');
  aide.replaceChildren();
  if (brut.trim() && id !== brut.trim()) {
    aide.append(document.createTextNode('Identifiant : '), el('code', '', id || '…'));
  } else aide.textContent = 'Minuscules, chiffres et tirets. C\'est aussi le nom du dossier.';
}

// id = identifiant à ouvrir, ou null pour un nouveau skill.
function ouvrirSkill(id) {
  const s = id ? sk.liste.find((x) => x.id === id) : null;
  if (id && !s) return;
  $('#erreurSkill').textContent = '';
  if (!sk.admin) {
    // Lecture seule (membre)
    $('#titreSkill').textContent = s.id;
    $('#formSkill').hidden = true;
    $('#lectureSkill').hidden = false;
    $('#lectureSkillDescription').textContent = s.description;
    $('#lectureSkillMethode').innerHTML = markdownEnHTML(s.methode || '');
    ouvrirFenetre('fenetreSkill');
    return;
  }
  sk.edition = s ? s.id : null;
  $('#formSkill').hidden = false;
  $('#lectureSkill').hidden = true;
  $('#titreSkill').textContent = s ? 'Modifier le skill' : 'Nouveau skill';
  $('#champSkillNom').value = s ? s.id : '';
  $('#champSkillDescription').value = s ? s.description : '';
  $('#champSkillMethode').value = s ? s.methode : '';
  $('#boutonSupprimerSkill').hidden = !s;
  majAideNom();
  vueMethode('ecrire');
  ouvrirFenetre('fenetreSkill');
  requestAnimationFrame(ajusterDescription);
}

async function enregistrerSkill(ev) {
  ev.preventDefault();
  const erreur = $('#erreurSkill');
  erreur.textContent = '';
  const nom = $('#champSkillNom').value;
  const description = $('#champSkillDescription').value;
  const methode = $('#champSkillMethode').value;
  if (!idSkill(nom)) { erreur.textContent = 'Donnez un nom au skill.'; $('#champSkillNom').focus(); return; }
  if (!description.trim()) { erreur.textContent = 'Dites quand utiliser ce skill.'; $('#champSkillDescription').focus(); return; }
  if (!methode.trim()) { erreur.textContent = 'Écrivez la méthode.'; vueMethode('ecrire'); $('#champSkillMethode').focus(); return; }
  const b = $('#boutonEnregistrerSkill');
  b.disabled = true;
  try {
    const corps = { nom, description, methode };
    if (sk.edition) corps.ancien = sk.edition;
    const r = await api('/api/skills', { corps });
    fermerFenetre('fenetreSkill');
    toast(`Skill « ${r.skill.id} » enregistré.`, 'ok');
    chargerSkills();
  } catch (e) { erreur.textContent = e.message; }
  finally { b.disabled = false; }
}

async function supprimerSkill(id) {
  const ok = await confirmer('Supprimer ce skill ?', `« ${id} » sera supprimé : l'agent ne pourra plus l'appliquer.`, 'Supprimer');
  if (!ok) return;
  try {
    await api('/api/skills/supprimer', { corps: { id } });
    fermerFenetre('fenetreSkill');
    toast('Skill supprimé.', 'ok');
    chargerSkills();
  } catch (e) { toast(e.message, 'erreur'); }
}

// ----- Le bouton « / » de la discussion -----

function choisirSkill(id) {
  sk.choisi = id || null;
  $('#skillChoisi').hidden = !sk.choisi;
  $('#skillChoisiNom').textContent = sk.choisi || '';
  $('#boutonSlash').classList.toggle('actif', Boolean(sk.choisi));
  ajusterZone();
}

function rendreMenuSkills() {
  const menu = $('#menuSkills');
  menu.replaceChildren();
  const tete = el('div', 'menu-skills-titre', 'Appliquer un skill au prochain message');
  menu.append(tete);
  if (!sk.liste.length) {
    const v = el('div', 'menu-skills-vide', 'Aucun skill pour l\'instant.');
    if (estAdmin()) {
      const b = el('button', 'lien-bouton', 'Créer un skill');
      b.type = 'button';
      b.addEventListener('click', () => { basculerMenuSkills(false); allerA('skills'); });
      v.append(document.createTextNode(' '), b);
    }
    menu.append(v);
    return;
  }
  sk.actif = Math.min(sk.actif, sk.liste.length - 1);
  sk.liste.forEach((s, i) => {
    const o = el('button', 'menu-skill');
    o.type = 'button';
    o.setAttribute('role', 'option');
    o.id = 'option-skill-' + i;
    o.setAttribute('aria-selected', String(s.id === sk.choisi));
    if (i === sk.actif) o.classList.add('actif');
    o.append(el('span', 'menu-skill-nom', '/' + s.id), el('span', 'menu-skill-description', s.description));
    o.addEventListener('click', () => { choisirSkill(s.id); basculerMenuSkills(false); $('#zoneMessage').focus(); });
    o.addEventListener('mousemove', () => { if (sk.actif !== i) { sk.actif = i; $$('.menu-skill', menu).forEach((x, j) => x.classList.toggle('actif', j === i)); } });
    menu.append(o);
  });
}

function basculerMenuSkills(ouvrir) {
  const menu = $('#menuSkills');
  const o = ouvrir === undefined ? menu.hidden : ouvrir;
  if (o) {
    sk.actif = Math.max(0, sk.liste.findIndex((s) => s.id === sk.choisi));
    rendreMenuSkills();
    chargerSkills();
  }
  menu.hidden = !o;
  $('#boutonSlash').setAttribute('aria-expanded', String(o));
}

// Flèches, Entrée et Échap dans la liste (depuis la zone de saisie).
function clavierMenuSkills(e) {
  const menu = $('#menuSkills');
  if (menu.hidden) return false;
  if (e.key === 'Escape') { basculerMenuSkills(false); return true; }
  if (!sk.liste.length) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    sk.actif = (sk.actif + (e.key === 'ArrowDown' ? 1 : -1) + sk.liste.length) % sk.liste.length;
    $$('.menu-skill', menu).forEach((x, j) => x.classList.toggle('actif', j === sk.actif));
    const a = $$('.menu-skill', menu)[sk.actif];
    if (a) a.scrollIntoView({ block: 'nearest' });
    return true;
  }
  if (e.key === 'Enter' || e.key === 'Tab') {
    const s = sk.liste[sk.actif];
    if (s) { choisirSkill(s.id); basculerMenuSkills(false); }
    return true;
  }
  return false;
}

// ---------- Connexions ----------
// Les outils externes branchés à l'agent (admin seulement) : serveur MCP par compte (OAuth),
// serveur MCP avec un jeton, API avec une clé. Le navigateur ne voit jamais un secret entier.

const cx = { liste: [], resultats: {}, enTest: new Set(), type: 'oauth' };
const STATUTS_CX = {
  connecte: ['ok', 'Connecté'],
  'a-reconnecter': ['attention', 'À reconnecter'],
  erreur: ['erreur', 'Erreur'],
};
const TYPES_CX = { oauth: 'Serveur MCP · par compte', jeton: 'Serveur MCP · jeton', api: 'API · clé' };
const ICONES_CX = { oauth: 'i-serveur', jeton: 'i-cle', api: 'i-api' };

function hote(url) { try { const u = new URL(url); return u.host + (u.pathname !== '/' ? u.pathname.replace(/\/$/, '') : ''); } catch { return url; } }

async function chargerConnexions() {
  if (!estAdmin()) return;
  try {
    const d = await api('/api/connexions');
    cx.liste = d.connexions || [];
    rendreConnexions();
  } catch { /* rien */ }
}

function icone(id) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'icone');
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', '#' + id);
  s.append(u);
  return s;
}

function boutonCx(classe, id, texte, clic) {
  const b = el('button', classe);
  b.type = 'button';
  b.append(icone(id), el('span', '', texte));
  b.addEventListener('click', clic);
  return b;
}

function rendreConnexions() {
  const ul = $('#listeConnexions');
  ul.replaceChildren();
  if (!cx.liste.length) {
    listeVide(ul, 'Aucune connexion pour l\'instant', 'Branchez un premier outil avec « Nouvelle connexion » : un serveur MCP (Notion, votre CRM…) ou une API avec une clé.');
    return;
  }
  for (const c of cx.liste) {
    const li = el('li', 'cx');
    const haut = el('div', 'cx-haut');
    const ic = el('span', 'cx-icone ' + c.type);
    ic.append(icone(ICONES_CX[c.type] || 'i-prise'));
    const infos = el('div', 'cx-infos');
    const l1 = el('div', 'cx-ligne');
    const [classe, texte] = STATUTS_CX[c.statut] || STATUTS_CX.erreur;
    const enTest = cx.enTest.has(c.nom);
    l1.append(el('span', 'cx-nom', c.nom), el('span', 'pastille ' + (enTest ? 'travail' : classe), enTest ? 'Test…' : texte));
    const meta = el('span', 'cx-meta');
    meta.append(el('span', 'cx-type', TYPES_CX[c.type] || c.type), el('span', 'cx-url', hote(c.url)));
    meta.title = c.url;
    infos.append(l1, meta);
    const details = [];
    if (c.secretFin) details.push(`${c.entete} : ${c.prefixe ? c.prefixe + ' ' : ''}${c.secretFin}`);
    if (c.type === 'oauth') details.push(c.jetonFin ? 'Autorisé par compte' : 'Autorisation à faire');
    if (details.length) infos.append(el('span', 'cx-detail', details.join(' · ')));
    haut.append(ic, infos);
    li.append(haut);

    if (c.type === 'api') {
      const lab = el('label', 'cx-interrupteur');
      const caseE = el('input');
      caseE.type = 'checkbox';
      caseE.checked = Boolean(c.ecriture);
      caseE.addEventListener('change', () => changerEcriture(c.nom, caseE.checked, caseE));
      lab.append(caseE, el('span', 'cx-interrupteur-piste'), el('span', '', 'Autoriser l\'écriture'));
      li.append(lab);
    }

    // Résultat du dernier test (ou outils connus).
    const r = cx.resultats[c.nom];
    const zone = el('div', 'cx-resultat');
    if (r && r.ok) {
      zone.classList.add('ok');
      zone.append(el('p', 'cx-resultat-titre', r.outils.length ? `Test réussi : ${r.outils.length} outil${r.outils.length > 1 ? 's' : ''} disponible${r.outils.length > 1 ? 's' : ''}` : 'Test réussi, mais le serveur ne propose aucun outil.'));
      if (r.outils.length) {
        const liste = el('ul', 'cx-outils');
        for (const o of r.outils) {
          const item = el('li', 'cx-outil');
          item.append(el('code', '', o.nom));
          if (o.description) { item.append(el('span', '', o.description)); item.title = o.description; }
          liste.append(item);
        }
        zone.append(liste);
      }
    } else if ((r && !r.ok) || (c.statut !== 'connecte' && c.erreur)) {
      zone.classList.add(c.statut === 'a-reconnecter' ? 'attention' : 'erreur');
      zone.append(el('p', 'cx-resultat-titre', (r && r.erreur) || c.erreur));
    } else if (c.outils && c.outils.length) {
      const p = el('p', 'cx-resultat-court');
      p.append(el('span', '', c.outils.length > 1 ? 'Outils :' : 'Outil :'));
      for (const n of c.outils) p.append(el('code', '', n));
      zone.append(p);
    }
    if (zone.childElementCount) li.append(zone);

    const actions = el('div', 'cx-actions');
    const t = boutonCx('bouton-secondaire bouton-petit', 'i-test', enTest ? 'Test en cours…' : 'Tester', () => testerConnexion(c.nom));
    t.disabled = enTest;
    actions.append(t);
    if (c.type === 'oauth') actions.append(boutonCx(c.statut === 'connecte' ? 'bouton-secondaire bouton-petit' : 'bouton bouton-petit', 'i-recharger', 'Reconnecter', () => reconnecterConnexion(c.nom)));
    const x = boutonCx('bouton-fantome bouton-petit bouton-danger cx-supprimer', 'i-poubelle', 'Supprimer', () => supprimerConnexion(c.nom));
    actions.append(x);
    li.append(actions);
    ul.append(li);
  }
}

async function testerConnexion(nom) {
  cx.enTest.add(nom);
  delete cx.resultats[nom];
  rendreConnexions();
  try {
    const r = await api('/api/connexions/tester', { corps: { nom } });
    cx.resultats[nom] = r;
    if (r.ok) toast(`« ${nom} » répond : ${r.outils.length} outil${r.outils.length > 1 ? 's' : ''}.`, 'ok');
    else toast(`« ${nom} » : le test a échoué.`, 'erreur');
  } catch (e) { cx.resultats[nom] = { ok: false, erreur: e.message }; }
  cx.enTest.delete(nom);
  await chargerConnexions();
  chargerEtatPlusTard();
}

async function reconnecterConnexion(nom) {
  try {
    const r = await api('/api/connexions/reconnecter', { corps: { nom } });
    window.location.href = r.lien; // le site de l'outil, puis retour sur /api/oauth/retour
  } catch (e) { toast(e.message, 'erreur'); }
}

async function supprimerConnexion(nom) {
  const ok = await confirmer('Supprimer cette connexion ?', `« ${nom} » sera débranchée : l'agent ne pourra plus s'en servir et son jeton ou sa clé sera effacé du serveur.`, 'Supprimer');
  if (!ok) return;
  try {
    await api('/api/connexions/supprimer', { corps: { nom } });
    delete cx.resultats[nom];
    toast('Connexion supprimée.', 'ok');
    await chargerConnexions();
    chargerEtatPlusTard();
  } catch (e) { toast(e.message, 'erreur'); }
}

async function changerEcriture(nom, ecriture, caseE) {
  caseE.disabled = true;
  try {
    await api('/api/connexions/ecriture', { corps: { nom, ecriture } });
    toast(ecriture ? `« ${nom} » : écriture autorisée.` : `« ${nom} » : lecture seule.`, 'ok');
    delete cx.resultats[nom];
    await chargerConnexions();
  } catch (e) { toast(e.message, 'erreur'); caseE.checked = !ecriture; }
  caseE.disabled = false;
}

// ----- Fenêtre « Nouvelle connexion » -----

function typeConnexion(type) {
  cx.type = type;
  $$('#formConnexion [data-pour]').forEach((e) => { e.hidden = !e.dataset.pour.split(' ').includes(type); });
  const api_ = type === 'api';
  $('#libelleCxUrl').textContent = api_ ? 'URL de base de l\'API' : 'Adresse du serveur MCP';
  $('#champCxUrl').placeholder = api_ ? 'https://api.exemple.com/v1/' : 'https://mcp.exemple.com/mcp';
  $('#aideCxUrl').textContent = api_ ? 'L\'agent ne pourra appeler que des adresses sous celle-ci.' : 'Donnée dans la documentation de l\'outil (souvent elle finit par /mcp).';
  $('#libelleCxSecret').textContent = api_ ? 'Clé' : 'Jeton';
  $('#aideCxSecret').textContent = api_ ? 'Elle ne sera plus jamais affichée en entier (seulement ses 4 derniers caractères).' : 'Il ne sera plus jamais affiché en entier (seulement ses 4 derniers caractères).';
  $('#champCxEntete').placeholder = api_ ? 'Authorization ou X-API-Key' : 'Authorization';
  $('#boutonAjouterConnexion').textContent = type === 'oauth' ? 'Connecter' : 'Ajouter et tester';
  $('#erreurConnexion').textContent = '';
}

function ouvrirNouvelleConnexion() {
  const f = $('#formConnexion');
  f.reset();
  $('#champCxEntete').value = 'Authorization';
  $('#champCxPrefixe').value = 'Bearer';
  typeConnexion('oauth');
  ouvrirFenetre('fenetreConnexion');
}

async function ajouterConnexion(ev) {
  ev.preventDefault();
  const erreur = $('#erreurConnexion');
  erreur.textContent = '';
  const nom = idSkill($('#champCxNom').value).slice(0, 40);
  $('#champCxNom').value = nom;
  if (!nom) { erreur.textContent = 'Donnez un nom à la connexion.'; $('#champCxNom').focus(); return; }
  const url = $('#champCxUrl').value.trim();
  if (!/^https:\/\//i.test(url)) { erreur.textContent = 'L\'adresse doit commencer par https://'; $('#champCxUrl').focus(); return; }
  const corps = { type: cx.type, nom, url };
  if (cx.type !== 'oauth') {
    corps.entete = $('#champCxEntete').value.trim();
    corps.prefixe = $('#champCxPrefixe').value.trim();
    corps.secret = $('#champCxSecret').value;
    if (!corps.entete) { erreur.textContent = 'Donnez le nom de l\'en-tête (ex. Authorization ou X-API-Key).'; $('#champCxEntete').focus(); return; }
    if (!corps.secret.trim()) { erreur.textContent = cx.type === 'api' ? 'Collez la clé.' : 'Collez le jeton.'; $('#champCxSecret').focus(); return; }
    if (cx.type === 'api') corps.ecriture = $('#champCxEcriture').checked;
  }
  const b = $('#boutonAjouterConnexion');
  b.disabled = true;
  const libelle = b.textContent;
  b.textContent = cx.type === 'oauth' ? 'Recherche du serveur…' : 'Test en cours…';
  try {
    const r = await api('/api/connexions', { corps });
    $('#champCxSecret').value = '';
    if (cx.type === 'oauth') { window.location.href = r.lien; return; }
    fermerFenetre('fenetreConnexion');
    if (r.test) cx.resultats[nom] = r.test;
    toast(r.test && r.test.ok ? `« ${nom} » ajoutée et testée.` : `« ${nom} » ajoutée, mais le test a échoué.`, r.test && r.test.ok ? 'ok' : 'attention');
    await chargerConnexions();
    chargerEtatPlusTard();
  } catch (e) {
    erreur.textContent = e.message;
    const champ = { nom: '#champCxNom', url: '#champCxUrl', entete: '#champCxEntete', prefixe: '#champCxPrefixe', secret: '#champCxSecret' }[e.donnees && e.donnees.champ];
    if (champ) $(champ).focus();
  } finally {
    b.disabled = false;
    b.textContent = libelle;
  }
}

// Retour d'une autorisation OAuth : /?oauth=ok|erreur&nom=…&message=…
function retourOAuth() {
  const q = new URLSearchParams(window.location.search);
  if (!q.has('oauth')) return;
  const nom = q.get('nom');
  if (q.get('oauth') === 'ok') toast(`« ${nom} » : Connecté.`, 'ok');
  else toast(q.get('message') || 'La connexion n\'a pas abouti.', 'erreur');
  history.replaceState(null, '', '/');
  if (estAdmin()) { allerA('connexions'); if (q.get('oauth') === 'ok' && nom) { cx.enTest.add(nom); setTimeout(() => { cx.enTest.delete(nom); chargerConnexions(); }, 8000); } }
}

// ---------- Temps réel ----------

function ouvrirFlux() {
  const flux = new EventSource('/api/flux');
  const lire = (e) => { try { return JSON.parse(e.data); } catch { return null; } };
  flux.addEventListener('etat', (e) => {
    const d = lire(e);
    if (!d) return;
    majClaude(d.claude);
    appliquerStatut(d.agent);
    // Reconnexion : on rattrape ce qui a pu changer pendant la coupure (dont l'identité).
    if (app.fluxDejaOuvert) { chargerDiscussion(); chargerEtat(); api('/api/marque').then(changerMarque).catch(() => {}); }
    app.fluxDejaOuvert = true;
  });
  flux.addEventListener('statut', (e) => {
    const s = lire(e);
    appliquerStatut(s);
    if (s && (s.etat === 'fini' || s.etat === 'repos')) chargerEtatPlusTard();
  });
  flux.addEventListener('message', (e) => {
    const m = lire(e);
    if (m && m.discussion === app.discussion) ajouterMessage(m);
  });
  flux.addEventListener('debut', (e) => {
    const d = lire(e);
    if (d && d.discussion === app.discussion) creerEnCours(d.id);
  });
  flux.addEventListener('morceau', (e) => {
    const d = lire(e);
    if (!d) return;
    if (!app.enCours || app.enCours.id !== d.id) return;
    app.enCours.texte += d.texte;
    planifierRendu();
  });
  flux.addEventListener('outils', (e) => {
    const d = lire(e);
    if (!d || !app.enCours || app.enCours.id !== d.id) return;
    app.enCours.outils = d.outils;
    majOutilsEnCours();
  });
  flux.addEventListener('fin', (e) => {
    const m = lire(e);
    if (m && m.discussion === app.discussion) finaliser(m);
    // L'agent a pu écrire dans work/ ou dans sa mémoire.
    if (!$('#vueReglages').hidden) { chargerFichiers(); chargerContexte(); chargerSkills(); }
  });
  flux.addEventListener('marque', (e) => changerMarque(lire(e)));
  flux.addEventListener('skills', () => chargerSkills());
  flux.addEventListener('connexions', () => { if (!cx.enTest.size) chargerConnexions(); chargerEtatPlusTard(); });
  flux.addEventListener('contexte', () => { chargerContexte(); chargerEtatPlusTard(); });
  flux.addEventListener('file', (e) => {
    const d = lire(e);
    if (d) appliquerStatut({ file: d.n });
  });
  flux.addEventListener('nouvelle', (e) => {
    const d = lire(e);
    if (!d || d.discussion === app.discussion) return;
    app.discussion = d.discussion;
    app.ids.clear();
    app.enCours = null;
    afficherAccueil();
  });
  flux.addEventListener('claude', (e) => {
    majClaude(lire(e));
    chargerEtat();
  });
  flux.addEventListener('error', () => {
    if (flux.readyState === EventSource.CLOSED) {
      // Session expirée ou serveur redémarré : on vérifie, puis on rouvre.
      api('/api/moi').then(() => setTimeout(ouvrirFlux, 3000)).catch(() => {});
    }
  });
}

let minuterieEtat = null;
function chargerEtatPlusTard() {
  clearTimeout(minuterieEtat);
  minuterieEtat = setTimeout(chargerEtat, 500);
}

// ---------- Onglets ----------

function choisirOnglet(nom) {
  $$('[data-onglet]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.onglet === nom)));
  $('#vueDiscussion').hidden = nom !== 'discussion';
  $('#vueReglages').hidden = nom !== 'reglages';
  document.body.classList.toggle('sur-reglages', nom === 'reglages');
  if (nom === 'reglages') { chargerEtat(); chargerContexte(); chargerFichiers(); chargerSkills(); chargerConnexions(); if (ctx.sous === 'documents') chargerDocuments(); }
  if (nom !== 'discussion') basculerMenuSkills(false);
  if (nom === 'discussion') requestAnimationFrame(() => defiler(true));
}

// ---------- Fenêtres ----------

let derniereFocalisation = null;

function ouvrirFenetre(id) {
  const f = $('#' + id);
  derniereFocalisation = document.activeElement;
  f.hidden = false;
  const premier = $('input, button:not([data-fermer])', f) || $('button', f);
  setTimeout(() => premier && premier.focus(), 30);
}
function fermerFenetre(id) {
  const f = $('#' + id);
  if (f.hidden) return;
  f.hidden = true;
  if (id === 'fenetreClaude') { $('#champCle').value = ''; $('#erreurCle').textContent = ''; $('#champCode').value = ''; }
  if (id === 'fenetreRemplir' && !$('#remplirResultat').hidden) app.propositionVue = true;
  if (derniereFocalisation && derniereFocalisation.focus) derniereFocalisation.focus();
}

function ouvrirFenetreClaude() {
  if (!estAdmin()) { toast('Seul un admin peut connecter Claude.', 'attention'); return; }
  methodeClaude('auto');
  remettreAZeroAuto();
  $('#claudeSucces').hidden = true;
  $('#titreFenetreClaude').textContent = app.claude.connecte ? 'Changer la clé Claude' : 'Connecter Claude';
  $('#erreurCle').textContent = '';
  $('#champCle').value = '';
  ouvrirFenetre('fenetreClaude');
}

// Deux méthodes dans la même fenêtre : « auto » (sans Terminal, par défaut) ou « cle » (J'ai déjà une clé).
function methodeClaude(m) {
  $('#claudeAuto').hidden = m !== 'auto';
  $('#claudeGuide').hidden = m !== 'cle';
}

function remettreAZeroAuto() {
  $('#claudeDepart').hidden = false;
  $('#claudeEtapes').hidden = true;
  $('#erreurLien').textContent = '';
  $('#erreurCode').textContent = '';
  $('#champCode').value = '';
  $('#champCode').disabled = false;
  $('#boutonCode').hidden = false;
  $('#boutonRelancer').hidden = true;
  $('#lienClaude').setAttribute('href', '#');
  const b = $('#boutonLien');
  b.disabled = false;
  b.textContent = 'Se connecter avec Claude';
}

// Le serveur lance claude setup-token et renvoie le lien d'autorisation.
async function demanderLien() {
  remettreAZeroAuto();
  const b = $('#boutonLien');
  b.disabled = true;
  b.textContent = 'Préparation…';
  try {
    const r = await api('/api/claude/lien', { corps: {} });
    $('#lienClaude').setAttribute('href', r.lien);
    $('#claudeDepart').hidden = true;
    $('#claudeEtapes').hidden = false;
    setTimeout(() => $('#lienClaude').focus(), 30);
  } catch (e) {
    $('#erreurLien').textContent = e.message;
    b.disabled = false;
    b.textContent = 'Se connecter avec Claude';
  }
}

async function envoyerCode(ev) {
  ev.preventDefault();
  const champ = $('#champCode');
  const erreur = $('#erreurCode');
  const bouton = $('#boutonCode');
  erreur.textContent = '';
  if (!champ.value.trim()) { erreur.textContent = 'Collez d\'abord le code affiché par Claude.'; champ.focus(); return; }
  bouton.disabled = true;
  champ.disabled = true;
  bouton.textContent = 'Vérification…';
  try {
    const r = await api('/api/claude/code', { corps: { code: champ.value } });
    champ.value = '';
    majClaude(r.claude);
    $('#claudeAuto').hidden = true;
    $('#claudeSucces').hidden = false;
    chargerEtat();
    setTimeout(() => fermerFenetre('fenetreClaude'), 2200);
  } catch (e) {
    erreur.textContent = e.message;
    if (e.donnees && e.donnees.relancer) {
      // Le processus de connexion est arrêté : il faut un nouveau lien.
      champ.value = '';
      bouton.hidden = true;
      $('#boutonRelancer').hidden = false;
      $('#lienClaude').setAttribute('href', '#');
    } else {
      champ.disabled = false;
    }
  } finally {
    bouton.disabled = false;
    bouton.textContent = 'Connecter';
    if (!bouton.hidden) champ.disabled = false;
  }
}

function confirmer(titre, texte, libelle) {
  return new Promise((resolve) => {
    $('#confirmerTitre').textContent = titre;
    $('#confirmerTexte').textContent = texte;
    const oui = $('#confirmerOui');
    oui.textContent = libelle;
    const f = $('#fenetreConfirmer');
    const finir = (r) => { oui.removeEventListener('click', surOui); f.removeEventListener('fermeture', surNon); fermerFenetre('fenetreConfirmer'); resolve(r); };
    const surOui = () => finir(true);
    const surNon = () => finir(false);
    oui.addEventListener('click', surOui);
    f.addEventListener('fermeture', surNon);
    ouvrirFenetre('fenetreConfirmer');
    setTimeout(() => $('[data-fermer]', f).focus(), 40);
  });
}

async function connecterClaude(ev) {
  ev.preventDefault();
  const champ = $('#champCle');
  const erreur = $('#erreurCle');
  const bouton = $('#boutonConnecter');
  erreur.textContent = '';
  if (!champ.value.trim()) { erreur.textContent = 'Collez d\'abord la clé affichée par le Terminal.'; champ.focus(); return; }
  bouton.disabled = true;
  champ.disabled = true;
  bouton.textContent = 'Vérification…';
  try {
    const r = await api('/api/claude/connecter', { corps: { cle: champ.value } });
    champ.value = '';
    majClaude(r.claude);
    $('#claudeGuide').hidden = true;
    $('#claudeSucces').hidden = false;
    chargerEtat();
    setTimeout(() => fermerFenetre('fenetreClaude'), 2200);
  } catch (e) {
    erreur.textContent = e.message;
  } finally {
    bouton.disabled = false;
    champ.disabled = false;
    bouton.textContent = 'Connecter';
  }
}

async function deconnecterClaude() {
  const ok = await confirmer('Déconnecter Claude ?',
    'La clé sera supprimée du serveur. L\'agent ne pourra plus répondre tant qu\'un admin n\'aura pas collé une nouvelle clé.',
    'Déconnecter');
  if (!ok) return;
  try {
    const r = await api('/api/claude/deconnecter', { corps: {} });
    majClaude(r.claude);
    chargerEtat();
    toast('Claude est déconnecté. La clé a été supprimée du serveur.');
  } catch (e) { toast(e.message, 'erreur'); }
}

async function seDeconnecter() {
  await fetch('/api/deconnexion', { method: 'POST' }).catch(() => {});
  window.location.href = '/connexion.html';
}

// ---------- Branchements ----------

function brancherInterface() {
  // Onglets (haut sur ordinateur, bas sur mobile)
  $$('[data-onglet]').forEach((b) => b.addEventListener('click', () => choisirOnglet(b.dataset.onglet)));

  // Saisie
  const zone = $('#zoneMessage');
  zone.addEventListener('input', ajusterZone);
  zone.addEventListener('keydown', (e) => {
    if (!e.isComposing && clavierMenuSkills(e)) { e.preventDefault(); return; }
    // « / » au début d'un message vide : ouvre la liste des skills.
    if (e.key === '/' && !zone.value && !e.metaKey && !e.ctrlKey) { e.preventDefault(); basculerMenuSkills(true); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); envoyer(zone.value); }
  });
  $('#saisie').addEventListener('submit', (e) => { e.preventDefault(); envoyer(zone.value); });
  ajusterZone();

  $('#boutonArreter').addEventListener('click', async () => {
    try { await api('/api/arreter', { corps: {} }); toast('Travail arrêté.'); } catch (e) { toast(e.message, 'erreur'); }
  });
  $('#boutonNouvelle').addEventListener('click', async () => {
    if (app.statut.occupe) {
      const ok = await confirmer('Nouvelle discussion ?', 'L\'agent est en train de travailler : son travail en cours sera arrêté.', 'Nouvelle discussion');
      if (!ok) return;
    }
    try {
      const r = await api('/api/nouvelle', { corps: {} });
      app.discussion = r.discussion;
      app.ids.clear();
      app.enCours = null;
      afficherAccueil();
      zone.focus();
    } catch (e) { toast(e.message, 'erreur'); }
  });

  // Claude
  $('#pastilleClaude').addEventListener('click', () => {
    if (app.claude.connecte) { choisirOnglet('reglages'); return; }
    if (estAdmin()) ouvrirFenetreClaude();
    else toast('L\'agent n\'est pas encore connecté : demandez à un admin.', 'attention');
  });
  $('#reglageConnecter').addEventListener('click', ouvrirFenetreClaude);
  $('#reglageDeconnecter').addEventListener('click', deconnecterClaude);
  $('#formClaude').addEventListener('submit', connecterClaude);
  $('#boutonLien').addEventListener('click', demanderLien);
  $('#boutonRelancer').addEventListener('click', demanderLien);
  $('#formCode').addEventListener('submit', envoyerCode);
  $('#lienClaude').addEventListener('click', (e) => { if ($('#lienClaude').getAttribute('href') === '#') e.preventDefault(); });
  $('#versCle').addEventListener('click', () => { methodeClaude('cle'); setTimeout(() => $('#copierCommande').focus(), 30); });
  $('#versAuto').addEventListener('click', () => { methodeClaude('auto'); setTimeout(() => $('#boutonLien').focus(), 30); });
  $('#copierCommande').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    try { await navigator.clipboard.writeText('claude setup-token'); b.textContent = 'Copié ✓'; }
    catch { b.textContent = 'Sélectionnez le texte'; }
    setTimeout(() => { b.textContent = 'Copier'; }, 1800);
  });

  // Fenêtres : fermer (bouton, clic à côté, Échap)
  $$('.fenetre-fond').forEach((f) => {
    f.addEventListener('click', (e) => {
      if (e.target === f || e.target.closest('[data-fermer]')) {
        if (f.id === 'fenetreConfirmer') f.dispatchEvent(new Event('fermeture'));
        else fermerFenetre(f.id);
      }
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const ouverte = $$('.fenetre-fond').find((f) => !f.hidden);
    if (ouverte) {
      if (ouverte.id === 'fenetreConfirmer') ouverte.dispatchEvent(new Event('fermeture'));
      else fermerFenetre(ouverte.id);
    } else if (!$('#menuSkills').hidden) basculerMenuSkills(false);
    else if (!$('#menu').hidden) basculerMenu(false);
  });

  // Mise en route : déplier / replier
  $('#merEntete').addEventListener('click', () => {
    const memo = stockage('miseEnRoute') || { faites: 0, replie: false };
    memo.replie = !memo.replie;
    stockage('miseEnRoute', memo);
    $('#merEntete').setAttribute('aria-expanded', String(!memo.replie));
    $('#merEtapes').hidden = memo.replie;
    $('#merAction').hidden = memo.replie || !$('#merAction').childElementCount;
  });

  // Menu ☰ (mobile)
  $('#boutonMenu').addEventListener('click', (e) => { e.stopPropagation(); basculerMenu(); });
  document.addEventListener('click', (e) => { if (!$('#menu').hidden && !e.target.closest('#menu')) basculerMenu(false); });
  $$('[data-aller]').forEach((b) => b.addEventListener('click', () => {
    basculerMenu(false);
    if (b.dataset.aller === 'fichiers') allerA('fichiers'); else choisirOnglet(b.dataset.aller);
  }));

  // Skills : bouton « / », étiquette, liste
  $('#boutonSlash').addEventListener('click', (e) => { e.stopPropagation(); basculerMenuSkills(); if (!$('#menuSkills').hidden) zone.focus(); });
  $('#skillRetirer').addEventListener('click', () => { choisirSkill(null); zone.focus(); });
  document.addEventListener('click', (e) => { if (!$('#menuSkills').hidden && !e.target.closest('#menuSkills, #boutonSlash')) basculerMenuSkills(false); });
  $('#boutonNouveauSkill').addEventListener('click', () => ouvrirSkill(null));
  // Connexions
  $('#boutonNouvelleConnexion').addEventListener('click', ouvrirNouvelleConnexion);
  $('#formConnexion').addEventListener('submit', ajouterConnexion);
  $$('input[name="typeConnexion"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) typeConnexion(r.value); }));
  $('#champCxNom').addEventListener('blur', () => { const id = idSkill($('#champCxNom').value).slice(0, 40); if (id) $('#champCxNom').value = id; });
  $('#formSkill').addEventListener('submit', enregistrerSkill);
  $('#champSkillNom').addEventListener('input', majAideNom);
  $('#champSkillDescription').addEventListener('input', ajusterDescription);
  $('#champSkillNom').addEventListener('blur', () => { const id = idSkill($('#champSkillNom').value); if (id) $('#champSkillNom').value = id; majAideNom(); });
  $$('[data-skill-vue]').forEach((b) => b.addEventListener('click', () => vueMethode(b.dataset.skillVue)));
  $('#boutonSupprimerSkill').addEventListener('click', () => { if (sk.edition) supprimerSkill(sk.edition); });
  $('#champSkillMethode').addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); $('#formSkill').requestSubmit(); } });

  // Pièce jointe (trombone)
  $('#boutonJoindre').addEventListener('click', () => $('#champJoindre').click());
  $('#champJoindre').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const pb = verifierFichier(f);
    if (pb) { toast(pb, 'erreur'); e.target.value = ''; return; }
    afficherPiece(f);
    zone.focus();
  });
  $('#pieceRetirer').addEventListener('click', retirerPiece);
  // Glisser un fichier sur la discussion = le joindre
  const vueDisc = $('#vueDiscussion');
  vueDisc.addEventListener('dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); vueDisc.classList.add('survol-fichier'); } });
  vueDisc.addEventListener('dragleave', (e) => { if (e.target === vueDisc || !vueDisc.contains(e.relatedTarget)) vueDisc.classList.remove('survol-fichier'); });
  vueDisc.addEventListener('drop', (e) => {
    vueDisc.classList.remove('survol-fichier');
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (!f) return;
    e.preventDefault();
    const pb = verifierFichier(f);
    if (pb) { toast(pb, 'erreur'); return; }
    afficherPiece(f);
  });

  // Identité
  $('#formIdentite').addEventListener('submit', enregistrerIdentite);
  $('#formIdentite').addEventListener('input', () => { $('#formIdentite').dataset.modifie = '1'; });
  $('#champBadge').addEventListener('input', (e) => { const p = e.target.selectionStart; e.target.value = e.target.value.toUpperCase().replace(/\s/g, ''); e.target.setSelectionRange(p, p); });
  $('#boutonLogo').addEventListener('click', () => $('#champLogo').click());
  $('#champLogo').addEventListener('change', (e) => envoyerLogo(e.target.files && e.target.files[0]));
  $('#boutonRetirerLogo').addEventListener('click', retirerLogo);

  // Contexte et mémoire
  $$('[data-sous]').forEach((b) => b.addEventListener('click', () => choisirSous(b.dataset.sous)));
  $('#boutonModifier').addEventListener('click', () => ouvrirEdition());
  $('#boutonAnnulerTexte').addEventListener('click', () => { ctx.edition = false; rendreSousVue(); });
  $('#boutonEnregistrerTexte').addEventListener('click', sauverEdition);
  $('#zoneTexte').addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); sauverEdition(); } });
  $('#boutonRemplir').addEventListener('click', ouvrirRemplir);
  $('#formRemplir').addEventListener('submit', lancerRemplir);
  $('#boutonGarderProposition').addEventListener('click', garderProposition);
  $('#boutonAnnulerRemplir').addEventListener('click', async () => {
    try { await api('/api/contexte/remplir/annuler', { corps: {} }); } catch { /* rien */ }
  });

  // Documents
  $('#boutonDeposer').addEventListener('click', () => $('#champDeposer').click());
  $('#champDeposer').addEventListener('change', (e) => deposerDocuments(e.target.files));
  const depot = $('#depot');
  depot.addEventListener('dragover', (e) => { e.preventDefault(); depot.classList.add('survol'); });
  depot.addEventListener('dragleave', () => depot.classList.remove('survol'));
  depot.addEventListener('drop', (e) => { e.preventDefault(); depot.classList.remove('survol'); deposerDocuments(e.dataTransfer.files); });
  $$('[data-deconnexion]').forEach((b) => b.addEventListener('click', seDeconnecter));

  // Scène repliable (mobile)
  const scene = $('#scene');
  const replier = $('#replierScene');
  const appliquerRepli = (r) => {
    scene.classList.toggle('repliee', r);
    replier.setAttribute('aria-expanded', String(!r));
    replier.setAttribute('aria-label', r ? 'Déplier le bureau' : 'Replier le bureau');
  };
  appliquerRepli(Boolean(stockage('sceneRepliee')));
  replier.addEventListener('click', () => {
    const r = !scene.classList.contains('repliee');
    stockage('sceneRepliee', r);
    appliquerRepli(r);
  });
}

function basculerMenu(ouvrir) {
  const menu = $('#menu');
  const o = ouvrir === undefined ? menu.hidden : ouvrir;
  menu.hidden = !o;
  $('#boutonMenu').setAttribute('aria-expanded', String(o));
}

// ---------- Démarrage ----------

async function demarrer() {
  let moi, marque;
  try {
    [moi, marque] = await Promise.all([api('/api/moi'), api('/api/marque')]);
  } catch { return; }
  app.moi = moi;
  app.marque = marque;
  appliquerMarque();
  document.body.classList.toggle('est-admin', moi.role === 'admin');
  $$('.admin-seul').forEach((e) => { if (moi.role !== 'admin') e.hidden = true; });
  $$('.membre-seul').forEach((e) => { e.hidden = moi.role === 'admin'; });
  if (moi.role !== 'admin') $$('#formIdentite .champ').forEach((c) => { c.readOnly = true; });
  remplirIdentite();
  brancherInterface();
  creerScene();
  await Promise.all([chargerEtat(), chargerDiscussion(), chargerSkills()]);
  ouvrirFlux();
  retourOAuth();
}

demarrer();
