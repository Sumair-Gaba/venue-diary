// Venue Diary — local dev HTTP server. Thin adapter over the shared router in
// lib/router.js (the same logic Vercel runs). Serves the static dashboard too.
// Run: node --env-file=.env server.js   (reads DATABASE_URL from .env)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './lib/router.js';
import { handleBlobUpload } from './lib/blob.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png' };

const sendJson = (res, code, data) => {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
};
const readBody = (req) => new Promise((resolve) => {
  let b = ''; req.on('data', (c) => (b += c));
  req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
});

function serveStatic(res, pathname) {
  const file = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(PUBLIC)) return sendJson(res, 403, { error: 'FORBIDDEN' });
  fs.readFile(file, (err, data) => {
    if (err) return fs.readFile(path.join(PUBLIC, 'index.html'), (e2, html) => { if (e2) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(data);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    // Vercel Blob client-upload token endpoint (special response shape).
    if (url.pathname === '/api/media/upload' && req.method === 'POST') {
      const body = await readBody(req);
      const reqLike = { headers: { get: (k) => req.headers[String(k).toLowerCase()] } };
      try { return sendJson(res, 200, await handleBlobUpload(body, reqLike)); }
      catch (e) { return sendJson(res, 400, { error: 'UPLOAD_FAILED', message: e.message }); }
    }
    if (url.pathname.startsWith('/api/')) {
      const body = (req.method === 'POST' || req.method === 'PATCH') ? await readBody(req) : {};
      const h = req.headers['authorization'] || '';
      body.__token = h.startsWith('Bearer ') ? h.slice(7) : null;
      const segs = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
      const { status, data } = await handleApi({ method: req.method, segs, query: url.searchParams, body });
      return sendJson(res, status, data);
    }
    serveStatic(res, url.pathname);
  } catch (e) { sendJson(res, 500, { error: 'SERVER_ERROR', message: e.message }); }
}).listen(PORT, () => console.log(`\n  Venue Diary running →  http://localhost:${PORT}\n`));
