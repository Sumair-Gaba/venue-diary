// Venue Diary — database layer (SQLite via Node's built-in node:sqlite).
// Dev uses SQLite for zero-install local runs. The double-booking rule is
// enforced in a transaction + a partial unique index as a backstop.
// Production (per TECHNICAL_PLAN.md): PostgreSQL + EXCLUDE constraint.

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'venue.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export const FACILITIES = ['AC', 'Parking', 'Generator', 'Bridal room', 'Separate halls', 'Valet', 'Stage', 'DJ allowed', 'Outside catering'];

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS venue (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT, area TEXT,
      address TEXT, phone TEXT, capacity_min INTEGER, capacity_max INTEGER,
      facilities TEXT DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS hall (
      id INTEGER PRIMARY KEY, venue_id INTEGER NOT NULL REFERENCES venue(id),
      name TEXT NOT NULL, capacity INTEGER, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS slot (
      id INTEGER PRIMARY KEY, venue_id INTEGER NOT NULL REFERENCES venue(id),
      code TEXT NOT NULL, name TEXT NOT NULL,
      span_start INTEGER NOT NULL, span_end INTEGER NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS rate_plan (
      id INTEGER PRIMARY KEY, hall_id INTEGER NOT NULL REFERENCES hall(id),
      event_type TEXT NOT NULL, per_head_rate INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS booking (
      id INTEGER PRIMARY KEY, client_uuid TEXT UNIQUE,
      venue_id INTEGER NOT NULL REFERENCES venue(id),
      hall_id INTEGER NOT NULL REFERENCES hall(id),
      slot_id INTEGER NOT NULL REFERENCES slot(id),
      event_date TEXT NOT NULL, customer_name TEXT NOT NULL, customer_phone TEXT,
      event_type TEXT, guest_count INTEGER, total_amount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'tentative', notes TEXT, created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_booking_confirmed
      ON booking(hall_id, event_date, slot_id) WHERE status = 'confirmed';
    CREATE TABLE IF NOT EXISTS payment (
      id INTEGER PRIMARY KEY, booking_id INTEGER NOT NULL REFERENCES booking(id),
      amount INTEGER NOT NULL, method TEXT NOT NULL, paid_on TEXT NOT NULL, note TEXT
    );
    CREATE TABLE IF NOT EXISTS block (
      id INTEGER PRIMARY KEY, hall_id INTEGER NOT NULL REFERENCES hall(id),
      slot_id INTEGER NOT NULL REFERENCES slot(id), block_date TEXT NOT NULL, reason TEXT
    );
    CREATE TABLE IF NOT EXISTS notification_log (
      id INTEGER PRIMARY KEY, booking_id INTEGER REFERENCES booking(id),
      channel TEXT NOT NULL, template TEXT NOT NULL, status TEXT NOT NULL, sent_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session (
      token TEXT PRIMARY KEY, phone TEXT, created_at TEXT NOT NULL
    );
  `);
}

function seed() {
  if (db.prepare('SELECT COUNT(*) AS c FROM venue').get().c > 0) return;
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO venue (id,name,city,area,address,phone,capacity_min,capacity_max,facilities)
      VALUES (1,?,?,?,?,?,?,?,?)`).run('Shalimar Grand', 'Lahore', 'Johar Town',
      '123 Main Boulevard, Johar Town', '+924235000000', 300, 900,
      JSON.stringify(['AC', 'Parking', 'Generator', 'Stage', 'Valet']));

    for (const [id, name, cap] of [[1, 'Grand Hall', 700], [2, 'Lawn', 900]])
      db.prepare('INSERT INTO hall (id,venue_id,name,capacity) VALUES (?,1,?,?)').run(id, name, cap);

    for (const [id, code, name, s, e, sort] of [
      [1, 'lunch', 'Lunch', 1, 2, 1], [2, 'dinner', 'Dinner', 2, 3, 2], [3, 'fullday', 'Full Day', 1, 3, 3]])
      db.prepare('INSERT INTO slot (id,venue_id,code,name,span_start,span_end,sort) VALUES (?,1,?,?,?,?,?)').run(id, code, name, s, e, sort);

    for (const [hall, ev, rate] of [
      [1, 'Walima', 2500], [1, 'Barat', 2800], [1, 'Mehndi', 2200], [1, 'Nikah', 2000],
      [2, 'Walima', 2300], [2, 'Barat', 2600], [2, 'Mehndi', 2000], [2, 'Nikah', 1800]])
      db.prepare('INSERT INTO rate_plan (hall_id,event_type,per_head_rate) VALUES (?,?,?)').run(hall, ev, rate);

    const now = new Date().toISOString();
    const y = new Date().getFullYear(), m = String(new Date().getMonth() + 1).padStart(2, '0');
    const d = (day) => `${y}-${m}-${String(day).padStart(2, '0')}`;

    const bookings = [
      ['seed-1', 1, 2, d(3),  'Khan family',   '+923001112233', 'Walima', 650, 1625000, 'confirmed'],
      ['seed-2', 2, 1, d(8),  'Butt family',   '+923004445566', 'Mehndi', 300, 660000,  'confirmed'],
      ['seed-3', 1, 2, d(13), 'Malik family',  '+923007778899', 'Barat',  450, 1260000, 'confirmed'],
      ['seed-4', 1, 1, d(15), 'Chaudhry sb',   '+923002223344', 'Walima', 500, 1250000, 'confirmed'],
      ['seed-5', 2, 2, d(22), 'Sheikh family', '+923005556677', 'Barat',  400, 1040000, 'confirmed'],
      ['seed-6', 1, 2, d(5),  'Qureshi sb',    '+923008889900', 'Nikah',  250, 500000,  'tentative'],
      ['seed-7', 1, 1, d(20), 'Awan family',   '+923001234567', 'Mehndi', 350, 770000,  'tentative'],
      ['seed-8', 1, 2, d(26), 'Malik family',  '+923007778899', 'Barat',  450, 1260000, 'confirmed'],
      ['seed-9', 1, 2, d(28), 'Tariq sb',      '+923009990011', 'Walima', 600, 1500000, 'confirmed'],
    ];
    for (const b of bookings)
      db.prepare(`INSERT INTO booking (client_uuid,venue_id,hall_id,slot_id,event_date,customer_name,customer_phone,event_type,guest_count,total_amount,status,created_at)
        VALUES (?,1,?,?,?,?,?,?,?,?,?,?)`).run(b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], now);

    db.prepare('INSERT INTO block (hall_id,slot_id,block_date,reason) VALUES (1,3,?,?)').run(d(11), 'Maintenance');

    const today = `${y}-${m}-02`;
    for (const [bid, amt, method] of [[3, 435000, 'bank'], [8, 400000, 'cash'], [1, 625000, 'bank'], [4, 500000, 'cash'], [2, 510000, 'cash'], [9, 300000, 'bank']])
      db.prepare('INSERT INTO payment (booking_id,amount,method,paid_on) VALUES (?,?,?,?)').run(bid, amt, method, today);

    // Past completed bookings (fully paid) for a realistic 6-month trend
    const names = ['Rana sb', 'Ahmed family', 'Dar family', 'Gill sb', 'Noor family', 'Shah sb', 'Baig family', 'Mir sb'];
    const evs = ['Walima', 'Barat', 'Mehndi', 'Nikah'];
    const prevCounts = [5, 3, 7, 4, 6]; // 5,4,3,2,1 months ago
    let nameI = 0;
    for (let mi = 5; mi >= 1; mi--) {
      const dt = new Date(y, new Date().getMonth() - mi, 1);
      const ym = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
      const n = prevCounts[5 - mi];
      for (let k = 0; k < n; k++) {
        const day = String(3 + k * 3).padStart(2, '0');
        const hall = 1 + (k % 2), slot = 1 + (k % 2), total = 800000 + k * 80000;
        const info = db.prepare(`INSERT INTO booking (client_uuid,venue_id,hall_id,slot_id,event_date,customer_name,customer_phone,event_type,guest_count,total_amount,status,created_at)
          VALUES (?,1,?,?,?,?,?,?,?,?,'completed',?)`).run(`past-${mi}-${k}`, hall, slot, `${ym}-${day}`,
          names[nameI++ % names.length], '+9230000000', evs[k % evs.length], 300 + k * 40, total, now);
        db.prepare('INSERT INTO payment (booking_id,amount,method,paid_on) VALUES (?,?,?,?)').run(info.lastInsertRowid, total, 'bank', `${ym}-${day}`);
      }
    }

    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---- double-booking core --------------------------------------------------
export function findConflict(hallId, dateISO, slotId, excludeBookingId = null) {
  const slot = db.prepare('SELECT span_start, span_end FROM slot WHERE id=?').get(slotId);
  if (!slot) return null;
  const clash = db.prepare(`
    SELECT b.id, b.customer_name, b.event_type, s.name AS slot_name
    FROM booking b JOIN slot s ON s.id = b.slot_id
    WHERE b.hall_id = ? AND b.event_date = ? AND b.status = 'confirmed'
      AND (? IS NULL OR b.id <> ?) AND s.span_start < ? AND s.span_end > ? LIMIT 1
  `).get(hallId, dateISO, excludeBookingId, excludeBookingId, slot.span_end, slot.span_start);
  if (clash) return { type: 'booking', ...clash };
  const blocked = db.prepare(`
    SELECT bl.id, bl.reason, s.name AS slot_name
    FROM block bl JOIN slot s ON s.id = bl.slot_id
    WHERE bl.hall_id = ? AND bl.block_date = ? AND s.span_start < ? AND s.span_end > ? LIMIT 1
  `).get(hallId, dateISO, slot.span_end, slot.span_start);
  if (blocked) return { type: 'block', ...blocked };
  return null;
}

migrate();
if (process.argv.includes('--reseed')) {
  db.exec('DELETE FROM notification_log; DELETE FROM payment; DELETE FROM block; DELETE FROM booking; DELETE FROM rate_plan; DELETE FROM slot; DELETE FROM hall; DELETE FROM venue;');
  seed();
  console.log('Reseeded.');
} else {
  seed();
}
