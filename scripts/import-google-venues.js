// Import REAL Karachi venues from a Google-Maps-extracted Excel workbook into
// Venue Diary as public directory listings, and REPLACE the older OpenStreetMap
// import. Google data is richer (real phones, proper addresses, Place IDs and a
// listing photo), so the `source='osm'` rows are removed first.
//
//   Preview (writes nothing):
//     node --env-file=.env scripts/import-google-venues.js "<file.xlsx>" --dry
//   Import for real:
//     node --env-file=.env scripts/import-google-venues.js "<file.xlsx>"
//
// Every field is taken VERBATIM from the workbook — nothing is invented. Fields
// the export does not carry (capacity, flat price, coordinates) are left blank
// for the owner to fill. Idempotent: matched on the Google Place ID, so
// re-running updates rows in place and never creates duplicates.
//
// Photos: the workbook's "Listing photo" URL (Google user-content CDN) is stored
// as the venue's media — these are the real listing photos, per the owner's
// request to use the Excel's own images (no stock placeholders).

import xlsx from 'xlsx';
import { pathToFileURL } from 'node:url';
import { pool, migrate, get, all, run, insert, slugify, withTx } from '../lib/db.js';
import { deriveArea } from './import-venues.js';

const dry = process.argv.includes('--dry');
const SHEET = 'Karachi venues';

// Column headers as they appear on the header row of the workbook.
const COL = {
  name: 'Venue name',
  type: 'Venue type',
  area: 'Area / neighborhood',
  address: 'Full address',
  phone: 'Public phone',
  website: 'Website',
  placeId: 'Place ID',
  // The real Google CDN photo link lives in "Photo source URL" (933 rows); the
  // "Listing photo" column holds only embedded thumbnails (sparse text).
  photo: 'Photo source URL',
};

// Same conservative name filter the OSM import uses — drops obvious non-venues
// (photographers, caterers, card shops, planners) the broad search can catch.
const NOT_A_VENUE = /photograph|studio|\bsalon\b|beauty|boutique|cater|decoration|\bdecor\b|decorator|tent service|wedding card|wedding dress|wedding gaoon|gown|crockery|bedsheet|\bfabric\b|marriage bureau|marriage service|marriage berou|rishta|\bprinter\b|printing|photo album|album maker|event planner|event management|event solution|event organiser|event organizer|eventish|event delight|\bproduction|balloons|attestation|certificate|arrangement shop|real estate|builders|\btravel\b|\bplanner\b|services$|digital/i;

const clean = (v) => {
  const s = (v == null ? '' : String(v)).trim();
  return s ? s : null;
};

// Read the sheet with the real header row (the file has a few banner rows first).
function readRows(file) {
  const wb = xlsx.readFile(file);
  const ws = wb.Sheets[SHEET];
  if (!ws) throw new Error(`Sheet "${SHEET}" not found. Sheets: ${wb.SheetNames.join(', ')}`);
  const grid = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null });
  const headerIdx = grid.findIndex((r) => Array.isArray(r) && r.includes(COL.name));
  if (headerIdx < 0) throw new Error(`Could not find header row containing "${COL.name}".`);
  const header = grid[headerIdx];
  const col = Object.fromEntries(Object.entries(COL).map(([k, label]) => [k, header.indexOf(label)]));
  return grid.slice(headerIdx + 1)
    .filter((r) => Array.isArray(r) && clean(r[col.name]))
    .map((r) => ({
      name: clean(r[col.name]),
      type: clean(r[col.type]),
      area: clean(r[col.area]),
      address: clean(r[col.address]),
      phone: clean(r[col.phone]),
      website: clean(r[col.website]),
      placeId: clean(r[col.placeId]),
      photo: clean(r[col.photo]),
    }));
}

// A slug no other venue uses (an existing row for the SAME ref keeps its slug).
async function uniqueSlug(name, ref) {
  const base = slugify(name) || 'venue';
  let slug = base, n = 1;
  while (true) {
    const row = await get('SELECT source, source_ref FROM venue WHERE slug=?', [slug]);
    if (!row || (row.source === 'google' && row.source_ref === ref)) return slug;
    slug = `${base}-${++n}`;
  }
}

