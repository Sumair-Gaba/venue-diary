// Venue Diary — HTTP server + REST API (pure Node, no dependencies).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, findConflict, FACILITIES } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

const json = (res, code, data) => {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
};
const readBody = (req) => new Promise((resolve) => {
  let b = ''; req.on('data', (c) => (b += c));
  req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
});

// ---- auth -----------------------------------------------------------------
const otpStore = new Map(); // phone -> { code, exp }
const newToken = () => crypto.randomUUID().replace(/-/g, '');
function validSession(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return false;
  return !!db.prepare('SELECT token FROM session WHERE token=?').get(token);
}

// ---- views ----------------------------------------------------------------
function bookingView(b) {
  const paid = db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM payment WHERE booking_id=?').get(b.id).s;
  const hall = db.prepare('SELECT name FROM hall WHERE id=?').get(b.hall_id);
  const slot = db.prepare('SELECT name,code FROM slot WHERE id=?').get(b.slot_id);
  return { ...b, hall_name: hall?.name, slot_name: slot?.name, slot_code: slot?.code, paid, balance: b.total_amount - paid };
}
function logNotification(bookingId, template) {
  db.prepare('INSERT INTO notification_log (booking_id,channel,template,status,sent_at) VALUES (?,?,?,?,?)')
    .run(bookingId, 'whatsapp', template, 'sent', new Date().toISOString());
}

