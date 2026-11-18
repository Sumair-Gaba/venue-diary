// Venue Diary — API router (shared by the local server and the Vercel function).
// Pure logic: takes a normalized request, returns { status, data }. No HTTP here.

import crypto from 'node:crypto';
import {
  FACILITIES, ensureReady, get, all, run, insert, withTx,
  newToken, validToken, bookingView, logNotification, findConflict, findConflictTx,
} from './db.js';

const ok = (data, status = 200) => ({ status, data });

export async function handleApi({ method: m, segs: seg, query: q, body: d = {} }) {
  await ensureReady();

  // ---- AUTH (public) ----
  if (seg[0] === 'auth') {
    if (m === 'POST' && seg[1] === 'request-otp') {
      if (!d.phone) return ok({ error: 'PHONE_REQUIRED' }, 400);
      const code = String(Math.floor(1000 + Math.random() * 9000));
      const exp = Date.now() + 5 * 60000;
      await run(`INSERT INTO otp (phone,code,exp) VALUES (?,?,?)
        ON CONFLICT (phone) DO UPDATE SET code=excluded.code, exp=excluded.exp`, [d.phone, code, exp]);
      console.log(`  OTP for ${d.phone}: ${code}`);
      // Dev mode: return the code so it can be shown (production: send via SMS/WhatsApp).
      return ok({ sent: true, devCode: code });
    }
    if (m === 'POST' && seg[1] === 'verify') {
      const rec = await get('SELECT code, exp FROM otp WHERE phone=?', [d.phone]);
      if (!rec || Number(rec.exp) < Date.now() || rec.code !== String(d.code))
        return ok({ error: 'INVALID_OTP', message: 'Invalid or expired code.' }, 401);
      await run('DELETE FROM otp WHERE phone=?', [d.phone]);
      const token = newToken();
      await run('INSERT INTO session (token,phone,created_at) VALUES (?,?,?)', [token, d.phone, new Date().toISOString()]);
      return ok({ token });
    }
    return ok({ error: 'NO_ROUTE' }, 404);
  }

  // ---- everything else requires a session ----
  if (!(await validToken(d.__token))) return ok({ error: 'UNAUTHORIZED' }, 401);

  // GET /api/venue
  if (m === 'GET' && seg[0] === 'venue') {
    const venue = await get('SELECT * FROM venue WHERE id=1');
    venue.facilities = JSON.parse(venue.facilities || '[]');
    venue.all_facilities = FACILITIES;
    venue.halls = await all('SELECT * FROM hall WHERE venue_id=1 AND active=1 ORDER BY id');
    venue.slots = await all('SELECT * FROM slot WHERE venue_id=1 AND active=1 ORDER BY sort');
    venue.rates = await all('SELECT * FROM rate_plan');
    return ok(venue);
  }

  // PATCH /api/venue
  if (m === 'PATCH' && seg[0] === 'venue') {
    await run(`UPDATE venue SET name=?, city=?, area=?, address=?, phone=?, capacity_min=?, capacity_max=?, facilities=? WHERE id=1`,
      [d.name, d.city, d.area, d.address, d.phone, d.capacity_min || null, d.capacity_max || null, JSON.stringify(d.facilities || [])]);
    return ok({ ok: true });
  }

  // Halls CRUD
  if (seg[0] === 'halls') {
    if (m === 'POST') { const id = await insert('INSERT INTO hall (venue_id,name,capacity) VALUES (1,?,?)', [d.name, d.capacity || null]); return ok({ id }, 201); }
    if (m === 'PATCH' && seg[1]) { await run('UPDATE hall SET name=?, capacity=? WHERE id=?', [d.name, d.capacity || null, Number(seg[1])]); return ok({ ok: true }); }
    if (m === 'DELETE' && seg[1]) {
      const used = Number((await get("SELECT COUNT(*) c FROM booking WHERE hall_id=? AND status<>'cancelled'", [Number(seg[1])])).c);
      if (used) return ok({ error: 'HALL_IN_USE', message: 'This hall has bookings; it cannot be deleted.' }, 409);
      await run('UPDATE hall SET active=0 WHERE id=?', [Number(seg[1])]); return ok({ ok: true });
    }
  }

  // Slots CRUD (custom slots get their own non-overlapping span)
  if (seg[0] === 'slots') {
    if (m === 'POST') {
      const maxEnd = Number((await get('SELECT COALESCE(MAX(span_end),0) e FROM slot WHERE venue_id=1')).e);
      const sort = Number((await get('SELECT COALESCE(MAX(sort),0) s FROM slot WHERE venue_id=1')).s) + 1;
      const id = await insert('INSERT INTO slot (venue_id,code,name,span_start,span_end,sort) VALUES (1,?,?,?,?,?)',
        [String(d.name || 'slot').toLowerCase().replace(/\s+/g, '_'), d.name, maxEnd + 1, maxEnd + 2, sort]);
      return ok({ id }, 201);
    }
    if (m === 'DELETE' && seg[1]) {
      const used = Number((await get("SELECT COUNT(*) c FROM booking WHERE slot_id=? AND status<>'cancelled'", [Number(seg[1])])).c);
      if (used) return ok({ error: 'SLOT_IN_USE', message: 'This slot has bookings; it cannot be removed.' }, 409);
      await run('UPDATE slot SET active=0 WHERE id=?', [Number(seg[1])]); return ok({ ok: true });
    }
  }

  // Rate plans
  if (seg[0] === 'rates') {
    if (m === 'POST') { const id = await insert('INSERT INTO rate_plan (hall_id,event_type,per_head_rate) VALUES (?,?,?)', [Number(d.hall_id), d.event_type, Math.round(Number(d.per_head_rate) || 0)]); return ok({ id }, 201); }
    if (m === 'DELETE' && seg[1]) { await run('DELETE FROM rate_plan WHERE id=?', [Number(seg[1])]); return ok({ ok: true }); }
  }

  // GET /api/dashboard
  if (m === 'GET' && seg[0] === 'dashboard') {
    const today = new Date().toISOString().slice(0, 10);
    const in7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const todays = await Promise.all((await all(`SELECT * FROM booking WHERE event_date=? AND status IN ('confirmed','completed') ORDER BY slot_id`, [today])).map(bookingView));
    const week = Number((await get(`SELECT COUNT(*) c FROM booking WHERE event_date BETWEEN ? AND ? AND status IN ('confirmed','tentative')`, [today, in7])).c);
    const outRows = (await all(`SELECT b.*, (b.total_amount - COALESCE((SELECT SUM(amount) FROM payment p WHERE p.booking_id=b.id),0)) AS bal
      FROM booking b WHERE b.status='confirmed'`)).filter((b) => Number(b.bal) > 0);
    const outstanding = await Promise.all(outRows.map(bookingView));
    // 6-month booking trend
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const dt = new Date(); dt.setDate(1); dt.setMonth(dt.getMonth() - i);
      const ym = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
      const c = Number((await get(`SELECT COUNT(*) c FROM booking WHERE event_date LIKE ? AND status<>'cancelled'`, [ym + '%'])).c);
      trend.push({ label: dt.toLocaleDateString('en', { month: 'short' }), count: c });
    }
    const confTotal = Number((await get(`SELECT COALESCE(SUM(total_amount),0) s FROM booking WHERE status IN ('confirmed','completed')`)).s);
    const received = Number((await get(`SELECT COALESCE(SUM(p.amount),0) s FROM payment p JOIN booking b ON b.id=p.booking_id WHERE b.status IN ('confirmed','completed')`)).s);
    return ok({ today, todays, weekCount: week, outstanding, totalBaqaya: outstanding.reduce((s, b) => s + b.balance, 0), trend, confTotal, received });
  }

  // GET /api/calendar
  if (m === 'GET' && seg[0] === 'calendar') {
    const month = q.get('month') || new Date().toISOString().slice(0, 7);
    const hall = Number(q.get('hall')) || 1;
    const rows = await all(`SELECT event_date, status FROM booking WHERE hall_id=? AND event_date LIKE ? AND status IN ('confirmed','tentative')`, [hall, month + '%']);
    const blocks = await all(`SELECT block_date FROM block WHERE hall_id=? AND block_date LIKE ?`, [hall, month + '%']);
    const days = {};
    for (const r of rows) { const cur = days[r.event_date]; if (!cur || (cur === 'tentative' && r.status === 'confirmed')) days[r.event_date] = r.status; }
    for (const b of blocks) if (!days[b.block_date]) days[b.block_date] = 'blocked';
    return ok({ month, hall, days });
  }

  // GET /api/day
  if (m === 'GET' && seg[0] === 'day') {
    const date = q.get('date'); const hall = Number(q.get('hall')) || 1;
    const slots = await Promise.all((await all('SELECT * FROM slot WHERE venue_id=1 AND active=1 ORDER BY sort')).map(async (s) => {
      const conflict = await findConflict(hall, date, s.id);
      let booking = null, blockId = null;
      if (conflict?.type === 'booking') booking = await get('SELECT * FROM booking WHERE id=?', [conflict.id]);
      if (conflict?.type === 'block') blockId = conflict.id;
      return { ...s, status: conflict ? (conflict.type === 'block' ? 'blocked' : 'confirmed') : 'free', booking, blockId };
    }));
    return ok({ date, hall, slots });
  }

  // Blocks
  if (seg[0] === 'blocks') {
    if (m === 'POST') { const id = await insert('INSERT INTO block (hall_id,slot_id,block_date,reason) VALUES (?,?,?,?)', [Number(d.hall), Number(d.slot), d.date, d.reason || 'Blocked']); return ok({ id }, 201); }
    if (m === 'DELETE' && seg[1]) { await run('DELETE FROM block WHERE id=?', [Number(seg[1])]); return ok({ ok: true }); }
  }

  // GET /api/bookings
  if (m === 'GET' && seg[0] === 'bookings' && !seg[1]) {
    let sql = 'SELECT * FROM booking WHERE 1=1'; const args = [];
    if (q.get('status')) { sql += ' AND status=?'; args.push(q.get('status')); }
    if (q.get('q')) { sql += ' AND customer_name LIKE ?'; args.push('%' + q.get('q') + '%'); }
    sql += ' ORDER BY event_date DESC LIMIT 300';
    return ok(await Promise.all((await all(sql, args)).map(bookingView)));
  }

  // GET /api/bookings/:id
  if (m === 'GET' && seg[0] === 'bookings' && seg[1] && !seg[2]) {
    const b = await get('SELECT * FROM booking WHERE id=?', [Number(seg[1])]);
    if (!b) return ok({ error: 'NOT_FOUND' }, 404);
    const view = await bookingView(b);
    view.payments = await all('SELECT * FROM payment WHERE booking_id=? ORDER BY paid_on DESC, id DESC', [b.id]);
    view.notifications = await all('SELECT * FROM notification_log WHERE booking_id=? ORDER BY sent_at DESC', [b.id]);
    return ok(view);
  }

  // POST /api/check
  if (m === 'POST' && seg[0] === 'check') {
    const conflict = await findConflict(Number(d.hall), d.date, Number(d.slot));
    return ok({ free: !conflict, conflict });
  }

  // POST /api/bookings (create)
  if (m === 'POST' && seg[0] === 'bookings' && !seg[1]) {
    if (!d.customer_name || !d.date || !d.hall || !d.slot) return ok({ error: 'MISSING_FIELDS', message: 'Customer, date, hall and slot are required.' }, 400);
    const status = d.status === 'confirmed' ? 'confirmed' : 'tentative';
    try {
      const created = await withTx(async (query) => {
        if (status === 'confirmed') {
          const conflict = await findConflictTx(query, Number(d.hall), d.date, Number(d.slot));
          if (conflict) { const e = new Error('CONFLICT'); e.conflict = conflict; throw e; }
        }
        const r = await query(`INSERT INTO booking (client_uuid,venue_id,hall_id,slot_id,event_date,customer_name,customer_phone,event_type,guest_count,total_amount,status,notes,created_at)
          VALUES (?,1,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
          [d.client_uuid || crypto.randomUUID(), Number(d.hall), Number(d.slot), d.date,
            d.customer_name, d.customer_phone || null, d.event_type || null, d.guest_count || null, Math.round(Number(d.total_amount) || 0), status, d.notes || null, new Date().toISOString()]);
        const row = r.rows[0];
        if (d.advance && Number(d.advance) > 0)
          await query('INSERT INTO payment (booking_id,amount,method,paid_on) VALUES (?,?,?,?)', [row.id, Math.round(Number(d.advance)), d.advance_method || 'cash', d.date]);
        return row;
      });
      if (status === 'confirmed') await logNotification(created.id, 'booking_confirmation');
      return ok(await bookingView(created), 201);
    } catch (e) {
      if (e.conflict) return ok({ error: 'BOOKING_CONFLICT', conflict: e.conflict, message: 'This slot already has a confirmed booking or block.' }, 409);
      if (e.code === '23505') return ok({ error: 'BOOKING_CONFLICT', message: 'This slot already has a confirmed booking.' }, 409);
      return ok({ error: 'SERVER_ERROR', message: e.message }, 500);
    }
  }

  // PATCH /api/bookings/:id (edit)
  if (m === 'PATCH' && seg[0] === 'bookings' && seg[1]) {
    const id = Number(seg[1]);
    await run(`UPDATE booking SET customer_name=?, customer_phone=?, event_type=?, guest_count=?, total_amount=?, notes=? WHERE id=?`,
      [d.customer_name, d.customer_phone || null, d.event_type || null, d.guest_count || null, Math.round(Number(d.total_amount) || 0), d.notes || null, id]);
    return ok(await bookingView(await get('SELECT * FROM booking WHERE id=?', [id])));
  }

  // POST /api/bookings/:id/confirm
  if (m === 'POST' && seg[0] === 'bookings' && seg[2] === 'confirm') {
    const id = Number(seg[1]); const b = await get('SELECT * FROM booking WHERE id=?', [id]);
    if (!b) return ok({ error: 'NOT_FOUND' }, 404);
    try {
      await withTx(async (query) => {
        const conflict = await findConflictTx(query, b.hall_id, b.event_date, b.slot_id, id);
        if (conflict) { const e = new Error('CONFLICT'); e.conflict = conflict; throw e; }
        await query("UPDATE booking SET status='confirmed' WHERE id=?", [id]);
      });
      await logNotification(id, 'booking_confirmation');
      return ok(await bookingView(await get('SELECT * FROM booking WHERE id=?', [id])));
    } catch (e) {
      if (e.conflict) return ok({ error: 'BOOKING_CONFLICT', conflict: e.conflict }, 409);
      if (e.code === '23505') return ok({ error: 'BOOKING_CONFLICT' }, 409);
      return ok({ error: 'SERVER_ERROR', message: e.message }, 500);
    }
  }

  // POST /api/bookings/:id/complete
  if (m === 'POST' && seg[0] === 'bookings' && seg[2] === 'complete') {
    await run("UPDATE booking SET status='completed' WHERE id=?", [Number(seg[1])]);
    return ok(await bookingView(await get('SELECT * FROM booking WHERE id=?', [Number(seg[1])])));
  }

  // POST /api/bookings/:id/cancel
  if (m === 'POST' && seg[0] === 'bookings' && seg[2] === 'cancel') {
    await run("UPDATE booking SET status='cancelled', notes=COALESCE(notes,'')||' | cancel: '||? WHERE id=?", [d.reason || 'owner cancelled', Number(seg[1])]);
    return ok(await bookingView(await get('SELECT * FROM booking WHERE id=?', [Number(seg[1])])));
  }

  // POST /api/bookings/:id/payments
  if (m === 'POST' && seg[0] === 'bookings' && seg[2] === 'payments') {
    const id = Number(seg[1]);
    if (!d.amount || Number(d.amount) <= 0) return ok({ error: 'BAD_AMOUNT' }, 400);
    await run('INSERT INTO payment (booking_id,amount,method,paid_on,note) VALUES (?,?,?,?,?)',
      [id, Math.round(Number(d.amount)), d.method || 'cash', d.paid_on || new Date().toISOString().slice(0, 10), d.note || null]);
    const view = await bookingView(await get('SELECT * FROM booking WHERE id=?', [id]));
    view.payments = await all('SELECT * FROM payment WHERE booking_id=? ORDER BY paid_on DESC, id DESC', [id]);
    view.notifications = await all('SELECT * FROM notification_log WHERE booking_id=? ORDER BY sent_at DESC', [id]);
    return ok(view);
  }

  // POST /api/bookings/:id/remind (WhatsApp reminder — demo logs it)
  if (m === 'POST' && seg[0] === 'bookings' && seg[2] === 'remind') {
    await logNotification(Number(seg[1]), 'payment_reminder');
    return ok({ ok: true });
  }

  // POST /api/import  { rows: [...] } — bulk quick entry (old diary)
  if (m === 'POST' && seg[0] === 'import') {
    const rows = Array.isArray(d.rows) ? d.rows : [];
    let created = 0; const errors = [];
    try {
      await withTx(async (query) => {
        for (const [i, r] of rows.entries()) {
          if (!r.customer_name || !r.date || !r.hall || !r.slot) { errors.push({ row: i + 1, error: 'missing fields' }); continue; }
          await query(`INSERT INTO booking (client_uuid,venue_id,hall_id,slot_id,event_date,customer_name,customer_phone,event_type,guest_count,total_amount,status,notes,created_at)
            VALUES (?,1,?,?,?,?,?,?,?,?,?,?,?)`, [crypto.randomUUID(), Number(r.hall), Number(r.slot), r.date,
            r.customer_name, r.customer_phone || null, r.event_type || null, r.guest_count || null, Math.round(Number(r.total_amount) || 0), r.status || 'confirmed', r.notes || 'imported', new Date().toISOString()]);
          created++;
        }
      });
    } catch (e) { return ok({ error: 'IMPORT_FAILED', message: e.message }, 500); }
    return ok({ created, errors });
  }

  return ok({ error: 'NO_ROUTE' }, 404);
}
