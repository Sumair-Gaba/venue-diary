// Venue Diary — database layer on PostgreSQL (via `pg`), targeting Neon.
// Multi-tenant: each owner (app_user) owns one venue; all data is scoped to it.
// One DATABASE_URL drives both local dev and Vercel production. Everything async.

import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn('  [db] DATABASE_URL is not set — create a .env with your Neon connection string.');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : undefined,
  max: 3,
});

export const FACILITIES = ['AC', 'Parking', 'Generator', 'Bridal room', 'Separate halls', 'Valet', 'Stage', 'DJ allowed', 'Outside catering'];

const DEMO_OWNER_PHONE = '+923009990001';      // demo banquet owner (owns Shalimar Grand)

// Login sessions last 1 hour of inactivity, then require a fresh sign-in. The
// window slides: every authenticated request pushes expiry out another hour, so
// an active user is never logged out mid-work.
export const SESSION_TTL_MS = 60 * 60 * 1000;  // 1 hour

// Demo photos so a fresh install shows a populated gallery (owner can delete
// these and upload their own). Free-to-use banquet/wedding-hall stock images.
const DEMO_MEDIA = [
  'https://images.unsplash.com/photo-1519741497674-611481863552?w=1200&q=70',
  'https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=1200&q=70',
  'https://images.unsplash.com/photo-1507504031003-b417219a0fde?w=1200&q=70',
  'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=1200&q=70',
  'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?w=1200&q=70',
  'https://images.unsplash.com/photo-1478146896981-b80fe463b330?w=1200&q=70',
];

// ---- feature flags (platform-controlled, per tenant) ----------------------
// Every optional module lives here. The admin (master) turns features on/off
// per banquet; the owner's dashboard shows only what's enabled. Core modules
// (home, bookings, settings) are always on and never listed here. Build new
// modules, add them to this catalog, and they become toggleable platform-wide.
export const FEATURE_CATALOG = [
  { key: 'calendar',   label: 'Calendar',         desc: 'Month calendar of bookings & availability' },
  { key: 'payments',   label: 'Payments',         desc: 'Outstanding balances & payment tracking' },
  { key: 'calculator', label: 'Rate calculator',  desc: 'Per-head / per-dish quote tool' },
  { key: 'media',       label: 'Photos & videos',  desc: 'Venue photo/video gallery' },
  { key: 'decor',       label: 'Decor & stage',    desc: 'Decor/stage catalog with reference photos & rates' },
  { key: 'leads',       label: 'Public page & enquiries', desc: 'Public venue page with transparent pricing + customer enquiry form' },
  { key: 'beo',         label: 'Event order (BEO)', desc: 'Printable Banquet Event Order sheet per booking for staff' },
  { key: 'notifications', label: 'Alerts & reminders', desc: 'Dashboard alerts + WhatsApp/SMS reminders' },
  { key: 'import',      label: 'Import old diary',  desc: 'Bulk-add existing bookings' },
];
export const FEATURE_KEYS = FEATURE_CATALOG.map((f) => f.key);
export const DEFAULT_FEATURES = ['calendar', 'payments', 'calculator', 'media', 'decor', 'leads', 'beo', 'notifications']; // import off by default
// Keep only valid, known feature keys.
export const sanitizeFeatures = (list) => (Array.isArray(list) ? list : []).filter((k) => FEATURE_KEYS.includes(k));
// Resolve a venue's stored features column to an array (defaults when unset).
export function parseFeatures(raw) {
  if (raw == null) return DEFAULT_FEATURES.slice();
  try { const a = typeof raw === 'string' ? JSON.parse(raw) : raw; return Array.isArray(a) ? sanitizeFeatures(a) : DEFAULT_FEATURES.slice(); }
  catch { return DEFAULT_FEATURES.slice(); }
}

// URL- and DNS-friendly slug from a name. "Shalimar Grand!" -> "shalimar-grand".
const RESERVED_SLUGS = new Set(['admin', 'api', 'owner', 'public', 'assets', 'vendor', 'styles', 'app', 'index']);
export function slugify(name) {
  const base = String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'banquet';
  return RESERVED_SLUGS.has(base) ? base + '-1' : base;
}
// Return a slug based on `name` that no other venue is using.
async function uniqueSlug(name, excludeId = null) {
  let base = slugify(name), slug = base, n = 1;
  while (true) {
    const row = await get('SELECT id FROM venue WHERE slug=?', [slug]);
    if (!row || row.id === excludeId) return slug;
    slug = `${base}-${++n}`;
  }
}

// Admins log in with email + password (bootstrapped from ADMIN_EMAIL /
// ADMIN_PASSWORD env). Owners log in with phone + OTP.
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `scrypt$${salt}$${h}`;
}
export function verifyPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, h] = stored.split('$');
  const h2 = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  const a = Buffer.from(h, 'hex'), b = Buffer.from(h2, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- query helpers --------------------------------------------------------
// Keep the app's existing `?` placeholders; convert to Postgres $1,$2,... here.
const conv = (sql) => { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); };
const norm = (args = []) => args.map((a) => (a === undefined ? null : a));

// Accept a coordinate value from the client; return a valid finite number or null.
export const coord = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Accept a percentage from the client; clamp to a sane 0–100 range, else null.
export const pct = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
};

export async function get(sql, args = []) { const r = await pool.query(conv(sql), norm(args)); return r.rows[0]; }
export async function all(sql, args = []) { const r = await pool.query(conv(sql), norm(args)); return r.rows; }
export async function run(sql, args = []) { const r = await pool.query(conv(sql), norm(args)); return { changes: r.rowCount, rows: r.rows }; }
export async function insert(sql, args = []) { const r = await pool.query(conv(sql) + ' RETURNING id', norm(args)); return r.rows[0].id; }

