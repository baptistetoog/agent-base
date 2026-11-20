  // Route publique : une photo rendue publique par l'agent (lien_public_photo), et rien d'autre.
  const mPhoto = chemin.match(/^\/photo\/([a-f0-9]{32})\.(jpg|png|webp|pdf)$/);
  if (mPhoto && (methode === 'GET' || methode === 'HEAD')) {
    const f = path.join(__dirname, '..', 'data', 'photos-publiques', `${mPhoto[1]}.${mPhoto[2]}`);
    let st;
    try { st = fs.lstatSync(f); } catch { st = null; }
    if (!st || !st.isFile() || st.isSymbolicLink()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': mPhoto[2] === 'jpg' ? 'image/jpeg' : mPhoto[2] === 'pdf' ? 'application/pdf' : 'image/' + mPhoto[2], 'Content-Length': st.size, 'Cache-Control': 'public, max-age=31536000', 'X-Content-Type-Options': 'nosniff' });
    if (methode === 'HEAD') return res.end();
    return fs.createReadStream(f).pipe(res);
  }
