'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../docs/full-parity/INTERACTION-PROTOTYPE.html');
const server = http.createServer((req, res) => {
  if (!['/', '/index.html'].includes(req.url)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
});
server.listen(0, '127.0.0.1', () => console.log(`Prototype: http://127.0.0.1:${server.address().port}`));