// ---- schema ---------------------------------------------------------------
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS app_user (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    phone TEXT UNIQUE, email TEXT, name TEXT, password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'owner', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS venue (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    owner_user_id INTEGER REFERENCES app_user(id),
    name TEXT NOT NULL, slug TEXT, city TEXT, area TEXT,
    address TEXT, phone TEXT, capacity_min INTEGER, capacity_max INTEGER,
    facilities TEXT DEFAULT '[]', features TEXT,
    latitude DOUBLE PRECISION, longitude DOUBLE PRECISION
  );
  CREATE TABLE IF NOT EXISTS hall (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    venue_id INTEGER NOT NULL REFERENCES venue(id),
    name TEXT NOT NULL, capacity INTEGER, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS slot (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    venue_id INTEGER NOT NULL REFERENCES venue(id),
    code TEXT NOT NULL, name TEXT NOT NULL,
    span_start INTEGER NOT NULL, span_end INTEGER NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS rate_plan (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    hall_id INTEGER NOT NULL REFERENCES hall(id),
    event_type TEXT NOT NULL, per_head_rate INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS hall_price (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    hall_id INTEGER NOT NULL REFERENCES hall(id),
    slot_id INTEGER NOT NULL REFERENCES slot(id),
    price INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ux_hall_price ON hall_price(hall_id, slot_id);
  CREATE TABLE IF NOT EXISTS booking (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    client_uuid TEXT UNIQUE,
    venue_id INTEGER NOT NULL REFERENCES venue(id),
    hall_id INTEGER NOT NULL REFERENCES hall(id),
    slot_id INTEGER NOT NULL REFERENCES slot(id),
    event_date TEXT NOT NULL, customer_name TEXT NOT NULL, customer_phone TEXT,
    event_type TEXT, guest_count INTEGER, total_amount INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'tentative', notes TEXT, requirements TEXT, created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ux_booking_confirmed
    ON booking(hall_id, event_date, slot_id) WHERE status = 'confirmed';
  CREATE TABLE IF NOT EXISTS payment (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    booking_id INTEGER NOT NULL REFERENCES booking(id),
    amount INTEGER NOT NULL, method TEXT NOT NULL, paid_on TEXT NOT NULL, note TEXT
  );
  CREATE TABLE IF NOT EXISTS block (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    hall_id INTEGER NOT NULL REFERENCES hall(id),
    slot_id INTEGER NOT NULL REFERENCES slot(id), block_date TEXT NOT NULL, reason TEXT
  );
  CREATE TABLE IF NOT EXISTS notification_log (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    booking_id INTEGER REFERENCES booking(id),
    channel TEXT NOT NULL, template TEXT NOT NULL, status TEXT NOT NULL, sent_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS media (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    venue_id INTEGER NOT NULL REFERENCES venue(id),
    hall_id INTEGER REFERENCES hall(id),
    url TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'image',
    sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS decor_item (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    venue_id INTEGER NOT NULL REFERENCES venue(id),
    name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'decor',
    price INTEGER NOT NULL DEFAULT 0, description TEXT, image_url TEXT,
    sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pricing_rule (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    venue_id INTEGER NOT NULL REFERENCES venue(id),
    kind TEXT NOT NULL,               -- 'weekday' | 'range' | 'date'
    label TEXT, weekdays TEXT,        -- weekdays: csv of 0-6 (Sun..Sat) for kind=weekday
    start_date TEXT, end_date TEXT,   -- for kind range/date
    adj_type TEXT NOT NULL,           -- 'percent' | 'per_plate_add' | 'per_plate_set'
    adj_value DOUBLE PRECISION NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS lead (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    venue_id INTEGER NOT NULL REFERENCES venue(id),
    name TEXT NOT NULL, phone TEXT, event_date TEXT, event_type TEXT,
    guests INTEGER, hall_id INTEGER, slot_id INTEGER, message TEXT,
    status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS review (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    venue_id INTEGER NOT NULL REFERENCES venue(id),
    name TEXT NOT NULL, rating INTEGER NOT NULL, comment TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS claim_request (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    venue_id INTEGER NOT NULL REFERENCES venue(id),
    user_id INTEGER NOT NULL REFERENCES app_user(id),
    name TEXT, phone TEXT, note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected | superseded
    created_at TEXT NOT NULL, decided_at TEXT
  );
  CREATE TABLE IF NOT EXISTS session (
    token TEXT PRIMARY KEY, phone TEXT, user_id INTEGER, created_at TEXT NOT NULL,
    expires_at TEXT
  );
  CREATE TABLE IF NOT EXISTS otp (
    phone TEXT PRIMARY KEY, code TEXT NOT NULL, exp BIGINT NOT NULL
  );
`;

// Idempotent column adds for databases created before these features.
const ALTERS = `
  ALTER TABLE venue ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES app_user(id);
  ALTER TABLE venue ADD COLUMN IF NOT EXISTS slug TEXT;
  ALTER TABLE venue ADD COLUMN IF NOT EXISTS features TEXT;
  ALTER TABLE booking ADD COLUMN IF NOT EXISTS requirements TEXT;
  ALTER TABLE booking ADD COLUMN IF NOT EXISTS beo_arrival TEXT;
  ALTER TABLE booking ADD COLUMN IF NOT EXISTS beo_meal_time TEXT;
  ALTER TABLE booking ADD COLUMN IF NOT EXISTS beo_menu TEXT;
  ALTER TABLE booking ADD COLUMN IF NOT EXISTS beo_setup TEXT;
  ALTER TABLE booking ADD COLUMN IF NOT EXISTS beo_contact TEXT;
  ALTER TABLE venue ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
  ALTER TABLE venue ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
  ALTER TABLE venue ADD COLUMN IF NOT EXISTS service_charge_pct DOUBLE PRECISION;
  ALTER TABLE venue ADD COLUMN IF NOT EXISTS tax_pct DOUBLE PRECISION;
  ALTER TABLE venue ADD COLUMN IF NOT EXISTS website TEXT;
  ALTER TABLE venue ADD COLUMN IF NOT EXISTS source TEXT;
  ALTER TABLE venue ADD COLUMN IF NOT EXISTS source_ref TEXT;
  ALTER TABLE media ADD COLUMN IF NOT EXISTS placeholder INTEGER NOT NULL DEFAULT 0;
  CREATE UNIQUE INDEX IF NOT EXISTS ux_venue_source ON venue(source, source_ref) WHERE source_ref IS NOT NULL;
  ALTER TABLE session ADD COLUMN IF NOT EXISTS user_id INTEGER;
  ALTER TABLE session ADD COLUMN IF NOT EXISTS expires_at TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS ux_venue_slug ON venue(slug) WHERE slug IS NOT NULL;
  ALTER TABLE app_user ADD COLUMN IF NOT EXISTS email TEXT;
  ALTER TABLE app_user ADD COLUMN IF NOT EXISTS password_hash TEXT;
  ALTER TABLE app_user ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'owner';
  ALTER TABLE app_user ALTER COLUMN phone DROP NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS ux_app_user_email ON app_user(email) WHERE email IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS ux_claim_pending ON claim_request(venue_id, user_id) WHERE status='pending';
`;

export async function migrate() {
  await pool.query(SCHEMA);
  await pool.query(ALTERS);
  await ensureDemoOwner();
  await ensureAdmin();
  await backfillSlugs();
  await ensureVenueHalls();
}

// Any venue with no active hall can't take bookings. Give it a default "Main
// Hall" (covers banquets registered before halls were part of the form).
async function ensureVenueHalls() {
  const rows = await all(`SELECT v.id, v.capacity_max FROM venue v
    WHERE NOT EXISTS (SELECT 1 FROM hall h WHERE h.venue_id=v.id AND h.active=1)`);
  for (const v of rows)
    await run('INSERT INTO hall (venue_id,name,capacity) VALUES (?,?,?)', [v.id, 'Main Hall', v.capacity_max || null]);
}

// Give every existing venue a URL slug (for banquets created before slugs).
async function backfillSlugs() {
  const rows = await all('SELECT id, name FROM venue WHERE slug IS NULL OR slug=? ORDER BY id', ['']);
  for (const v of rows) await run('UPDATE venue SET slug=? WHERE id=?', [await uniqueSlug(v.name, v.id), v.id]);
}

// Seed a few demo photos for the demo venue (id=1) if it has none, so the
// dashboard gallery isn't empty on a fresh install. Idempotent.
async function ensureDemoMedia() {
  const v1 = await get('SELECT id FROM venue WHERE id=1');
  if (!v1) return;
  const have = Number((await get('SELECT COUNT(*) c FROM media WHERE venue_id=1'))?.c || 0);
  if (have) return;
  const now = new Date().toISOString();
  for (const [i, url] of DEMO_MEDIA.entries())
    await run('INSERT INTO media (venue_id,hall_id,url,kind,sort,created_at) VALUES (?,?,?,?,?,?)', [1, null, url, 'image', i, now]);
}

// Bootstrap/refresh the admin account from env (ADMIN_EMAIL + ADMIN_PASSWORD).
async function ensureAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const pw = process.env.ADMIN_PASSWORD;
  if (!email || !pw) return;
  const existing = await get('SELECT id FROM app_user WHERE email=?', [email]);
  const now = new Date().toISOString();
  if (!existing) await run('INSERT INTO app_user (email,name,password_hash,role,created_at) VALUES (?,?,?,?,?)', [email, 'Admin', hashPassword(pw), 'admin', now]);
  else await run('UPDATE app_user SET password_hash=?, role=? WHERE id=?', [hashPassword(pw), 'admin', existing.id]);
}

// Keep IDENTITY sequences ahead of any explicitly-inserted ids (seed uses them).
async function resyncSequences() {
  for (const t of ['app_user', 'venue', 'hall', 'slot', 'rate_plan', 'booking', 'payment', 'block', 'notification_log', 'media']) {
    await pool.query(
      `SELECT setval(pg_get_serial_sequence('${t}','id'), COALESCE((SELECT MAX(id) FROM ${t}), 1), (SELECT COUNT(*) FROM ${t}) > 0)`
    );
  }
}

// Keep the demo venue (id=1) owned by a non-admin demo OWNER, so the admin
// phone is free to act as admin. Idempotent; handles migrating an older DB
// where venue 1 was owned by what is now an admin phone.
async function ensureDemoOwner() {
  const v1 = await get('SELECT id, owner_user_id FROM venue WHERE id=1');
  if (!v1) return;
  let owner = await get('SELECT id FROM app_user WHERE phone=?', [DEMO_OWNER_PHONE]);
  let ownerId = owner?.id;
  if (!ownerId) ownerId = await insert('INSERT INTO app_user (phone,name,created_at) VALUES (?,?,?)', [DEMO_OWNER_PHONE, 'Shalimar Grand Owner', new Date().toISOString()]);
  const current = v1.owner_user_id ? await get('SELECT phone FROM app_user WHERE id=?', [v1.owner_user_id]) : null;
  if (!v1.owner_user_id || (current && current.phone === '+923001112233'))
    await run('UPDATE venue SET owner_user_id=? WHERE id=1', [ownerId]);
  await resyncSequences();
}

// ---- seed (demo data) -----------------------------------------------------
export async function seed() {
  const c = Number((await get('SELECT COUNT(*) AS c FROM venue'))?.c || 0);
  if (c > 0) return;

  const now = new Date().toISOString();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const q = (sql, args = []) => client.query(conv(sql), norm(args));

    await q('INSERT INTO app_user (id,phone,name,created_at) VALUES (1,?,?,?)', [DEMO_OWNER_PHONE, 'Shalimar Grand Owner', now]);
    await q(`INSERT INTO venue (id,owner_user_id,name,slug,city,area,address,phone,capacity_min,capacity_max,facilities)
      VALUES (1,1,?,?,?,?,?,?,?,?,?)`,
      ['Shalimar Grand', 'shalimar-grand', 'Lahore', 'Johar Town', '123 Main Boulevard, Johar Town', '+924235000000', 300, 900,
        JSON.stringify(['AC', 'Parking', 'Generator', 'Stage', 'Valet'])]);

    for (const [id, name, cap] of [[1, 'Grand Hall', 700], [2, 'Lawn', 900]])
      await q('INSERT INTO hall (id,venue_id,name,capacity) VALUES (?,1,?,?)', [id, name, cap]);

    for (const [id, code, name, s, e, sort] of [
      [1, 'lunch', 'Lunch', 1, 2, 1], [2, 'dinner', 'Dinner', 2, 3, 2], [3, 'fullday', 'Full Day', 1, 3, 3]])
      await q('INSERT INTO slot (id,venue_id,code,name,span_start,span_end,sort) VALUES (?,1,?,?,?,?,?)', [id, code, name, s, e, sort]);

    for (const [hall, ev, rate] of [
      [1, 'Walima', 2500], [1, 'Barat', 2800], [1, 'Mehndi', 2200], [1, 'Nikah', 2000],
      [2, 'Walima', 2300], [2, 'Barat', 2600], [2, 'Mehndi', 2000], [2, 'Nikah', 1800]])
      await q('INSERT INTO rate_plan (hall_id,event_type,per_head_rate) VALUES (?,?,?)', [hall, ev, rate]);

    const y = new Date().getFullYear(), m = String(new Date().getMonth() + 1).padStart(2, '0');
    const d = (day) => `${y}-${m}-${String(day).padStart(2, '0')}`;

    const bookings = [
      ['seed-1', 1, 2, d(3), 'Khan family', '+923001112233', 'Walima', 650, 1625000, 'confirmed'],
      ['seed-2', 2, 1, d(8), 'Butt family', '+923004445566', 'Mehndi', 300, 660000, 'confirmed'],
      ['seed-3', 1, 2, d(13), 'Malik family', '+923007778899', 'Barat', 450, 1260000, 'confirmed'],
      ['seed-4', 1, 1, d(15), 'Chaudhry sb', '+923002223344', 'Walima', 500, 1250000, 'confirmed'],
      ['seed-5', 2, 2, d(22), 'Sheikh family', '+923005556677', 'Barat', 400, 1040000, 'confirmed'],
      ['seed-6', 1, 2, d(5), 'Qureshi sb', '+923008889900', 'Nikah', 250, 500000, 'tentative'],
      ['seed-7', 1, 1, d(20), 'Awan family', '+923001234567', 'Mehndi', 350, 770000, 'tentative'],
      ['seed-8', 1, 2, d(26), 'Malik family', '+923007778899', 'Barat', 450, 1260000, 'confirmed'],
      ['seed-9', 1, 2, d(28), 'Tariq sb', '+923009990011', 'Walima', 600, 1500000, 'confirmed'],
    ];
    for (const b of bookings)
      await q(`INSERT INTO booking (client_uuid,venue_id,hall_id,slot_id,event_date,customer_name,customer_phone,event_type,guest_count,total_amount,status,created_at)
        VALUES (?,1,?,?,?,?,?,?,?,?,?,?)`, [b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], now]);

    await q('INSERT INTO block (hall_id,slot_id,block_date,reason) VALUES (1,3,?,?)', [d(11), 'Maintenance']);

    const today = `${y}-${m}-02`;
    for (const [bid, amt, method] of [[3, 435000, 'bank'], [8, 400000, 'cash'], [1, 625000, 'bank'], [4, 500000, 'cash'], [2, 510000, 'cash'], [9, 300000, 'bank']])
      await q('INSERT INTO payment (booking_id,amount,method,paid_on) VALUES (?,?,?,?)', [bid, amt, method, today]);

    const names = ['Rana sb', 'Ahmed family', 'Dar family', 'Gill sb', 'Noor family', 'Shah sb', 'Baig family', 'Mir sb'];
    const evs = ['Walima', 'Barat', 'Mehndi', 'Nikah'];
    const prevCounts = [5, 3, 7, 4, 6];
    let nameI = 0;
    for (let mi = 5; mi >= 1; mi--) {
      const dt = new Date(y, new Date().getMonth() - mi, 1);
      const ym = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
      const n = prevCounts[5 - mi];
      for (let k = 0; k < n; k++) {
        const day = String(3 + k * 3).padStart(2, '0');
        const hall = 1 + (k % 2), slot = 1 + (k % 2), total = 800000 + k * 80000;
        const r = await q(`INSERT INTO booking (client_uuid,venue_id,hall_id,slot_id,event_date,customer_name,customer_phone,event_type,guest_count,total_amount,status,created_at)
          VALUES (?,1,?,?,?,?,?,?,?,?,'completed',?) RETURNING id`,
          [`past-${mi}-${k}`, hall, slot, `${ym}-${day}`, names[nameI++ % names.length], '+9230000000', evs[k % evs.length], 300 + k * 40, total, now]);
        await q('INSERT INTO payment (booking_id,amount,method,paid_on) VALUES (?,?,?,?)', [r.rows[0].id, total, 'bank', `${ym}-${day}`]);
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  await resyncSequences();
}

let initDone = null;
export function ensureReady() {
  if (!initDone) initDone = (async () => { await migrate(); await seed(); await ensureDemoMedia(); })().catch((e) => { initDone = null; throw e; });
  return initDone;
}

// ---- auth / users ---------------------------------------------------------
export const newToken = () => crypto.randomUUID().replace(/-/g, '');

// Create a login session with a 1-hour expiry (slides on use). Returns the token.
export async function createSession(userId, phone) {
  const token = newToken();
  const now = Date.now();
  await run('INSERT INTO session (token,phone,user_id,created_at,expires_at) VALUES (?,?,?,?,?)',
    [token, phone, userId, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString()]);
  return token;
}

export async function findOrCreateUser(phone, name = null) {
  let u = await get('SELECT * FROM app_user WHERE phone=?', [phone]);
  if (!u) { const id = await insert('INSERT INTO app_user (phone,name,created_at) VALUES (?,?,?)', [phone, name, new Date().toISOString()]); u = await get('SELECT * FROM app_user WHERE id=?', [id]); }
  return u;
}
// Returns { user, venue } for a session token, or null if the token is invalid
// or has expired. Each successful lookup slides the 1-hour window forward.
export async function sessionContext(token) {
  if (!token) return null;
  const s = await get('SELECT user_id, phone, expires_at FROM session WHERE token=?', [token]);
  if (!s) return null;
  if (s.expires_at && Date.parse(s.expires_at) < Date.now()) {
    await run('DELETE FROM session WHERE token=?', [token]);   // expired — drop it
    return null;
  }
  const user = await get('SELECT * FROM app_user WHERE id=?', [s.user_id]);
  if (!user) return null;
  await run('UPDATE session SET expires_at=? WHERE token=?', [new Date(Date.now() + SESSION_TTL_MS).toISOString(), token]);
  const venue = await get('SELECT * FROM venue WHERE owner_user_id=? ORDER BY id LIMIT 1', [user.id]);
  return { user, venue: venue || null };
}

// Create the owner's venue during onboarding, with default slots and the halls
// the admin entered (at least one, so bookings work immediately). Returns { venueId, slug }.
export async function createVenueForUser(userId, d) {
  const slug = await uniqueSlug(d.slug || d.name);
  const halls = (Array.isArray(d.halls) ? d.halls : [])
    .map((h) => ({ name: String(h?.name || '').trim(), capacity: Number(h?.capacity) || null }))
    .filter((h) => h.name);
  if (!halls.length) halls.push({ name: 'Main Hall', capacity: d.capacity_max || null });
  const features = JSON.stringify(d.features ? sanitizeFeatures(d.features) : DEFAULT_FEATURES);
  const venueId = await withTx(async (q) => {
    const vr = await q(`INSERT INTO venue (owner_user_id,name,slug,city,area,address,phone,capacity_min,capacity_max,facilities,features,latitude,longitude)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
      [userId, d.name, slug, d.city || null, d.area || null, d.address || null, d.phone || null, d.capacity_min || null, d.capacity_max || null, JSON.stringify(d.facilities || []), features, coord(d.latitude), coord(d.longitude)]);
    const venueId = vr.rows[0].id;
    for (const [code, name, s, e, sort] of [['lunch', 'Lunch', 1, 2, 1], ['dinner', 'Dinner', 2, 3, 2], ['fullday', 'Full Day', 1, 3, 3]])
      await q('INSERT INTO slot (venue_id,code,name,span_start,span_end,sort) VALUES (?,?,?,?,?,?)', [venueId, code, name, s, e, sort]);
    for (const h of halls)
      await q('INSERT INTO hall (venue_id,name,capacity) VALUES (?,?,?)', [venueId, h.name, h.capacity]);
    return venueId;
  });
  return { venueId, slug };
}

// ---- admin ----------------------------------------------------------------
// Admin registers a banquet for an owner (by phone) and hands it over.
export async function registerBanquet(ownerPhone, ownerName, venueData) {
  const owner = await findOrCreateUser(ownerPhone, ownerName);
  if (ownerName && owner.name !== ownerName) await run('UPDATE app_user SET name=? WHERE id=?', [ownerName, owner.id]);
  const existing = await get('SELECT id FROM venue WHERE owner_user_id=?', [owner.id]);
  if (existing) { const e = new Error('OWNER_HAS_VENUE'); e.code = 'OWNER_HAS_VENUE'; throw e; }
  const { venueId, slug } = await createVenueForUser(owner.id, venueData);
  return { venueId, slug, ownerId: owner.id, ownerPhone };
}

// Admin (master) sets which optional features a banquet's dashboard shows.
export async function updateVenueFeatures(venueId, list) {
  await run('UPDATE venue SET features=? WHERE id=?', [JSON.stringify(sanitizeFeatures(list)), venueId]);
  return sanitizeFeatures(list);
}

// Public lookup for an owner's branded login page: resolve a slug to minimal,
// non-sensitive venue info. Returns null if no banquet uses that slug.
export async function publicVenueBySlug(slug) {
  const v = await get('SELECT id, owner_user_id, name, slug, city, area, address, phone, website, capacity_min, capacity_max, facilities, latitude, longitude FROM venue WHERE slug=?', [String(slug || '').toLowerCase()]);
  if (!v) return null;
  const id = v.id;
  v.claimable = !v.owner_user_id;   // an ownerless directory listing can be claimed
  v.verified = !!v.owner_user_id;   // a claimed/registered venue is owner-verified
  v.facilities = JSON.parse(v.facilities || '[]');
  v.halls = await all('SELECT id, name, capacity FROM hall WHERE venue_id=? AND active=1 ORDER BY id', [id]);
  v.slots = await all('SELECT id, name FROM slot WHERE venue_id=? AND active=1 ORDER BY sort', [id]);
  v.hall_prices = await all('SELECT hp.hall_id, hp.slot_id, hp.price FROM hall_price hp JOIN hall h ON h.id=hp.hall_id WHERE h.venue_id=?', [id]);
  v.pricing = await all('SELECT kind, label, weekdays, start_date, end_date, adj_type, adj_value FROM pricing_rule WHERE venue_id=? AND active=1 ORDER BY sort, id', [id]);
  v.decor = await all('SELECT name, category, price, image_url FROM decor_item WHERE venue_id=? AND active=1 ORDER BY sort, id', [id]);
  v.media = await all('SELECT url, kind, hall_id FROM media WHERE venue_id=? ORDER BY sort, id', [id]);
  v.reviews = await all('SELECT name, rating, comment, created_at FROM review WHERE venue_id=? ORDER BY id DESC LIMIT 50', [id]);
  const rs = await get('SELECT COUNT(*) c, COALESCE(AVG(rating),0) a FROM review WHERE venue_id=?', [id]);
  v.rating = Math.round(Number(rs.a) * 10) / 10;
  v.rating_count = Number(rs.c);
  delete v.id;              // don't expose internal id to the public page
  delete v.owner_user_id;   // nor who owns it
  return v;
}

// ---- owner-claim flow ------------------------------------------------------
// A directory listing (owner_user_id NULL) can be claimed by its real owner.
// The claimant verifies their phone via OTP (so they have a session + user),
// then submits a claim; the admin reviews and approves, which hands the venue
// over to that user. Safe handover: admin-reviewed, never auto-assigned.

// Submit (or refresh) a pending claim for a venue by slug, by the signed-in
// user. Returns null if the venue is missing, or an {error} / {id} result.
export async function createClaim(slug, userId, d) {
  const v = await get('SELECT id, name, owner_user_id FROM venue WHERE slug=?', [String(slug || '').toLowerCase()]);
  if (!v) return null;
  if (v.owner_user_id) return { error: 'ALREADY_OWNED' };
  const name = String(d.name || '').trim();
  if (!name) return { error: 'NAME_REQUIRED' };
  const phone = String(d.phone || '').trim() || null;
  const note = String(d.note || '').trim() || null;
  const now = new Date().toISOString();
  // Keep the claimant's display name on their user record if it's blank.
  await run('UPDATE app_user SET name=COALESCE(NULLIF(name,?),?) WHERE id=?', ['', name, userId]);
  const existing = await get("SELECT id FROM claim_request WHERE venue_id=? AND user_id=? AND status='pending'", [v.id, userId]);
  if (existing) {
    await run('UPDATE claim_request SET name=?, phone=?, note=?, created_at=? WHERE id=?', [name, phone, note, now, existing.id]);
    return { id: existing.id, resubmitted: true };
  }
  const id = await insert('INSERT INTO claim_request (venue_id,user_id,name,phone,note,status,created_at) VALUES (?,?,?,?,?,?,?)',
    [v.id, userId, name, phone, note, 'pending', now]);
  return { id };
}

// The signed-in user's own claims (any status), newest first — lets the owner
// portal show "your claim is under review / approved / declined".
export async function myClaims(userId) {
  return all(`SELECT c.id, c.status, c.created_at, c.decided_at, v.name AS venue_name, v.slug
    FROM claim_request c JOIN venue v ON v.id=c.venue_id
    WHERE c.user_id=? ORDER BY c.id DESC`, [userId]);
}

// Admin: all pending claims awaiting review, with the venue and claimant.
export async function listClaimRequests() {
  return all(`SELECT c.id, c.venue_id, c.name, c.phone, c.note, c.status, c.created_at,
      v.name AS venue_name, v.slug, v.city, v.area, v.address,
      (v.owner_user_id IS NOT NULL) AS already_owned,
      u.name AS claimant_name, u.phone AS claimant_phone
    FROM claim_request c JOIN venue v ON v.id=c.venue_id JOIN app_user u ON u.id=c.user_id
    WHERE c.status='pending' ORDER BY c.created_at`);
}

// Admin: approve a claim — hand the venue to the claimant (only if still
// ownerless), enable default features, and supersede any rival pending claims.
export async function approveClaim(claimId) {
  const c = await get('SELECT * FROM claim_request WHERE id=?', [claimId]);
  if (!c) return { error: 'NOT_FOUND' };
  if (c.status !== 'pending') return { error: 'NOT_PENDING' };
  const v = await get('SELECT id, owner_user_id FROM venue WHERE id=?', [c.venue_id]);
  if (!v) return { error: 'NOT_FOUND' };
  const now = new Date().toISOString();
  if (v.owner_user_id) {   // someone already owns it — can't hand it over twice
    await run("UPDATE claim_request SET status='rejected', decided_at=? WHERE id=?", [now, claimId]);
    return { error: 'ALREADY_OWNED' };
  }
  await withTx(async (q) => {
    await q('UPDATE venue SET owner_user_id=?, features=COALESCE(features,?) WHERE id=?', [c.user_id, JSON.stringify(DEFAULT_FEATURES), c.venue_id]);
    await q("UPDATE claim_request SET status='approved', decided_at=? WHERE id=?", [now, claimId]);
    await q("UPDATE claim_request SET status='superseded', decided_at=? WHERE venue_id=? AND status='pending' AND id<>?", [now, c.venue_id, claimId]);
  });
  return { ok: true, venue_id: c.venue_id, user_id: c.user_id };
}

// Admin: decline a pending claim.
export async function rejectClaim(claimId) {
  const c = await get('SELECT id, status FROM claim_request WHERE id=?', [claimId]);
  if (!c) return { error: 'NOT_FOUND' };
  if (c.status !== 'pending') return { error: 'NOT_PENDING' };
  await run("UPDATE claim_request SET status='rejected', decided_at=? WHERE id=?", [new Date().toISOString(), claimId]);
  return { ok: true };
}

// Record a public review for a venue by slug. Returns the review id.
export async function createReview(slug, d) {
  const v = await get('SELECT id FROM venue WHERE slug=?', [String(slug || '').toLowerCase()]);
  if (!v) return null;
  const name = String(d.name || '').trim();
  const rating = Math.round(Number(d.rating) || 0);
  if (!name) return { error: 'NAME_REQUIRED' };
  if (!(rating >= 1 && rating <= 5)) return { error: 'BAD_RATING' };
  return {
    id: await insert('INSERT INTO review (venue_id,name,rating,comment,created_at) VALUES (?,?,?,?,?)',
      [v.id, name, rating, String(d.comment || '').trim() || null, new Date().toISOString()]),
  };
}

// Record a public enquiry (lead) for a venue by slug. Returns the lead id.
export async function createLead(slug, d) {
  const v = await get('SELECT id FROM venue WHERE slug=?', [String(slug || '').toLowerCase()]);
  if (!v) return null;
  const name = String(d.name || '').trim();
  if (!name) return { error: 'NAME_REQUIRED' };
  return {
    id: await insert(`INSERT INTO lead (venue_id,name,phone,event_date,event_type,guests,hall_id,slot_id,message,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [v.id, name, String(d.phone || '').trim() || null, d.event_date || null, d.event_type || null,
        Number(d.guests) || null, Number(d.hall_id) || null, Number(d.slot_id) || null, String(d.message || '').trim() || null, new Date().toISOString()]),
  };
}

// Send one enquiry to many venues at once (consumer shortlist → multi-enquiry).
// Creates a lead per slug. Returns { sent, failed } or an {error}.
export async function createLeadsBulk(slugs, d) {
  const list = Array.isArray(slugs)
    ? [...new Set(slugs.map((s) => String(s || '').toLowerCase().trim()).filter(Boolean))]
    : [];
  if (!String(d.name || '').trim()) return { error: 'NAME_REQUIRED' };
  if (!list.length) return { error: 'NO_VENUES' };
  let sent = 0; const failed = [];
  for (const slug of list) {
    const r = await createLead(slug, d);
    if (r && r.id) sent++; else failed.push(slug);
  }
  return { sent, failed };
}

// Admin email+password login. Returns the admin user or null.
export async function adminLogin(email, password) {
  const u = await get('SELECT * FROM app_user WHERE email=?', [String(email || '').trim().toLowerCase()]);
  if (!u || u.role !== 'admin' || !verifyPassword(password, u.password_hash)) return null;
  return u;
}

export async function listVenuesForAdmin() {
  const rows = await all(`SELECT v.id, v.name, v.slug, v.city, v.area, v.address, v.phone, v.website, v.capacity_min, v.capacity_max, v.features,
      (v.owner_user_id IS NOT NULL) AS verified, u.phone AS owner_phone, u.name AS owner_name,
      (SELECT COUNT(*) FROM hall h WHERE h.venue_id=v.id AND h.active=1) AS hall_count,
      (SELECT COUNT(*) FROM booking b WHERE b.venue_id=v.id AND b.status<>'cancelled') AS booking_count,
      (SELECT COALESCE(json_agg(url ORDER BY sort, id), '[]')
         FROM (SELECT url, sort, id FROM media m WHERE m.venue_id=v.id AND m.kind<>'video' ORDER BY sort, id LIMIT 8) t) AS photos
    FROM venue v LEFT JOIN app_user u ON u.id=v.owner_user_id ORDER BY v.id`);
  return rows.map((r) => ({ ...r, features: parseFeatures(r.features), photos: r.photos || [] }));
}

// ---- PUBLIC consumer directory (customer-facing app/web) -------------------
// A photo subquery reused by the consumer list endpoints: up to 6 image URLs
// per venue, newest-sort first, as a JSON array.
const PUBLIC_PHOTOS = `(SELECT COALESCE(json_agg(url ORDER BY sort, id), '[]')
    FROM (SELECT url, sort, id FROM media m WHERE m.venue_id=v.id AND m.kind<>'video' ORDER BY sort, id LIMIT 6) t)`;

// Is a venue bookable on a date? A venue is 'available' if at least one active
// hall has at least one active slot with no confirmed booking and no block
// overlapping that date; otherwise 'booked'. Only meaningful for owner-managed
// venues — ownerless directory listings have no calendar, so callers pass
// 'unknown' for those. Overlap uses the slot span (span_start/span_end).
export async function venueAvailabilityOnDate(venueId, date) {
  const free = await get(`
    SELECT 1 FROM hall h JOIN slot s ON s.venue_id=h.venue_id
    WHERE h.venue_id=? AND h.active=1 AND s.active=1
      AND NOT EXISTS (
        SELECT 1 FROM booking b JOIN slot bs ON bs.id=b.slot_id
        WHERE b.hall_id=h.id AND b.event_date=? AND b.status='confirmed'
          AND bs.span_start < s.span_end AND bs.span_end > s.span_start)
      AND NOT EXISTS (
        SELECT 1 FROM block bl JOIN slot ks ON ks.id=bl.slot_id
        WHERE bl.hall_id=h.id AND bl.block_date=? AND ks.span_start < s.span_end AND ks.span_end > s.span_start)
    LIMIT 1`, [venueId, date, date]);
  return free ? 'available' : 'booked';
}

// Paginated, searchable, FILTERED list of public venues. Besides q/area it
// supports consumer filters: guests (capacity_max fits), verified-only,
// facilities (must contain all), budget (min/max on the venue's cheapest
// hall_price = `price_from`), and sort='rating'. Numeric/facility filters use
// "keep-unknown" semantics — a venue with no price/capacity/facilities data is
// still shown (so the directory never empties), while venues that DO have data
// (owner-claimed) are matched against the filter. Each item carries price_from
// + rating for the card. When `date` is given, items get an `availability`.
// Returns { items, total, page, pages }.
export async function listPublicVenues({
  q = '', area = '', page = 1, limit = 24, date = '',
  guests, minBudget, maxBudget, verified, facilities, sort,
} = {}) {
  const inner = ['v.slug IS NOT NULL'];
  const args = [];
  if (area) { inner.push('v.area = ?'); args.push(area); }
  if (q) { inner.push('LOWER(v.name) LIKE ?'); args.push('%' + String(q).toLowerCase().trim() + '%'); }
  if (verified === true || verified === 'true' || verified === '1') inner.push('v.owner_user_id IS NOT NULL');
  const g = Number(guests);
  if (Number.isFinite(g) && g > 0) { inner.push('(v.capacity_max IS NULL OR v.capacity_max >= ?)'); args.push(Math.round(g)); }
  const facs = (Array.isArray(facilities) ? facilities : String(facilities || '').split(','))
    .map((f) => String(f).trim()).filter(Boolean);
  if (facs.length) {
    // Treat null/''/'[]' facilities as unknown (show); otherwise require all.
    inner.push("(COALESCE(NULLIF(v.facilities,''),'[]')::jsonb = '[]'::jsonb OR COALESCE(NULLIF(v.facilities,''),'[]')::jsonb @> ?::jsonb)");
    args.push(JSON.stringify(facs));
  }
  const innerWhere = inner.join(' AND ');

  const outer = []; const outerArgs = [];
  const minB = Number(minBudget), maxB = Number(maxBudget);
  if (Number.isFinite(minB) && minB > 0) { outer.push('(price_from IS NULL OR price_from >= ?)'); outerArgs.push(Math.round(minB)); }
  if (Number.isFinite(maxB) && maxB > 0) { outer.push('(price_from IS NULL OR price_from <= ?)'); outerArgs.push(Math.round(maxB)); }
  const outerWhere = outer.length ? 'WHERE ' + outer.join(' AND ') : '';

  const lim = Math.min(60, Math.max(1, Number(limit) || 24));
  const pg = Math.max(1, Number(page) || 1);
  const orderBy = sort === 'rating' ? 'rating DESC NULLS LAST, photo_count DESC, id' : 'photo_count DESC, id';

  const sub = `(
      SELECT v.id, v.name, v.slug, v.city, v.area, v.address, v.phone, v.capacity_min, v.capacity_max, v.latitude, v.longitude,
        (v.owner_user_id IS NOT NULL) AS verified,
        (SELECT MIN(hp.price) FROM hall_price hp JOIN hall h2 ON h2.id=hp.hall_id WHERE h2.venue_id=v.id AND hp.price>0) AS price_from,
        (SELECT COUNT(*) FROM review r WHERE r.venue_id=v.id) AS rating_count,
        (SELECT ROUND(AVG(rating)::numeric,1) FROM review r WHERE r.venue_id=v.id) AS rating,
        (SELECT COUNT(*) FROM media m WHERE m.venue_id=v.id AND m.kind<>'video') AS photo_count,
        ${PUBLIC_PHOTOS} AS photos
      FROM venue v WHERE ${innerWhere}
    ) t`;

  // Count: skip the heavy subqueries unless a budget filter needs price_from.
  const total = Number((outer.length
    ? await get(`SELECT COUNT(*) c FROM (SELECT (SELECT MIN(hp.price) FROM hall_price hp JOIN hall h2 ON h2.id=hp.hall_id WHERE h2.venue_id=v.id AND hp.price>0) AS price_from FROM venue v WHERE ${innerWhere}) t ${outerWhere}`, [...args, ...outerArgs])
    : await get(`SELECT COUNT(*) c FROM venue v WHERE ${innerWhere}`, args)).c);

  const rows = await all(`SELECT * FROM ${sub} ${outerWhere} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...args, ...outerArgs, lim, (pg - 1) * lim]);
  const items = rows.map((r) => {
    const { photo_count, ...rest } = r;
    return { ...rest, photos: r.photos || [],
      price_from: r.price_from != null ? Number(r.price_from) : null,
      rating: r.rating != null ? Number(r.rating) : 0, rating_count: Number(r.rating_count || 0) };
  });
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : null;
  if (d) for (const it of items) it.availability = it.verified ? await venueAvailabilityOnDate(it.id, d) : 'unknown';
  return { items, total, page: pg, pages: Math.max(1, Math.ceil(total / lim)) };
}

// Distinct areas with venue counts, for the consumer area filter.
export async function listPublicAreas() {
  return all(`SELECT area, COUNT(*)::int AS count FROM venue
    WHERE area IS NOT NULL AND area<>'' AND slug IS NOT NULL GROUP BY area ORDER BY count DESC, area`);
}

// Venues within `radiusKm` of a point, nearest first, with the distance in km.
// Uses the haversine formula in SQL on the stored lat/lng (Plus-Code-derived).
export async function listVenuesNear({ lat, lng, radiusKm = 5, limit = 60 } = {}) {
  const la = Number(lat), lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return { items: [] };
  const rad = Math.min(50, Math.max(0.5, Number(radiusKm) || 5));
  const lim = Math.min(120, Math.max(1, Number(limit) || 60));
  const rows = await all(
    `SELECT id, name, slug, city, area, address, phone, latitude, longitude, verified, photos, dist FROM (
       SELECT v.id, v.name, v.slug, v.city, v.area, v.address, v.phone, v.latitude, v.longitude,
         (v.owner_user_id IS NOT NULL) AS verified, ${PUBLIC_PHOTOS} AS photos,
         (6371 * acos(LEAST(1, cos(radians(?)) * cos(radians(v.latitude)) * cos(radians(v.longitude) - radians(?)) + sin(radians(?)) * sin(radians(v.latitude))))) AS dist
       FROM venue v
       WHERE v.slug IS NOT NULL AND v.latitude IS NOT NULL
     ) t
     WHERE dist <= ? ORDER BY dist LIMIT ?`, [la, lo, la, rad, lim]);
  return { items: rows.map((r) => ({ ...r, photos: r.photos || [], dist: Math.round(Number(r.dist) * 10) / 10 })), center: { lat: la, lng: lo }, radiusKm: rad };
}

// Venues that have at least one photo, for the full-screen reel feed. Day-one
// these drive photo "auto-reels" (Ken-Burns) until real videos are uploaded.
export async function listReelVenues({ page = 1, limit = 15 } = {}) {
  const lim = Math.min(30, Math.max(1, Number(limit) || 15));
  const pg = Math.max(1, Number(page) || 1);
  const rows = await all(
    `SELECT v.id, v.name, v.slug, v.area, v.city, v.address, v.phone,
            (v.owner_user_id IS NOT NULL) AS verified, ${PUBLIC_PHOTOS} AS photos
       FROM venue v
      WHERE v.slug IS NOT NULL AND EXISTS (SELECT 1 FROM media m WHERE m.venue_id=v.id AND m.kind<>'video')
      ORDER BY v.id LIMIT ? OFFSET ?`, [lim, (pg - 1) * lim]);
  return { items: rows.map((r) => ({ ...r, photos: r.photos || [] })), page: pg };
}

// ---- views ----------------------------------------------------------------
export async function bookingView(b) {
  const paid = Number((await get('SELECT COALESCE(SUM(amount),0) AS s FROM payment WHERE booking_id=?', [b.id]))?.s || 0);
  const hall = await get('SELECT name FROM hall WHERE id=?', [b.hall_id]);
  const slot = await get('SELECT name,code FROM slot WHERE id=?', [b.slot_id]);
  return { ...b, hall_name: hall?.name, slot_name: slot?.name, slot_code: slot?.code, paid, balance: Number(b.total_amount) - paid };
}
// Compute the dashboard alert feed for a venue: today's/tomorrow's events,
// tentative bookings awaiting confirmation, and confirmed bookings still
// carrying a balance. Each alert carries the customer phone so the UI can offer
// one-tap WhatsApp/SMS. Severity drives the colour. Capped and newest-first.
export async function venueAlerts(venueId) {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const out = [];
  const ev = async (date) => all(`SELECT b.id, b.customer_name, b.customer_phone, b.event_type, b.event_date, h.name AS hall_name
      FROM booking b JOIN hall h ON h.id=b.hall_id
      WHERE b.venue_id=? AND b.event_date=? AND b.status IN ('confirmed','completed') ORDER BY b.slot_id`, [venueId, date]);
  for (const b of await ev(today))
    out.push({ type: 'event_today', severity: 'alert', title: 'Event today', text: `${b.customer_name} · ${b.hall_name}${b.event_type ? ' · ' + b.event_type : ''}`, booking_id: b.id, phone: b.customer_phone, name: b.customer_name, date: b.event_date, hall: b.hall_name });
  for (const b of await ev(tomorrow))
    out.push({ type: 'event_tomorrow', severity: 'info', title: 'Event tomorrow', text: `${b.customer_name} · ${b.hall_name}${b.event_type ? ' · ' + b.event_type : ''}`, booking_id: b.id, phone: b.customer_phone, name: b.customer_name, date: b.event_date, hall: b.hall_name });
  const tents = await all(`SELECT id, customer_name, customer_phone, event_date FROM booking
      WHERE venue_id=? AND status='tentative' AND event_date>=? ORDER BY event_date LIMIT 10`, [venueId, today]);
  for (const b of tents)
    out.push({ type: 'tentative', severity: 'warn', title: 'Tentative — needs confirmation', text: `${b.customer_name} · ${b.event_date}`, booking_id: b.id, phone: b.customer_phone, name: b.customer_name, date: b.event_date });
  const outs = (await all(`SELECT b.id, b.customer_name, b.customer_phone, b.event_date,
      (b.total_amount - COALESCE((SELECT SUM(amount) FROM payment p WHERE p.booking_id=b.id),0)) AS bal
      FROM booking b WHERE b.venue_id=? AND b.status='confirmed'`, [venueId]))
    .filter((b) => Number(b.bal) > 0).sort((a, b) => a.event_date.localeCompare(b.event_date)).slice(0, 10);
  for (const b of outs)
    out.push({ type: 'balance', severity: 'warn', title: 'Payment pending', text: `${b.customer_name} · balance due`, booking_id: b.id, phone: b.customer_phone, name: b.customer_name, date: b.event_date, amount: Number(b.bal) });
  const leads = await all(`SELECT id, name, phone, event_date, event_type, created_at FROM lead
      WHERE venue_id=? AND status='new' ORDER BY created_at DESC LIMIT 10`, [venueId]);
  for (const l of leads)
    out.push({ type: 'lead', severity: 'alert', title: 'New enquiry', text: `${l.name}${l.event_type ? ' · ' + l.event_type : ''}${l.event_date ? ' · ' + l.event_date : ''}`, lead_id: l.id, phone: l.phone, name: l.name, date: l.event_date || (l.created_at || '').slice(0, 10) });
  const rank = { alert: 0, warn: 1, info: 2 };
  return out.sort((a, b) => (rank[a.severity] - rank[b.severity]) || a.date.localeCompare(b.date)).slice(0, 20);
}
export async function logNotification(bookingId, template) {
  await run('INSERT INTO notification_log (booking_id,channel,template,status,sent_at) VALUES (?,?,?,?,?)',
    [bookingId, 'whatsapp', template, 'sent', new Date().toISOString()]);
}

// ---- double-booking core --------------------------------------------------
async function _conflict(getter, hallId, dateISO, slotId, excludeBookingId = null) {
  const slot = await getter('SELECT span_start, span_end FROM slot WHERE id=?', [slotId]);
  if (!slot) return null;
  const clash = await getter(`
    SELECT b.id, b.customer_name, b.event_type, s.name AS slot_name
    FROM booking b JOIN slot s ON s.id = b.slot_id
    WHERE b.hall_id = ? AND b.event_date = ? AND b.status = 'confirmed'
      AND (?::int IS NULL OR b.id <> ?) AND s.span_start < ? AND s.span_end > ? LIMIT 1
  `, [hallId, dateISO, excludeBookingId, excludeBookingId, slot.span_end, slot.span_start]);
  if (clash) return { type: 'booking', ...clash };
  const blocked = await getter(`
    SELECT bl.id, bl.reason, s.name AS slot_name
    FROM block bl JOIN slot s ON s.id = bl.slot_id
    WHERE bl.hall_id = ? AND bl.block_date = ? AND s.span_start < ? AND s.span_end > ? LIMIT 1
  `, [hallId, dateISO, slot.span_end, slot.span_start]);
  if (blocked) return { type: 'block', ...blocked };
  return null;
}
export const findConflict = (hallId, dateISO, slotId, excludeBookingId = null) =>
  _conflict(get, hallId, dateISO, slotId, excludeBookingId);
export const findConflictTx = (q, hallId, dateISO, slotId, excludeBookingId = null) =>
  _conflict((sql, args) => q(sql, args).then((r) => r.rows[0]), hallId, dateISO, slotId, excludeBookingId);

// A tentative ("hold") booking overlapping this slot. Soft occupancy: it shows
// in the day view and we warn about it, but it never hard-blocks a confirmation
// the way a confirmed booking or a block does.
async function _hold(getter, hallId, dateISO, slotId, excludeBookingId = null) {
  const slot = await getter('SELECT span_start, span_end FROM slot WHERE id=?', [slotId]);
  if (!slot) return null;
  const h = await getter(`
    SELECT b.id, b.customer_name, b.event_type, s.name AS slot_name
    FROM booking b JOIN slot s ON s.id = b.slot_id
    WHERE b.hall_id = ? AND b.event_date = ? AND b.status = 'tentative'
      AND (?::int IS NULL OR b.id <> ?) AND s.span_start < ? AND s.span_end > ? LIMIT 1
  `, [hallId, dateISO, excludeBookingId, excludeBookingId, slot.span_end, slot.span_start]);
  return h ? { type: 'hold', ...h } : null;
}
export const findHold = (hallId, dateISO, slotId, excludeBookingId = null) =>
  _hold(get, hallId, dateISO, slotId, excludeBookingId);

// Transaction helper for the confirm/create race-safe path.
export async function withTx(fn) {
  const client = await pool.connect();
  const q = (sql, args = []) => client.query(conv(sql), norm(args));
  try {
    await client.query('BEGIN');
    const result = await fn(q);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
