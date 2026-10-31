// Web sunucusu: oyun dosyalarını sunar ve /ws üzerinden online oyun sunucusunu çalıştırır.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8091;
const ROOT = __dirname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
// Yalnızca tarayıcının ihtiyaç duyduğu dosyalar sunulur (sunucu kodu, package.json vb. değil)
const ALLOWED = /^\/(index\.html|src\/[\w-]+\.js|vendor\/[\w/.-]+\.js)$/;

let game = null;
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
  if (p === '/') p = '/index.html';
  if (p === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(game ? game.stats() : { rooms: 0, players: 0 }));
  }
  if (!ALLOWED.test(p) || p.includes('..')) { res.writeHead(404); return res.end('Bulunamadı'); }
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); return res.end('Bulunamadı'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

import('./game-server.mjs').then(m => { game = m.attach(server); });
server.listen(PORT, () => console.log(`Delik Deşik: http://localhost:${PORT}`));
