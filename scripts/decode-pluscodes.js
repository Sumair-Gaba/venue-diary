// Set venue coordinates by decoding the Google "Plus Code" (Open Location Code)
// embedded at the start of most addresses — e.g. "R562+F6C, Sector 49 Korangi".
// Short codes are recovered against a Karachi reference point, then decoded to a
// precise lat/lng. Offline, instant, no API — far better than geocoding by text.
//
//   node --env-file=.env scripts/decode-pluscodes.js [--all]
//
// Only fills venues missing coordinates unless --all is passed.

import mod from 'open-location-code';
import { pool, all, run } from '../lib/db.js';

const OLC = mod.OpenLocationCode || mod.default?.OpenLocationCode || mod.default || mod;
const olc = new OLC();
const KHI = { lat: 24.8607, lng: 67.0011 };   // Karachi reference for short-code recovery
const PC = /\b([23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3})\b/;
const onlyAll = process.argv.includes('--all');

(async () => {
  const rows = await all(`SELECT id, address FROM venue WHERE slug IS NOT NULL AND address IS NOT NULL ${onlyAll ? '' : 'AND latitude IS NULL'}`);
  let ok = 0, bad = 0, nocode = 0;
  for (const v of rows) {
    const m = v.address.match(PC);
    if (!m) { nocode++; continue; }
    try {
      const full = olc.isFull(m[1]) ? m[1] : olc.recoverNearest(m[1], KHI.lat, KHI.lng);
      const a = olc.decode(full);
      const lat = a.latitudeCenter, lng = a.longitudeCenter;
      // sanity: keep only points in the greater-Karachi box
      if (lat > 24.6 && lat < 25.3 && lng > 66.6 && lng < 67.6) {
        await run('UPDATE venue SET latitude=?, longitude=? WHERE id=?', [lat, lng, v.id]);
        ok++;
      } else { bad++; }
    } catch { bad++; }
  }
  console.log(`Plus Codes decoded: ${ok} set, ${bad} out-of-range/failed, ${nocode} had no code.`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
