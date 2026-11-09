'use strict';
(async function () {
  const r = await fetch('/api/moi');
  if (r.status === 401) { window.location.href = '/connexion.html'; return; }
  const moi = await r.json();
  document.getElementById('bonjour').textContent = 'Bonjour ' + moi.prenom + ', ton agent arrive bientôt.';

  try {
    const m = await (await fetch('/api/marque')).json();
    document.title = m.nomOutil;
    document.querySelectorAll('[data-initiale]').forEach((e) => { e.textContent = m.initiale; });
    document.querySelectorAll('[data-nom-outil]').forEach((e) => { e.textContent = m.nomOutil; });
  } catch (e) { /* rien */ }

  document.getElementById('deconnexion').addEventListener('click', async () => {
    await fetch('/api/deconnexion', { method: 'POST' }).catch(() => {});
    window.location.href = '/connexion.html';
  });
})();
