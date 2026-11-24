// Forward-geocode venues that have no coordinates (lat/lng) so the consumer app
// can show them on a map and compute "near me" by radius. Uses the free OSM
// Nominatim service (no key, no card), 1 request/second per their usage policy.
//
//   node --env-file=.env scripts/geocode-coords.js [--all] [--limit N]
//
// Strategy: try the venue's full address first; fall back to "<area>, Karachi".
// Area look-ups are cached so many venues in the same area cost one request.
// Approximate (Nominatim resolves to street/area level) — good enough for a
// radius map; precise pins come later from owner edits / Google if ever keyed.

import { pool, all, run } from '../lib/db.js';

const UA = 'VenueDiary/1.0 (venue directory; tech@echodmc.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const onlyAll = process.argv.includes('--all');
const limArg = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || 0;

async function nominatim(q) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=pk&accept-language=en&q=' + encodeURIComponent(q);
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (Array.isArray(j) && j[0]) return { lat: Number(j[0].lat), lon: Number(j[0].lon) };
  return null;
}

// Clean an address for geocoding: drop a leading Plus Code (Nominatim ignores it)
// and the trailing country, keep street + area.
const cleanAddr = (a) => String(a || '')
  .replace(/^[0-9A-Z]{2,}\+[0-9A-Z]{2,}\s*,?\s*/i, '')
  .replace(/,?\s*Pakistan\s*$/i, '')
  .trim();

(async () => {
  let rows = await all(`SELECT id, name, area, address, latitude FROM venue WHERE slug IS NOT NULL ${onlyAll ? '' : 'AND latitude IS NULL'} ORDER BY id`);
  if (limArg) rows = rows.slice(0, limArg);
  console.log(`Geocoding ${rows.length} venues (1 req/sec, ~${Math.ceil(rows.length / 60)} min)…\n`);

  const areaCache = new Map();
  let ok = 0, viaArea = 0, miss = 0;

  for (let i = 0; i < rows.length; i++) {
    const v = rows[i];
    let pt = null;
    try {
      const addr = cleanAddr(v.address);
      if (addr) { pt = await nominatim(addr + ', Karachi'); await sleep(1100); }
    } catch {}
    if (!pt && v.area) {
      const key = v.area.toLowerCase();
      if (areaCache.has(key)) { pt = areaCache.get(key); viaArea++; }
      else {
        try { pt = await nominatim(v.area + ', Karachi, Pakistan'); await sleep(1100); } catch {}
        areaCache.set(key, pt);
        if (pt) viaArea++;
      }
    }
    if (pt && Number.isFinite(pt.lat) && Number.isFinite(pt.lon)) {
      await run('UPDATE venue SET latitude=?, longitude=? WHERE id=?', [pt.lat, pt.lon, v.id]);
      ok++;
    } else { miss++; }
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${rows.length} — set ${ok} (area ${viaArea}), missed ${miss}`);
  }
  console.log(`\nDone. Coordinates set for ${ok} venues, missed ${miss}.`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