// ---- API ------------------------------------------------------------------
async function api(req, res, url) {
  const seg = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  const q = url.searchParams;
  const m = req.method;

  // ---- AUTH (public) ----
  if (seg[0] === 'auth') {
    if (m === 'POST' && seg[1] === 'request-otp') {
      const d = await readBody(req);
      if (!d.phone) return json(res, 400, { error: 'PHONE_REQUIRED' });
      const code = String(Math.floor(1000 + Math.random() * 9000));
      otpStore.set(d.phone, { code, exp: Date.now() + 5 * 60000 });
      console.log(`  OTP for ${d.phone}: ${code}`);
      // Dev mode: return the code so it can be shown (production: send via SMS/WhatsApp).
      return json(res, 200, { sent: true, devCode: code });
    }
    if (m === 'POST' && seg[1] === 'verify') {
      const d = await readBody(req);
      const rec = otpStore.get(d.phone);
      if (!rec || rec.exp < Date.now() || rec.code !== String(d.code))
        return json(res, 401, { error: 'INVALID_OTP', message: 'Invalid or expired code.' });
      otpStore.delete(d.phone);
      const token = newToken();
      db.prepare('INSERT INTO session (token,phone,created_at) VALUES (?,?,?)').run(token, d.phone, new Date().toISOString());
      return json(res, 200, { token });
    }
    return json(res, 404, { error: 'NO_ROUTE' });
  }

  // ---- everything else requires a session ----
  if (!validSession(req)) return json(res, 401, { error: 'UNAUTHORIZED' });

  // GET /api/venue
  if (m === 'GET' && seg[0] === 'venue') {
    const venue = db.prepare('SELECT * FROM venue WHERE id=1').get();
    venue.facilities = JSON.parse(venue.facilities || '[]');
    venue.all_facilities = FACILITIES;
    venue.halls = db.prepare('SELECT * FROM hall WHERE venue_id=1 AND active=1 ORDER BY id').all();
    venue.slots = db.prepare('SELECT * FROM slot WHERE venue_id=1 AND active=1 ORDER BY sort').all();
    venue.rates = db.prepare('SELECT * FROM rate_plan').all();
    return json(res, 200, venue);
  }

  // PATCH /api/venue
  if (m === 'PATCH' && seg[0] === 'venue') {
    const d = await readBody(req);
    db.prepare(`UPDATE venue SET name=?, city=?, area=?, address=?, phone=?, capacity_min=?, capacity_max=?, facilities=? WHERE id=1`)
      .run(d.name, d.city, d.area, d.address, d.phone, d.capacity_min || null, d.capacity_max || null, JSON.stringify(d.facilities || []));
    return json(res, 200, { ok: true });
  }

  // Halls CRUD
  if (seg[0] === 'halls') {
    if (m === 'POST') { const d = await readBody(req); const i = db.prepare('INSERT INTO hall (venue_id,name,capacity) VALUES (1,?,?)').run(d.name, d.capacity || null); return json(res, 201, { id: i.lastInsertRowid }); }
    if (m === 'PATCH' && seg[1]) { const d = await readBody(req); db.prepare('UPDATE hall SET name=?, capacity=? WHERE id=?').run(d.name, d.capacity || null, Number(seg[1])); return json(res, 200, { ok: true }); }
    if (m === 'DELETE' && seg[1]) {
      const used = db.prepare("SELECT COUNT(*) c FROM booking WHERE hall_id=? AND status<>'cancelled'").get(Number(seg[1])).c;
      if (used) return json(res, 409, { error: 'HALL_IN_USE', message: 'This hall has bookings; it cannot be deleted.' });
      db.prepare('UPDATE hall SET active=0 WHERE id=?').run(Number(seg[1])); return json(res, 200, { ok: true });
    }
  }

  // Slots CRUD (custom slots get their own non-overlapping span)
  if (seg[0] === 'slots') {
    if (m === 'POST') {
      const d = await readBody(req);
      const maxEnd = db.prepare('SELECT COALESCE(MAX(span_end),0) e FROM slot WHERE venue_id=1').get().e;
      const sort = db.prepare('SELECT COALESCE(MAX(sort),0) s FROM slot WHERE venue_id=1').get().s + 1;
      const i = db.prepare('INSERT INTO slot (venue_id,code,name,span_start,span_end,sort) VALUES (1,?,?,?,?,?)')
        .run(String(d.name || 'slot').toLowerCase().replace(/\s+/g, '_'), d.name, maxEnd + 1, maxEnd + 2, sort);
      return json(res, 201, { id: i.lastInsertRowid });
    }
    if (m === 'DELETE' && seg[1]) {
      const used = db.prepare("SELECT COUNT(*) c FROM booking WHERE slot_id=? AND status<>'cancelled'").get(Number(seg[1])).c;
      if (used) return json(res, 409, { error: 'SLOT_IN_USE', message: 'This slot has bookings; it cannot be removed.' });
      db.prepare('UPDATE slot SET active=0 WHERE id=?').run(Number(seg[1])); return json(res, 200, { ok: true });
    }
  }

  // Rate plans
  if (seg[0] === 'rates') {
    if (m === 'POST') { const d = await readBody(req); const i = db.prepare('INSERT INTO rate_plan (hall_id,event_type,per_head_rate) VALUES (?,?,?)').run(Number(d.hall_id), d.event_type, Math.round(Number(d.per_head_rate) || 0)); return json(res, 201, { id: i.lastInsertRowid }); }
    if (m === 'DELETE' && seg[1]) { db.prepare('DELETE FROM rate_plan WHERE id=?').run(Number(seg[1])); return json(res, 200, { ok: true }); }
  }

  // GET /api/dashboard
  if (m === 'GET' && seg[0] === 'dashboard') {
    const today = new Date().toISOString().slice(0, 10);
    const in7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const todays = db.prepare(`SELECT * FROM booking WHERE event_date=? AND status IN ('confirmed','completed') ORDER BY slot_id`).all(today).map(bookingView);
    const week = db.prepare(`SELECT COUNT(*) c FROM booking WHERE event_date BETWEEN ? AND ? AND status IN ('confirmed','tentative')`).get(today, in7).c;
    const outstanding = db.prepare(`SELECT b.*, (b.total_amount - COALESCE((SELECT SUM(amount) FROM payment p WHERE p.booking_id=b.id),0)) AS bal
      FROM booking b WHERE b.status='confirmed'`).all().filter((b) => b.bal > 0).map(bookingView);
    // 6-month booking trend
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const dt = new Date(); dt.setDate(1); dt.setMonth(dt.getMonth() - i);
      const ym = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
      const c = db.prepare(`SELECT COUNT(*) c FROM booking WHERE event_date LIKE ? AND status<>'cancelled'`).get(ym + '%').c;
      trend.push({ label: dt.toLocaleDateString('en', { month: 'short' }), count: c });
    }
    const confTotal = db.prepare(`SELECT COALESCE(SUM(total_amount),0) s FROM booking WHERE status IN ('confirmed','completed')`).get().s;
    const received = db.prepare(`SELECT COALESCE(SUM(p.amount),0) s FROM payment p JOIN booking b ON b.id=p.booking_id WHERE b.status IN ('confirmed','completed')`).get().s;
    return json(res, 200, { today, todays, weekCount: week, outstanding, totalBaqaya: outstanding.reduce((s, b) => s + b.balance, 0), trend, confTotal, received });
  }

  // GET /api/calendar
  if (m === 'GET' && seg[0] === 'calendar') {
    const month = q.get('month') || new Date().toISOString().slice(0, 7);
    const hall = Number(q.get('hall')) || 1;
    const rows = db.prepare(`SELECT event_date, status FROM booking WHERE hall_id=? AND event_date LIKE ? AND status IN ('confirmed','tentative')`).all(hall, month + '%');
    const blocks = db.prepare(`SELECT block_date FROM block WHERE hall_id=? AND block_date LIKE ?`).all(hall, month + '%');
    const days = {};
    for (const r of rows) { const cur = days[r.event_date]; if (!cur || (cur === 'tentative' && r.status === 'confirmed')) days[r.event_date] = r.status; }
    for (const b of blocks) if (!days[b.block_date]) days[b.block_date] = 'blocked';
    return json(res, 200, { month, hall, days });
  }

  // GET /api/day
  if (m === 'GET' && seg[0] === 'day') {
    const date = q.get('date'); const hall = Number(q.get('hall')) || 1;
    const slots = db.prepare('SELECT * FROM slot WHERE venue_id=1 AND active=1 ORDER BY sort').all().map((s) => {
      const conflict = findConflict(hall, date, s.id);
      let booking = null, blockId = null;
      if (conflict?.type === 'booking') booking = db.prepare('SELECT * FROM booking WHERE id=?').get(conflict.id);
      if (conflict?.type === 'block') blockId = conflict.id;
      return { ...s, status: conflict ? (conflict.type === 'block' ? 'blocked' : 'confirmed') : 'free', booking, blockId };
    });
    return json(res, 200, { date, hall, slots });
  }

  // Blocks
  if (seg[0] === 'blocks') {
    if (m === 'POST') { const d = await readBody(req); const i = db.prepare('INSERT INTO block (hall_id,slot_id,block_date,reason) VALUES (?,?,?,?)').run(Number(d.hall), Number(d.slot), d.date, d.reason || 'Blocked'); return json(res, 201, { id: i.lastInsertRowid }); }
    if (m === 'DELETE' && seg[1]) { db.prepare('DELETE FROM block WHERE id=?').run(Number(seg[1])); return json(res, 200, { ok: true }); }
  }

  // GET /api/bookings
  if (m === 'GET' && seg[0] === 'bookings' && !seg[1]) {
    let sql = 'SELECT * FROM booking WHERE 1=1'; const args = [];
    if (q.get('status')) { sql += ' AND status=?'; args.push(q.get('status')); }
    if (q.get('q')) { sql += ' AND customer_name LIKE ?'; args.push('%' + q.get('q') + '%'); }
    sql += ' ORDER BY event_date DESC LIMIT 300';
    return json(res, 200, db.prepare(sql).all(...args).map(bookingView));
  }

  // GET /api/bookings/:id
  if (m === 'GET' && seg[0] === 'bookings' && seg[1] && !seg[2]) {
    const b = db.prepare('SELECT * FROM booking WHERE id=?').get(Number(seg[1]));
    if (!b) return json(res, 404, { error: 'NOT_FOUND' });
    const view = bookingView(b);
    view.payments = db.prepare('SELECT * FROM payment WHERE booking_id=? ORDER BY paid_on DESC, id DESC').all(b.id);
    view.notifications = db.prepare('SELECT * FROM notification_log WHERE booking_id=? ORDER BY sent_at DESC').all(b.id);
    return json(res, 200, view);
  }

  // POST /api/check
  if (m === 'POST' && seg[0] === 'check') {
    const d = await readBody(req);
    const conflict = findConflict(Number(d.hall), d.date, Number(d.slot));
    return json(res, 200, { free: !conflict, conflict });
  }

  // POST /api/bookings (create)
  if (m === 'POST' && seg[0] === 'bookings' && !seg[1]) {
    const d = await readBody(req);
    if (!d.customer_name || !d.date || !d.hall || !d.slot) return json(res, 400, { error: 'MISSING_FIELDS', message: 'Customer, date, hall and slot are required.' });
    const status = d.status === 'confirmed' ? 'confirmed' : 'tentative';
    db.exec('BEGIN IMMEDIATE');
    try {
      if (status === 'confirmed') {
        const conflict = findConflict(Number(d.hall), d.date, Number(d.slot));
        if (conflict) { db.exec('ROLLBACK'); return json(res, 409, { error: 'BOOKING_CONFLICT', conflict, message: 'This slot already has a confirmed booking or block.' }); }
      }
      const info = db.prepare(`INSERT INTO booking (client_uuid,venue_id,hall_id,slot_id,event_date,customer_name,customer_phone,event_type,guest_count,total_amount,status,notes,created_at)
        VALUES (?,1,?,?,?,?,?,?,?,?,?,?,?)`).run(d.client_uuid || crypto.randomUUID(), Number(d.hall), Number(d.slot), d.date,
        d.customer_name, d.customer_phone || null, d.event_type || null, d.guest_count || null, Math.round(Number(d.total_amount) || 0), status, d.notes || null, new Date().toISOString());
      const created = db.prepare('SELECT * FROM booking WHERE id=?').get(info.lastInsertRowid);
      if (d.advance && Number(d.advance) > 0)
        db.prepare('INSERT INTO payment (booking_id,amount,method,paid_on) VALUES (?,?,?,?)').run(created.id, Math.round(Number(d.advance)), d.advance_method || 'cash', d.date);
      db.exec('COMMIT');
      if (status === 'confirmed') logNotification(created.id, 'booking_confirmation');
      return json(res, 201, bookingView(created));
    } catch (e) {
      db.exec('ROLLBACK');
      if (String(e.message).includes('UNIQUE')) return json(res, 409, { error: 'BOOKING_CONFLICT', message: 'This slot already has a confirmed booking.' });
      return json(res, 500, { error: 'SERVER_ERROR', message: e.message });
    }
  }

  // PATCH /api/bookings/:id (edit)
  if (m === 'PATCH' && seg[0] === 'bookings' && seg[1]) {
    const d = await readBody(req); const id = Number(seg[1]);
    db.prepare(`UPDATE booking SET customer_name=?, customer_phone=?, event_type=?, guest_count=?, total_amount=?, notes=? WHERE id=?`)
      .run(d.customer_name, d.customer_phone || null, d.event_type || null, d.guest_count || null, Math.round(Number(d.total_amount) || 0), d.notes || null, id);
    return json(res, 200, bookingView(db.prepare('SELECT * FROM booking WHERE id=?').get(id)));
  }

  // POST /api/bookings/:id/confirm
  if (m === 'POST' && seg[0] === 'bookings' && seg[2] === 'confirm') {
    const id = Number(seg[1]); const b = db.prepare('SELECT * FROM booking WHERE id=?').get(id);
    if (!b) return json(res, 404, { error: 'NOT_FOUND' });
    db.exec('BEGIN IMMEDIATE');
    try {
      const conflict = findConflict(b.hall_id, b.event_date, b.slot_id, id);
      if (conflict) { db.exec('ROLLBACK'); return json(res, 409, { error: 'BOOKING_CONFLICT', conflict }); }
      db.prepare("UPDATE booking SET status='confirmed' WHERE id=?").run(id);
      db.exec('COMMIT'); logNotification(id, 'booking_confirmation');
      return json(res, 200, bookingView(db.prepare('SELECT * FROM booking WHERE id=?').get(id)));
    } catch (e) { db.exec('ROLLBACK'); return json(res, 500, { error: 'SERVER_ERROR', message: e.message }); }
  }

  // POST /api/bookings/:id/complete
  if (m === 'POST' && seg[0] === 'bookings' && seg[2] === 'complete') {
    db.prepare("UPDATE booking SET status='completed' WHERE id=?").run(Number(seg[1]));
    return json(res, 200, bookingView(db.prepare('SELECT * FROM booking WHERE id=?').get(Number(seg[1]))));
  }

  // POST /api/bookings/:id/cancel
  if (m === 'POST' && seg[0] === 'bookings' && seg[2] === 'cancel') {
    const d = await readBody(req);
    db.prepare("UPDATE booking SET status='cancelled', notes=COALESCE(notes,'')||' | cancel: '||? WHERE id=?").run(d.reason || 'owner cancelled', Number(seg[1]));
    return json(res, 200, bookingView(db.prepare('SELECT * FROM booking WHERE id=?').get(Number(seg[1]))));
  }

  // POST /api/bookings/:id/payments
  if (m === 'POST' && seg[0] === 'bookings' && seg[2] === 'payments') {
    const d = await readBody(req); const id = Number(seg[1]);
    if (!d.amount || Number(d.amount) <= 0) return json(res, 400, { error: 'BAD_AMOUNT' });
    db.prepare('INSERT INTO payment (booking_id,amount,method,paid_on,note) VALUES (?,?,?,?,?)')
      .run(id, Math.round(Number(d.amount)), d.method || 'cash', d.paid_on || new Date().toISOString().slice(0, 10), d.note || null);
    const view = bookingView(db.prepare('SELECT * FROM booking WHERE id=?').get(id));
    view.payments = db.prepare('SELECT * FROM payment WHERE booking_id=? ORDER BY paid_on DESC, id DESC').all(id);
    view.notifications = db.prepare('SELECT * FROM notification_log WHERE booking_id=? ORDER BY sent_at DESC').all(id);
    return json(res, 200, view);
  }

  // POST /api/bookings/:id/remind (WhatsApp reminder — demo logs it)
  if (m === 'POST' && seg[0] === 'bookings' && seg[2] === 'remind') {
    logNotification(Number(seg[1]), 'payment_reminder');
    return json(res, 200, { ok: true });
  }

  // POST /api/import  { rows: [...] } — bulk quick entry (old diary)
  if (m === 'POST' && seg[0] === 'import') {
    const d = await readBody(req);
    const rows = Array.isArray(d.rows) ? d.rows : [];
    let created = 0; const errors = [];
    db.exec('BEGIN');
    try {
      for (const [i, r] of rows.entries()) {
        if (!r.customer_name || !r.date || !r.hall || !r.slot) { errors.push({ row: i + 1, error: 'missing fields' }); continue; }
        db.prepare(`INSERT INTO booking (client_uuid,venue_id,hall_id,slot_id,event_date,customer_name,customer_phone,event_type,guest_count,total_amount,status,notes,created_at)
          VALUES (?,1,?,?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), Number(r.hall), Number(r.slot), r.date,
          r.customer_name, r.customer_phone || null, r.event_type || null, r.guest_count || null, Math.round(Number(r.total_amount) || 0), r.status || 'confirmed', r.notes || 'imported', new Date().toISOString());
        created++;
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); return json(res, 500, { error: 'IMPORT_FAILED', message: e.message }); }
    return json(res, 200, { created, errors });
  }

  return json(res, 404, { error: 'NO_ROUTE' });
}

// ---- static + server ------------------------------------------------------
function serveStatic(res, pathname) {
  const file = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'FORBIDDEN' });
  fs.readFile(file, (err, data) => {
    if (err) return fs.readFile(path.join(PUBLIC, 'index.html'), (e2, html) => { if (e2) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(data);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    serveStatic(res, url.pathname);
  } catch (e) { json(res, 500, { error: 'SERVER_ERROR', message: e.message }); }
}).listen(PORT, () => console.log(`\n  Venue Diary running →  http://localhost:${PORT}\n`));