// Remove every OSM-sourced listing and all of its child rows, in one transaction.
async function deleteOsm() {
  const ids = (await all("SELECT id FROM venue WHERE source='osm'")).map((r) => r.id);
  if (!ids.length) return 0;
  await withTx(async (query) => {
    const inId = 'venue_id = ANY($1)';
    const inHall = 'hall_id IN (SELECT id FROM hall WHERE venue_id = ANY($1))';
    const inBooking = 'booking_id IN (SELECT id FROM booking WHERE venue_id = ANY($1))';
    // Raw pg here (ANY($1)) because these scoped bulk deletes don't use the `?` dialect.
    await query(`DELETE FROM payment WHERE ${inBooking}`, [ids]);
    await query(`DELETE FROM notification_log WHERE ${inBooking}`, [ids]);
    await query(`DELETE FROM booking WHERE ${inId}`, [ids]);
    await query(`DELETE FROM block WHERE ${inHall}`, [ids]);
    await query(`DELETE FROM hall_price WHERE ${inHall}`, [ids]);
    await query(`DELETE FROM rate_plan WHERE ${inHall}`, [ids]);
    await query(`DELETE FROM pricing_rule WHERE ${inId}`, [ids]);
    await query(`DELETE FROM decor_item WHERE ${inId}`, [ids]);
    await query(`DELETE FROM lead WHERE ${inId}`, [ids]);
    await query(`DELETE FROM media WHERE ${inId}`, [ids]);
    await query(`DELETE FROM slot WHERE ${inId}`, [ids]);
    await query(`DELETE FROM hall WHERE ${inId}`, [ids]);
    await query('DELETE FROM venue WHERE id = ANY($1)', [ids]);
  });
  return ids.length;
}

async function importOne(v) {
  if (NOT_A_VENUE.test(v.name)) return 'skipped';
  // Prefer the Place ID as the idempotency key; fall back to name+address when a
  // row somehow lacks one (keeps re-runs from duplicating those too).
  const ref = v.placeId || `addr:${slugify(v.name)}:${slugify(v.address || '')}`;
  const area = v.area || deriveArea(v.address) || null;

  if (dry) { console.log(`  • ${v.name}${area ? ' — ' + area : ''}${v.phone ? ' · ' + v.phone : ''}${v.photo ? ' [photo]' : ''}`); return 'preview'; }

  const existing = await get('SELECT id FROM venue WHERE source=? AND source_ref=?', ['google', ref]);
  let venueId;
  if (existing) {
    venueId = existing.id;
    await run('UPDATE venue SET name=?, city=?, area=?, address=?, phone=?, website=? WHERE id=?',
      [v.name, 'Karachi', area, v.address, v.phone, v.website, venueId]);
  } else {
    const slug = await uniqueSlug(v.name, ref);
    venueId = await insert(
      `INSERT INTO venue (owner_user_id,name,slug,city,area,address,phone,website,facilities,features,source,source_ref)
       VALUES (NULL,?,?,?,?,?,?,?,?,?,?,?)`,
      [v.name, slug, 'Karachi', area, v.address, v.phone, v.website, '[]', null, 'google', ref]);
    // Default slots + one hall so each listing is functional and claimable later.
    for (const [code, nm, s, e, sort] of [['lunch', 'Lunch', 1, 2, 1], ['dinner', 'Dinner', 2, 3, 2], ['fullday', 'Full Day', 1, 3, 3]])
      await run('INSERT INTO slot (venue_id,code,name,span_start,span_end,sort) VALUES (?,?,?,?,?,?)', [venueId, code, nm, s, e, sort]);
    await run('INSERT INTO hall (venue_id,name,capacity) VALUES (?,?,?)', [venueId, 'Main Hall', null]);
  }

  // Real listing photo from the workbook. Refresh it on re-run (URL may rotate).
  await run('DELETE FROM media WHERE venue_id=? AND placeholder=0', [venueId]);
  if (v.photo) {
    await run('INSERT INTO media (venue_id,hall_id,url,kind,sort,created_at,placeholder) VALUES (?,?,?,?,?,?,0)',
      [venueId, null, v.photo, 'image', 0, new Date().toISOString()]);
  }
  return existing ? 'updated' : 'created';
}

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!file) {
  console.error('Usage: node --env-file=.env scripts/import-google-venues.js "<file.xlsx>" [--dry]');
  process.exit(1);
}

(async () => {
  const rows = readRows(file);
  console.log(`${dry ? 'PREVIEW (no writes) — ' : ''}read ${rows.length} venue rows from "${SHEET}".\n`);

  if (!dry) {
    await migrate();
    const removed = await deleteOsm();
    console.log(`Removed ${removed} OSM listings (replacing with Google data).\n`);
  }

  const counts = { created: 0, updated: 0, skipped: 0, preview: 0 };
  for (const v of rows) {
    try { counts[await importOne(v)]++; }
    catch (e) { console.error('  ! failed', v.name, e.message); }
  }

  if (dry) console.log(`\nPreview: ${counts.preview} venues ready to import (${counts.skipped} non-venues skipped).`);
  else console.log(`\nDone. Created ${counts.created}, updated ${counts.updated}, skipped ${counts.skipped} (non-venue names).`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
