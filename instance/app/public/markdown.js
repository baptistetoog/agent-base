// markdown.js — transforme le Markdown des réponses de l'agent en HTML sûr.
// Tout le texte est d'abord échappé : aucune balise venant de la réponse n'est interprétée.
// Gère : titres, paragraphes, gras, italique, barré, code, blocs de code, listes (imbriquées,
// numérotées, cases à cocher), citations, séparateurs, liens (http, https, mailto) et tableaux.

function echapper(t) {
  return String(t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function enLigne(brut) {
  const reserve = [];
  const garder = (html) => `\u0000${reserve.push(html) - 1}\u0000`;
  let t = echapper(brut);
  t = t.replace(/`([^`\n]+)`/g, (_, c) => garder(`<code>${c}</code>`));
  t = t.replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g,
    (_, texte, url) => garder(`<a href="${url}" target="_blank" rel="noopener noreferrer">${texte}</a>`));
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)\u0000]+[^\s<).,;:!?\u0000])/g,
    (_, avant, url) => avant + garder(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));
  t = t.replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/__(?=\S)([^_\n]*?\S)__/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?![*\w])/g, '$1<em>$2</em>');
  t = t.replace(/(^|[^_\w])_(?=\S)([^_\n]*?\S)_(?![_\w])/g, '$1<em>$2</em>');
  t = t.replace(/~~(?=\S)([^~\n]*?\S)~~/g, '<del>$1</del>');
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => reserve[Number(i)]);
  return t;
}

const RE_LISTE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const RE_FENCE = /^\s{0,3}(```|~~~)/;
const RE_TITRE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_SEPARATEUR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const RE_LIGNE_TABLEAU = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function indentation(l) { return l.match(/^\s*/)[0].replace(/\t/g, '    ').length; }

function debutBloc(l, suivante) {
  return RE_FENCE.test(l) || RE_TITRE.test(l) || RE_SEPARATEUR.test(l) || RE_LISTE.test(l)
    || /^\s*>/.test(l) || (l.includes('|') && suivante !== undefined && RE_LIGNE_TABLEAU.test(suivante));
}

function cellules(l) {
  return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function desindenter(lignes) {
  const min = Math.min(...lignes.filter((l) => l.trim()).map(indentation));
  return lignes.map((l) => l.replace(/\t/g, '    ').slice(Number.isFinite(min) ? min : 0));
}

export function markdownEnHTML(source) {
  const lignes = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const n = lignes.length;
  let html = '';
  let i = 0;

  function liste() {
    const base = indentation(lignes[i]);
    const premier = lignes[i].match(RE_LISTE);
    const ordonnee = /\d/.test(premier[2]);
    const depart = ordonnee ? parseInt(premier[2], 10) : 1;
    let sortie = ordonnee ? (depart !== 1 ? `<ol start="${depart}">` : '<ol>') : '<ul>';
    while (i < n) {
      const l = lignes[i];
      if (!l.trim()) {
        if (i + 1 < n && RE_LISTE.test(lignes[i + 1]) && indentation(lignes[i + 1]) >= base) { i++; continue; }
        break;
      }
      const m = l.match(RE_LISTE);
      const ind = indentation(l);
      if (m && ind <= base + 1) {
        if (/\d/.test(m[2]) !== ordonnee) break; // une liste d'un autre type commence
        i++;
        const sous = [];
        while (i < n && lignes[i].trim() && indentation(lignes[i]) > base + 1) sous.push(lignes[i++]);
        let contenu = m[3];
        let coche = '';
        const c = contenu.match(/^\[([ xX])\]\s+(.*)$/);
        if (c) { coche = c[1] === ' ' ? '<span class="md-case">☐</span> ' : '<span class="md-case">☑</span> '; contenu = c[2]; }
        let li = coche + enLigne(contenu);
        if (sous.length) li += markdownEnHTML(desindenter(sous).join('\n'));
        sortie += `<li>${li}</li>`;
      } else if (ind < base || (!m && ind <= base)) {
        break;
      } else {
        sortie += `<li>${enLigne(l.trim())}</li>`;
        i++;
      }
    }
    return sortie + (ordonnee ? '</ol>' : '</ul>');
  }

  while (i < n) {
    const l = lignes[i];
    if (RE_FENCE.test(l)) {
      const tampon = [];
      i++;
      while (i < n && !RE_FENCE.test(lignes[i])) tampon.push(lignes[i++]);
      i++;
      html += `<pre><code>${echapper(tampon.join('\n'))}</code></pre>`;
      continue;
    }
    if (!l.trim()) { i++; continue; }
    const t = l.match(RE_TITRE);
    if (t) {
      const niveau = Math.min(6, t[1].length + 2);
      html += `<h${niveau}>${enLigne(t[2])}</h${niveau}>`;
      i++;
      continue;
    }
    if (RE_SEPARATEUR.test(l)) { html += '<hr>'; i++; continue; }
    if (l.includes('|') && i + 1 < n && RE_LIGNE_TABLEAU.test(lignes[i + 1])) {
      const tete = cellules(l);
      const alignements = cellules(lignes[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'md-centre' : c.endsWith(':') ? 'md-droite' : ''));
      i += 2;
      const rangs = [];
      while (i < n && lignes[i].trim() && lignes[i].includes('|')) rangs.push(cellules(lignes[i++]));
      const classe = (k) => (alignements[k] ? ` class="${alignements[k]}"` : '');
      html += '<div class="md-tableau"><table><thead><tr>'
        + tete.map((c, k) => `<th${classe(k)}>${enLigne(c)}</th>`).join('')
        + '</tr></thead><tbody>'
        + rangs.map((r) => '<tr>' + tete.map((_, k) => `<td${classe(k)}>${enLigne(r[k] || '')}</td>`).join('') + '</tr>').join('')
        + '</tbody></table></div>';
      continue;
    }
    if (/^\s*>/.test(l)) {
      const tampon = [];
      while (i < n && /^\s*>/.test(lignes[i])) tampon.push(lignes[i++].replace(/^\s*>\s?/, ''));
      html += `<blockquote>${markdownEnHTML(tampon.join('\n'))}</blockquote>`;
      continue;
    }
    if (RE_LISTE.test(l)) { html += liste(); continue; }
    const tampon = [];
    while (i < n && lignes[i].trim() && (tampon.length === 0 || !debutBloc(lignes[i], lignes[i + 1]))) tampon.push(lignes[i++]);
    html += `<p>${tampon.map((x) => enLigne(x.trim())).join('<br>')}</p>`;
  }
  return html;
}
