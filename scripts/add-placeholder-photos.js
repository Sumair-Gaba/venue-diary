// Give imported (ownerless) directory venues a small gallery of LICENSED STOCK
// placeholder photos so the public pages don't look bare. These are NOT the
// venue's own photos — they are free, legally-reusable Unsplash banquet/wedding
// images (same source as the app's demo media), rotated so neighbours differ.
// Inserted with placeholder=1 so an owner can clear them when they upload real
// photos. Reverse all with: DELETE FROM media WHERE placeholder=1;
//
//   node --env-file=.env scripts/add-placeholder-photos.js [--dry]
//
// Idempotent: only venues (source='osm') that currently have NO media get photos.

import { pool, migrate, all, get, run } from '../lib/db.js';

// Validated free Unsplash photos (banquet / wedding-hall / event themes).
const POOL = [
  'photo-1519741497674-611481863552', 'photo-1464366400600-7168b8af9bc3',
  'photo-1507504031003-b417219a0fde', 'photo-1470229722913-7c0e2dbbafd3',
  'photo-1511795409834-ef04bbd61622', 'photo-1478146896981-b80fe463b330',
  'photo-1505236858219-8359eb29e329', 'photo-1519167758481-83f550bb49b3',
  'photo-1527529482837-4698179dc6ce', 'photo-1535254973040-607b474cb50d',
  'photo-1522413452208-996ff3f3e740', 'photo-1492684223066-81342ee5ff30',
  'photo-1530103862676-de8c9debad1d', 'photo-1465495976277-4387d4b0b4c6',
  'photo-1519225421980-715cb0215aed', 'photo-1600891964599-f61ba0e24092',
].map((id) => `https://images.unsplash.com/${id}?w=1200&q=70`);
const PER_VENUE = 3;

const dry = process.argv.includes('--dry');

(async () => {
  await migrate();
  const venues = await all("SELECT id FROM venue WHERE source='osm' ORDER BY id");
  const now = new Date().toISOString();
  let done = 0, skipped = 0;
  for (const [i, v] of venues.entries()) {
    const have = Number((await get('SELECT COUNT(*) c FROM media WHERE venue_id=?', [v.id])).c);
    if (have) { skipped++; continue; }
    if (dry) { done++; continue; }
    for (let k = 0; k < PER_VENUE; k++) {
      const url = POOL[(i * PER_VENUE + k) % POOL.length];   // rotate so neighbours differ
      await run('INSERT INTO media (venue_id,hall_id,url,kind,sort,placeholder,created_at) VALUES (?,?,?,?,?,?,?)',
        [v.id, null, url, 'image', k, 1, now]);
    }
    done++;
  }
  console.log(`${dry ? 'PREVIEW — ' : ''}${done} venues ${dry ? 'would get' : 'given'} ${PER_VENUE} placeholder photos each; ${skipped} already had media.`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
