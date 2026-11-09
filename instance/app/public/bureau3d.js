/* =============================================================================
   bureau3d.js - Le bureau 3D d'un agent IA (style « pâte à modeler »)
   Module ES autonome, sans dépendance au reste de l'outil.
   -----------------------------------------------------------------------------
   PRÉREQUIS dans la page (three.js via une importmap) :

     <script type="importmap">
       { "imports": {
           "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
           "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/" } }
     </script>
     (Content-Security-Policy : autoriser https://cdn.jsdelivr.net dans script-src,
      et l'importmap en ligne par son empreinte sha256.)

   UTILISATION :

     import { creerBureau } from './bureau3d.js';
     const bureau = creerBureau(document.getElementById('scene'), {
       nom: 'Mon agent',          // nom affiché sur l'écran de l'ordinateur
       entreprise: '',             // (facultatif) nom de l'entreprise, affiché sur l'écran au repos
       couleurCorps: '#4C5A70',    // couleur du personnage cube
       couleurYeux: '#FFD43B',     // couleur des grands yeux
       badge: 'IA',                // texte du badge sur la poitrine (4 caractères max)
       accessoire: 'aucun',        // 'lanterne' | 'loupe' | 'casque' | 'aucun'
       fond: '#F5F6F8',            // couleur de fond autour de la pièce
     });
     bureau.statut('outil', 'Je lis le document…');
     bureau.parle(true);           // la bouche bouge (ex. pendant que la réponse arrive)
     bureau.destroy();             // libère tout (WebGL, écouteurs, éléments créés)

   LES ÉTATS : bureau.statut(etat, detail)
     'repos'     il respire, cligne des yeux, regarde autour de lui ou vers nous
     'message'   on vient d'envoyer un message : il se tourne vers nous et fait un signe
     'reflechit' une bulle « … » au-dessus de sa tête
     'outil'     il se tourne vers l'écran et tape ; l'accessoire s'allume ;
                 detail = texte affiché sur l'écran (ex. « Je lis le document… »)
     'repond'    il se tourne vers nous, sa bouche bouge
     'fini'      petit saut de joie
     'alerte'    une carte attend une validation : panneau « ! » au-dessus du bureau.
                 Le panneau RESTE affiché (même pendant le travail) jusqu'à
                 bureau.statut('alerte', false). detail (texte) = phrase sur l'écran.

   Le module ne touche qu'au conteneur fourni (il y ajoute un <canvas> ou un <svg>).
   Sans WebGL (ou si three.js ne se charge pas), il affiche une illustration SVG
   du même personnage, avec la même API et les mêmes états.
   Le rendu se met en pause quand l'onglet est caché ou le conteneur invisible.
   Option avancée : { webgl: false } force l'illustration SVG.
   ============================================================================= */

const DEFAUTS = {
  nom: 'Mon agent',
  entreprise: '',
  couleurCorps: '#4C5A70',
  couleurYeux: '#FFD43B',
  badge: 'IA',
  accessoire: 'aucun',
  fond: '#F5F6F8',
  webgl: true,
};
const ETATS = ['repos', 'message', 'reflechit', 'outil', 'repond', 'fini', 'alerte'];
const POLICE = '"Lexend Deca", "DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif';

export function creerBureau(conteneur, options = {}) {
  if (!conteneur || !conteneur.appendChild) throw new Error('creerBureau : conteneur manquant');
  const o = { ...DEFAUTS, ...options };
  o.badge = String(o.badge || '').slice(0, 4);
  if (!['lanterne', 'loupe', 'casque', 'aucun'].includes(o.accessoire)) o.accessoire = 'lanterne';

  // État partagé (3D ou SVG) : le dernier statut reçu est rejoué quand la scène est prête
  const memo = { etat: 'repos', detail: null, alerte: false, texteAlerte: null, parle: false, journal: [] };
  let moteur = null;
  let detruit = false;

  function noterJournal(etat, detail) {
    if (etat === 'message' || ((etat === 'reflechit' || etat === 'outil') && (memo.etat === 'repos' || memo.etat === 'fini'))) memo.journal = [];
    if (etat === 'outil') {
      memo.journal.push(String(detail || 'Je travaille…'));
      if (memo.journal.length > 14) memo.journal.shift();
    }
  }

  const api = {
    statut(etat, detail) {
      if (detruit || !ETATS.includes(etat)) return;
      if (etat === 'alerte') {
        memo.alerte = detail !== false;
        memo.texteAlerte = typeof detail === 'string' ? detail : null;
        if (moteur) moteur.alerte(memo.alerte, memo.texteAlerte);
        return;
      }
      noterJournal(etat, detail);
      memo.etat = etat;
      memo.detail = detail == null ? null : String(detail);
      if (moteur) moteur.statut(etat, memo.detail, memo.journal);
    },
    parle(actif) {
      memo.parle = !!actif;
      if (moteur && !detruit) moteur.parle(memo.parle);
    },
    destroy() {
      detruit = true;
      if (moteur) { try { moteur.destroy(); } catch (e) { /* rien */ } }
      moteur = null;
    },
    type: 'chargement',
  };

  function brancher(m, type) {
    if (detruit) { m.destroy(); return; }
    moteur = m;
    api.type = type;
    m.statut(memo.etat, memo.detail, memo.journal);
    if (memo.alerte) m.alerte(true, memo.texteAlerte);
    if (memo.parle) m.parle(true);
  }

  if (!o.webgl || !webglDisponible()) {
    brancher(creerSVG(conteneur, o), 'svg');
  } else {
    // three.js est chargé à la demande : si le CDN ne répond pas, on bascule sur le SVG
    Promise.all([import('three'), import('three/addons/geometries/RoundedBoxGeometry.js')])
      .then(([THREE, rb]) => {
        if (detruit) return;
        let m;
        try { m = creer3D(THREE, rb.RoundedBoxGeometry, conteneur, o, memo); }
        catch (e) { console.warn('bureau3d : WebGL indisponible, illustration SVG à la place.', e); m = creerSVG(conteneur, o); brancher(m, 'svg'); return; }
        brancher(m, '3d');
      })
      .catch((e) => {
        if (detruit) return;
        console.warn('bureau3d : three.js introuvable, illustration SVG à la place.', e);
        brancher(creerSVG(conteneur, o), 'svg');
      });
  }
  return api;
}

function webglDisponible() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}

function heureCourante() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// Période de la journée (pour le ciel de la fenêtre et la lumière)
function periode() {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h >= 8 && h < 18) return 'jour';
  if ((h >= 18 && h < 21) || (h >= 6 && h < 8)) return 'soir';
  return 'nuit';
}

