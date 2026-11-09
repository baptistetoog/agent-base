'use strict';
(async function () {
  try {
    const m = await (await fetch('/api/marque')).json();
    document.title = 'Connexion · ' + m.nomOutil;
    document.querySelectorAll('[data-initiale]').forEach((e) => { e.textContent = m.initiale; });
    document.querySelectorAll('[data-nom-outil]').forEach((e) => { e.textContent = m.nomOutil; });
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
