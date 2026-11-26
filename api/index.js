// Venue Diary — Vercel serverless function. Handles every /api/* request
// (see vercel.json routing) via the shared router. DATABASE_URL comes from the
// Vercel project's environment variables (your Neon connection string).
import { handleApi } from '../lib/router.js';
import { handleBlobUpload } from '../lib/blob.js';

export default async function handler(req, res) {
  try {
    // CORS: the consumer mobile app / web client calls this API cross-origin.
    // Tokens travel in the Authorization header (not cookies), so `*` is safe.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Venue-Id, X-Device-Id');
    if (req.method === 'OPTIONS') return res.status(204).end();

    const url = new URL(req.url, `https://${req.headers.host}`);
    const segs = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);

    // Vercel Blob client-upload token endpoint (special response shape).
    if (req.method === 'POST' && segs[0] === 'media' && segs[1] === 'upload') {
      let b = req.body; if (b == null) b = {}; else if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
      const reqLike = { headers: { get: (k) => req.headers[String(k).toLowerCase()] } };
      try { return res.status(200).json(await handleBlobUpload(b, reqLike)); }
      catch (e) { return res.status(400).json({ error: 'UPLOAD_FAILED', message: e.message }); }
    }

    // Vercel parses JSON bodies into req.body; fall back to raw if needed.
    let body = req.body;
    if (body == null) body = {};
    else if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    else body = { ...body };

    const h = req.headers['authorization'] || '';
    body.__token = h.startsWith('Bearer ') ? h.slice(7) : null;
    body.__venueOverride = req.headers['x-venue-id'] || null;
    body.__device = req.headers['x-device-id'] || null;
    body.__ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || null;

    const { status, data } = await handleApi({ method: req.method, segs, query: url.searchParams, body });
    res.status(status).json(data);
  } catch (e) {
    console.error('[api]', e);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
  }
}
