// Fill in real street addresses for imported venues that have coordinates but no
// address, by reverse-geocoding against OpenStreetMap Nominatim (free, ODbL).
// Respects Nominatim's usage policy: single-threaded, ~1 request/second, with a
// descriptive User-Agent. Only touches venues missing an address (small batch),
// never re-geocodes ones that already have one.
//
//   node --env-file=.env scripts/geocode-addresses.js [--all] [--dry]
//
// --all   also re-geocode venues that already have an address (slower; use
//         sparingly to stay within Nominatim's policy).

import { pool, migrate, all, run } from '../lib/db.js';
import { deriveArea } from './import-venues.js';

const UA = 'VenueDiary/1.0 (venue directory; tech@echodmc.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const all_ = process.argv.includes('--all');
const dry = process.argv.includes('--dry');

// Build a clean, de-duplicated address from Nominatim address components.
function cleanAddress(a = {}) {
  const city = /karachi/i.test(a.city || a.town || a.county || '') ? 'Karachi' : (a.city || a.town || 'Karachi');
  const comp = [a.road || a.pedestrian || a.footway, a.neighbourhood || a.quarter, a.suburb, city]
    .filter((x) => x && !/\b(division|district)\b/i.test(x));   // drop admin-level clutter
  const seen = new Set();
  const out = comp.filter((x) => !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
  return out.length ? out.join(', ') : null;
}
function areaOf(a = {}, address) {
  const cand = a.suburb || a.neighbourhood || a.quarter || null;
  if (cand && !/\b(division|district)\b/i.test(cand)) return cand;
  return deriveArea(address) || null;
}

(async () => {
  await migrate();
  const where = all_ ? 'latitude IS NOT NULL' : 'latitude IS NOT NULL AND address IS NULL';
  const rows = await all(`SELECT id, name, latitude, longitude FROM venue WHERE source='osm' AND ${where} ORDER BY id`);
  console.log(`${dry ? 'PREVIEW — ' : ''}${rows.length} venues to geocode (~${Math.ceil(rows.length * 1.1)}s)…\n`);
  let done = 0, failed = 0;
  for (const v of rows) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${v.latitude}&lon=${v.longitude}&format=json&zoom=18&addressdetails=1&accept-language=en`;
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
      if (!res.ok) { failed++; console.error('  !', res.status, v.name); await sleep(1100); continue; }
      const j = await res.json();
      const address = cleanAddress(j.address);
      const area = areaOf(j.address, address);
      if (address) {
        if (dry) console.log(`  • ${v.name} → ${address}${area ? '  [' + area + ']' : ''}`);
        else await run('UPDATE venue SET address=?, area=COALESCE(area,?) WHERE id=?', [address, area, v.id]);
        done++;
      }
    } catch (e) { failed++; console.error('  !', v.name, e.message); }
    await sleep(1100);   // Nominatim policy: <= 1 req/sec
  }
  console.log(`\n${dry ? 'Would update' : 'Updated'} ${done} addresses; ${failed} failed.`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
