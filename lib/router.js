// Venue Diary — API router (shared by the local server and the Vercel function).
// Multi-tenant: every request resolves the caller's user + venue and all data is
// scoped to that venue. Pure logic: returns { status, data }. No HTTP here.

import crypto from 'node:crypto';
import {
  FACILITIES, FEATURE_CATALOG, parseFeatures, updateVenueFeatures,
  ensureReady, get, all, run, insert, withTx, coord, pct,
  findOrCreateUser, sessionContext, createSession, adminLogin,
  registerBanquet, listVenuesForAdmin, publicVenueBySlug, createLead, createReview,
  createClaim, myClaims, listClaimRequests, approveClaim, rejectClaim, createLeadsBulk,
  listPublicVenues, listPublicAreas, listReelVenues, listVenuesNear,
  bookingView, logNotification, findConflict, findConflictTx, findHold, venueAlerts,
} from './db.js';

const ok = (data, status = 200) => ({ status, data });

export async function handleApi({ method: m, segs: seg, query: q, body: d = {} }) {
  await ensureReady();

  // ---- PUBLIC: a banquet's public page data (name, halls, prices, decor, photos) ----
  if (m === 'GET' && seg[0] === 'public' && seg[1] === 'venue') {
    const v = await publicVenueBySlug(q.get('slug'));
    if (!v) return ok({ error: 'NOT_FOUND' }, 404);
    return ok(v);
  }

  // ---- PUBLIC: consumer directory list/search (customer app + web) ----
  if (m === 'GET' && seg[0] === 'public' && seg[1] === 'venues') {
    return ok(await listPublicVenues({
      q: q.get('q'), area: q.get('area'), page: q.get('page'), limit: q.get('limit'), date: q.get('date'),
      guests: q.get('guests'), minBudget: q.get('minBudget'), maxBudget: q.get('maxBudget'),
      verified: q.get('verified'), facilities: q.get('facilities'), sort: q.get('sort'),
    }));
  }
  if (m === 'GET' && seg[0] === 'public' && seg[1] === 'areas') {
    return ok(await listPublicAreas());
  }
  // ---- PUBLIC: venues near a point, within a radius (map "near me") ----
  if (m === 'GET' && seg[0] === 'public' && seg[1] === 'near') {
    return ok(await listVenuesNear({ lat: q.get('lat'), lng: q.get('lng'), radiusKm: q.get('radius') }));
  }
  // ---- PUBLIC: reel feed (venues with photos, for the full-screen feed) ----
  if (m === 'GET' && seg[0] === 'public' && seg[1] === 'reels') {
    return ok(await listReelVenues({ page: q.get('page'), limit: q.get('limit') }));
  }

  // ---- PUBLIC: post a review for a venue (no auth) ----
  if (m === 'POST' && seg[0] === 'public' && seg[1] === 'review') {
    const r = await createReview(q.get('slug') || d.slug, d);
    if (!r) return ok({ error: 'NOT_FOUND', message: 'Venue not found.' }, 404);
    if (r.error === 'BAD_RATING') return ok({ error: r.error, message: 'Please choose a rating 1–5.' }, 400);
    if (r.error) return ok({ error: r.error, message: 'Please enter your name.' }, 400);
    return ok({ ok: true, id: r.id }, 201);
  }

  // ---- PUBLIC: one enquiry to many venues at once (shortlist, no auth) ----
  if (m === 'POST' && seg[0] === 'public' && seg[1] === 'enquiries' && seg[2] === 'bulk') {
    const r = await createLeadsBulk(d.slugs, d);
    if (r.error === 'NAME_REQUIRED') return ok({ error: r.error, message: 'Please enter your name.' }, 400);
    if (r.error === 'NO_VENUES') return ok({ error: r.error, message: 'Please select at least one venue.' }, 400);
    return ok({ ok: true, sent: r.sent, failed: r.failed }, 201);
  }

  // ---- PUBLIC: a customer enquiry from a venue's public page (no auth) ----
  if (m === 'POST' && seg[0] === 'public' && seg[1] === 'enquiry') {
    const r = await createLead(q.get('slug') || d.slug, d);
    if (!r) return ok({ error: 'NOT_FOUND', message: 'Venue not found.' }, 404);
    if (r.error) return ok({ error: r.error, message: 'Please enter your name.' }, 400);
    return ok({ ok: true, id: r.id }, 201);
  }

  // ---- AUTH (public) ----
  if (seg[0] === 'auth') {
    if (m === 'POST' && seg[1] === 'request-otp') {
      if (!d.phone) return ok({ error: 'PHONE_REQUIRED' }, 400);
      const code = String(Math.floor(1000 + Math.random() * 9000));
      const exp = Date.now() + 5 * 60000;
      await run(`INSERT INTO otp (phone,code,exp) VALUES (?,?,?)
        ON CONFLICT (phone) DO UPDATE SET code=excluded.code, exp=excluded.exp`, [d.phone, code, exp]);
      console.log(`  OTP for ${d.phone}: ${code}`);
      return ok({ sent: true, devCode: code });
    }
    if (m === 'POST' && seg[1] === 'verify') {
      const rec = await get('SELECT code, exp FROM otp WHERE phone=?', [d.phone]);
      if (!rec || Number(rec.exp) < Date.now() || rec.code !== String(d.code))
        return ok({ error: 'INVALID_OTP', message: 'Invalid or expired code.' }, 401);
      await run('DELETE FROM otp WHERE phone=?', [d.phone]);
      const user = await findOrCreateUser(d.phone, d.name || null);
      const token = await createSession(user.id, d.phone);
      return ok({ token });
    }
    // Admin login with email + password
    if (m === 'POST' && seg[1] === 'admin-login') {
      const u = await adminLogin(d.email, d.password);
      if (!u) return ok({ error: 'INVALID_LOGIN', message: 'Incorrect email or password.' }, 401);
      const token = await createSession(u.id, u.email);
      return ok({ token });
    }
    return ok({ error: 'NO_ROUTE' }, 404);
  }

  // ---- everything else requires a session ----
  const ctx = await sessionContext(d.__token);
  if (!ctx) return ok({ error: 'UNAUTHORIZED' }, 401);
  const { user } = ctx;
  const admin = user.role === 'admin';

  // Effective venue: owners use their own; admins target a venue via X-Venue-Id.
  let venue;
  if (admin) {
    const ov = d.__venueOverride ? Number(d.__venueOverride) : null;
    venue = ov ? await get('SELECT * FROM venue WHERE id=?', [ov]) : null;
  } else {
    venue = ctx.venue;
  }
  const venueId = venue?.id || null;

  // GET /api/me — who am I + where should the app land
  if (m === 'GET' && seg[0] === 'me') {
    return ok({ phone: user.phone, name: user.name, role: admin ? 'admin' : 'owner', hasVenue: !!ctx.venue, venueId: ctx.venue?.id || null, slug: ctx.venue?.slug || null });
  }
  if (m === 'PATCH' && seg[0] === 'me') {
    await run('UPDATE app_user SET name=? WHERE id=?', [d.name || null, user.id]);
    return ok({ ok: true });
  }

  // ---- OWNER CLAIM (signed-in, phone verified via OTP) ----
  // GET  /api/claims/mine — the user's own claims + status
  // POST /api/claims { slug, name, phone, note } — claim a directory listing
  if (seg[0] === 'claims') {
    if (m === 'GET' && seg[1] === 'mine') return ok(await myClaims(user.id));
    if (m === 'POST' && !seg[1]) {
      const r = await createClaim(d.slug, user.id, d);
      if (!r) return ok({ error: 'NOT_FOUND', message: 'Venue not found.' }, 404);
      if (r.error === 'ALREADY_OWNED') return ok({ error: r.error, message: 'This venue has already been claimed.' }, 409);
      if (r.error === 'NAME_REQUIRED') return ok({ error: r.error, message: 'Please enter your name.' }, 400);
      return ok({ ok: true, id: r.id, resubmitted: !!r.resubmitted }, 201);
    }
    return ok({ error: 'NO_ROUTE' }, 404);
  }

  // ---- ADMIN panel ----
  if (seg[0] === 'admin') {
    if (!admin) return ok({ error: 'FORBIDDEN' }, 403);
    if (m === 'GET' && seg[1] === 'features') return ok({ catalog: FEATURE_CATALOG });
    if (m === 'GET' && seg[1] === 'venues') return ok(await listVenuesForAdmin());
    // Owner-claim review: list pending, approve (hand over), or reject.
    if (m === 'GET' && seg[1] === 'claims') return ok(await listClaimRequests());
    if (m === 'POST' && seg[1] === 'claims' && seg[2] && seg[3] === 'approve') {
      const r = await approveClaim(Number(seg[2]));
      if (r.error === 'NOT_FOUND') return ok({ error: r.error }, 404);
      if (r.error === 'NOT_PENDING') return ok({ error: r.error, message: 'This claim is no longer pending.' }, 409);
      if (r.error === 'ALREADY_OWNED') return ok({ error: r.error, message: 'That venue is already owned — the claim was declined.' }, 409);
      return ok(r);
    }
    if (m === 'POST' && seg[1] === 'claims' && seg[2] && seg[3] === 'reject') {
      const r = await rejectClaim(Number(seg[2]));
      if (r.error === 'NOT_FOUND') return ok({ error: r.error }, 404);
      if (r.error === 'NOT_PENDING') return ok({ error: r.error, message: 'This claim is no longer pending.' }, 409);
      return ok(r);
    }
    // Toggle a banquet's optional features: PATCH /api/admin/venues/:id/features
    if (m === 'PATCH' && seg[1] === 'venues' && seg[2] && seg[3] === 'features') {
      const vid = Number(seg[2]);
      if (!(await get('SELECT id FROM venue WHERE id=?', [vid]))) return ok({ error: 'NOT_FOUND' }, 404);
      const features = await updateVenueFeatures(vid, d.features);
      return ok({ ok: true, features });
    }
    // DELETE /api/admin/venues/:id — permanently remove a banquet and all its data
    if (m === 'DELETE' && seg[1] === 'venues' && seg[2] && !seg[3]) {
      const vid = Number(seg[2]);
      if (!(await get('SELECT id FROM venue WHERE id=?', [vid]))) return ok({ error: 'NOT_FOUND' }, 404);
      await withTx(async (query) => {
        await query('DELETE FROM payment WHERE booking_id IN (SELECT id FROM booking WHERE venue_id=?)', [vid]);
        await query('DELETE FROM notification_log WHERE booking_id IN (SELECT id FROM booking WHERE venue_id=?)', [vid]);
        await query('DELETE FROM booking WHERE venue_id=?', [vid]);
        await query('DELETE FROM block WHERE hall_id IN (SELECT id FROM hall WHERE venue_id=?)', [vid]);
        await query('DELETE FROM hall_price WHERE hall_id IN (SELECT id FROM hall WHERE venue_id=?)', [vid]);
        await query('DELETE FROM rate_plan WHERE hall_id IN (SELECT id FROM hall WHERE venue_id=?)', [vid]);
        await query('DELETE FROM pricing_rule WHERE venue_id=?', [vid]);
        await query('DELETE FROM decor_item WHERE venue_id=?', [vid]);
        await query('DELETE FROM lead WHERE venue_id=?', [vid]);
        await query('DELETE FROM review WHERE venue_id=?', [vid]);
        await query('DELETE FROM media WHERE venue_id=?', [vid]);
        await query('DELETE FROM slot WHERE venue_id=?', [vid]);
        await query('DELETE FROM hall WHERE venue_id=?', [vid]);
        await query('DELETE FROM venue WHERE id=?', [vid]);
      });
      return ok({ ok: true });
    }
    if (m === 'POST' && seg[1] === 'venues') {
      if (!d.name) return ok({ error: 'NAME_REQUIRED', message: 'Banquet name is required.' }, 400);
      if (!d.owner_phone) return ok({ error: 'OWNER_PHONE_REQUIRED', message: 'Owner phone is required.' }, 400);
      try {
        const r = await registerBanquet(String(d.owner_phone).trim(), d.owner_name ? String(d.owner_name).trim() : null, d);
        return ok(r, 201);
      } catch (e) {
        if (e.code === 'OWNER_HAS_VENUE') return ok({ error: 'OWNER_HAS_VENUE', message: 'This phone already has a banquet.' }, 409);
        return ok({ error: 'SERVER_ERROR', message: e.message }, 500);
      }
    }
    return ok({ error: 'NO_ROUTE' }, 404);
  }

  // GET /api/venue
  if (m === 'GET' && seg[0] === 'venue') {
    if (!venue) {
      if (admin) return ok({ admin: true, needsSelection: true, all_facilities: FACILITIES, user: { name: user.name, phone: user.phone } });
      return ok({ needsSetup: true, user: { name: user.name, phone: user.phone } });
    }
    const v = { ...venue };
    v.role = admin ? 'admin' : 'owner';
    v.facilities = JSON.parse(v.facilities || '[]');
    v.all_facilities = FACILITIES;
    v.owner = { name: user.name, phone: user.phone };
    v.halls = await all('SELECT * FROM hall WHERE venue_id=? AND active=1 ORDER BY id', [venueId]);
    v.slots = await all('SELECT * FROM slot WHERE venue_id=? AND active=1 ORDER BY sort', [venueId]);
    v.rates = await all('SELECT rp.* FROM rate_plan rp JOIN hall h ON h.id=rp.hall_id WHERE h.venue_id=?', [venueId]);
    v.media = await all('SELECT * FROM media WHERE venue_id=? ORDER BY sort, id', [venueId]);
    v.decor = await all('SELECT * FROM decor_item WHERE venue_id=? AND active=1 ORDER BY sort, id', [venueId]);
    v.pricing = await all('SELECT * FROM pricing_rule WHERE venue_id=? AND active=1 ORDER BY sort, id', [venueId]);
    v.hall_prices = await all('SELECT hp.* FROM hall_price hp JOIN hall h ON h.id=hp.hall_id WHERE h.venue_id=?', [venueId]);
    v.features = parseFeatures(venue.features);   // enabled optional modules
    v.feature_catalog = FEATURE_CATALOG;          // full list (admin toggles)
    return ok(v);
  }

  // POST /api/venue — self-signup is disabled; only admin registers banquets.
  if (m === 'POST' && seg[0] === 'venue') {
    return ok({ error: 'FORBIDDEN', message: 'Banquets are registered by the admin. Please contact the administrator.' }, 403);
  }

  // PATCH /api/venue — edit profile (owner's own, or admin's selected venue)
  if (m === 'PATCH' && seg[0] === 'venue') {
    if (!venueId) return ok({ error: 'NO_VENUE' }, 400);
    await run(`UPDATE venue SET name=?, city=?, area=?, address=?, phone=?, capacity_min=?, capacity_max=?, facilities=?, latitude=?, longitude=?, service_charge_pct=?, tax_pct=? WHERE id=?`,
      [d.name, d.city, d.area, d.address, d.phone, d.capacity_min || null, d.capacity_max || null, JSON.stringify(d.facilities || []), coord(d.latitude), coord(d.longitude), pct(d.service_charge_pct), pct(d.tax_pct), venueId]);
    return ok({ ok: true });
  }

  // From here most routes need a venue.
  const needVenue = ['halls', 'slots', 'rates', 'hall-prices', 'dashboard', 'calendar', 'day', 'bookings', 'blocks', 'check', 'import', 'media', 'decor', 'pricing', 'leads', 'notifications'];
  if (needVenue.includes(seg[0]) && !venueId) {
    if (m === 'GET' && seg[0] === 'dashboard') return ok({ today: new Date().toISOString().slice(0, 10), todays: [], weekCount: 0, outstanding: [], totalBaqaya: 0, trend: [], confTotal: 0, received: 0 });
    if (m === 'GET' && (seg[0] === 'bookings' || seg[0] === 'notifications')) return ok([]);
    if (m === 'GET' && seg[0] === 'calendar') return ok({ month: q.get('month'), hall: null, days: {} });
    return ok({ error: 'NO_VENUE', message: 'Create your banquet first.' }, 400);
  }

  // Helpers to confirm a child row belongs to this venue (tenant isolation).
  const hallInVenue = (id) => get('SELECT id FROM hall WHERE id=? AND venue_id=?', [id, venueId]);
  const slotInVenue = (id) => get('SELECT id FROM slot WHERE id=? AND venue_id=?', [id, venueId]);

  // Halls CRUD
  if (seg[0] === 'halls') {
    if (m === 'POST') { const id = await insert('INSERT INTO hall (venue_id,name,capacity) VALUES (?,?,?)', [venueId, d.name, d.capacity || null]); return ok({ id }, 201); }
    if (m === 'PATCH' && seg[1]) { if (!(await hallInVenue(Number(seg[1])))) return ok({ error: 'NOT_FOUND' }, 404); await run('UPDATE hall SET name=?, capacity=? WHERE id=?', [d.name, d.capacity || null, Number(seg[1])]); return ok({ ok: true }); }
    if (m === 'DELETE' && seg[1]) {
      if (!(await hallInVenue(Number(seg[1])))) return ok({ error: 'NOT_FOUND' }, 404);
      const used = Number((await get("SELECT COUNT(*) c FROM booking WHERE hall_id=? AND status<>'cancelled'", [Number(seg[1])])).c);
      if (used) return ok({ error: 'HALL_IN_USE', message: 'This hall has bookings; it cannot be deleted.' }, 409);
      await run('UPDATE hall SET active=0 WHERE id=?', [Number(seg[1])]); return ok({ ok: true });
    }
  }

  // Slots CRUD (custom slots get their own non-overlapping span)
  if (seg[0] === 'slots') {
    if (m === 'POST') {
      const maxEnd = Number((await get('SELECT COALESCE(MAX(span_end),0) e FROM slot WHERE venue_id=?', [venueId])).e);
      const sort = Number((await get('SELECT COALESCE(MAX(sort),0) s FROM slot WHERE venue_id=?', [venueId])).s) + 1;
      const id = await insert('INSERT INTO slot (venue_id,code,name,span_start,span_end,sort) VALUES (?,?,?,?,?,?)',
        [venueId, String(d.name || 'slot').toLowerCase().replace(/\s+/g, '_'), d.name, maxEnd + 1, maxEnd + 2, sort]);
      return ok({ id }, 201);
    }
    if (m === 'DELETE' && seg[1]) {
      if (!(await slotInVenue(Number(seg[1])))) return ok({ error: 'NOT_FOUND' }, 404);
      const used = Number((await get("SELECT COUNT(*) c FROM booking WHERE slot_id=? AND status<>'cancelled'", [Number(seg[1])])).c);
      if (used) return ok({ error: 'SLOT_IN_USE', message: 'This slot has bookings; it cannot be removed.' }, 409);
      await run('UPDATE slot SET active=0 WHERE id=?', [Number(seg[1])]); return ok({ ok: true });
    }
  }

  // Rate plans
  if (seg[0] === 'rates') {
    if (m === 'POST') { if (!(await hallInVenue(Number(d.hall_id)))) return ok({ error: 'NOT_FOUND' }, 404); const id = await insert('INSERT INTO rate_plan (hall_id,event_type,per_head_rate) VALUES (?,?,?)', [Number(d.hall_id), d.event_type, Math.round(Number(d.per_head_rate) || 0)]); return ok({ id }, 201); }
    if (m === 'DELETE' && seg[1]) { await run('DELETE FROM rate_plan WHERE id=? AND hall_id IN (SELECT id FROM hall WHERE venue_id=?)', [Number(seg[1]), venueId]); return ok({ ok: true }); }
  }

  // Media (images/videos). Actual file bytes live in Vercel Blob; we store URLs.
  if (seg[0] === 'media') {
    if (m === 'GET') return ok(await all('SELECT * FROM media WHERE venue_id=? ORDER BY sort, id', [venueId]));
    if (m === 'POST') {
      if (!d.url) return ok({ error: 'URL_REQUIRED' }, 400);
      if (d.hall_id && !(await hallInVenue(Number(d.hall_id)))) return ok({ error: 'NOT_FOUND' }, 404);
      const kind = d.kind === 'video' ? 'video' : 'image';
      const id = await insert('INSERT INTO media (venue_id,hall_id,url,kind,created_at) VALUES (?,?,?,?,?)',
        [venueId, d.hall_id ? Number(d.hall_id) : null, d.url, kind, new Date().toISOString()]);
      return ok({ id }, 201);
    }
    if (m === 'DELETE' && seg[1]) { await run('DELETE FROM media WHERE id=? AND venue_id=?', [Number(seg[1]), venueId]); return ok({ ok: true }); }
  }

  // Decor & stage catalog — priced items with a reference photo.
  if (seg[0] === 'decor') {
    if (m === 'GET') return ok(await all('SELECT * FROM decor_item WHERE venue_id=? AND active=1 ORDER BY sort, id', [venueId]));
    if (m === 'POST') {
      if (!d.name) return ok({ error: 'NAME_REQUIRED', message: 'A name is required.' }, 400);
      const cat = d.category === 'stage' || d.category === 'other' ? d.category : 'decor';
      const id = await insert('INSERT INTO decor_item (venue_id,name,category,price,description,image_url,created_at) VALUES (?,?,?,?,?,?,?)',
        [venueId, String(d.name).trim(), cat, Math.max(0, Math.round(Number(d.price) || 0)), d.description || null, d.image_url || null, new Date().toISOString()]);
      return ok({ id }, 201);
    }
    if (m === 'PATCH' && seg[1]) {
      const item = await get('SELECT id FROM decor_item WHERE id=? AND venue_id=?', [Number(seg[1]), venueId]);
      if (!item) return ok({ error: 'NOT_FOUND' }, 404);
      const cat = d.category === 'stage' || d.category === 'other' ? d.category : 'decor';
      await run('UPDATE decor_item SET name=?, category=?, price=?, description=?, image_url=? WHERE id=?',
        [String(d.name).trim(), cat, Math.max(0, Math.round(Number(d.price) || 0)), d.description || null, d.image_url || null, Number(seg[1])]);
      return ok({ ok: true });
    }
    if (m === 'DELETE' && seg[1]) { await run('DELETE FROM decor_item WHERE id=? AND venue_id=?', [Number(seg[1]), venueId]); return ok({ ok: true }); }
  }

  // Flat complete price per hall + slot (e.g. Grand Hall · Dinner = Rs 600,000).
  // Upsert on (hall_id, slot_id); price 0 or missing removes the entry.
  if (seg[0] === 'hall-prices') {
    if (m === 'GET') return ok(await all('SELECT hp.* FROM hall_price hp JOIN hall h ON h.id=hp.hall_id WHERE h.venue_id=?', [venueId]));
    if (m === 'POST') {
      const hallId = Number(d.hall_id), slotId = Number(d.slot_id), price = Math.max(0, Math.round(Number(d.price) || 0));
      if (!(await hallInVenue(hallId)) || !(await slotInVenue(slotId))) return ok({ error: 'NOT_FOUND' }, 404);
      if (!price) { await run('DELETE FROM hall_price WHERE hall_id=? AND slot_id=?', [hallId, slotId]); return ok({ ok: true }); }
      await run(`INSERT INTO hall_price (hall_id,slot_id,price) VALUES (?,?,?)
        ON CONFLICT (hall_id,slot_id) DO UPDATE SET price=excluded.price`, [hallId, slotId, price]);
      return ok({ ok: true });
    }
  }

  // Date-based pricing rules — weekend / season / single-date price adjustments
  // on the flat hall price: flat_add (+Rs total) or flat_set (= Rs total).
  if (seg[0] === 'pricing') {
    if (m === 'GET') return ok(await all('SELECT * FROM pricing_rule WHERE venue_id=? AND active=1 ORDER BY sort, id', [venueId]));
    if (m === 'POST' || (m === 'PATCH' && seg[1])) {
      const kind = ['weekday', 'range', 'date'].includes(d.kind) ? d.kind : null;
      const adjType = ['flat_add', 'flat_set'].includes(d.adj_type) ? d.adj_type : null;
      if (!kind || !adjType) return ok({ error: 'BAD_RULE', message: 'Pick a rule type and an adjustment.' }, 400);
      const weekdays = kind === 'weekday'
        ? [...new Set(String(d.weekdays || '').split(',').map((x) => x.trim()).filter((x) => x !== '').map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort().join(',')
        : null;
      if (kind === 'weekday' && !weekdays) return ok({ error: 'BAD_RULE', message: 'Choose at least one day.' }, 400);
      const start = (kind === 'range' || kind === 'date') ? (d.start_date || null) : null;
      const end = kind === 'range' ? (d.end_date || null) : (kind === 'date' ? (d.start_date || null) : null);
      if ((kind === 'range' || kind === 'date') && !start) return ok({ error: 'BAD_RULE', message: 'Pick a date.' }, 400);
      const val = Math.round(Number(d.adj_value) || 0);   // flat Rs amount
      const args = [kind, d.label || null, weekdays, start, end, adjType, val];
      if (m === 'POST') {
        const id = await insert('INSERT INTO pricing_rule (venue_id,kind,label,weekdays,start_date,end_date,adj_type,adj_value,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
          [venueId, ...args, new Date().toISOString()]);
        return ok({ id }, 201);
      }
      const row = await get('SELECT id FROM pricing_rule WHERE id=? AND venue_id=?', [Number(seg[1]), venueId]);
      if (!row) return ok({ error: 'NOT_FOUND' }, 404);
      await run('UPDATE pricing_rule SET kind=?, label=?, weekdays=?, start_date=?, end_date=?, adj_type=?, adj_value=? WHERE id=?', [...args, Number(seg[1])]);
      return ok({ ok: true });
    }
    if (m === 'DELETE' && seg[1]) { await run('DELETE FROM pricing_rule WHERE id=? AND venue_id=?', [Number(seg[1]), venueId]); return ok({ ok: true }); }
  }

  // Leads — customer enquiries from the public page.
  if (seg[0] === 'leads') {
    if (m === 'GET') return ok(await all('SELECT * FROM lead WHERE venue_id=? ORDER BY created_at DESC LIMIT 200', [venueId]));
    if (m === 'PATCH' && seg[1]) {
      const row = await get('SELECT id FROM lead WHERE id=? AND venue_id=?', [Number(seg[1]), venueId]);
      if (!row) return ok({ error: 'NOT_FOUND' }, 404);
      const status = ['new', 'contacted', 'closed'].includes(d.status) ? d.status : 'new';
      await run('UPDATE lead SET status=? WHERE id=?', [status, Number(seg[1])]);
      return ok({ ok: true });
    }
    if (m === 'DELETE' && seg[1]) { await run('DELETE FROM lead WHERE id=? AND venue_id=?', [Number(seg[1]), venueId]); return ok({ ok: true }); }
  }

  // GET /api/notifications — dashboard alert feed
  if (m === 'GET' && seg[0] === 'notifications') return ok(await venueAlerts(venueId));

  // GET /api/dashboard
  if (m === 'GET' && seg[0] === 'dashboard') {
    const today = new Date().toISOString().slice(0, 10);
    const in7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const todays = await Promise.all((await all(`SELECT * FROM booking WHERE venue_id=? AND event_date=? AND status IN ('confirmed','completed') ORDER BY slot_id`, [venueId, today])).map(bookingView));
    const week = Number((await get(`SELECT COUNT(*) c FROM booking WHERE venue_id=? AND event_date BETWEEN ? AND ? AND status IN ('confirmed','tentative')`, [venueId, today, in7])).c);
    const outRows = (await all(`SELECT b.*, (b.total_amount - COALESCE((SELECT SUM(amount) FROM payment p WHERE p.booking_id=b.id),0)) AS bal
      FROM booking b WHERE b.venue_id=? AND b.status='confirmed'`, [venueId])).filter((b) => Number(b.bal) > 0);
    const outstanding = await Promise.all(outRows.map(bookingView));
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const dt = new Date(); dt.setDate(1); dt.setMonth(dt.getMonth() - i);
      const ym = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
      const c = Number((await get(`SELECT COUNT(*) c FROM booking WHERE venue_id=? AND event_date LIKE ? AND status<>'cancelled'`, [venueId, ym + '%'])).c);
      trend.push({ label: dt.toLocaleDateString('en', { month: 'short' }), count: c });
    }
    const confTotal = Number((await get(`SELECT COALESCE(SUM(total_amount),0) s FROM booking WHERE venue_id=? AND status IN ('confirmed','completed')`, [venueId])).s);
    const received = Number((await get(`SELECT COALESCE(SUM(p.amount),0) s FROM payment p JOIN booking b ON b.id=p.booking_id WHERE b.venue_id=? AND b.status IN ('confirmed','completed')`, [venueId])).s);
    return ok({ today, todays, weekCount: week, outstanding, totalBaqaya: outstanding.reduce((s, b) => s + b.balance, 0), trend, confTotal, received });
  }

  // GET /api/calendar
  if (m === 'GET' && seg[0] === 'calendar') {
    const month = q.get('month') || new Date().toISOString().slice(0, 7);
    let hall = Number(q.get('hall')) || null;
    if (!hall || !(await hallInVenue(hall))) hall = (await get('SELECT id FROM hall WHERE venue_id=? AND active=1 ORDER BY id LIMIT 1', [venueId]))?.id || null;
    const rows = hall ? await all(`SELECT event_date, status FROM booking WHERE hall_id=? AND event_date LIKE ? AND status IN ('confirmed','tentative')`, [hall, month + '%']) : [];
    const blocks = hall ? await all(`SELECT block_date FROM block WHERE hall_id=? AND block_date LIKE ?`, [hall, month + '%']) : [];
    const days = {};
    for (const r of rows) { const cur = days[r.event_date]; if (!cur || (cur === 'tentative' && r.status === 'confirmed')) days[r.event_date] = r.status; }
    for (const b of blocks) if (!days[b.block_date]) days[b.block_date] = 'blocked';
    return ok({ month, hall, days });
  }

  // GET /api/day
  if (m === 'GET' && seg[0] === 'day') {
    const date = q.get('date'); let hall = Number(q.get('hall')) || null;
    if (!hall || !(await hallInVenue(hall))) hall = (await get('SELECT id FROM hall WHERE venue_id=? AND active=1 ORDER BY id LIMIT 1', [venueId]))?.id || null;
    const slots = await Promise.all((await all('SELECT * FROM slot WHERE venue_id=? AND active=1 ORDER BY sort', [venueId])).map(async (s) => {
      const conflict = hall ? await findConflict(hall, date, s.id) : null;
      let booking = null, blockId = null, status = 'free';
      if (conflict?.type === 'booking') { booking = await get('SELECT * FROM booking WHERE id=?', [conflict.id]); status = 'confirmed'; }
      else if (conflict?.type === 'block') { blockId = conflict.id; status = 'blocked'; }
      else if (hall) {
        // No hard conflict — surface a soft hold (tentative) if one overlaps.
        const hold = await findHold(hall, date, s.id);
        if (hold) { booking = await get('SELECT * FROM booking WHERE id=?', [hold.id]); status = 'tentative'; }
      }
      return { ...s, status, booking, blockId };
    }));
    return ok({ date, hall, slots });
  }

  // Blocks
  if (seg[0] === 'blocks') {
    if (m === 'POST') { if (!(await hallInVenue(Number(d.hall)))) return ok({ error: 'NOT_FOUND' }, 404); const id = await insert('INSERT INTO block (hall_id,slot_id,block_date,reason) VALUES (?,?,?,?)', [Number(d.hall), Number(d.slot), d.date, d.reason || 'Blocked']); return ok({ id }, 201); }
    if (m === 'DELETE' && seg[1]) { await run('DELETE FROM block WHERE id=? AND hall_id IN (SELECT id FROM hall WHERE venue_id=?)', [Number(seg[1]), venueId]); return ok({ ok: true }); }
  }

  // GET /api/bookings
  if (m === 'GET' && seg[0] === 'bookings' && !seg[1]) {
    let sql = 'SELECT * FROM booking WHERE venue_id=?'; const args = [venueId];
    if (q.get('status')) { sql += ' AND status=?'; args.push(q.get('status')); }
    if (q.get('q')) { sql += ' AND customer_name LIKE ?'; args.push('%' + q.get('q') + '%'); }
    sql += ' ORDER BY event_date DESC LIMIT 300';
    return ok(await Promise.all((await all(sql, args)).map(bookingView)));
  }

  // GET /api/bookings/:id
  if (m === 'GET' && seg[0] === 'bookings' && seg[1] && !seg[2]) {
    const b = await get('SELECT * FROM booking WHERE id=? AND venue_id=?', [Number(seg[1]), venueId]);
    if (!b) return ok({ error: 'NOT_FOUND' }, 404);
    const view = await bookingView(b);
    view.payments = await all('SELECT * FROM payment WHERE booking_id=? ORDER BY paid_on DESC, id DESC', [b.id]);
    view.notifications = await all('SELECT * FROM notification_log WHERE booking_id=? ORDER BY sent_at DESC', [b.id]);
    return ok(view);
  }

  // POST /api/check
  if (m === 'POST' && seg[0] === 'check') {
    if (!(await hallInVenue(Number(d.hall)))) return ok({ error: 'NOT_FOUND' }, 404);
    const conflict = await findConflict(Number(d.hall), d.date, Number(d.slot));
    const hold = conflict ? null : await findHold(Number(d.hall), d.date, Number(d.slot), d.exclude ? Number(d.exclude) : null);
    return ok({ free: !conflict, conflict, hold });
  }

  // POST /api/bookings (create)
  if (m === 'POST' && seg[0] === 'bookings' && !seg[1]) {
    if (!d.customer_name || !d.date || !d.hall || !d.slot) return ok({ error: 'MISSING_FIELDS', message: 'Customer, date, hall and slot are required.' }, 400);
    if (!(await hallInVenue(Number(d.hall))) || !(await slotInVenue(Number(d.slot)))) return ok({ error: 'NOT_FOUND', message: 'Hall or slot not found.' }, 404);
    const status = d.status === 'confirmed' ? 'confirmed' : 'tentative';
    try {
      const created = await withTx(async (query) => {
        if (status === 'confirmed') {
          const conflict = await findConflictTx(query, Number(d.hall), d.date, Number(d.slot));
          if (conflict) { const e = new Error('CONFLICT'); e.conflict = conflict; throw e; }
        }
        const r = await query(`INSERT INTO booking (client_uuid,venue_id,hall_id,slot_id,event_date,customer_name,customer_phone,event_type,guest_count,total_amount,status,notes,requirements,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
          [d.client_uuid || crypto.randomUUID(), venueId, Number(d.hall), Number(d.slot), d.date,
            d.customer_name, d.customer_phone || null, d.event_type || null, d.guest_count || null, Math.round(Number(d.total_amount) || 0), status, d.notes || null, d.requirements || null, new Date().toISOString()]);
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
    if (!(await get('SELECT id FROM booking WHERE id=? AND venue_id=?', [id, venueId]))) return ok({ error: 'NOT_FOUND' }, 404);
    await run(`UPDATE booking SET customer_name=?, customer_phone=?, event_type=?, guest_count=?, total_amount=?, notes=?, requirements=?,
        beo_arrival=?, beo_meal_time=?, beo_menu=?, beo_setup=?, beo_contact=? WHERE id=?`,
      [d.customer_name, d.customer_phone || null, d.event_type || null, d.guest_count || null, Math.round(Number(d.total_amount) || 0), d.notes || null, d.requirements || null,
        d.beo_arrival || null, d.beo_meal_time || null, d.beo_menu || null, d.beo_setup || null, d.beo_contact || null, id]);
    return ok(await bookingView(await get('SELECT * FROM booking WHERE id=?', [id])));
  }

  // POST /api/bookings/:id/confirm
  if (m === 'POST' && seg[0] === 'bookings' && seg[2] === 'confirm') {
    const id = Number(seg[1]); const b = await get('SELECT * FROM booking WHERE id=? AND venue_id=?', [id, venueId]);
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
    if (!(await get('SELECT id FROM booking WHERE id=? AND venue_id=?', [Number(seg[1]), venueId]))) return ok({ error: 'NOT_FOUND' }, 404);
    await run("UPDATE booking SET status='completed' WHERE id=?", [Number(seg[1])]);
    return ok(await bookingView(await get('SELECT * FROM booking WHERE id=?', [Number(seg[1])])));
  }

  // POST /api/bookings/:id/cancel
  if (m === 'POST' && seg[0] === 'bookings' && seg[2] === 'cancel') {
    if (!(await get('SELECT id FROM booking WHERE id=? AND venue_id=?', [Number(seg[1]), venueId]))) return ok({ error: 'NOT_FOUND' }, 404);
    await run("UPDATE booking SET status='cancelled', notes=COALESCE(notes,'')||' | cancel: '||? WHERE id=?", [d.reason || 'owner cancelled', Number(seg[1])]);
    return ok(await bookingView(await get('SELECT * FROM booking WHERE id=?', [Number(seg[1])])));
  }

  // POST /api/bookings/:id/payments
  if (m === 'POST' && seg[0] === 'bookings' && seg[2] === 'payments') {
    const id = Number(seg[1]);
    if (!(await get('SELECT id FROM booking WHERE id=? AND venue_id=?', [id, venueId]))) return ok({ error: 'NOT_FOUND' }, 404);
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
    if (!(await get('SELECT id FROM booking WHERE id=? AND venue_id=?', [Number(seg[1]), venueId]))) return ok({ error: 'NOT_FOUND' }, 404);
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
          await query(`INSERT INTO booking (client_uuid,venue_id,hall_id,slot_id,event_date,customer_name,customer_phone,event_type,guest_count,total_amount,status,notes,requirements,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [crypto.randomUUID(), venueId, Number(r.hall), Number(r.slot), r.date,
            r.customer_name, r.customer_phone || null, r.event_type || null, r.guest_count || null, Math.round(Number(r.total_amount) || 0), r.status || 'confirmed', r.notes || 'imported', r.requirements || null, new Date().toISOString()]);
          created++;
        }
      });
    } catch (e) { return ok({ error: 'IMPORT_FAILED', message: e.message }, 500); }
    return ok({ created, errors });
  }

  return ok({ error: 'NO_ROUTE' }, 404);
}