function eclaircir(hex, f) {
  const n = parseInt(hex.replace('#', ''), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.round(r + (f > 0 ? (255 - r) * f : r * f));
  g = Math.round(g + (f > 0 ? (255 - g) * f : g * f));
  b = Math.round(b + (f > 0 ? (255 - b) * f : b * f));
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

function rondRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function couper(ctx, texte, largeur, maxLignes) {
  const mots = String(texte).split(/\s+/);
  const lignes = [];
  let l = '';
  for (const m of mots) {
    const essai = l ? l + ' ' + m : m;
    if (ctx.measureText(essai).width > largeur && l) { lignes.push(l); l = m; }
    else l = essai;
  }
  if (l) lignes.push(l);
  if (lignes.length > maxLignes) {
    const r = lignes.slice(0, maxLignes);
    let d = r[maxLignes - 1];
    while (d.length > 1 && ctx.measureText(d + '…').width > largeur) d = d.slice(0, -1);
    r[maxLignes - 1] = d.replace(/[\s.…]+$/, '') + '…';
    return r;
  }
  return lignes;
}

// Contour simplifié de la France (longitude, latitude) pour la carte punaisée
const FRANCE = [[2.55, 51.08], [4.15, 50.0], [4.8, 50.15], [5.9, 49.5], [6.8, 49.15], [8.2, 48.95], [7.6, 47.6], [6.9, 47.4], [6.1, 46.6], [6.8, 46.4], [7.0, 45.9], [6.6, 45.1], [7.0, 44.2], [7.5, 43.78], [6.6, 43.15], [5.0, 43.35], [4.2, 43.45], [3.1, 42.9], [3.15, 42.43], [1.7, 42.5], [0.7, 42.8], [-0.3, 42.8], [-1.78, 43.36], [-1.25, 44.6], [-1.2, 46.0], [-2.2, 47.1], [-2.8, 47.5], [-4.4, 47.8], [-4.75, 48.35], [-3.5, 48.85], [-2.0, 48.65], [-1.6, 48.75], [-1.95, 49.7], [-1.25, 49.65], [-1.1, 49.35], [0.2, 49.45], [1.45, 50.1], [1.6, 50.9]];
const VILLES = [
  { lon: 2.35, lat: 48.86, c: '#FF5C2A' },   // Paris
  { lon: 0.72, lat: 45.18, c: '#D9443B', grand: true }, // Périgueux
  { lon: 4.84, lat: 45.76, c: '#FFDB21' },   // Lyon
  { lon: -0.58, lat: 44.84, c: '#2E9E6A' },  // Bordeaux
  { lon: 5.37, lat: 43.3, c: '#FF5C2A' },    // Marseille
  { lon: 3.06, lat: 50.63, c: '#FFDB21' },   // Lille
  { lon: -1.55, lat: 47.22, c: '#2E9E6A' },  // Nantes
  { lon: 1.44, lat: 43.6, c: '#FF5C2A' },    // Toulouse
];
// Projection de la carte : coordonnées dans un rectangle de 0..1 (x) et 0..1 (y)
function projeter(lon, lat) {
  return { x: ((lon + 5.4) * 0.69) / 9.7 + 0.03, y: (51.4 - lat) / 10.4 + 0.02 };
}

function dessinerCarteFrance(ctx, w, h) {
  ctx.fillStyle = '#FFFBF2'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#DCEFF3'; rondRect(ctx, 18, 18, w - 36, h - 36, 14); ctx.fill();
  // petites vagues
  ctx.strokeStyle = 'rgba(80,140,160,.25)'; ctx.lineWidth = 2;
  for (let i = 0; i < 9; i++) {
    const x = 40 + (i * 97) % (w - 90), y = 50 + (i * 131) % (h - 100);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 8, y - 6, x + 16, y); ctx.quadraticCurveTo(x + 24, y + 6, x + 32, y); ctx.stroke();
  }
  const zx = 30, zy = 26, zw = w - 60, zh = h - 52;
  ctx.beginPath();
  FRANCE.forEach(([lon, lat], i) => { const p = projeter(lon, lat); const X = zx + p.x * zw, Y = zy + p.y * zh; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
  ctx.closePath();
  ctx.fillStyle = '#CFE5C8'; ctx.fill();
  ctx.lineJoin = 'round'; ctx.strokeStyle = '#6E9A78'; ctx.lineWidth = 4; ctx.stroke();
  // Corse
  const c = projeter(9.1, 42.15);
  ctx.beginPath(); ctx.ellipse(zx + c.x * zw, zy + c.y * zh, 10, 22, 0.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // routes en pointillés entre les villes
  ctx.setLineDash([6, 7]); ctx.strokeStyle = 'rgba(255,92,42,.55)'; ctx.lineWidth = 3;
  const v = VILLES.map(x => projeter(x.lon, x.lat));
  ctx.beginPath();
  [[1, 0], [1, 3], [1, 7], [0, 2], [2, 4], [0, 5], [0, 6]].forEach(([a, b]) => { ctx.moveTo(zx + v[a].x * zw, zy + v[a].y * zh); ctx.lineTo(zx + v[b].x * zw, zy + v[b].y * zh); });
  ctx.stroke(); ctx.setLineDash([]);
  // rose des vents
  ctx.save(); ctx.translate(w - 70, h - 70); ctx.fillStyle = '#2F4A3A';
  ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(7, 0); ctx.lineTo(0, 26); ctx.lineTo(-7, 0); ctx.closePath(); ctx.globalAlpha = .7; ctx.fill();
  ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(0, 7); ctx.lineTo(26, 0); ctx.lineTo(0, -7); ctx.closePath(); ctx.globalAlpha = .35; ctx.fill();
  ctx.globalAlpha = 1; ctx.font = `600 16px ${POLICE}`; ctx.textAlign = 'center'; ctx.fillText('N', 0, -32); ctx.restore();
  return { zx, zy, zw, zh };
}

/* =============================================================================
   LA SCÈNE 3D
   ============================================================================= */
function creer3D(THREE, RoundedBoxGeometry, conteneur, o, memo) {
  const petitEcran = Math.min(window.innerWidth, window.innerHeight) < 600 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const canvas = document.createElement('canvas');
  canvas.className = 'bureau3d-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${o.nom} à son bureau`);
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;cursor:grab;';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  conteneur.appendChild(canvas);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, petitEcran ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping || THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(new THREE.Color(o.fond), 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

  const aJeter = [];   // géométries, matériaux, textures à libérer
  const geo = (g) => { aJeter.push(g); return g; };
  const matCache = new Map();
  function mat(couleur, extra = {}) {
    const cle = extra.map ? '' : couleur + JSON.stringify(extra);
    const { unique: u, ...reste } = extra;
    const unique = u || !!extra.map;
    if (!unique && matCache.has(cle)) return matCache.get(cle);
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(couleur), roughness: 0.82, metalness: 0, ...reste });
    aJeter.push(m);
    if (!unique) matCache.set(cle, m);
    return m;
  }
  function boite(w, h, d, r, couleur, extra) {
    const seg = petitEcran ? 3 : 4;
    const m = new THREE.Mesh(geo(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2))), typeof couleur === 'string' ? mat(couleur, extra) : couleur);
    return m;
  }
  function sphere(r, couleur, extra) { return new THREE.Mesh(geo(new THREE.SphereGeometry(r, 24, 16)), typeof couleur === 'string' ? mat(couleur, extra) : couleur); }
  function cylindre(rh, rb, h, couleur, extra, seg = 28) { return new THREE.Mesh(geo(new THREE.CylinderGeometry(rh, rb, h, seg)), typeof couleur === 'string' ? mat(couleur, extra) : couleur); }
  function capsule(r, l, couleur) { return new THREE.Mesh(geo(new THREE.CapsuleGeometry(r, l, 6, 14)), typeof couleur === 'string' ? mat(couleur) : couleur); }
  function texCanvas(c) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    aJeter.push(t);
    return t;
  }
  function placer(m, x, y, z, parent = scene) { m.position.set(x, y, z); parent.add(m); return m; }

  // ---------------- Lumières ----------------
  const hemi = new THREE.HemisphereLight(0xFFF3E2, 0xD8C2A4, 1.6);
  scene.add(hemi);
  const soleil = new THREE.DirectionalLight(0xFFE6C4, 2.4);
  soleil.position.set(4.5, 8.5, 5.5);
  soleil.target.position.set(-0.3, 0, -1);
  soleil.castShadow = true;
  soleil.shadow.mapSize.set(petitEcran ? 1024 : 2048, petitEcran ? 1024 : 2048);
  Object.assign(soleil.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 22 });
  soleil.shadow.bias = -0.0006;
  soleil.shadow.normalBias = 0.025;
  soleil.shadow.radius = 4;
  scene.add(soleil, soleil.target);
  const remplissage = new THREE.DirectionalLight(0xFFF1E0, 0.55);
  remplissage.position.set(-2, 4, 8);
  scene.add(remplissage);
  const lumiereFenetre = new THREE.PointLight(0xCFE6FF, 2.2, 6, 2);
  lumiereFenetre.position.set(-1.55, 2.7, -2.4);
  scene.add(lumiereFenetre);

  // ---------------- La pièce (diorama) ----------------
  const X_MUR = -3.1, Z_MUR = -3.2;

  // Parquet clair
  const cParquet = document.createElement('canvas'); cParquet.width = cParquet.height = 512;
  {
    const ctx = cParquet.getContext('2d');
    const teintes = ['#EED7B4', '#E9CFA8', '#F1DCBB', '#E6CBA2', '#ECD4AF'];
    const haut = 64;
    for (let r = 0; r < 512 / haut; r++) {
      let x = -((r * 173) % 260);
      let i = r;
      while (x < 512) {
        const l = 220 + ((i * 97) % 120);
        ctx.fillStyle = teintes[(i + r) % teintes.length];
        ctx.fillRect(x, r * haut, l, haut);
        ctx.fillStyle = 'rgba(160,110,60,.06)';
        for (let k = 0; k < 4; k++) ctx.fillRect(x + 10, r * haut + 10 + k * 13, l - 20, 2);
        ctx.fillStyle = 'rgba(150,105,60,.28)';
        ctx.fillRect(x, r * haut, 3, haut);
        x += l; i++;
      }
      ctx.fillStyle = 'rgba(150,105,60,.3)';
      ctx.fillRect(0, r * haut, 512, 3);
    }
  }
  const texParquet = texCanvas(cParquet);
  texParquet.wrapS = texParquet.wrapT = THREE.RepeatWrapping;
  texParquet.repeat.set(2.2, 2.2);
  const sol = boite(6.8, 0.32, 5.55, 0.14, mat('#FFFFFF', { map: texParquet, roughness: 0.7 }));
  placer(sol, 0.05, -0.16, -0.675);
  const socle = boite(6.92, 0.22, 5.67, 0.1, '#D9B98E');
  placer(socle, 0.05, -0.36, -0.675);

  // Murs
  const murFond = boite(6.8, 4.5, 0.26, 0.1, '#F4E8D7');
  placer(murFond, 0.05, 2.1, Z_MUR - 0.13);
  const murGauche = boite(0.26, 4.5, 5.55, 0.1, '#F0E1CD');
  placer(murGauche, X_MUR - 0.13, 2.1, -0.675);
  // Soubassement vert sauge + plinthes
  placer(boite(6.7, 1.25, 0.06, 0.03, '#D5E2CC'), 0.1, 0.62, Z_MUR + 0.03);
  placer(boite(0.06, 1.25, 5.4, 0.03, '#D0DEC7'), X_MUR + 0.03, 0.62, -0.6);
  placer(boite(6.7, 0.07, 0.1, 0.03, '#FFFFFF'), 0.1, 1.27, Z_MUR + 0.05);
  placer(boite(0.1, 0.07, 5.4, 0.03, '#FFFFFF'), X_MUR + 0.05, 1.27, -0.6);

  // Tapis rond
  placer(cylindre(1.55, 1.55, 0.03, '#F6D2B6', {}, 48), 0.25, 0.015, -0.75);
  placer(cylindre(1.3, 1.3, 0.035, '#FBE6D3', {}, 48), 0.25, 0.02, -0.75);

  // ---------------- Fenêtre (ciel selon l'heure) ----------------
  const cCiel = document.createElement('canvas'); cCiel.width = 256; cCiel.height = 224;
  const texCiel = texCanvas(cCiel);
  const ciel = new THREE.Mesh(geo(new THREE.PlaneGeometry(1.42, 1.24)), new THREE.MeshBasicMaterial({ map: texCiel, toneMapped: false }));
  aJeter.push(ciel.material);
  placer(ciel, -1.55, 2.75, Z_MUR + 0.02);
  const blanc = '#FFFFFF';
  placer(boite(1.62, 0.12, 0.14, 0.05, blanc), -1.55, 3.43, Z_MUR + 0.07);
  placer(boite(1.62, 0.12, 0.14, 0.05, blanc), -1.55, 2.07, Z_MUR + 0.07);
  placer(boite(0.12, 1.45, 0.14, 0.05, blanc), -2.31, 2.75, Z_MUR + 0.07);
  placer(boite(0.12, 1.45, 0.14, 0.05, blanc), -0.79, 2.75, Z_MUR + 0.07);
  placer(boite(0.06, 1.3, 0.08, 0.03, blanc), -1.55, 2.75, Z_MUR + 0.06);
  placer(boite(1.42, 0.06, 0.08, 0.03, blanc), -1.55, 2.75, Z_MUR + 0.06);
  placer(boite(1.85, 0.08, 0.3, 0.04, blanc), -1.55, 1.98, Z_MUR + 0.15);  // rebord
  // Rideaux
  placer(boite(0.34, 1.75, 0.12, 0.08, '#FFE7A8'), -2.55, 2.62, Z_MUR + 0.14);
  placer(boite(0.34, 1.75, 0.12, 0.08, '#FFE7A8'), -0.55, 2.62, Z_MUR + 0.14);
  placer(boite(2.5, 0.06, 0.06, 0.03, '#C9A57C'), -1.55, 3.55, Z_MUR + 0.16);
  // Petit cactus sur le rebord
  placer(cylindre(0.11, 0.09, 0.16, '#E07E55'), -1.15, 2.1, Z_MUR + 0.16);
  placer(capsule(0.065, 0.12, '#6FAE7C'), -1.15, 2.28, Z_MUR + 0.16);

  let periodeAffichee = null;
  function dessinerCiel() {
    const p = periode();
    periodeAffichee = p;
    const ctx = cCiel.getContext('2d');
    const w = cCiel.width, h = cCiel.height;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    if (p === 'jour') { g.addColorStop(0, '#7EC3EE'); g.addColorStop(1, '#D9F0FB'); }
    else if (p === 'soir') { g.addColorStop(0, '#7E6FB3'); g.addColorStop(0.55, '#F59A7A'); g.addColorStop(1, '#FBD38D'); }
    else { g.addColorStop(0, '#16213F'); g.addColorStop(1, '#34467A'); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    if (p === 'nuit') {
      ctx.fillStyle = '#FFFFFF';
      for (let i = 0; i < 40; i++) { ctx.globalAlpha = 0.4 + ((i * 37) % 60) / 100; ctx.beginPath(); ctx.arc((i * 71) % w, (i * 43) % (h * 0.75), 0.8 + (i % 3) * 0.6, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1; ctx.fillStyle = '#FFF5D6'; ctx.beginPath(); ctx.arc(w * 0.72, h * 0.3, 20, 0, 7); ctx.fill();
      ctx.fillStyle = '#16213F'; ctx.beginPath(); ctx.arc(w * 0.72 + 9, h * 0.3 - 6, 18, 0, 7); ctx.fill();
    } else {
      ctx.fillStyle = p === 'jour' ? '#FFE680' : '#FFB36B';
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 24;
      ctx.beginPath(); ctx.arc(w * 0.7, p === 'jour' ? h * 0.28 : h * 0.62, 22, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = p === 'jour' ? 'rgba(255,255,255,.95)' : 'rgba(255,232,214,.8)';
      [[50, 70, 1], [150, 120, .8], [70, 160, .7]].forEach(([x, y, s]) => {
        ctx.beginPath(); ctx.arc(x, y, 16 * s, 0, 7); ctx.arc(x + 18 * s, y - 8 * s, 20 * s, 0, 7); ctx.arc(x + 40 * s, y, 15 * s, 0, 7); ctx.fill();
      });
    }
    // collines au loin
    ctx.fillStyle = p === 'nuit' ? '#22305A' : (p === 'soir' ? '#B9877F' : '#A8D49C');
    ctx.beginPath(); ctx.moveTo(0, h); ctx.quadraticCurveTo(w * 0.25, h * 0.68, w * 0.55, h * 0.84); ctx.quadraticCurveTo(w * 0.8, h * 0.72, w, h * 0.8); ctx.lineTo(w, h); ctx.fill();
    texCiel.needsUpdate = true;
    // lumière de la pièce
    if (p === 'jour') { hemi.intensity = 1.6; hemi.color.set(0xFFF3E2); soleil.intensity = 2.4; soleil.color.set(0xFFE6C4); lumiereFenetre.color.set(0xCFE6FF); lumiereFenetre.intensity = 2.2; }
    else if (p === 'soir') { hemi.intensity = 1.35; hemi.color.set(0xFFE2C8); soleil.intensity = 2.0; soleil.color.set(0xFFC79A); lumiereFenetre.color.set(0xFFB58A); lumiereFenetre.intensity = 2.6; }
    else { hemi.intensity = 1.1; hemi.color.set(0xDCE4FF); soleil.intensity = 1.25; soleil.color.set(0xC9D6FF); lumiereFenetre.color.set(0x8FA5E6); lumiereFenetre.intensity = 1.6; }
  }
  dessinerCiel();

  // ---------------- Carte de France punaisée (mur de gauche) ----------------
  const cCarte = document.createElement('canvas'); cCarte.width = 640; cCarte.height = 520;
  const zone = dessinerCarteFrance(cCarte.getContext('2d'), cCarte.width, cCarte.height);
  const LARG_CARTE = 1.75, HAUT_CARTE = 1.42;
  const carte = new THREE.Group();
  carte.position.set(X_MUR + 0.04, 2.55, -0.55);
  carte.rotation.y = Math.PI / 2;
  scene.add(carte);
  placer(boite(LARG_CARTE + 0.12, HAUT_CARTE + 0.12, 0.05, 0.03, '#C9A57C'), 0, 0, 0, carte);
  const feuille = new THREE.Mesh(geo(new THREE.PlaneGeometry(LARG_CARTE, HAUT_CARTE)), mat('#FFFFFF', { map: texCanvas(cCarte), roughness: 0.95, unique: true }));
  placer(feuille, 0, 0, 0.03, carte);
  VILLES.forEach((v) => {
    const p = projeter(v.lon, v.lat);
    const u = (zone.zx + p.x * zone.zw) / cCarte.width, w = (zone.zy + p.y * zone.zh) / cCarte.height;
    const x = (u - 0.5) * LARG_CARTE, y = (0.5 - w) * HAUT_CARTE;
    const aiguille = cylindre(0.008, 0.008, 0.1, '#9AA0A6', {}, 6);
    aiguille.rotation.x = Math.PI / 2;
    placer(aiguille, x, y, 0.08, carte);
    placer(sphere(v.grand ? 0.055 : 0.04, v.c, { roughness: 0.45 }), x, y, 0.13, carte);
  });
  // punaises aux coins
  [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([a, b]) => placer(sphere(0.03, '#D9443B'), a * (LARG_CARTE / 2 - 0.05), b * (HAUT_CARTE / 2 - 0.05), 0.05, carte));

  // ---------------- Étagère (mur du fond, à droite) ----------------
  const etagere = new THREE.Group();
  etagere.position.set(2.45, 2.95, Z_MUR);
  scene.add(etagere);
  placer(boite(1.5, 0.08, 0.38, 0.03, '#C98F5E'), 0, 0, 0.19, etagere);
  placer(boite(0.06, 0.22, 0.3, 0.02, '#B57A4C'), -0.55, -0.13, 0.16, etagere);
  placer(boite(0.06, 0.22, 0.3, 0.02, '#B57A4C'), 0.55, -0.13, 0.16, etagere);
  const livres = [['#FF5C2A', 0.42], ['#2F4A3A', 0.5], ['#FFDB21', 0.38], ['#7FB3C9', 0.46], ['#F2C14E', 0.34]];
  let lx = -0.62;
  livres.forEach(([c, h], i) => {
    const l = boite(0.11, h, 0.28, 0.03, c);
    l.position.set(lx, 0.04 + h / 2, 0.19);
    if (i === 4) { l.rotation.z = -0.32; l.position.x += 0.05; l.position.y -= 0.01; }
    etagere.add(l); lx += 0.125;
  });
  // petit globe
  placer(cylindre(0.05, 0.08, 0.06, '#C98F5E'), 0.2, 0.07, 0.19, etagere);
  const globe = placer(sphere(0.15, '#7FB3C9', { roughness: 0.6 }), 0.2, 0.25, 0.19, etagere);
  placer(new THREE.Mesh(geo(new THREE.TorusGeometry(0.17, 0.012, 8, 32)), mat('#C98F5E')), 0.2, 0.25, 0.19, etagere).rotation.y = 0.6;
  // pot à crayons
  placer(cylindre(0.08, 0.08, 0.2, '#FFFFFF'), 0.5, 0.14, 0.2, etagere);
  [['#FF5C2A', -0.03], ['#2E9E6A', 0.02], ['#FFDB21', 0.0]].forEach(([c, d], i) => {
    const cr = cylindre(0.015, 0.015, 0.3, c, {}, 8); cr.rotation.z = d * 6; placer(cr, 0.5 + d, 0.28 + i * 0.01, 0.2 + d, etagere);
  });

  // ---------------- Plante ----------------
  const plante = new THREE.Group();
  plante.position.set(-2.4, 0, -2.45);
  scene.add(plante);
  placer(cylindre(0.36, 0.28, 0.62, '#D9774B'), 0, 0.31, 0, plante);
  placer(cylindre(0.39, 0.39, 0.1, '#E58A5E'), 0, 0.6, 0, plante);
  placer(cylindre(0.33, 0.33, 0.04, '#6B4A33'), 0, 0.64, 0, plante);
  const feuilles = [];
  const vertsFeuilles = ['#6FAE7C', '#5E9E6B', '#86C08D', '#4F8E5E'];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + (i % 2) * 0.3;
    const f = sphere(0.22, vertsFeuilles[i % 4]);
    f.scale.set(0.55, 1.5, 0.25);
    const piv = new THREE.Group();
    piv.position.set(0, 0.66, 0);
    piv.rotation.y = a;
    f.position.set(0, 0.3 + (i % 3) * 0.12, 0.12);
    f.rotation.x = 0.55 + (i % 3) * 0.12;
    piv.add(f);
    plante.add(piv);
    feuilles.push(piv);
  }

  // ---------------- Le bureau (meuble) ----------------
  const DESSUS = 1.21;
  const meuble = new THREE.Group();
  meuble.position.set(0.45, 0, -2.5);
  scene.add(meuble);
  placer(boite(3.0, 0.12, 1.2, 0.05, '#D39A68'), 0, DESSUS - 0.06, 0, meuble);
  [[-1.38, -0.5], [1.38, -0.5], [-1.38, 0.5], [1.38, 0.5]].forEach(([x, z]) => placer(boite(0.12, DESSUS - 0.12, 0.12, 0.05, '#B57A4C'), x, (DESSUS - 0.12) / 2, z, meuble));
  placer(boite(0.7, 0.5, 1.0, 0.06, '#C98F5E'), 1.0, DESSUS - 0.37, 0, meuble);   // caisson
  placer(boite(0.6, 0.03, 0.02, 0.01, '#9C6A40'), 1.0, DESSUS - 0.32, 0.51, meuble);
  placer(sphere(0.035, '#F2C14E'), 1.0, DESSUS - 0.42, 0.52, meuble);

  // Écran d'ordinateur (texture canvas mise à jour en direct)
  const ordi = new THREE.Group();
  ordi.position.set(0.85, DESSUS, -2.72);
  ordi.rotation.y = 0.12;
  scene.add(ordi);
  placer(boite(0.55, 0.05, 0.34, 0.02, '#4A4F57'), 0, 0.025, 0, ordi);
  placer(boite(0.1, 0.42, 0.08, 0.03, '#4A4F57'), 0, 0.24, -0.03, ordi);
  placer(boite(1.5, 0.96, 0.09, 0.06, '#3E434B'), 0, 0.88, 0.02, ordi);
  const cEcran = document.createElement('canvas'); cEcran.width = 768; cEcran.height = 480;
  const texEcran = texCanvas(cEcran);
  const matEcran = new THREE.MeshBasicMaterial({ map: texEcran, toneMapped: false });
  aJeter.push(matEcran);
  const ecran = new THREE.Mesh(geo(new THREE.PlaneGeometry(1.38, 0.86)), matEcran);
  placer(ecran, 0, 0.88, 0.07, ordi);
  const lueurEcran = new THREE.PointLight(0xBFE3CF, 1.2, 2.6, 2);
  placer(lueurEcran, 0, 0.9, 0.5, ordi);

  // Clavier
  const clavier = new THREE.Group();
  clavier.position.set(0.5, DESSUS, -2.05);
  clavier.rotation.y = -0.38;
  scene.add(clavier);
  placer(boite(0.92, 0.05, 0.32, 0.03, '#F4EFE8'), 0, 0.025, 0, clavier);
  const touches = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 10; c++) {
    const t = boite(0.068, 0.025, 0.065, 0.012, '#FFFFFF');
    placer(t, -0.385 + c * 0.0855, 0.058, -0.085 + r * 0.085, clavier);
    touches.push(t);
  }
  // Souris
  placer(boite(0.14, 0.06, 0.2, 0.06, '#F4EFE8'), 1.15, DESSUS + 0.03, -1.95);

  // Tasse
  const tasse = new THREE.Group();
  tasse.position.set(1.55, DESSUS, -1.95);
  scene.add(tasse);
  placer(cylindre(0.12, 0.105, 0.24, '#FF5C2A'), 0, 0.12, 0, tasse);
  placer(cylindre(0.1, 0.1, 0.02, '#6B4A33'), 0, 0.235, 0, tasse);
  const anse = new THREE.Mesh(geo(new THREE.TorusGeometry(0.065, 0.02, 8, 18, Math.PI * 1.3)), mat('#FF5C2A'));
  anse.rotation.z = -Math.PI * 0.65;
  placer(anse, 0.13, 0.12, 0, tasse);
  // vapeur
  const vapeurs = [0, 1, 2].map(i => { const v = sphere(0.035, '#FFFFFF', { transparent: true, opacity: 0.6, unique: true }); placer(v, 0, 0.3, 0, tasse); v.castShadow = false; v.userData.i = i; return v; });

  // Carnet + stylo
  const carnet = placer(boite(0.42, 0.04, 0.3, 0.02, '#2E9E6A'), -0.05, DESSUS + 0.02, -2.35);
  carnet.rotation.y = 0.25;
  placer(boite(0.4, 0.015, 0.28, 0.01, '#FFFDF6'), -0.05, DESSUS + 0.045, -2.35).rotation.y = 0.25;
  const stylo = placer(cylindre(0.012, 0.012, 0.3, '#FF5C2A', {}, 8), 0.15, DESSUS + 0.06, -2.3);
  stylo.rotation.z = Math.PI / 2; stylo.rotation.y = 0.5;

  // ---------------- Accessoire posé sur le bureau ----------------
  const access = { lumiere: null, emissifs: [], groupe: null, tete: null };
  if (o.accessoire === 'lanterne') {
    const g = new THREE.Group();
    g.position.set(1.95, DESSUS, -2.62);
    scene.add(g);
    placer(cylindre(0.17, 0.19, 0.07, '#2F4A3A'), 0, 0.035, 0, g);
    const verre = cylindre(0.14, 0.14, 0.34, '#FFF2C6', { transparent: true, opacity: 0.55, roughness: 0.2, emissive: new THREE.Color('#FFB347'), emissiveIntensity: 0, unique: true });
    placer(verre, 0, 0.24, 0, g);
    verre.castShadow = false;
    [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([a, b]) => placer(cylindre(0.014, 0.014, 0.34, '#2F4A3A', {}, 6), a * 0.1, 0.24, b * 0.1, g));
    placer(cylindre(0.12, 0.17, 0.08, '#2F4A3A'), 0, 0.45, 0, g);
    const poignee = new THREE.Mesh(geo(new THREE.TorusGeometry(0.08, 0.016, 8, 20, Math.PI)), mat('#2F4A3A'));
    placer(poignee, 0, 0.5, 0, g);
    const flamme = sphere(0.055, '#FFD36B', { emissive: new THREE.Color('#FF9A2E'), emissiveIntensity: 0.2, unique: true });
    flamme.scale.set(0.8, 1.4, 0.8);
    placer(flamme, 0, 0.22, 0, g);
    flamme.userData.sansOmbre = true;
    access.flamme = flamme;
    access.emissifs = [verre.material, flamme.material];
    access.lumiere = new THREE.PointLight(0xFFB04A, 0, 3.2, 2);
    placer(access.lumiere, 0, 0.3, 0.05, g);
    access.groupe = g;
  } else if (o.accessoire === 'loupe') {
    const g = new THREE.Group();
    g.position.set(1.85, DESSUS + 0.03, -2.5);
    g.rotation.y = 0.6;
    scene.add(g);
    const manche = cylindre(0.035, 0.035, 0.32, '#B57A4C', {}, 12); manche.rotation.z = Math.PI / 2; placer(manche, 0.32, 0, 0, g);
    const anneau = new THREE.Mesh(geo(new THREE.TorusGeometry(0.16, 0.03, 10, 32)), mat('#3E434B', { roughness: 0.4 }));
    anneau.rotation.x = Math.PI / 2; placer(anneau, 0, 0.0, 0, g);
    const lentille = cylindre(0.15, 0.15, 0.015, '#CFEAF7', { transparent: true, opacity: 0.6, roughness: 0.1, emissive: new THREE.Color('#9FDBFF'), emissiveIntensity: 0, unique: true }, 32);
    placer(lentille, 0, 0, 0, g);
    lentille.castShadow = false;
    access.emissifs = [lentille.material];
    access.lumiere = new THREE.PointLight(0x9FDBFF, 0, 2.2, 2);
    placer(access.lumiere, 0, 0.25, 0, g);
    access.groupe = g;
  }

  // ---------------- Panneau « ! » (carte à valider) ----------------
  const alerte = new THREE.Group();
  alerte.position.set(0.55, 3.15, -2.2);
  alerte.visible = false;
  scene.add(alerte);
  const panneauAlerte = boite(0.5, 0.5, 0.12, 0.12, '#FFDB21', { emissive: new THREE.Color('#FFDB21'), emissiveIntensity: 0.25, unique: true });
  panneauAlerte.rotation.z = Math.PI / 4;
  alerte.add(panneauAlerte);
  const barreAlerte = boite(0.08, 0.2, 0.06, 0.035, '#1F1A17'); placer(barreAlerte, 0, 0.05, 0.07, alerte);
  placer(sphere(0.045, '#1F1A17'), 0, -0.12, 0.07, alerte);

  // ---------------- Chaise + personnage ----------------
  const PIVOT = new THREE.Vector3(0.0, 0, -1.12);
  // pied de chaise fixe
  placer(cylindre(0.06, 0.06, 0.55, '#5A5550', {}, 12), PIVOT.x, 0.4, PIVOT.z);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const b = boite(0.5, 0.06, 0.09, 0.03, '#5A5550');
    b.position.set(PIVOT.x + Math.cos(a) * 0.25, 0.1, PIVOT.z + Math.sin(a) * 0.25);
    b.rotation.y = -a;
    scene.add(b);
    placer(sphere(0.055, '#3E3A36'), PIVOT.x + Math.cos(a) * 0.48, 0.055, PIVOT.z + Math.sin(a) * 0.48);
  }
  const pivot = new THREE.Group();
  pivot.position.copy(PIVOT);
  scene.add(pivot);
  placer(boite(0.95, 0.16, 0.9, 0.07, '#FF5C2A'), 0, 0.76, 0, pivot);                   // assise
  placer(boite(0.86, 0.7, 0.14, 0.07, '#FF5C2A'), 0, 1.22, -0.46, pivot);               // dossier
  placer(boite(0.12, 0.3, 0.1, 0.04, '#5A5550'), 0, 0.92, -0.45, pivot);

  const perso = new THREE.Group();     // sauts
  pivot.add(perso);
  const corps = new THREE.Group();     // respiration (échelle depuis la base)
  corps.position.set(0, 0.86, 0.02);
  perso.add(corps);
  const couleurCorps = o.couleurCorps;
  const matCorps = mat(couleurCorps, { roughness: 0.75 });
  const H = 1.05;
  const cube = boite(1.0, H, 0.9, 0.24, matCorps);
  placer(cube, 0, H / 2, 0, corps);
  // reflet doux sur le dessus
  placer(boite(0.86, 0.06, 0.72, 0.03, eclaircir(couleurCorps, 0.12)), 0, H - 0.01, 0, corps);

  // Yeux
  const matYeux = mat(o.couleurYeux, { emissive: new THREE.Color(o.couleurYeux), emissiveIntensity: 0.28, roughness: 0.4 });
  const matPupille = mat('#1F1A17', { roughness: 0.3 });
  const yeux = [];
  [-1, 1].forEach((s) => {
    const oeil = new THREE.Group();
    oeil.position.set(s * 0.22, 0.66, 0.452);
    corps.add(oeil);
    const disque = cylindre(0.165, 0.165, 0.05, matYeux, null, 32);
    disque.rotation.x = Math.PI / 2;
    oeil.add(disque);
    const pupille = new THREE.Group();
    oeil.add(pupille);
    const p = cylindre(0.078, 0.078, 0.03, matPupille, null, 24); p.rotation.x = Math.PI / 2; p.position.z = 0.03;
    pupille.add(p);
    const eclat = sphere(0.026, '#FFFFFF', { roughness: 0.2 }); eclat.position.set(0.03, 0.035, 0.05); eclat.scale.z = 0.4;
    pupille.add(eclat);
    yeux.push({ oeil, pupille });
  });
  // Joues
  [-1, 1].forEach((s) => { const j = sphere(0.06, '#E8907A', { transparent: true, opacity: 0.75 }); j.scale.set(1.2, 0.7, 0.3); placer(j, s * 0.38, 0.46, 0.452, corps); j.castShadow = false; });
  // Bouche : sourire (repos) et bouche ouverte (parle)
  const sourire = new THREE.Mesh(geo(new THREE.TorusGeometry(0.07, 0.02, 8, 18, Math.PI)), mat('#1F1A17'));
  sourire.rotation.z = Math.PI;
  placer(sourire, 0, 0.47, 0.455, corps);
  const boucheOuverte = new THREE.Group();
  placer(boucheOuverte, 0, 0.44, 0.452, corps);
  const bo = sphere(0.075, '#3A1F1A'); bo.scale.set(1.1, 0.8, 0.3); boucheOuverte.add(bo);
  const langue = sphere(0.04, '#E8907A'); langue.position.set(0, -0.03, 0.012); langue.scale.set(1.2, 0.6, 0.3); boucheOuverte.add(langue);
  boucheOuverte.visible = false;

  // Badge
  if (o.badge) {
    const cBadge = document.createElement('canvas'); cBadge.width = 256; cBadge.height = 104;
    const ctx = cBadge.getContext('2d');
    const dessinerBadge = () => {
      ctx.clearRect(0, 0, 256, 104);
      ctx.fillStyle = '#FFDB21'; rondRect(ctx, 0, 0, 256, 104, 52); ctx.fill();
      ctx.fillStyle = couleurCorps; ctx.font = `700 64px ${POLICE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(o.badge, 128, 56);
    };
    dessinerBadge();
    const texBadge = texCanvas(cBadge);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { dessinerBadge(); texBadge.needsUpdate = true; }).catch(() => {});
    placer(boite(0.42, 0.18, 0.04, 0.06, '#FFDB21'), 0, 0.2, 0.448, corps);
    const plaque = new THREE.Mesh(geo(new THREE.PlaneGeometry(0.4, 0.162)), new THREE.MeshBasicMaterial({ map: texBadge, transparent: true }));
    aJeter.push(plaque.material);
    placer(plaque, 0, 0.2, 0.473, corps);
  }

  // Antenne en forme d'épingle de carte
  const antenne = new THREE.Group();
  antenne.position.set(0.18, H, 0);
  corps.add(antenne);
  placer(cylindre(0.022, 0.022, 0.22, '#3E434B', {}, 8), 0, 0.11, 0, antenne);
  placer(sphere(0.085, '#FF5C2A', { roughness: 0.5 }), 0, 0.27, 0, antenne);

  // Casque (accessoire porté)
  if (o.accessoire === 'casque') {
    const arceau = new THREE.Mesh(geo(new THREE.TorusGeometry(0.56, 0.045, 10, 32, Math.PI)), mat('#3E434B'));
    placer(arceau, 0, H - 0.18, 0, corps);
    const ecouteurs = [-1, 1].map((s) => {
      const e = cylindre(0.15, 0.15, 0.1, '#FF5C2A', { emissive: new THREE.Color('#FF5C2A'), emissiveIntensity: 0, unique: true }, 24);
      e.rotation.z = Math.PI / 2; placer(e, s * 0.55, H - 0.2, 0, corps); return e;
    });
    const micro = cylindre(0.018, 0.018, 0.42, '#3E434B', {}, 8); micro.rotation.x = Math.PI / 2.3; placer(micro, -0.52, H - 0.38, 0.2, corps);
    placer(sphere(0.045, '#3E434B'), -0.5, H - 0.47, 0.42, corps);
    access.emissifs = ecouteurs.map(e => e.material);
  }

  // Bras (épaule = pivot)
  function creerBras(s) {
    const epaule = new THREE.Group();
    epaule.position.set(s * 0.53, 0.55, 0.05);
    corps.add(epaule);
    const b = capsule(0.095, 0.3, matCorps); b.position.y = -0.22; epaule.add(b);
    const main = sphere(0.115, eclaircir(couleurCorps, 0.1)); main.position.y = -0.46; epaule.add(main);
    return epaule;
  }
  const brasG = creerBras(1);   // côté +x
  const brasD = creerBras(-1);  // côté -x

  // Jambes (posées sur l'assise)
  [-1, 1].forEach((s) => {
    const cuisse = capsule(0.1, 0.22, matCorps); cuisse.rotation.x = Math.PI / 2; placer(cuisse, s * 0.24, 0.94, 0.4, pivot);
    const tibia = capsule(0.09, 0.2, matCorps); placer(tibia, s * 0.24, 0.72, 0.58, pivot);
    placer(boite(0.2, 0.12, 0.3, 0.06, '#3E434B'), s * 0.24, 0.52, 0.65, pivot);
  });

  // Bulle « … » (réflexion), toujours face à la caméra
  const bulle = new THREE.Group();
  bulle.visible = false;
  scene.add(bulle);
  const matBulle = mat('#FFFFFF', { emissive: new THREE.Color('#FFFFFF'), emissiveIntensity: 0.35, roughness: 0.6 });
  const nuage = sphere(0.3, matBulle); nuage.scale.set(1.55, 1, 0.45); bulle.add(nuage);
  const petite1 = sphere(0.08, matBulle); petite1.position.set(-0.3, -0.36, 0); bulle.add(petite1);
  const petite2 = sphere(0.045, matBulle); petite2.position.set(-0.42, -0.5, 0); bulle.add(petite2);
  const points = [-0.17, 0, 0.17].map((x) => { const p = sphere(0.055, '#2F4A3A'); p.position.set(x, 0, 0.14); bulle.add(p); return p; });
  [nuage, petite1, petite2, ...points].forEach(m => { m.castShadow = false; });

  // Ombres
  scene.traverse((m) => {
    if (m.isMesh && m !== ciel && m !== ecran && !m.material.transparent && !m.userData.sansOmbre) { m.castShadow = true; m.receiveShadow = true; }
    else if (m.isMesh) { m.receiveShadow = true; m.castShadow = false; }
  });
  sol.castShadow = false; murFond.castShadow = false; murGauche.castShadow = false; socle.castShadow = false;

  // ---------------- Caméra et contrôle à la souris / au doigt ----------------
  const CIBLE = new THREE.Vector3(0.05, 1.55, -1.0);
  const cam = { az: 0, el: 0, azCible: 0, elCible: 0, survolAz: 0, survolEl: 0, glisse: false, x0: 0, y0: 0, az0: 0, el0: 0 };
  const AZ_BASE = 0.74, EL_BASE = 0.36;
  let distance = 13;
  function placerCamera(t) {
    const az = AZ_BASE + cam.az + Math.sin(t * 0.13) * 0.025;
    const el = EL_BASE + cam.el;
    camera.position.set(
      CIBLE.x + distance * Math.sin(az) * Math.cos(el),
      CIBLE.y + distance * Math.sin(el),
      CIBLE.z + distance * Math.cos(az) * Math.cos(el));
    camera.lookAt(CIBLE);
  }
  function surDown(e) {
    cam.glisse = true; cam.x0 = e.clientX; cam.y0 = e.clientY; cam.az0 = cam.az; cam.el0 = cam.el;
    canvas.style.cursor = 'grabbing';
    try { canvas.setPointerCapture(e.pointerId); } catch (er) { /* rien */ }
  }
  function surMove(e) {
    const r = canvas.getBoundingClientRect();
    if (cam.glisse) {
      cam.azCible = Math.max(-0.5, Math.min(0.5, cam.az0 - (e.clientX - cam.x0) * 0.006));
      cam.elCible = Math.max(-0.16, Math.min(0.22, cam.el0 + (e.clientY - cam.y0) * 0.004));
    } else if (e.pointerType === 'mouse' && r.width) {
      cam.survolAz = -((e.clientX - r.left) / r.width - 0.5) * 0.08;
      cam.survolEl = ((e.clientY - r.top) / r.height - 0.5) * 0.04;
    }
  }
  function surUp(e) {
    cam.glisse = false; canvas.style.cursor = 'grab';
    try { canvas.releasePointerCapture(e.pointerId); } catch (er) { /* rien */ }
  }
  function surSortie() { cam.survolAz = 0; cam.survolEl = 0; }
  canvas.addEventListener('pointerdown', surDown);
  canvas.addEventListener('pointermove', surMove);
  canvas.addEventListener('pointerup', surUp);
  canvas.addEventListener('pointercancel', surUp);
  canvas.addEventListener('pointerleave', surSortie);

  function redimensionner() {
    const w = conteneur.clientWidth, h = conteneur.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    const a = w / h;
    camera.aspect = a;
    // La pièce doit tenir quel que soit le format (portrait, paysage, mobile)
    camera.fov = 30;
    const D = 10.4;
    distance = a >= 1.3 ? D : D * Math.pow(1.3 / a, 0.9);
    if (a > 1.9) distance = D * Math.pow(1.9 / a, 0.25);
    camera.updateProjectionMatrix();
    rendreUneFois = true;
  }
  const ro = new ResizeObserver(redimensionner);
  ro.observe(conteneur);

  // ---------------- Écran de l'ordinateur ----------------
  const ecranEtat = { mode: 'repos', titre: '', journal: [], alerte: false, texteAlerte: null, depuis: 0, defile: 0 };
  function dessinerEcran(t) {
    const ctx = cEcran.getContext('2d');
    const W = cEcran.width, Hc = cEcran.height;
    const g = ctx.createLinearGradient(0, 0, 0, Hc);
    g.addColorStop(0, '#1E3127'); g.addColorStop(1, '#2B4536');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, Hc);
    ctx.textBaseline = 'alphabetic';
    // barre du haut
    ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(0, 0, W, 46);
    ['#FF5C2A', '#FFDB21', '#2E9E6A'].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(28 + i * 24, 23, 7, 0, 7); ctx.fill(); });
    ctx.fillStyle = 'rgba(255,248,235,.7)'; ctx.font = `500 22px ${POLICE}`; ctx.textAlign = 'right';
    ctx.fillText(heureCourante(), W - 24, 31);
    ctx.textAlign = 'left';
    ctx.fillText(o.nom, 110, 31);
    const m = ecranEtat.mode;
    const e = t - ecranEtat.depuis;

    if (m === 'repos') {
      // logo : la tête de l'agent
      const cx = W / 2, cy = 190, s = 1 + Math.sin(t * 2) * 0.02;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
      ctx.fillStyle = o.couleurCorps; rondRect(ctx, -70, -62, 140, 124, 36); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = 4; ctx.stroke();
      const cligne = (t % 4.2) < 0.13 ? 0.15 : 1;
      ctx.fillStyle = o.couleurYeux;
      [-30, 30].forEach(x => { ctx.beginPath(); ctx.ellipse(x, -6, 22, 22 * cligne, 0, 0, 7); ctx.fill(); });
      ctx.fillStyle = '#1F1A17';
      [-30, 30].forEach(x => { ctx.beginPath(); ctx.ellipse(x + 3, -4, 10, 10 * cligne, 0, 0, 7); ctx.fill(); });
      ctx.strokeStyle = o.couleurYeux; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(0, 26, 14, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#FFF8EB'; ctx.textAlign = 'center'; ctx.font = `600 40px ${POLICE}`;
      ctx.fillText(o.nom, W / 2, 330);
      ctx.font = `500 26px ${POLICE}`; ctx.fillStyle = 'rgba(255,248,235,.65)';
      ctx.fillText('En attente', W / 2 + 12, 378);
      if (o.entreprise) { ctx.font = `500 22px ${POLICE}`; ctx.fillStyle = 'rgba(255,248,235,.45)'; ctx.fillText(couper(ctx, o.entreprise, W - 80, 1)[0] || '', W / 2, 428); }
      ctx.fillStyle = `rgba(46,158,106,${0.55 + Math.sin(t * 3) * 0.45})`;
      const lt = ctx.measureText('En attente').width;
      ctx.beginPath(); ctx.arc(W / 2 + 12 - lt / 2 - 20, 369, 8, 0, 7); ctx.fill();
    } else if (m === 'message') {
      ctx.textAlign = 'center';
      const b = Math.abs(Math.sin(e * 6)) * Math.max(0, 1 - e / 1.6) * 18;
      ctx.save(); ctx.translate(W / 2, 200 - b);
      ctx.fillStyle = '#FFDB21'; rondRect(ctx, -90, -60, 180, 120, 18); ctx.fill();
      ctx.strokeStyle = '#1E3127'; ctx.lineWidth = 8; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(-80, -50); ctx.lineTo(0, 12); ctx.lineTo(80, -50); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#FFF8EB'; ctx.font = `600 40px ${POLICE}`; ctx.fillText('Nouveau message !', W / 2, 340);
      ctx.font = `500 26px ${POLICE}`; ctx.fillStyle = 'rgba(255,248,235,.65)'; ctx.fillText('Je regarde ça…', W / 2, 386);
    } else if (m === 'fini') {
      ctx.textAlign = 'center';
      const s = Math.min(1, e * 4);
      ctx.save(); ctx.translate(W / 2, 195); ctx.scale(s, s);
      ctx.fillStyle = '#2E9E6A'; ctx.beginPath(); ctx.arc(0, 0, 78, 0, 7); ctx.fill();
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 16; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(-34, 2); ctx.lineTo(-8, 28); ctx.lineTo(38, -24); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#FFF8EB'; ctx.font = `600 42px ${POLICE}`; ctx.fillText("C'est fait !", W / 2, 340);
      if (ecranEtat.journal.length) { ctx.font = `500 24px ${POLICE}`; ctx.fillStyle = 'rgba(255,248,235,.65)'; ctx.fillText(`${ecranEtat.journal.length} étape${ecranEtat.journal.length > 1 ? 's' : ''} réalisée${ecranEtat.journal.length > 1 ? 's' : ''}`, W / 2, 384); }
    } else {
      // reflechit / outil / repond : titre + liste qui défile
      let titre = ecranEtat.titre;
      if (m === 'reflechit') titre = 'Je réfléchis' + '...'.slice(0, 1 + Math.floor(t * 2.5) % 3);
      if (m === 'repond') titre = "J'écris ma réponse…";
      ctx.fillStyle = m === 'outil' ? '#FF5C2A' : (m === 'repond' ? '#2E9E6A' : '#F2C14E');
      rondRect(ctx, 24, 66, 150, 36, 18); ctx.fill();
      ctx.fillStyle = m === 'reflechit' ? '#1E3127' : '#FFFFFF'; ctx.font = `600 20px ${POLICE}`; ctx.textAlign = 'center';
      ctx.fillText(m === 'outil' ? 'Au travail' : (m === 'repond' ? 'Réponse' : 'Réflexion'), 99, 91);
      ctx.textAlign = 'left'; ctx.fillStyle = '#FFF8EB'; ctx.font = `600 38px ${POLICE}`;
      const lignesTitre = couper(ctx, titre, W - 60, 2);
      lignesTitre.forEach((l, i) => ctx.fillText(l, 26, 150 + i * 46));
      const y0 = 150 + lignesTitre.length * 46 + 6;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, y0, W, Hc - y0 - 34); ctx.clip();
      if (m === 'repond') {
        // lignes de texte qui s'écrivent
        const n = Math.floor(e * 3);
        const largeurs = [0.92, 0.8, 0.88, 0.6, 0.95, 0.74, 0.85, 0.5];
        const dec = Math.max(0, n - 5) * 30;
        for (let i = 0; i <= n; i++) {
          const y = y0 + 20 + i * 30 - dec;
          if (y < y0 - 20) continue;
          let lw = (W - 60) * largeurs[i % largeurs.length];
          if (i === n) lw *= (e * 3) % 1;
          ctx.fillStyle = 'rgba(255,248,235,.32)'; rondRect(ctx, 26, y, Math.max(8, lw), 14, 7); ctx.fill();
        }
      } else {
        const j = ecranEtat.journal.slice(-8);
        ecranEtat.defile += (0 - ecranEtat.defile) * 0.15;
        const visibles = Math.max(1, Math.floor((Hc - y0 - 40) / 40));
        const debut = Math.max(0, j.length - visibles);
        ctx.font = `500 25px ${POLICE}`;
        for (let i = debut; i < j.length; i++) {
          const y = y0 + 30 + (i - debut) * 40 + ecranEtat.defile;
          const dernier = i === j.length - 1 && m === 'outil';
          if (dernier) {
            ctx.strokeStyle = '#FFDB21'; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.arc(38, y - 8, 10, t * 6, t * 6 + 4.2); ctx.stroke();
            ctx.fillStyle = '#FFF8EB';
          } else {
            ctx.fillStyle = '#5BD39A'; ctx.font = `700 24px ${POLICE}`; ctx.fillText('✓', 28, y);
            ctx.fillStyle = 'rgba(255,248,235,.6)';
          }
          ctx.font = `500 25px ${POLICE}`;
          ctx.fillText(couper(ctx, j[i], W - 100, 1)[0] || '', 62, y);
        }
      }
      ctx.restore();
      // barre de progression indéterminée
      ctx.fillStyle = 'rgba(255,255,255,.1)'; rondRect(ctx, 24, Hc - 26, W - 48, 8, 4); ctx.fill();
      const px = ((t * 0.6) % 1.4 - 0.2) * (W - 48);
      ctx.save(); rondRect(ctx, 24, Hc - 26, W - 48, 8, 4); ctx.clip();
      ctx.fillStyle = m === 'outil' ? '#FF5C2A' : '#F2C14E'; rondRect(ctx, 24 + px, Hc - 26, 160, 8, 4); ctx.fill(); ctx.restore();
    }
    if (ecranEtat.alerte) {
      ctx.fillStyle = '#FFDB21'; rondRect(ctx, 16, Hc - (m === 'repos' || m === 'fini' || m === 'message' ? 60 : 92), W - 32, 44, 14); ctx.fill();
      ctx.fillStyle = '#1F1A17'; ctx.font = `600 22px ${POLICE}`; ctx.textAlign = 'left';
      ctx.fillText('!  ' + (couper(ctx, ecranEtat.texteAlerte || 'Une carte attend votre validation', W - 110, 1)[0] || ''), 36, Hc - (m === 'repos' || m === 'fini' || m === 'message' ? 31 : 63));
    }
    texEcran.needsUpdate = true;
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { rendreUneFois = true; dernierDessinEcran = 0; }).catch(() => {});

  // ---------------- Animation du personnage ----------------
  const camYaw = () => Math.atan2(camera.position.x - pivot.position.x, camera.position.z - pivot.position.z);
  const versPoint = (x, z) => Math.atan2(x - pivot.position.x, z - pivot.position.z);
  const YAW_ECRAN = versPoint(0.68, -2.55);
  const YAW_FENETRE = versPoint(-1.55, -3.2);
  const YAW_CARTE = versPoint(-3.1, -0.55);
  const YAW_PLANTE = versPoint(-2.4, -2.45);
  const YAW_REPOS = YAW_ECRAN - 0.75;

  const A = {
    etat: 'repos', depuis: 0, parle: false,
    yaw: YAW_REPOS, yawVit: 0, yawCible: YAW_REPOS,
    salutJusqua: -1, sautDebut: -1, alerteDebut: -1,
    regardSuivant: 1.5, regard: YAW_REPOS, regardPupille: { x: 0, y: 0 },
    clignement: 2.5, pup: { x: 0, y: 0 },
    brasG: { x: 0, z: 0.12 }, brasD: { x: 0, z: -0.12 },
    bulle: 0, lumiere: 0, alerte: 0,
  };

  function angleProche(cible, actuel) {
    let d = cible - actuel;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return actuel + d;
  }
  const amortir = (a, b, vitesse, dt) => a + (b - a) * (1 - Math.exp(-vitesse * dt));

  let horloge = 0;
  function animer(dt) {
    horloge += dt;
    const t = horloge;
    const etat = A.etat;
    const e = t - A.depuis;
    const salut = t < A.salutJusqua;
    const sautP = A.sautDebut >= 0 ? (t - A.sautDebut) / 1.25 : 2;
    const saute = sautP >= 0 && sautP < 1;
    const parle = etat === 'repond' || A.parle;

    // Où regarder (rotation de la chaise)
    if (etat === 'repos' || etat === 'fini') {
      if (t > A.regardSuivant) {
        const choix = [camYaw(), YAW_REPOS, camYaw(), YAW_CARTE, YAW_REPOS, YAW_ECRAN, camYaw(), YAW_FENETRE, YAW_PLANTE];
        A.regard = choix[Math.floor(Math.random() * choix.length)];
        if (A.alerte > 0.5 && Math.random() < 0.4) A.regard = versPoint(0.55, -2.2);
        A.regardPupille = { x: (Math.random() - 0.5) * 0.06, y: (Math.random() - 0.3) * 0.05 };
        A.regardSuivant = t + 2.2 + Math.random() * 3.5;
      }
      A.yawCible = A.regard;
    } else if (etat === 'outil') { A.yawCible = YAW_ECRAN; A.regardPupille = { x: 0, y: 0.01 }; }
    else if (etat === 'reflechit') { A.yawCible = (YAW_ECRAN + camYaw()) / 2; A.regardPupille = { x: 0.035 * Math.sin(t * 0.9), y: 0.05 }; }
    else if (etat === 'repond' || etat === 'message') { A.yawCible = camYaw(); A.regardPupille = { x: 0, y: 0 }; }
    if (salut || saute) { A.yawCible = camYaw(); A.regardPupille = { x: 0, y: 0 }; }

    // Ressort amorti pour la rotation (pas de saccade)
    const cible = angleProche(A.yawCible, A.yaw);
    const k = 26, c = 9;
    A.yawVit += ((cible - A.yaw) * k - A.yawVit * c) * dt;
    A.yaw += A.yawVit * dt;
    pivot.rotation.y = A.yaw;

    // Respiration
    const resp = Math.sin(t * 2.1);
    corps.scale.set(1 - resp * 0.008, 1 + resp * 0.018, 1 - resp * 0.008);

    // Sauts (fini)
    let y = 0;
    if (saute) y = Math.abs(Math.sin(sautP * Math.PI * 2)) * 0.38 * (1 - sautP * 0.3);
    if (A.alerteDebut >= 0 && t - A.alerteDebut < 0.45) y = Math.max(y, Math.sin((t - A.alerteDebut) / 0.45 * Math.PI) * 0.15);
    // petit rebond pendant la frappe
    if (etat === 'outil' && !salut && !saute) y += Math.abs(Math.sin(t * 9)) * 0.012;
    perso.position.y = amortir(perso.position.y, y, 30, dt);
    corps.rotation.z = amortir(corps.rotation.z, etat === 'reflechit' ? Math.sin(t * 0.9) * 0.07 : 0, 4, dt);
    corps.rotation.x = amortir(corps.rotation.x, etat === 'outil' ? 0.06 : 0, 5, dt);

    // Bras
    let gx = 0.08 + Math.sin(t * 2.1) * 0.03, gz = 0.12, dx = 0.08 + Math.sin(t * 2.1 + 0.5) * 0.03, dz = -0.12;
    if (etat === 'outil') {
      gx = -1.2 + Math.sin(t * 17) * 0.16; dx = -1.2 + Math.sin(t * 17 + 2.1) * 0.16; gz = -0.25; dz = 0.25;
    } else if (etat === 'reflechit') {
      gx = 0.05; gz = 0.12; dx = -2.0; dz = 0.55;   // main au menton
    } else if (etat === 'repond') {
      gx = -0.45 + Math.sin(t * 3.1) * 0.22; dx = -0.35 + Math.sin(t * 2.7 + 1) * 0.22; gz = 0.25; dz = -0.25;
    }
    if (salut) { gz = 2.45 + Math.sin(t * 13) * 0.35; gx = -0.15; }
    if (saute) { gz = 2.5; dz = -2.5; gx = 0; dx = 0; }
    A.brasG.x = amortir(A.brasG.x, gx, 14, dt); A.brasG.z = amortir(A.brasG.z, gz, 14, dt);
    A.brasD.x = amortir(A.brasD.x, dx, 14, dt); A.brasD.z = amortir(A.brasD.z, dz, 14, dt);
    brasG.rotation.set(A.brasG.x, 0, A.brasG.z);
    brasD.rotation.set(A.brasD.x, 0, A.brasD.z);

    // Touches du clavier
    if (etat === 'outil') touches.forEach((tc, i) => { tc.position.y = 0.058 - (Math.sin(t * 23 + i * 1.7) > 0.85 ? 0.012 : 0); });

    // Yeux : clignement + pupilles
    if (t > A.clignement) A.clignement = t + 2 + Math.random() * 3.5 + (Math.random() < 0.2 ? -1.6 : 0);
    const ferme = A.clignement - t < 0.13;
    const content = saute || (etat === 'fini' && e < 2.5);
    yeux.forEach(({ oeil, pupille }) => {
      const sy = ferme ? 0.1 : (content ? 0.55 : 1);
      oeil.scale.y = amortir(oeil.scale.y, sy, ferme ? 40 : 18, dt);
      A.pup.x = amortir(A.pup.x, A.regardPupille.x, 8, dt);
      A.pup.y = amortir(A.pup.y, A.regardPupille.y, 8, dt);
      pupille.position.set(A.pup.x, A.pup.y, 0);
    });

    // Bouche
    boucheOuverte.visible = parle;
    sourire.visible = !parle;
    if (parle) boucheOuverte.scale.y = 0.35 + Math.abs(Math.sin(t * 13) * Math.sin(t * 5.3 + 1)) * 0.95;

    // Antenne qui oscille
    antenne.rotation.z = Math.sin(t * 2.4) * 0.06 + (etat === 'outil' ? Math.sin(t * 17) * 0.05 : 0) - (A.yawVit * 0.02);

    // Bulle « … »
    A.bulle = amortir(A.bulle, etat === 'reflechit' ? 1 : 0, 10, dt);
    bulle.visible = A.bulle > 0.02;
    if (bulle.visible) {
      const s = A.bulle * (1 + Math.sin(t * 2) * 0.03);
      bulle.scale.set(s, s, s);
      bulle.position.set(pivot.position.x + 0.55, 2.62 + perso.position.y + Math.sin(t * 1.6) * 0.04, pivot.position.z + 0.15);
      bulle.quaternion.copy(camera.quaternion);
      points.forEach((p, i) => { p.position.y = Math.max(0, Math.sin(t * 6 - i * 0.7)) * 0.07; });
    }

    // Accessoire allumé pendant le travail
    A.lumiere = amortir(A.lumiere, etat === 'outil' ? 1 : (etat === 'reflechit' || etat === 'repond' ? 0.25 : 0), 5, dt);
    const scint = 1 + Math.sin(t * 19) * 0.06 + Math.sin(t * 7.3) * 0.05;
    if (access.lumiere) access.lumiere.intensity = A.lumiere * 3.2 * scint;
    access.emissifs.forEach((m) => { m.emissiveIntensity = 0.15 + A.lumiere * 1.8 * scint; });
    if (access.flamme) access.flamme.scale.set(0.8, 1.4 * (0.85 + A.lumiere * 0.35 * scint), 0.8);
    lueurEcran.intensity = etat === 'repos' ? 0.8 : 1.6;

    // Panneau « ! »
    A.alerte = amortir(A.alerte, ecranEtat.alerte ? 1 : 0, 9, dt);
    alerte.visible = A.alerte > 0.02;
    if (alerte.visible) {
      const s = 1.45 * A.alerte * (1 + Math.max(0, Math.sin(t * 5)) * 0.06);
      alerte.scale.set(s, s, s);
      alerte.position.y = 3.15 + Math.sin(t * 2.6) * 0.07;
      alerte.rotation.y = Math.sin(t * 1.3) * 0.25 + 0.35;
    }

    // Détails vivants : vapeur, plante, globe
    vapeurs.forEach((v) => {
      const p = ((t * 0.35 + v.userData.i / 3) % 1);
      v.position.set(Math.sin(p * 6 + v.userData.i) * 0.03, 0.3 + p * 0.45, 0);
      v.material.opacity = 0.5 * Math.sin(p * Math.PI);
      const s = 0.6 + p * 0.9; v.scale.set(s, s, s);
    });
    feuilles.forEach((f, i) => { f.rotation.z = Math.sin(t * 0.9 + i) * 0.025; });
    globe.rotation.y += dt * 0.25;

    // Caméra : retour en place en douceur quand on lâche
    if (!cam.glisse) { cam.azCible = amortir(cam.azCible, 0, 1.6, dt); cam.elCible = amortir(cam.elCible, 0, 1.6, dt); }
    cam.az = amortir(cam.az, cam.azCible + cam.survolAz, 6, dt);
    cam.el = amortir(cam.el, cam.elCible + cam.survolEl, 6, dt);
    placerCamera(t);
  }

  // ---------------- Boucle de rendu (pause si caché) ----------------
  let raf = 0, dernier = 0, rendreUneFois = true, dernierDessinEcran = 0, visibleVue = true, minuteCiel = 0;
  const intervalle = petitEcran ? 1 / 30 : 1 / 60;
  let accu = 0;
  function boucle(ms) {
    raf = requestAnimationFrame(boucle);
    const s = ms / 1000;
    let dt = dernier ? s - dernier : 0.016;
    dernier = s;
    if (dt > 0.25) dt = 0.1;
    accu += dt;
    if (accu < intervalle * 0.92 && !rendreUneFois) return;
    const pas = Math.min(accu, 0.1);
    accu = 0;
    rendreUneFois = false;
    animer(pas);
    const anime = ['reflechit', 'outil', 'repond', 'message', 'fini'].includes(A.etat);
    if (horloge - dernierDessinEcran > (anime ? 0.08 : 0.25) || dernierDessinEcran === 0) { dessinerEcran(horloge); dernierDessinEcran = horloge; }
    if (horloge - minuteCiel > 60) { minuteCiel = horloge; if (periode() !== periodeAffichee) dessinerCiel(); }
    renderer.render(scene, camera);
  }
  function demarrer() { if (!raf && visibleVue && document.visibilityState !== 'hidden') { dernier = 0; raf = requestAnimationFrame(boucle); } }
  function arreter() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function surVisibilite() { if (document.visibilityState === 'hidden') arreter(); else demarrer(); }
  document.addEventListener('visibilitychange', surVisibilite);
  const io = new IntersectionObserver((entrees) => {
    visibleVue = entrees.some(en => en.isIntersecting && en.intersectionRect.height > 8);
    if (visibleVue) demarrer(); else arreter();
  });
  io.observe(conteneur);
  redimensionner();
  placerCamera(0);
  demarrer();

  // ---------------- API interne ----------------
  return {
    statut(etat, detail, journal) {
      const avant = A.etat;
      A.etat = etat === 'message' ? (avant === 'repos' || avant === 'fini' ? 'repos' : avant) : etat;
      if (etat !== avant) A.depuis = horloge;
      if (etat === 'message') A.salutJusqua = horloge + 1.9;
      if (etat === 'fini' && avant !== 'fini') A.sautDebut = horloge;
      if (etat === 'repos') A.regardSuivant = horloge + 1.2;
      const ancienNb = ecranEtat.journal.length;
      ecranEtat.mode = etat;
      ecranEtat.depuis = horloge;
      ecranEtat.titre = etat === 'outil' ? (detail || 'Je travaille…') : (detail || '');
      ecranEtat.journal = journal.slice();
      if (ecranEtat.journal.length > ancienNb && ancienNb > 0) ecranEtat.defile = 40;
      dernierDessinEcran = 0;
      rendreUneFois = true;
    },
    alerte(actif, texte) {
      if (actif && !ecranEtat.alerte) A.alerteDebut = horloge;
      ecranEtat.alerte = !!actif;
      ecranEtat.texteAlerte = texte || null;
      dernierDessinEcran = 0;
    },
    parle(actif) { A.parle = !!actif; },
    destroy() {
      arreter();
      document.removeEventListener('visibilitychange', surVisibilite);
      io.disconnect(); ro.disconnect();
      canvas.removeEventListener('pointerdown', surDown);
      canvas.removeEventListener('pointermove', surMove);
      canvas.removeEventListener('pointerup', surUp);
      canvas.removeEventListener('pointercancel', surUp);
      canvas.removeEventListener('pointerleave', surSortie);
      aJeter.forEach((x) => { try { x.dispose(); } catch (er) { /* rien */ } });
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch (er) { /* rien */ }
      canvas.remove();
    },
  };
}

/* =============================================================================
   L'ILLUSTRATION SVG (sans WebGL) - même personnage, mêmes états
   ============================================================================= */
let compteurSVG = 0;
function creerSVG(conteneur, o) {
  const id = 'b3s' + (++compteurSVG);
  const corps = o.couleurCorps, yeux = o.couleurYeux;
  const clair = eclaircir(corps, 0.12);
  const NS = 'http://www.w3.org/2000/svg';
  const boite = document.createElement('div');
  boite.className = 'bureau3d-svg';
  boite.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;background:' + o.fond;
  const acc = o.accessoire;
  const accessoireBureau = acc === 'lanterne'
    ? `<g class="${id}-acc" transform="translate(138 284)"><rect x="-16" y="40" width="32" height="7" rx="3" fill="#2F4A3A"/><rect x="-13" y="8" width="26" height="32" rx="6" fill="#FFF2C6" class="${id}-verre"/><path d="M0 16 q6 8 0 16 q-6 -8 0 -16z" fill="#FFB347" class="${id}-flamme"/><rect x="-14" y="0" width="28" height="8" rx="4" fill="#2F4A3A"/><path d="M-8 0 q8 -14 16 0" stroke="#2F4A3A" stroke-width="3" fill="none"/></g>`
    : acc === 'loupe'
      ? `<g class="${id}-acc" transform="translate(150 330) rotate(-20)"><rect x="12" y="-4" width="34" height="8" rx="4" fill="#B57A4C"/><circle r="15" fill="#CFEAF7" stroke="#3E434B" stroke-width="5" class="${id}-verre"/></g>`
      : '';
  const casque = acc === 'casque'
    ? `<path d="M236 236 q64 -60 128 0" stroke="#3E434B" stroke-width="9" fill="none"/><rect x="226" y="226" width="16" height="34" rx="8" fill="#FF5C2A" class="${id}-verre"/><rect x="358" y="226" width="16" height="34" rx="8" fill="#FF5C2A" class="${id}-verre"/>`
    : '';
  const svg = `
<svg xmlns="${NS}" viewBox="0 0 600 440" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${echapperXML(o.nom)} à son bureau" style="width:100%;height:100%;max-height:100%">
  <style>
    .${id} * { transform-box: fill-box; }
    .${id}-perso { transform-origin: 50% 100%; transform-box: fill-box; }
    .${id}-corps { transform-origin: 50% 100%; animation: ${id}-resp 3s ease-in-out infinite; }
    .${id}-oeil { transform-origin: center; animation: ${id}-cligne 4.6s infinite; }
    .${id}-bulle, .${id}-alerte, .${id}-ouverte { opacity: 0; transition: opacity .25s; }
    .${id}-brasg, .${id}-brasd { transform-origin: 50% 8%; transition: transform .3s; }
    .${id}-tete { transition: transform .5s cubic-bezier(.3,1.4,.5,1); transform-origin: 50% 100%; }
    .reflechit .${id}-bulle { opacity: 1; }
    .reflechit .${id}-pt { animation: ${id}-pt 1.2s infinite; }
    .reflechit .${id}-pt:nth-child(3) { animation-delay: .2s; } .reflechit .${id}-pt:nth-child(4) { animation-delay: .4s; }
    .reflechit .${id}-brasd { transform: rotate(150deg); }
    .outil .${id}-tete { transform: translateX(-10px) rotate(-4deg); }
    .outil .${id}-brasg { animation: ${id}-tape .22s infinite alternate; }
    .outil .${id}-brasd { animation: ${id}-tape .22s infinite alternate-reverse; }
    .outil .${id}-flamme, .outil .${id}-verre { filter: drop-shadow(0 0 10px #FFB347) brightness(1.15); }
    .outil .${id}-halo { opacity: .9; }
    .${id}-halo { opacity: 0; transition: opacity .4s; }
    .repond .${id}-ouverte, .parle .${id}-ouverte { opacity: 1; animation: ${id}-parle .28s infinite alternate; transform-origin: center; }
    .repond .${id}-sourire, .parle .${id}-sourire { opacity: 0; }
    .salut .${id}-brasg { animation: ${id}-salut .35s infinite alternate; }
    .fini .${id}-perso { animation: ${id}-saut .62s ease-out 2; }
    .fini .${id}-brasg { transform: rotate(-150deg); } .fini .${id}-brasd { transform: rotate(150deg); }
    .alerte .${id}-alerte { opacity: 1; animation: ${id}-flotte 1.6s ease-in-out infinite; }
    @keyframes ${id}-resp { 50% { transform: scale(1.012, .985); } }
    @keyframes ${id}-cligne { 0%, 95%, 100% { transform: scaleY(1); } 97% { transform: scaleY(.1); } }
    @keyframes ${id}-pt { 0%, 100% { transform: translateY(0); } 40% { transform: translateY(-6px); } }
    @keyframes ${id}-tape { from { transform: rotate(-70deg); } to { transform: rotate(-58deg); } }
    @keyframes ${id}-parle { from { transform: scaleY(.35); } to { transform: scaleY(1); } }
    @keyframes ${id}-salut { from { transform: rotate(-140deg); } to { transform: rotate(-165deg); } }
    @keyframes ${id}-saut { 0%, 100% { transform: translateY(0); } 45% { transform: translateY(-34px); } }
    @keyframes ${id}-flotte { 50% { transform: translateY(-6px); } }
    @media (prefers-reduced-motion: reduce) { .${id} * { animation: none !important; } }
  </style>
  <g class="${id}">
    <rect x="0" y="0" width="600" height="440" fill="${o.fond}"/>
    <path d="M40 30 h520 a18 18 0 0 1 18 18 v300 h-556 v-300 a18 18 0 0 1 18 -18z" fill="#F4E8D7"/>
    <rect x="22" y="250" width="556" height="98" fill="#D5E2CC"/>
    <rect x="22" y="246" width="556" height="6" fill="#FFFFFF"/>
    <path d="M22 348 h556 l22 60 a14 14 0 0 1 -14 16 h-572 a14 14 0 0 1 -14 -16z" fill="#EED7B4"/>
    <ellipse cx="300" cy="392" rx="170" ry="26" fill="#F6D2B6"/>
    <g transform="translate(70 70)"><rect width="120" height="104" rx="8" fill="#FFFFFF"/><rect x="8" y="8" width="104" height="88" rx="4" fill="#8EC9F0" class="${id}-ciel"/><circle cx="84" cy="32" r="12" fill="#FFE680" class="${id}-astre"/><path d="M8 80 q30 -22 58 -6 q22 -12 46 0 v22 h-104z" fill="#A8D49C" class="${id}-colline"/><rect x="58" y="8" width="4" height="88" fill="#FFFFFF"/><rect x="8" y="50" width="104" height="4" fill="#FFFFFF"/></g>
    <g transform="translate(430 64)"><rect width="120" height="94" rx="6" fill="#C9A57C"/><rect x="6" y="6" width="108" height="82" rx="3" fill="#DCEFF3"/><path d="M48 14 l22 6 l18 16 l-6 18 l4 18 l-20 8 l-26 -2 l-10 -18 l-14 -10 l6 -16 z" fill="#CFE5C8" stroke="#6E9A78" stroke-width="2"/><circle cx="60" cy="34" r="4" fill="#FF5C2A"/><circle cx="52" cy="62" r="5" fill="#D9443B"/><circle cx="80" cy="54" r="4" fill="#FFDB21"/><circle cx="40" cy="58" r="4" fill="#2E9E6A"/></g>
    <g transform="translate(46 210)"><rect x="0" y="80" width="54" height="58" rx="10" fill="#D9774B"/><ellipse cx="10" cy="54" rx="12" ry="34" fill="#6FAE7C" transform="rotate(-22 10 54)"/><ellipse cx="44" cy="50" rx="12" ry="36" fill="#5E9E6B" transform="rotate(20 44 50)"/><ellipse cx="27" cy="40" rx="12" ry="40" fill="#86C08D"/></g>
    <rect x="96" y="330" width="428" height="16" rx="7" fill="#D39A68"/>
    <rect x="112" y="344" width="14" height="60" rx="5" fill="#B57A4C"/><rect x="494" y="344" width="14" height="60" rx="5" fill="#B57A4C"/>
    <g transform="translate(368 178)">
      <rect x="0" y="0" width="150" height="100" rx="10" fill="#3E434B"/>
      <rect x="7" y="7" width="136" height="86" rx="5" fill="#1E3127"/>
      <circle cx="16" cy="15" r="2.5" fill="#FF5C2A"/><circle cx="24" cy="15" r="2.5" fill="#FFDB21"/><circle cx="32" cy="15" r="2.5" fill="#2E9E6A"/>
      <text x="14" y="38" font-family='${POLICE}' font-size="11" font-weight="600" fill="#FFF8EB" class="${id}-titre"></text>
      <text x="14" y="54" font-family='${POLICE}' font-size="9" fill="rgba(255,248,235,.6)" class="${id}-l1"></text>
      <text x="14" y="68" font-family='${POLICE}' font-size="9" fill="rgba(255,248,235,.6)" class="${id}-l2"></text>
      <text x="14" y="82" font-family='${POLICE}' font-size="9" fill="rgba(255,248,235,.6)" class="${id}-l3"></text>
      <rect x="62" y="100" width="26" height="22" fill="#4A4F57"/><rect x="46" y="120" width="58" height="10" rx="4" fill="#4A4F57"/>
    </g>
    <circle cx="443" cy="228" r="80" fill="#FFB347" class="${id}-halo" opacity="0" style="filter:blur(30px)"/>
    ${accessoireBureau}
    <g transform="translate(176 304)"><rect width="22" height="26" rx="6" fill="#FF5C2A"/><path d="M22 6 q10 2 0 14" stroke="#FF5C2A" stroke-width="4" fill="none"/></g>
    <g transform="translate(512 140)"><g class="${id}-alerte"><rect x="-20" y="-20" width="40" height="40" rx="10" fill="#FFDB21" transform="rotate(45)"/><rect x="-3.5" y="-15" width="7" height="18" rx="3.5" fill="#1F1A17"/><circle cy="10" r="4" fill="#1F1A17"/></g></g>
    <g class="${id}-perso">
      <rect x="236" y="320" width="128" height="18" rx="9" fill="#FF5C2A"/>
      <rect x="244" y="250" width="112" height="76" rx="14" fill="#E8481A" opacity=".9"/>
      <g class="${id}-tete">
        <g class="${id}-corps">
          <path d="M300 176 v-22" stroke="#3E434B" stroke-width="4" stroke-linecap="round"/><circle cx="300" cy="148" r="9" fill="#FF5C2A"/>
          <rect x="236" y="176" width="128" height="140" rx="32" fill="${corps}"/>
          <rect x="248" y="180" width="104" height="10" rx="5" fill="${clair}"/>
          <g class="${id}-oeil"><circle cx="272" cy="230" r="20" fill="${yeux}"/><circle cx="275" cy="232" r="9" fill="#1F1A17"/><circle cx="279" cy="227" r="3" fill="#fff"/></g>
          <g class="${id}-oeil"><circle cx="328" cy="230" r="20" fill="${yeux}"/><circle cx="331" cy="232" r="9" fill="#1F1A17"/><circle cx="335" cy="227" r="3" fill="#fff"/></g>
          <ellipse cx="252" cy="256" rx="7" ry="4" fill="#E8907A" opacity=".8"/><ellipse cx="348" cy="256" rx="7" ry="4" fill="#E8907A" opacity=".8"/>
          <path d="M291 258 q9 8 18 0" stroke="#1F1A17" stroke-width="4" fill="none" stroke-linecap="round" class="${id}-sourire"/>
          <ellipse cx="300" cy="262" rx="10" ry="8" fill="#3A1F1A" class="${id}-ouverte"/>
          ${o.badge ? `<rect x="273" y="280" width="54" height="22" rx="11" fill="#FFDB21"/><text x="300" y="296" text-anchor="middle" font-family='${POLICE}' font-size="13" font-weight="700" fill="${corps}">${echapperXML(o.badge)}</text>` : ''}
          ${casque}
        </g>
        <g class="${id}-brasd"><rect x="222" y="246" width="18" height="56" rx="9" fill="${corps}"/><circle cx="231" cy="304" r="11" fill="${clair}"/></g>
        <g class="${id}-brasg"><rect x="360" y="246" width="18" height="56" rx="9" fill="${corps}"/><circle cx="369" cy="304" r="11" fill="${clair}"/></g>
      </g>
    </g>
    <g class="${id}-bulle" transform="translate(372 120)"><circle cx="-26" cy="44" r="6" fill="#fff"/><circle cx="-38" cy="58" r="4" fill="#fff"/><g><rect x="-30" y="-18" width="84" height="44" rx="22" fill="#fff" stroke="#EDE6DC"/><circle class="${id}-pt" cx="-6" cy="4" r="5" fill="#2F4A3A"/><circle class="${id}-pt" cx="12" cy="4" r="5" fill="#2F4A3A"/><circle class="${id}-pt" cx="30" cy="4" r="5" fill="#2F4A3A"/></g></g>
  </g>
</svg>`;
  boite.innerHTML = svg;
  conteneur.appendChild(boite);
  const racine = boite.querySelector('svg');
  const q = (c) => boite.querySelector('.' + id + '-' + c);
  // ciel selon l'heure
  function ciel() {
    const p = periode();
    q('ciel').setAttribute('fill', p === 'jour' ? '#8EC9F0' : (p === 'soir' ? '#F59A7A' : '#1E2A4A'));
    q('astre').setAttribute('fill', p === 'nuit' ? '#FFF5D6' : (p === 'soir' ? '#FFB36B' : '#FFE680'));
    q('colline').setAttribute('fill', p === 'nuit' ? '#22305A' : (p === 'soir' ? '#B9877F' : '#A8D49C'));
  }
  ciel();
  const minuteur = setInterval(ciel, 60000);
  let etat = 'repos', alerteOn = false, parleOn = false, salutFin = 0, finiTimer = 0, salutTimer = 0;
  function classes() {
    const c = [etat];
    if (alerteOn) c.push('alerte');
    if (parleOn) c.push('parle');
    if (Date.now() < salutFin) c.push('salut');
    racine.setAttribute('class', c.join(' '));
  }
  function ecrire(titre, lignes) {
    q('titre').textContent = titre;
    ['l1', 'l2', 'l3'].forEach((k, i) => { q(k).textContent = lignes[i] ? (lignes[i].length > 30 ? lignes[i].slice(0, 29) + '…' : lignes[i]) : ''; });
  }
  return {
    statut(e, detail, journal) {
      if (e === 'message') {
        salutFin = Date.now() + 1900;
        clearTimeout(salutTimer); salutTimer = setTimeout(classes, 1950);
        if (etat === 'fini') etat = 'repos';
        ecrire('Nouveau message !', ['Je regarde ça…']);
      } else {
        etat = e;
        if (e === 'repos') ecrire(o.nom, ['En attente']);
        else if (e === 'reflechit') ecrire('Je réfléchis…', journal.slice(-3).map(x => '✓ ' + x));
        else if (e === 'outil') ecrire(String(detail || 'Je travaille…').slice(0, 26), journal.slice(-4, -1).map(x => '✓ ' + x));
        else if (e === 'repond') ecrire("J'écris ma réponse…", journal.slice(-3).map(x => '✓ ' + x));
        else if (e === 'fini') {
          ecrire("C'est fait !", journal.length ? [`${journal.length} étape(s) réalisée(s)`] : []);
          clearTimeout(finiTimer);
        }
      }
      classes();
    },
    alerte(actif) { alerteOn = !!actif; classes(); },
    parle(actif) { parleOn = !!actif; classes(); },
    destroy() { clearInterval(minuteur); clearTimeout(finiTimer); clearTimeout(salutTimer); boite.remove(); },
  };
}

function echapperXML(t) {
  return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
