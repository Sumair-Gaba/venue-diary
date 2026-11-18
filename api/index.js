// Venue Diary — Vercel serverless function. Handles every /api/* request
// (see vercel.json routing) via the shared router. DATABASE_URL comes from the
// Vercel project's environment variables (your Neon connection string).
import { handleApi } from '../lib/router.js';

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const segs = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);

    // Vercel parses JSON bodies into req.body; fall back to raw if needed.
    let body = req.body;
    if (body == null) body = {};
    else if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    else body = { ...body };

    const h = req.headers['authorization'] || '';
    body.__token = h.startsWith('Bearer ') ? h.slice(7) : null;

    const { status, data } = await handleApi({ method: req.method, segs, query: url.searchParams, body });
    res.status(status).json(data);
  } catch (e) {
    res.status(500).json({ error: 'SERVER_ERROR', message: e.message });
  }
}
