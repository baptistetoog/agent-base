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

function appliquerMarque() {
  const m = app.marque;
  document.title = `${m.nomAgent} · ${m.nomOutil}`;
  $$('[data-initiale]').forEach((e) => { e.textContent = m.initiale; });
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
  } else {
    bulle.textContent = m.texte;
  }
  let meta = heure(m.quand);
  if (!agent && !moi && m.qui) meta = `${prenomDe(m.qui.nom)} · ${meta}`;
  if (agent && m.statut === 'arrete') meta += ' · arrêté';
  bloc.append(bulle, el('div', 'meta', meta));
  ligne.append(bloc);
  return ligne;
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
  if (!t) return;
  if (!app.claude.connecte) {
    if (estAdmin()) { toast('Connectez d\'abord Claude pour que l\'agent puisse répondre.', 'attention'); ouvrirFenetreClaude(); }
    else toast('L\'agent n\'est pas encore connecté : demandez à un admin.', 'attention');
    return;
  }
  const zone = $('#zoneMessage');
  zone.value = '';
  ajusterZone();
  if (app.bureau) app.bureau.statut('message');
  try {
    const r = await api('/api/message', { corps: { texte: t } });
    ajouterMessage(r.message);
    defiler(true);
    if (r.enAttente) toast(`L'agent termine son travail en cours : votre message passe ensuite (${r.enAttente} en attente).`);
  } catch (e) {
    if (!zone.value) { zone.value = t; ajusterZone(); }
    toast(e.message, 'erreur');
    if (e.donnees && e.donnees.connecter) ouvrirFenetreClaude();
    appliquerStatut(app.statut);
  }
}

function ajusterZone() {
  const z = $('#zoneMessage');
  z.style.height = 'auto';
  z.style.height = Math.min(z.scrollHeight, 180) + 'px';
  $('#boutonEnvoyer').disabled = !z.value.trim();
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
    if (app.fluxDejaOuvert) { chargerDiscussion(); chargerEtat(); }
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
  });
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
  if (nom === 'reglages') chargerEtat();
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
    } else if (!$('#menu').hidden) basculerMenu(false);
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
  $$('[data-aller]').forEach((b) => b.addEventListener('click', () => { basculerMenu(false); choisirOnglet(b.dataset.aller); }));
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
  brancherInterface();
  try {
    app.bureau = creerBureau($('#scene3d'), { nom: marque.nomAgent, entreprise: marque.nomOutil, ...PERSONNAGE });
  } catch (e) { console.warn('Bureau 3D indisponible :', e); }
  await Promise.all([chargerEtat(), chargerDiscussion()]);
  ouvrirFlux();
}

demarrer();
