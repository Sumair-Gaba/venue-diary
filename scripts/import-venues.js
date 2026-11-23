// Import REAL venues from an OpenStreetMap (Overpass API) JSON export into Venue
// Diary as public directory listings.
//
//   1. Open the export link (see scripts/README-import.md), click Export → JSON
//   2. Save the file into the project, e.g. data/karachi-venues.json
//   3. Preview first (writes nothing):
//        node --env-file=.env scripts/import-venues.js data/karachi-venues.json --dry
//   4. Import for real:
//        node --env-file=.env scripts/import-venues.js data/karachi-venues.json
//
// Every field is taken VERBATIM from the OSM tags — nothing is invented. Fields
// OSM does not carry (capacity, flat price, facilities) are left blank for the
// owner to fill. Idempotent: matched on the OSM id, so re-running updates rows
// in place and never creates duplicates.

import fs from 'node:fs';
import { pool, migrate, get, run, insert, slugify } from '../lib/db.js';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('Usage: node --env-file=.env scripts/import-venues.js <overpass.json> [--dry]');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const elements = Array.isArray(raw.elements) ? raw.elements : (Array.isArray(raw) ? raw : []);

// A slug no other venue uses (an existing row for the SAME osm ref keeps its slug).
async function uniqueSlug(name, ref) {
  const base = slugify(name);
  let slug = base, n = 1;
  while (true) {
    const row = await get('SELECT source_ref FROM venue WHERE slug=?', [slug]);
    if (!row || row.source_ref === ref) return slug;
    slug = `${base}-${++n}`;
  }
}

function buildAddress(t) {
  if (t['addr:full']) return t['addr:full'];
  const parts = [t['addr:housenumber'], t['addr:street'], t['addr:suburb'] || t['addr:neighbourhood'], t['addr:city']].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

// Known Karachi localities (most-specific first) — used to pull a real area out
// of the address when OSM has no addr:suburb tag. Not invented: only set when
// the name actually appears in the venue's real address string.
export const KARACHI_AREAS = [
  'North Nazimabad', 'Gulshan-e-Bahar', 'Gulshan-e-Iqbal', 'Gulistan-e-Johar', 'Gulistan-e-Jauhar',
  'Federal B Area', 'FB Area', 'DHA', 'Defence', 'Clifton', 'PECHS', 'P.E.C.H.S', 'Bahadurabad',
  'Shahra-e-Faisal', 'Shah Faisal', 'Malir', 'Korangi', 'Landhi', 'Orangi', 'Liaquatabad',
  'Nazimabad', 'Gulberg', 'Saddar', 'Lyari', 'SITE', 'Baldia', 'New Karachi', 'North Karachi',
  'Gadap', 'Model Colony', 'Tariq Road', 'Buffer Zone', 'Bufferzone', 'Nipa', 'Surjani', 'Manghopir', 'Kemari',
];
export function deriveArea(address) {
  if (!address) return null;
  const hay = address.toLowerCase();
  for (const a of KARACHI_AREAS) if (hay.includes(a.toLowerCase())) return a;
  return null;
}

function fieldsOf(el) {
  const t = el.tags || {};
  const address = buildAddress(t);
  return {
    name: String(t.name || '').trim(),
    ref: `${el.type}/${el.id}`,
    lat: el.lat ?? el.center?.lat ?? null,
    lon: el.lon ?? el.center?.lon ?? null,
    area: t['addr:suburb'] || t['addr:neighbourhood'] || t['addr:place'] || t['addr:district'] || deriveArea(address) || null,
    address,
    phone: t.phone || t['contact:phone'] || t.mobile || t['contact:mobile'] || null,
    website: t.website || t['contact:website'] || null,
  };
}

// Obvious non-venues the broad name search catches (photographers, studios,
// salons, caterers that aren't themselves a hall). Dropped so the directory
// stays banquets/marquees/lawns.
const NOT_A_VENUE = /photograph|studio|\bsalon\b|beauty|boutique|cater|decoration|\bdecor\b|decorator|tent service|wedding card|wedding dress|wedding gaoon|gown|crockery|bedsheet|\bfabric\b|marriage bureau|marriage service|marriage berou|rishta|\bprinter\b|printing|photo album|album maker|event planner|event management|event solution|event organiser|event organizer|eventish|event delight|\bproduction|balloons|attestation|certificate|arrangement shop|real estate|builders|\btravel\b|\bplanner\b|services$|digital/i;

async function importOne(el) {
  const f = fieldsOf(el);
  if (!f.name) return 'skipped';
  if (NOT_A_VENUE.test(f.name)) return 'skipped';
  if (dry) { console.log(`  • ${f.name}${f.area ? ' — ' + f.area : ''}${f.phone ? ' · ' + f.phone : ''}`); return 'preview'; }

  const existing = await get('SELECT id FROM venue WHERE source=? AND source_ref=?', ['osm', f.ref]);
  if (existing) {
    await run('UPDATE venue SET name=?, city=?, area=?, address=?, phone=?, website=?, latitude=?, longitude=? WHERE id=?',
      [f.name, 'Karachi', f.area, f.address, f.phone, f.website, f.lat, f.lon, existing.id]);
    return 'updated';
  }
  const slug = await uniqueSlug(f.name, f.ref);
  const venueId = await insert(
    `INSERT INTO venue (owner_user_id,name,slug,city,area,address,phone,website,facilities,features,latitude,longitude,source,source_ref)
     VALUES (NULL,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [f.name, slug, 'Karachi', f.area, f.address, f.phone, f.website, '[]', null, f.lat, f.lon, 'osm', f.ref]);
  // Default slots + one hall so each listing is functional and claimable later.
  for (const [code, nm, s, e, sort] of [['lunch', 'Lunch', 1, 2, 1], ['dinner', 'Dinner', 2, 3, 2], ['fullday', 'Full Day', 1, 3, 3]])
    await run('INSERT INTO slot (venue_id,code,name,span_start,span_end,sort) VALUES (?,?,?,?,?,?)', [venueId, code, nm, s, e, sort]);
  await run('INSERT INTO hall (venue_id,name,capacity) VALUES (?,?,?)', [venueId, 'Main Hall', null]);
  return 'created';
}

(async () => {
  if (!dry) await migrate();
  const counts = { created: 0, updated: 0, skipped: 0, preview: 0 };
  console.log(`${dry ? 'PREVIEW (no writes) — ' : ''}processing ${elements.length} OSM elements…\n`);
  for (const el of elements) {
    try { counts[await importOne(el)]++; }
    catch (e) { console.error('  ! failed', `${el.type}/${el.id}`, e.message); }
  }
  if (dry) console.log(`\nPreview: ${counts.preview} real named venues ready to import (${counts.skipped} unnamed skipped).`);
  else console.log(`\nDone. Created ${counts.created}, updated ${counts.updated}, skipped ${counts.skipped} (no name).`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
