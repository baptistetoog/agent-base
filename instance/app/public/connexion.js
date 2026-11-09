'use strict';
(async function () {
  try {
    const m = await (await fetch('/api/marque')).json();
    document.title = 'Connexion · ' + m.nomOutil;
    document.querySelectorAll('[data-initiale]').forEach((e) => { e.textContent = m.initiale; });
    document.querySelectorAll('[data-nom-outil]').forEach((e) => { e.textContent = m.nomOutil; });
    if (m.logo) {
      document.querySelectorAll('[data-logo]').forEach((e) => { e.src = m.logo; e.alt = m.nomOutil; e.hidden = false; });
      document.querySelectorAll('[data-initiale]').forEach((e) => { e.hidden = true; });
    }
    const icone = document.getElementById('favicon');
    if (icone) icone.href = m.logo || ('data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="' + (getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3B5BDB') + '"/><text x="16" y="22" font-family="Inter,Arial,sans-serif" font-size="18" font-weight="700" fill="#fff" text-anchor="middle">' + m.initiale.replace(/[<&>"]/g, '') + '</text></svg>'));
  } catch (e) { /* la page reste utilisable sans le nom */ }

  const formulaire = document.getElementById('formulaire');
  const message = document.getElementById('message');
  formulaire.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    message.textContent = '';
    const bouton = formulaire.querySelector('button');
    bouton.disabled = true;
    try {
      const r = await fetch('/api/connexion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formulaire.email.value, motDePasse: formulaire.motDePasse.value }),
      });
      if (r.ok) { window.location.href = '/'; return; }
      const d = await r.json().catch(() => ({}));
      message.textContent = d.erreur || 'Connexion impossible.';
    } catch (e) {
      message.textContent = 'Le serveur ne répond pas. Réessayez.';
    }
    bouton.disabled = false;
  });
})();
