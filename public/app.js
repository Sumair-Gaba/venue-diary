// Venue Diary — owner web dashboard (vanilla SPA). UI language: English.

// ---- api + auth -----------------------------------------------------------
let TOKEN = localStorage.getItem('vd_token') || null;
let ADMIN_VENUE = null; // when an admin is viewing a specific banquet

// Typed errors so callers can tell a dropped connection from an expired login.
function apiError(kind, msg) { const e = new Error(msg || kind); e[kind] = true; return e; }

async function req(method, p, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  if (ADMIN_VENUE) headers['X-Venue-Id'] = String(ADMIN_VENUE);
  let r;
  try {
    r = await fetch('/api/' + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw apiError('network', 'Network error'); // offline / server unreachable
  }
  if (r.status === 401 && !p.startsWith('auth/')) { sessionExpired(); throw apiError('unauthorized'); }
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}
const api = {
  get: async (p) => (await req('GET', p)).data,
  post: (p, b) => req('POST', p, b),
  patch: (p, b) => req('PATCH', p, b),
  del: (p) => req('DELETE', p),
};

const $ = (s, r = document) => r.querySelector(s);
const el = (t) => Object.assign(document.createElement('div'), t);
const ic = (id) => `<svg><use href="#${id}"/></svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => 'Rs ' + Number(n || 0).toLocaleString('en-IN');
const initials = (name) => name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const EVENTS = ['Mehndi','Barat','Walima','Nikah','Corporate','Other'];
const METHODS = ['Cash','Bank transfer','Cheque','Other'];
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso) => new Date(iso + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : '';
const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const originBase = () => location.origin.replace(/\/$/, '');

// ---- customer messaging (free, no paid API — opens the owner's own app) ----
// WhatsApp uses wa.me (country code, no +); SMS uses the sms: URI. Both open a
// prefilled message the owner reviews and sends. Automated sending would need a
// paid provider (Twilio / WhatsApp Business API) — not wired here.
const phoneDigits = (p) => String(p || '').replace(/\D/g, '');
const waLink = (phone, text) => `https://wa.me/${phoneDigits(phone)}?text=${encodeURIComponent(text)}`;
const smsLink = (phone, text) => `sms:${String(phone || '').replace(/[^\d+]/g, '')}?body=${encodeURIComponent(text)}`;
const venueName = () => (VENUE && VENUE.name) || 'our venue';
const msgBalance = (name, date, amount) => `Hello ${name || ''}, a reminder from ${venueName()}: your booking on ${date} has a pending balance of ${fmt(amount)}. Kindly clear it at your convenience. Thank you.`;
const msgEvent = (name, date, hall) => `Hello ${name || ''}, a reminder from ${venueName()}: your event is on ${date}${hall ? ' at ' + hall : ''}. We look forward to hosting you.`;
const msgTentative = (name, date) => `Hello ${name || ''}, regarding your tentative booking on ${date} with ${venueName()} — please confirm at your convenience so we can hold the date for you.`;
function alertMsg(a) {
  if (a.type === 'balance') return msgBalance(a.name, a.date, a.amount);
  if (a.type === 'event_today' || a.type === 'event_tomorrow') return msgEvent(a.name, a.date, a.hall);
  if (a.type === 'tentative') return msgTentative(a.name, a.date);
  return `Hello ${a.name || ''}, a message from ${venueName()}.`;
}
const pill = (status) => `<span class="pill p-${status}"><span class="dt"></span>${cap(status)}</span>`;
const kpi = (icon, n, label) => `<div class="kpi"><div class="ico">${ic(icon)}</div><div class="kmeta"><div class="n">${n}</div><div class="l">${label}</div></div></div>`;
const emptyState = (icon, text) => `<div class="empty"><span class="empty-ic">${ic(icon)}</span><span>${esc(text)}</span></div>`;
// A claimed/owner-managed venue shows a "Verified" trust badge.
const verifiedBadge = (on, sm) => on ? `<span class="verified${sm ? ' sm' : ''}" title="Owner-verified venue">${ic('i-check')}Verified</span>` : '';

// ---- date-based flat pricing ---------------------------------------------
// Banquets charge a flat complete price per hall+slot. Pricing rules adjust
// that price by date: flat_add charges stack (e.g. weekend + wedding season
// both add), while a flat_set rule overrides the whole price. A single-date
// set beats a season set beats a weekend set. Returns the total + what applied.
const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function resolveFlatPrice(base, dateISO, rules = (VENUE && VENUE.pricing) || []) {
  base = Number(base) || 0;
  if (!dateISO || !rules.length) return { base, total: base, adds: [], setRule: null };
  const dow = new Date(dateISO + 'T00:00').getDay();
  const matches = rules.filter((r) =>
    r.kind === 'date' ? r.start_date === dateISO
    : r.kind === 'range' ? (r.start_date && r.end_date && dateISO >= r.start_date && dateISO <= r.end_date)
    : String(r.weekdays || '').split(',').map(Number).includes(dow));
  const sets = matches.filter((r) => r.adj_type === 'flat_set');
  const setRule = sets.find((r) => r.kind === 'date') || sets.find((r) => r.kind === 'range') || sets.find((r) => r.kind === 'weekday') || null;
  if (setRule) return { base, total: Math.max(0, Math.round(setRule.adj_value)), adds: [], setRule };
  const adds = matches.filter((r) => r.adj_type === 'flat_add');
  const total = base + adds.reduce((s, r) => s + Math.round(r.adj_value), 0);
  return { base, total: Math.max(0, total), adds, setRule: null };
}
function ruleAdjText(r) {
  if (!r) return '';
  if (r.adj_type === 'flat_set') return '= ' + fmt(r.adj_value);
  return (r.adj_value >= 0 ? '+' : '− ') + fmt(Math.abs(r.adj_value));
}
function ruleLabel(r) {
  if (!r) return '';
  if (r.label) return r.label;
  if (r.kind === 'weekday') return String(r.weekdays || '').split(',').map(Number).map((n) => WD_SHORT[n]).join('/');
  if (r.kind === 'range') return 'Season';
  return 'Date rate';
}
// The flat complete price saved for a hall + slot (0 if none set).
function hallSlotPrice(hallId, slotId) {
  const hp = (VENUE.hall_prices || []).find((p) => p.hall_id === Number(hallId) && p.slot_id === Number(slotId));
  return hp ? hp.price : 0;
}
// Tables needed for a guest count (banquet rounds seat ~10).
const tablesFor = (guests, seats = 10) => guests ? Math.ceil(guests / seats) : 0;

let VENUE = null;
let ME = null;

// ---- feature flags (platform-controlled per tenant) ----
// Core modules are always available; optional ones depend on what the admin
// enabled for this banquet (VENUE.features). See FEATURE_CATALOG on the server.
const CORE_FEATURES = ['home', 'bookings', 'settings', 'booking'];
const OPTIONAL_FEATURES = ['calendar', 'payments', 'calculator', 'import', 'media', 'decor', 'leads'];
function featureOn(key) { return CORE_FEATURES.includes(key) || (VENUE?.features || []).includes(key); }
// Show only the nav links whose feature is enabled.
function applyFeatureNav() {
  document.querySelectorAll('#nav a[data-feature]').forEach((a) => { a.style.display = featureOn(a.dataset.feature) ? '' : 'none'; });
}
let calState = { month: todayISO().slice(0, 7), hall: 1 };
let listenerSet = false;

function toast(msg, wa) {
  const t = el({ className: 'toast', innerHTML: (wa ? ic('i-wa') : ic('i-check')) + `<span>${esc(msg)}</span>` });
  $('#toast-root').append(t); setTimeout(() => t.remove(), 3200);
}

// Run an async action with a button spinner so the user always sees that their
// click registered. Disables the button while busy and surfaces a clear,
// English message on any failure (network drop, server error, expired session).
async function withBusy(btn, fn) {
  if (!btn || btn.classList.contains('loading')) return; // ignore double taps
  btn.classList.add('loading'); btn.disabled = true;
  try {
    await fn();
  } catch (e) {
    if (e && e.unauthorized) return;                    // session-expired flow already took over
    toast(e && e.network ? 'Network error — please check your connection and try again.'
                         : 'Something went wrong. Please try again.');
  } finally {
    btn.classList.remove('loading'); btn.disabled = false;
  }
}
// Convenience: turn an onclick handler into a busy-guarded one.
const busy = (fn) => (e) => withBusy(e.currentTarget, () => fn(e));

// The token the server gave us is no longer valid — bounce cleanly to sign-in.
function sessionExpired() {
  if (!TOKEN) return;           // already signed out
  TOKEN = null; localStorage.removeItem('vd_token');
  ADMIN_VENUE = null; VENUE = null; ME = null; ALERTS = [];
  closeModal(); closeNotif();
  toast('Your session has expired. Please sign in again.');
  location.hash = '#/home'; renderLogin();
}
function setNav(page) {
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#/' + page));
}
function bindRows() {
  document.querySelectorAll('.row[data-id]').forEach((r) => r.onclick = () => (location.hash = '#/booking/' + r.dataset.id));
}

// ---- login ----------------------------------------------------------------
// The root URL (/) and /admin show the admin login (email + password). Every
// other path is a banquet slug (e.g. /shalimar-grand) and shows that banquet's
// branded owner login (phone + OTP).
function getPathMode() {
  const p = location.pathname.replace(/\/+$/, '').toLowerCase(); // '' at root
  if (p === '' || p === '/admin') return { mode: 'admin' };
  return { mode: 'owner', slug: p.replace(/^\//, '').split('/')[0] };
}
// Put (and keep) the owner's banquet name in the address bar: /<slug>.
function setOwnerUrl(slug) {
  if (!slug) return;
  const want = '/' + slug;
  if (location.pathname.replace(/\/+$/, '').toLowerCase() !== want)
    history.replaceState(null, '', want + (location.hash || ''));
}

async function renderLogin() {
  $('#app').hidden = true;
  const { mode, slug } = getPathMode();
  if (mode === 'owner') return renderPublicVenue(slug);
  $('#login').innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <div class="auth-logo">${ic('i-gear')}</div>
    <h2>Venue Diary</h2>
    <p class="auth-sub">Admin sign in · email &amp; password</p>
    <div id="auth-step"></div>
  </div><div class="auth-foot">Echo DMC · admin panel</div></div>`;
  adminLoginStep();
}
// Branded owner login for a specific banquet slug.
// The branded owner sign-in card (phone + OTP), reached from the public page.
function showOwnerLoginCard(slug, v) {
  $('#login').innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <div class="auth-logo">${ic('i-cal')}</div>
    <h2>${esc(v.name)}</h2>
    <p class="auth-sub">Owner sign in · phone &amp; OTP</p>
    <div id="auth-step"></div>
    <button class="linkbtn" id="backPub" style="margin-top:14px">← Back to venue page</button>
  </div><div class="auth-foot">${esc([v.city, v.area].filter(Boolean).join(', ') || 'Banquet owner portal')}</div></div>`;
  $('#backPub').onclick = () => renderPublicVenue(slug, v);
  phoneStep();
}

// Public, customer-facing venue page at /<slug>: photos, decor, transparent
// pricing and an enquiry form. An "Owner login" button opens the sign-in card.
async function renderPublicVenue(slug, cached) {
  $('#app').hidden = true;
  const v = cached || await api.get('public/venue?slug=' + encodeURIComponent(slug));
  if (!v || v.error) {
    $('#login').innerHTML = `<div class="auth-wrap"><div class="auth-card">
      <div class="auth-logo">${ic('i-warn')}</div>
      <h2>Banquet not found</h2>
      <p class="auth-sub">No banquet is registered at this link. Please check the URL with your administrator (Echo DMC).</p>
    </div><div class="auth-foot">Venue Diary</div></div>`;
    return;
  }
  const loc = [v.city, v.area].filter(Boolean).join(', ');
  const photos = (v.media || []).filter((m) => m.kind !== 'video').slice(0, 12);
  const priceOf = (h, s) => (v.hall_prices || []).find((p) => p.hall_id === h && p.slot_id === s)?.price || 0;
  const adds = (v.pricing || []).filter((r) => r.adj_type === 'flat_add');
  const cap = v.capacity_min && v.capacity_max ? `${v.capacity_min}–${v.capacity_max} guests` : (v.capacity_max ? `up to ${v.capacity_max} guests` : '');
  const priceTable = v.halls.length && v.slots.length ? `
    <div class="pub-pricewrap"><table class="pub-price">
      <thead><tr><th>Hall</th>${v.slots.map((s) => `<th>${esc(s.name)}</th>`).join('')}</tr></thead>
      <tbody>${v.halls.map((h) => `<tr><td class="hn">${esc(h.name)}${h.capacity ? `<span>cap ${h.capacity}</span>` : ''}</td>
        ${v.slots.map((s) => { const p = priceOf(h.id, s.id); return `<td>${p ? fmt(p) : '<span class="pub-dash">—</span>'}</td>`; }).join('')}</tr>`).join('')}</tbody>
    </table></div>
    ${adds.length ? `<div class="pub-addnote">${adds.map((r) => `<span>${esc(ruleLabel(r))}: <b>${ruleAdjText(r)}</b></span>`).join('')}</div>` : ''}
    <div class="pub-note">Prices are the complete, flat event price — no per-head charges. Weekend &amp; season charges apply as shown.</div>` : `<div class="pub-note">Contact us for pricing.</div>`;
  $('#login').innerHTML = `<div class="pub">
    <header class="pub-top">
      <div class="pub-brand"><span class="mk"><svg><use href="#i-cal"/></svg></span>
        <div><b>${esc(v.name)}</b>${loc ? `<span>${esc(loc)}</span>` : ''}</div></div>
      <button class="btn btn-sec btn-sm" id="pubLogin">Owner login</button>
    </header>
    <div class="pub-wrap">
      <section class="pub-hero">
        <h1>${esc(v.name)} ${verifiedBadge(v.verified)}</h1>
        <div class="pub-sub">${esc([loc, cap].filter(Boolean).join(' · '))}${v.address ? `<br>${esc(v.address)}` : ''}</div>
        ${(v.facilities || []).length ? `<div class="chips">${v.facilities.map((f) => `<span class="chip on">${esc(f)}</span>`).join('')}</div>` : ''}
      </section>
      ${v.claimable ? `<section class="pub-card pub-claim">
        <div class="pub-claim-txt"><h2>Is this your venue?</h2>
          <p class="pub-note">Claim this listing to manage your bookings, prices and photos — free. We'll verify your phone and review your request.</p></div>
        <button class="btn btn-pri" id="pubClaim">${ic('i-home')}Claim this venue</button>
      </section>` : ''}
      <div class="pub-gal">${carouselHTML(photos.map((m) => m.url), { h: 360, round: '16px' })}</div>
      <section class="pub-card"><h2>Pricing</h2>${priceTable}</section>
      ${(v.decor || []).length ? `<section class="pub-card"><h2>Decor &amp; Stage</h2>
        <div class="media-grid">${v.decor.map((d) => `<div class="media-item decor-card">
          ${d.image_url ? `<img class="lb-img" data-src="${esc(d.image_url)}" src="${esc(d.image_url)}" loading="lazy" alt="${esc(d.name)}">` : `<div class="decor-noimg">${ic('i-image')}</div>`}
          <div class="decor-body"><div class="decor-top"><span class="decor-name">${esc(d.name)}</span><span class="decor-price">${fmt(d.price)}</span></div></div>
        </div>`).join('')}</div></section>` : ''}
      <section class="pub-card pub-enq">
        <h2>Send an enquiry</h2>
        <div class="pub-note" style="margin-bottom:10px">Tell us your date and we'll get back to you.</div>
        <div id="enqBody">
          <div class="two"><div><label class="fl">Your name <span class="req">*</span></label><input class="field" id="eq_name" placeholder="Full name"></div>
            <div><label class="fl">Phone</label><input class="field" id="eq_phone" placeholder="+92 3XX XXXXXXX"></div></div>
          <div class="two"><div><label class="fl">Event date</label><input class="field" type="date" id="eq_date"></div>
            <div><label class="fl">Event type</label><select class="field" id="eq_event"><option value="">—</option>${EVENTS.map((e) => `<option>${e}</option>`).join('')}</select></div></div>
          <div class="two"><div><label class="fl">Guests</label><input class="field" type="number" id="eq_guests" placeholder="450"></div>
            <div><label class="fl">Hall</label><select class="field" id="eq_hall"><option value="">Any</option>${v.halls.map((h) => `<option value="${h.id}">${esc(h.name)}</option>`).join('')}</select></div></div>
          <label class="fl">Message</label><textarea class="field" id="eq_msg" placeholder="Any details or questions…"></textarea>
          <button class="btn btn-pri" id="eq_send" style="margin-top:14px">${ic('i-wa')}Send enquiry</button>
        </div>
      </section>
    </div>
    <footer class="pub-foot">Powered by Venue Diary</footer>
  </div>`;
  $('#pubLogin').onclick = () => showOwnerLoginCard(slug, v);
  if ($('#pubClaim')) $('#pubClaim').onclick = () => showClaimCard(slug, v);
  initCarousels('#login'); bindLightbox('#login');
  $('#eq_send').onclick = busy(async () => {
    const name = $('#eq_name').value.trim();
    if (!name) return toast('Please enter your name');
    const body = { name, phone: $('#eq_phone').value.trim(), event_date: $('#eq_date').value || null,
      event_type: $('#eq_event').value || null, guests: Number($('#eq_guests').value) || null, hall_id: Number($('#eq_hall').value) || null,
      message: $('#eq_msg').value.trim() || null };
    const r = await api.post('public/enquiry?slug=' + encodeURIComponent(slug), body);
    if (!r.ok) return toast(r.data.message || 'Could not send. Please try again.');
    $('#enqBody').innerHTML = `<div class="ok">${ic('i-check')}Thank you! Your enquiry has been sent — ${esc(v.name)} will contact you soon.</div>`;
  });
}
// ---- owner-claim flow (public page → verify phone → submit claim) ----------
// A directory listing can be claimed by its real owner. We verify the phone by
// OTP (reusing the owner auth), then POST the claim for admin review.
function showClaimCard(slug, v) {
  $('#login').innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <div class="auth-logo">${ic('i-home')}</div>
    <h2>Claim ${esc(v.name)}</h2>
    <p class="auth-sub">Verify your phone to request this listing</p>
    <div id="auth-step"></div>
    <button class="linkbtn" id="backPub" style="margin-top:14px">← Back to venue page</button>
  </div><div class="auth-foot">We'll review your request before handing over the dashboard.</div></div>`;
  $('#backPub').onclick = () => renderPublicVenue(slug, v);
  claimDetailsStep(slug, v);
}
function claimDetailsStep(slug, v, prefill = {}) {
  $('#auth-step').innerHTML = `
    <label class="fl">Your name <span class="req">*</span></label>
    <input class="field" id="c_name" placeholder="Owner / manager name" value="${esc(prefill.name || '')}">
    <label class="fl">Phone number <span class="req">*</span></label>
    <input class="field" id="c_phone" placeholder="+92 3XX XXXXXXX" autocomplete="tel" value="${esc(prefill.phone || '')}">
    <label class="fl">Note <span class="opt">(optional)</span></label>
    <textarea class="field" id="c_note" placeholder="Anything that helps us verify you own this venue">${esc(prefill.note || '')}</textarea>
    <button class="btn btn-pri" id="c_send" style="width:100%;margin-top:16px">Send code</button>`;
  $('#c_send').onclick = busy(async () => {
    const name = $('#c_name').value.trim(), phone = $('#c_phone').value.trim();
    const note = $('#c_note').value.trim();
    if (!name) return toast('Please enter your name');
    if (!phone) return toast('Please enter a phone number');
    const r = await api.post('auth/request-otp', { phone });
    if (!r.ok) return toast(r.data.message || 'Could not send the code. Please try again.');
    claimOtpStep(slug, v, { name, phone, note }, r.data.devCode);
  });
}
function claimOtpStep(slug, v, info, devCode) {
  $('#auth-step').innerHTML = `
    <label class="fl">Enter the 4-digit code sent to ${esc(info.phone)}</label>
    <input class="field otp-input" id="c_code" maxlength="4" inputmode="numeric" placeholder="----">
    ${devCode ? `<div class="devcode">Dev mode — your code is <b>${devCode}</b></div>` : ''}
    <button class="btn btn-pri" id="c_verify" style="width:100%;margin-top:16px">Verify &amp; submit claim</button>
    <button class="btn btn-sec" id="c_back" style="width:100%;margin-top:8px">Back</button>`;
  const code = $('#c_code'); code.focus();
  code.onkeydown = (e) => { if (e.key === 'Enter') $('#c_verify').click(); };
  $('#c_back').onclick = () => claimDetailsStep(slug, v, info);
  $('#c_verify').onclick = busy(async () => {
    if (!code.value.trim()) return toast('Please enter the 4-digit code');
    const vr = await api.post('auth/verify', { phone: info.phone, code: code.value.trim(), name: info.name });
    if (!vr.ok) return toast(vr.data.message || 'Invalid or expired code');
    TOKEN = vr.data.token; localStorage.setItem('vd_token', TOKEN);
    const cr = await api.post('claims', { slug, name: info.name, phone: info.phone, note: info.note });
    if (!cr.ok) {
      if (cr.status === 409) return claimDone(slug, v, 'owned');
      return toast(cr.data.message || 'Could not submit your claim. Please try again.');
    }
    claimDone(slug, v, cr.data.resubmitted ? 'resubmitted' : 'submitted');
  });
}
function claimDone(slug, v, kind) {
  const msg = kind === 'owned'
    ? `This venue has already been claimed. If you believe this is a mistake, please contact the admin (Echo DMC).`
    : `Thank you! Your claim for <b>${esc(v.name)}</b> has been ${kind === 'resubmitted' ? 'updated' : 'submitted'}. We'll review it and, once approved, you can sign in as the owner to manage this venue.`;
  $('#auth-step').innerHTML = `<div class="ok">${ic('i-check')}<span>${msg}</span></div>
    <button class="btn btn-sec" id="c_toowner" style="width:100%;margin-top:16px">Go to owner sign-in</button>
    <button class="btn btn-sec" id="c_topub" style="width:100%;margin-top:8px">Back to venue page</button>`;
  $('#c_toowner').onclick = () => showOwnerLoginCard(slug, v);
  $('#c_topub').onclick = () => renderPublicVenue(slug, v);
}

function phoneStep() {
  $('#auth-step').innerHTML = `
    <label class="fl">Phone number</label>
    <input class="field" id="a_phone" placeholder="+92 3XX XXXXXXX" autocomplete="tel">
    <button class="btn btn-pri" id="a_send" style="width:100%;margin-top:16px">Send OTP</button>`;
  $('#a_phone').onkeydown = (e) => { if (e.key === 'Enter') $('#a_send').click(); };
  $('#a_send').onclick = busy(async () => {
    const phone = $('#a_phone').value.trim();
    if (!phone) return toast('Please enter a phone number');
    const r = await api.post('auth/request-otp', { phone });
    if (!r.ok) return toast(r.data.message || 'Could not send the code. Please try again.');
    otpStep(phone, r.data.devCode);
  });
}
// Admin signs in with email + password (owners use phone + OTP).
function adminLoginStep() {
  $('#auth-step').innerHTML = `
    <label class="fl">Admin email</label>
    <input class="field" id="ad_email" type="email" placeholder="admin@echodmc.com" autocomplete="username">
    <label class="fl">Password</label>
    <input class="field" id="ad_pass" type="password" placeholder="••••••••" autocomplete="current-password">
    <button class="btn btn-pri" id="ad_in" style="width:100%;margin-top:16px">Sign in</button>`;
  $('#ad_pass').onkeydown = (e) => { if (e.key === 'Enter') $('#ad_in').click(); };
  $('#ad_in').onclick = busy(async () => {
    const email = $('#ad_email').value.trim(), password = $('#ad_pass').value;
    if (!email || !password) return toast('Please enter your email and password');
    const r = await api.post('auth/admin-login', { email, password });
    if (!r.ok) return toast(r.data.message || 'Sign in failed. Please try again.');
    TOKEN = r.data.token; localStorage.setItem('vd_token', TOKEN);
    await enterApp();
  });
}
function otpStep(phone, devCode) {
  $('#auth-step').innerHTML = `
    <label class="fl">Enter the 4-digit code</label>
    <input class="field otp-input" id="a_code" maxlength="4" inputmode="numeric" placeholder="----">
    ${devCode ? `<div class="devcode">Dev mode — your code is <b>${devCode}</b></div>` : ''}
    <button class="btn btn-pri" id="a_verify" style="width:100%;margin-top:16px">Verify &amp; sign in</button>
    <button class="btn btn-sec" id="a_back" style="width:100%;margin-top:8px">Back</button>`;
  const code = $('#a_code'); code.focus();
  code.onkeydown = (e) => { if (e.key === 'Enter') $('#a_verify').click(); };
  $('#a_back').onclick = phoneStep;
  $('#a_verify').onclick = busy(async () => {
    if (!code.value.trim()) return toast('Please enter the 4-digit code');
    const r = await api.post('auth/verify', { phone, code: code.value.trim() });
    if (!r.ok) return toast(r.data.message || 'Invalid or expired code');
    TOKEN = r.data.token; localStorage.setItem('vd_token', TOKEN);
    await enterApp();
  });
}
// Decide where to land after sign-in: admin panel, owner dashboard, or a
// "not set up yet" notice for owners whose banquet the admin hasn't created.
async function enterApp() {
  ME = await api.get('me');
  if (ME && ME.role === 'admin') { ADMIN_VENUE = null; return renderAdmin(); }
  if (!ME || !ME.hasVenue) return renderNoVenue();
  ADMIN_VENUE = null;
  VENUE = await api.get('venue');
  setOwnerUrl(ME.slug);   // keep /<banquet-slug> in the address bar
  startApp();
}
function logout() {
  TOKEN = null; localStorage.removeItem('vd_token');
  closeNotif(); ALERTS = [];
  location.hash = '#/home'; renderLogin();
}

// ---- ADMIN panel (platform/Echo DMC) --------------------------------------
let FEATURE_CAT = null;
async function renderAdmin() {
  $('#app').hidden = true;
  const list = await api.get('admin/venues');
  if (!FEATURE_CAT) FEATURE_CAT = (await api.get('admin/features')).catalog || [];
  const claims = (await api.get('admin/claims')) || [];
  const areas = [...new Set(list.map((v) => v.area).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  $('#login').innerHTML = `<div class="admin-wrap">
    <div class="admin-top">
      <div class="brand"><span class="mk">${ic('i-cal')}</span><div><b>VENUE DIARY</b><span>ADMIN PANEL</span></div></div>
      <div class="admin-actions">
        <button class="btn btn-sec" id="ad_claims">${ic('i-bell')}Claims${claims.length ? `<span class="badge-count">${claims.length}</span>` : ''}</button>
        <button class="btn btn-pri" id="ad_new">${ic('i-plus')}Register new banquet</button>
        <button class="btn btn-sec" id="ad_logout">${ic('i-logout')}Log out</button>
      </div>
    </div>
    <div class="admin-body">
      <div class="page-h"><div><h1>Banquets</h1><div class="sub" id="ad_count">${list.length} registered</div></div></div>
      <div class="ad-filters" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">
        <input class="field" id="ad_search" placeholder="Search by name…" style="flex:1;min-width:200px;margin:0">
        <select class="field" id="ad_area" style="flex:none;width:auto;min-width:170px;margin:0">
          <option value="">All areas</option>
          ${areas.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}
        </select>
      </div>
      <div class="admin-grid" id="ad_grid"></div>
      <div id="ad_pager" style="display:flex;justify-content:center;align-items:center;gap:14px;margin:26px 0 8px"></div>
    </div></div>`;
  $('#ad_logout').onclick = () => { if (confirm('Log out?')) logout(); };
  $('#ad_new').onclick = registerBanquetModal;
  $('#ad_claims').onclick = () => claimsModal(claims);

  const PER_PAGE = 30;
  let page = 1, q = '', area = '';
  const card = (v) => `
    <div class="vcard">
      <div style="margin:-2px -2px 12px">${carouselHTML(v.photos, { h: 160, round: '12px 12px 0 0' })}</div>
      <div class="vcard-h"><div class="vname">${esc(v.name)} ${verifiedBadge(v.verified, true)}</div><span class="pill p-confirmed"><span class="dt"></span>${v.hall_count} halls</span></div>
      <div class="vmeta">${ic('i-home')} ${esc(v.address || [v.area, v.city].filter(Boolean).join(', ') || '—')}</div>
      <div class="vmeta">${ic('i-users')} ${esc(v.owner_name || 'Owner')} · ${esc(v.owner_phone || '—')}</div>
      <div class="vmeta">${ic('i-book')} ${v.booking_count} bookings</div>
      <div class="vmeta">${ic('i-gear')} ${(v.features || []).length} of ${FEATURE_CAT.length} features on</div>
      ${v.slug ? `<div class="vlink" data-copy="${esc(originBase() + '/' + v.slug)}" title="Copy owner link">${ic('i-link')}<span>/${esc(v.slug)}</span><span class="vlink-copy">Copy</span></div>` : ''}
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn btn-sec btn-sm" data-feat="${v.id}" style="flex:none">${ic('i-gear')}Features</button>
        <button class="btn btn-sec btn-sm" data-open="${v.id}" style="flex:1">Open dashboard ${ic('i-chev-r')}</button>
        <button class="btn btn-danger btn-sm" data-del="${v.id}" style="flex:none" title="Delete banquet">${ic('i-trash')}</button>
      </div>
    </div>`;
  const draw = () => {
    const filtered = list.filter((v) =>
      (!area || v.area === area) && (!q || v.name.toLowerCase().includes(q)));
    const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    if (page > pages) page = pages;
    const slice = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    $('#ad_count').textContent = `${filtered.length} banquet${filtered.length === 1 ? '' : 's'}${area ? ' in ' + area : ''}${q ? ` matching “${q}”` : ''}`;
    $('#ad_grid').innerHTML = slice.length ? slice.map(card).join('') : emptyState('i-home', 'No banquets match your filters.');
    initCarousels('#ad_grid'); bindLightbox('#ad_grid');
    $('#ad_pager').innerHTML = filtered.length > PER_PAGE ? `
      <button class="btn btn-sec btn-sm" id="pg_prev" ${page <= 1 ? 'disabled' : ''}>${ic('i-chev-l')}Prev</button>
      <span class="mono">Page ${page} of ${pages}</span>
      <button class="btn btn-sec btn-sm" id="pg_next" ${page >= pages ? 'disabled' : ''}>Next${ic('i-chev-r')}</button>` : '';
    $('#ad_grid').querySelectorAll('[data-open]').forEach((b) => b.onclick = busy(() => openBanquet(Number(b.dataset.open))));
    $('#ad_grid').querySelectorAll('[data-feat]').forEach((b) => b.onclick = () => manageFeaturesModal(list.find((v) => v.id === Number(b.dataset.feat))));
    $('#ad_grid').querySelectorAll('[data-copy]').forEach((b) => b.onclick = async (e) => {
      e.stopPropagation();
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('Owner link copied'); }
      catch { toast(b.dataset.copy); }
    });
    if ($('#pg_prev')) $('#pg_prev').onclick = () => { page--; draw(); window.scrollTo(0, 0); };
    if ($('#pg_next')) $('#pg_next').onclick = () => { page++; draw(); window.scrollTo(0, 0); };
    $('#ad_grid').querySelectorAll('[data-del]').forEach((b) => b.onclick = async (e) => {
      e.stopPropagation();
      const v = list.find((x) => x.id === Number(b.dataset.del));
      const warn = v.booking_count > 0 ? `\n\n⚠ This has ${v.booking_count} booking(s) — they will be permanently deleted too.` : '';
      if (!confirm(`Delete "${v.name}"? This permanently removes the banquet and all its data and cannot be undone.${warn}`)) return;
      const r = await api.del('admin/venues/' + v.id);
      if (!r.ok) return toast(r.data.message || 'Could not delete. Please try again.');
      const i = list.indexOf(v); if (i >= 0) list.splice(i, 1);
      toast('Banquet deleted'); draw();
    });
  };
  let t; $('#ad_search').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim().toLowerCase(); page = 1; draw(); }, 200); };
  $('#ad_area').onchange = (e) => { area = e.target.value; page = 1; draw(); };
  draw();
}
async function openBanquet(id) {
  ADMIN_VENUE = id;
  VENUE = await api.get('venue');
  if (!VENUE || VENUE.needsSelection) { ADMIN_VENUE = null; return toast('Could not open this banquet'); }
  $('#login').innerHTML = '';
  if (!location.hash || location.hash === '#/') location.hash = '#/home';
  startApp();
}
function backToAdmin() { ADMIN_VENUE = null; VENUE = null; $('#app').hidden = true; renderAdmin(); }

// Admin (master) turns dashboard modules on/off for a specific banquet.
function manageFeaturesModal(v) {
  if (!v) return;
  const enabled = new Set(v.features || []);
  const cat = FEATURE_CAT || [];
  modal('Features · ' + v.name,
    `<div class="mono" style="margin-bottom:14px;color:var(--muted)">Turn modules on or off for this banquet's dashboard. Core screens (Home, Bookings, Settings) are always on.</div>
     <div class="feat-list">${cat.map((f) => `
       <label class="feat-row">
         <div class="feat-text"><div class="feat-name">${esc(f.label)}</div><div class="feat-desc">${esc(f.desc)}</div></div>
         <span class="switch"><input type="checkbox" data-k="${esc(f.key)}" ${enabled.has(f.key) ? 'checked' : ''}><span class="slider"></span></span>
       </label>`).join('')}</div>`,
    `<button class="btn btn-sec" id="ft_cancel">Cancel</button><button class="btn btn-pri" id="ft_save">${ic('i-check')}Save</button>`);
  $('#ft_cancel').onclick = closeModal;
  $('#ft_save').onclick = busy(async () => {
    const features = [...$('#modal-root').querySelectorAll('input[data-k]:checked')].map((i) => i.dataset.k);
    const r = await api.patch('admin/venues/' + v.id + '/features', { features });
    if (!r.ok) return toast(r.data.message || 'Could not save features. Please try again.');
    v.features = r.data.features; closeModal(); toast('Features updated'); renderAdmin();
  });
}
// Admin reviews owner-claim requests: approve (hand the venue over) or decline.
function claimsModal(claims) {
  const body = () => claims.length ? `<div class="claim-list">${claims.map((c) => `
    <div class="claim-row" data-row="${c.id}">
      <div class="claim-main">
        <div class="claim-venue">${esc(c.venue_name)} <span class="mono">/${esc(c.slug)}</span></div>
        <div class="vmeta">${ic('i-home')} ${esc(c.address || [c.area, c.city].filter(Boolean).join(', ') || '—')}</div>
        <div class="vmeta">${ic('i-users')} ${esc(c.name || c.claimant_name || 'Owner')} · ${esc(c.phone || c.claimant_phone || '—')}</div>
        ${c.note ? `<div class="vmeta claim-note">${ic('i-chat')} ${esc(c.note)}</div>` : ''}
      </div>
      <div class="claim-acts">
        <button class="btn btn-pri btn-sm" data-ap="${c.id}">${ic('i-check')}Approve</button>
        <button class="btn btn-sec btn-sm" data-rj="${c.id}">${ic('i-x')}Decline</button>
      </div>
    </div>`).join('')}</div>` : emptyState('i-check', 'No pending claims.');
  modal('Venue claims',
    `<div class="mono" style="margin-bottom:14px;color:var(--muted)">Owners who verified their phone and asked to manage a directory listing. Approving hands the venue over to them.</div>
     <div id="claim-body">${body()}</div>`,
    `<button class="btn btn-sec" id="cl_close">Close</button>`, 'wide');
  // Refresh the admin panel (grid + Claims badge) once, when the modal closes,
  // so any handed-over venue shows its new owner.
  let changed = false;
  $('#cl_close').onclick = () => { closeModal(); if (changed) renderAdmin(); };
  const decide = (id, action) => busy(async () => {
    const r = await api.post('admin/claims/' + id + '/' + action, {});
    if (!r.ok) return toast(r.data.message || 'Could not update this claim. Please try again.');
    toast(action === 'approve' ? 'Claim approved — venue handed over' : 'Claim declined');
    changed = true;
    const i = claims.findIndex((c) => c.id === id);
    if (i >= 0) claims.splice(i, 1);
    if (!claims.length) { closeModal(); renderAdmin(); return; }
    $('#claim-body').innerHTML = body(); bind();
  });
  const bind = () => {
    $('#claim-body').querySelectorAll('[data-ap]').forEach((b) => b.onclick = decide(Number(b.dataset.ap), 'approve'));
    $('#claim-body').querySelectorAll('[data-rj]').forEach((b) => b.onclick = decide(Number(b.dataset.rj), 'reject'));
  };
  bind();
}
function registerBanquetModal() {
  modal('Register new banquet', `
    <div class="form-sec">Banquet</div>
    <label class="fl">Banquet name <span class="req">*</span></label><input class="field" id="rb_name" placeholder="e.g. Royal Marquee">
    <label class="fl">Owner link (URL)</label>
    <div class="slug-field"><span class="slug-pre">${esc(originBase())}/</span><input class="field" id="rb_slug" placeholder="royal-marquee"></div>
    <div class="slug-hint mono">The owner opens their dashboard at this link.</div>
    <div class="two"><div><label class="fl">City</label><input class="field" id="rb_city" placeholder="Lahore"></div>
      <div><label class="fl">Area</label><input class="field" id="rb_area" placeholder="Johar Town"></div></div>
    <label class="fl">Address</label><input class="field" id="rb_address" placeholder="Street, landmark">
    <div class="two"><div><label class="fl">Min capacity</label><input class="field" type="number" id="rb_cmin" placeholder="200"></div>
      <div><label class="fl">Max capacity</label><input class="field" type="number" id="rb_cmax" placeholder="800"></div></div>

    <div class="form-sec">Halls <span class="req">*</span></div>
    <div class="mono" style="margin:-4px 0 10px;color:var(--muted)">Add every hall / lawn. Bookings are made per hall, so at least one is required.</div>
    <div id="rb_halls"></div>
    <button type="button" class="btn btn-sec btn-sm" id="rb_addhall" style="margin-top:4px">${ic('i-plus')}Add another hall</button>

    <div class="form-sec">Owner</div>
    <div class="two"><div><label class="fl">Owner name</label><input class="field" id="rb_oname" placeholder="Owner / manager"></div>
      <div><label class="fl">Owner phone <span class="req">*</span></label><input class="field" id="rb_ophone" placeholder="+92 3XX XXXXXXX"></div></div>

    <div class="form-sec">Location</div>
    ${locationPickerHTML('rb')}
    <div class="modal-note">${ic('i-users')}<span>The owner signs in with their phone (OTP) at the owner link above to see this dashboard.</span></div>`,
    `<button class="btn btn-sec" id="rb_cancel">Cancel</button><button class="btn btn-pri" id="rb_save">${ic('i-check')}Register</button>`,
    'wide');

  // Dynamic hall rows (start with one; admin adds more).
  const addHallRow = (name = '', cap = '') => {
    const row = el({ className: 'two hall-row' });
    row.innerHTML = `<div><input class="field hall-name" placeholder="Hall name (e.g. Grand Hall)" value="${esc(name)}"></div>
      <div style="display:flex;gap:8px"><input class="field hall-cap" type="number" placeholder="Capacity" value="${esc(cap)}">
      <button type="button" class="iconbtn hall-del" title="Remove">${ic('i-x')}</button></div>`;
    row.querySelector('.hall-del').onclick = () => { if ($('#rb_halls').children.length > 1) row.remove(); else toast('Keep at least one hall'); };
    $('#rb_halls').append(row);
  };
  addHallRow('Main Hall');
  $('#rb_addhall').onclick = () => addHallRow();

  // Auto-fill the slug from the name until the admin edits the slug themselves.
  let slugEdited = false;
  $('#rb_slug').oninput = () => { slugEdited = true; $('#rb_slug').value = slugify($('#rb_slug').value); };
  $('#rb_name').oninput = () => { if (!slugEdited) $('#rb_slug').value = slugify($('#rb_name').value); };

  setupLocationPicker('rb', {}, () => $('#rb_city').value);
  $('#rb_cancel').onclick = closeModal;
  $('#rb_save').onclick = busy(async () => {
    const name = $('#rb_name').value.trim(), phone = $('#rb_ophone').value.trim();
    if (!name) return toast('Please enter the banquet name');
    if (!phone) return toast('Please enter the owner phone number');
    const halls = [...$('#rb_halls').querySelectorAll('.hall-row')].map((r) => ({
      name: r.querySelector('.hall-name').value.trim(), capacity: Number(r.querySelector('.hall-cap').value) || null,
    })).filter((h) => h.name);
    if (!halls.length) return toast('Please add at least one hall');
    const r = await api.post('admin/venues', {
      name, slug: $('#rb_slug').value.trim() || slugify(name), halls,
      owner_name: $('#rb_oname').value.trim(), owner_phone: phone,
      city: $('#rb_city').value.trim(), area: $('#rb_area').value.trim(), address: $('#rb_address').value.trim(),
      capacity_min: Number($('#rb_cmin').value) || null, capacity_max: Number($('#rb_cmax').value) || null,
      ...readPicker('rb'),
    });
    if (!r.ok) return toast(r.data.message || 'Could not register this banquet. Please try again.');
    closeModal();
    toast('Banquet registered' + (r.data.slug ? ` · link: /${r.data.slug}` : ''));
    renderAdmin();
  });
}
// Owner whose banquet the admin hasn't created/handed over yet. If they have a
// venue claim in progress, show its status instead of the generic notice.
async function renderNoVenue() {
  $('#app').hidden = true;
  let claims = [];
  try { claims = await api.get('claims/mine'); } catch { claims = []; }
  const pending = (claims || []).find((c) => c.status === 'pending');
  const approved = (claims || []).find((c) => c.status === 'approved');
  const rejected = (claims || []).find((c) => c.status === 'rejected');
  let logo = 'i-home', title = 'Account pending setup', sub =
    `Your banquet hasn't been set up yet. Please contact the admin (Echo DMC) — they'll create your dashboard for you.`;
  if (pending) {
    logo = 'i-bell'; title = 'Claim under review';
    sub = `Your claim for <b>${esc(pending.venue_name)}</b> is being reviewed. Once approved, sign in here again to manage it.`;
  } else if (approved) {
    logo = 'i-check'; title = 'Claim approved';
    sub = `Your claim for <b>${esc(approved.venue_name)}</b> was approved. Sign in at /${esc(approved.slug)} to open your dashboard.`;
  } else if (rejected) {
    logo = 'i-warn'; title = 'Claim not approved';
    sub = `Your claim for <b>${esc(rejected.venue_name)}</b> wasn't approved. Please contact the admin (Echo DMC) if you think this is a mistake.`;
  }
  $('#login').innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <div class="auth-logo">${ic(logo)}</div>
    <h2>${esc(title)}</h2>
    <p class="auth-sub">${sub}</p>
    <button class="btn btn-sec" id="nv_logout" style="width:100%;margin-top:14px">Log out</button>
  </div></div>`;
  $('#nv_logout').onclick = logout;
}

// ---- router ---------------------------------------------------------------
async function route() {
  const [, page, arg] = (location.hash || '#/home').split('/');
  if (page !== 'messages') clearMsgPoll();   // stop chat polling when leaving Messages
  // Gate disabled optional modules — the admin controls these per banquet.
  if (OPTIONAL_FEATURES.includes(page) && !featureOn(page)) {
    toast('This feature is turned off for your dashboard.');
    location.hash = '#/home'; return;
  }
  try {
    if (page === 'home') return await renderHome();
    if (page === 'calendar') return await renderCalendar();
    if (page === 'bookings') return await renderBookings();
    if (page === 'leads') return await renderLeads();
    if (page === 'messages') {
      if (!featureOn('chat')) { toast('This feature is turned off for your dashboard.'); location.hash = '#/home'; return; }
      return await renderMessages(arg);
    }
    if (page === 'payments') return await renderPayments();
    if (page === 'calculator') return await renderCalculator();
    if (page === 'import') return await renderImport();
    if (page === 'settings') return await renderSettings();
    if (page === 'booking') return await renderBookingDetail(arg);
    await renderHome();
  } catch (e) {
    if (e && e.unauthorized) return; // handled by sessionExpired()
    toast(e && e.network ? 'Network error — please check your connection.' : 'Could not load this page. Please try again.');
    if ($('#view') && !$('#view').innerHTML) $('#view').innerHTML = emptyState('i-warn', 'Could not load. Check your connection and try again.');
  }
}

// ---- Home ----
async function renderHome() {
  setNav('home');
  const d = await api.get('dashboard');
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const pctCollected = d.confTotal ? Math.round(d.received / d.confTotal * 100) : 0;
  const maxT = Math.max(1, ...d.trend.map((t) => t.count));
  $('#view').innerHTML = `
    <div class="page-h"><div><h1>${greet}</h1><div class="sub">${esc(VENUE.name)} · ${fmtDate(d.today)}</div></div>
      <button class="btn btn-pri" id="hNew">${ic('i-plus')}New booking</button></div>
    <div class="kpis">
      ${kpi('i-cal', d.todays.length, 'Events today')}
      ${kpi('i-book', d.weekCount, 'Bookings this week')}
      ${kpi('i-wallet', d.outstanding.length, 'Pending payments')}
      ${kpi('i-users', VENUE.halls.length, 'Halls')}
    </div>
    <div class="grid" style="grid-template-columns:380px 1fr;align-items:start">
      <div class="focal">
        <div class="focal-top"><div class="lbl">Total outstanding</div><span class="focal-ic">${ic('i-wallet')}</span></div>
        <div class="big">${fmt(d.totalBaqaya)}</div>
        <div class="meta">Across ${d.outstanding.length} customers with pending balance</div>
        <div class="collected">
          <div class="collected-h"><span>${pctCollected}% collected</span><span class="mono">${fmt(d.received)} of ${fmt(d.confTotal)}</span></div>
          <div class="cbar"><i style="width:${pctCollected}%"></i></div>
        </div>
        <div class="spark">
          <span class="lbl">Bookings · last 6 months</span>
          <div class="spark-bars">${d.trend.map((t) => `<div class="sb"><span class="sb-bar${t.count === maxT ? ' hi' : ''}" style="height:${Math.max(6, Math.round(t.count / maxT * 100))}%"></span><span class="sb-l">${t.label}</span></div>`).join('')}</div>
        </div>
        <a href="#/payments" class="focal-link">View all payments ${ic('i-chev-r')}</a>
      </div>
      <div class="card pad"><div class="card-h"><h3>Today's events</h3><span class="mono">${fmtDate(d.today)}</span></div><div id="todayList"></div></div>
    </div>
    <div class="card pad" style="margin-top:18px"><div class="card-h"><h3>Outstanding payments</h3><a href="#/payments">View all</a></div><div id="baqList"></div></div>
    ${galleryCardHTML()}`;
  $('#hNew').onclick = () => startNewBooking();
  $('#todayList').innerHTML = d.todays.length ? d.todays.map((b) => rowBooking(b)).join('') : emptyState('i-cal', 'No events scheduled for today.');
  $('#baqList').innerHTML = d.outstanding.length ? d.outstanding.slice(0, 6).map((b) => rowBooking(b, true)).join('') : emptyState('i-check', 'All payments cleared.');
  bindRows();
  initCarousels('#view'); bindLightbox('#view');
}
// Wire every .lb-img within a container to open the lightbox.
function bindLightbox(root) {
  (root ? $(root) : document).querySelectorAll('.lb-img').forEach((im) => im.onclick = () => openLightbox(im.dataset.src, im.dataset.kind || 'image'));
}

// ---- notification bell + dropdown ----
// Alerts live behind a bell icon (with an unread count), not a dashboard card.
let ALERTS = [];
let bellOpen = false;
async function loadAlerts() {
  if (!featureOn('notifications')) { ALERTS = []; return updateBell(); }
  try { ALERTS = (await api.get('notifications')) || []; } catch { ALERTS = []; }
  updateBell();
}
function updateBell() {
  const bell = $('#bellBtn'), badge = $('#bellBadge');
  if (!bell) return;
  bell.hidden = !featureOn('notifications');
  if (badge) { badge.textContent = ALERTS.length > 9 ? '9+' : String(ALERTS.length); badge.hidden = !ALERTS.length; }
  if (bellOpen && $('#notifList'))
    $('#notifList').innerHTML = ALERTS.length ? ALERTS.map((a) => alertRowHTML(a)).join('') : emptyState('i-check', "You're all caught up.");
}
async function toggleNotif() {
  if (bellOpen) return closeNotif();
  await loadAlerts();
  const list = ALERTS.length ? ALERTS.map((a) => alertRowHTML(a)).join('') : emptyState('i-check', "You're all caught up.");
  document.body.insertAdjacentHTML('beforeend', `
    <div class="notif-overlay" id="notifOv"></div>
    <div class="notif-panel" id="notifPanel">
      <div class="card-h"><h3>Alerts &amp; reminders</h3><span class="mono">${ALERTS.length} active</span></div>
      <div id="notifList">${list}</div>
    </div>`);
  bellOpen = true;
  $('#notifOv').onclick = closeNotif;
  $('#notifPanel').querySelectorAll('.alert-open[data-id]').forEach((e) => e.onclick = () => { closeNotif(); location.hash = '#/booking/' + e.dataset.id; });
}
function closeNotif() { $('#notifOv') && $('#notifOv').remove(); $('#notifPanel') && $('#notifPanel').remove(); bellOpen = false; }

// ---- image/video lightbox ----
// Click any venue photo (dashboard gallery or Settings) to view it large.
function openLightbox(url, kind = 'image') {
  closeLightbox();
  document.body.insertAdjacentHTML('beforeend', `
    <div class="lightbox" id="lightbox">
      <button class="lightbox-x" id="lbX" title="Close">${ic('i-x')}</button>
      ${kind === 'video'
        ? `<video src="${esc(url)}" class="lightbox-media" controls autoplay playsinline></video>`
        : `<img src="${esc(url)}" class="lightbox-media" alt="">`}
    </div>`);
  const lb = $('#lightbox');
  lb.onclick = (e) => { if (e.target === lb) closeLightbox(); };
  $('#lbX').onclick = closeLightbox;
}
function closeLightbox() { $('#lightbox') && $('#lightbox').remove(); }

// ---- image carousel -------------------------------------------------------
// A swipeable photo carousel. `photos` is an array of image URLs. When empty it
// renders a clean "No photo" placeholder — never a stock/dummy image. Arrows,
// dots and the counter appear only when there is more than one photo. Call
// initCarousels(root) after inserting the HTML to wire the controls.
function carouselHTML(photos, { h = 150, round = '12px', lightbox = true } = {}) {
  const imgs = (photos || []).filter(Boolean);
  const style = `--ch:${h}px;--cr:${round}`;
  if (!imgs.length)
    return `<div class="carousel is-empty" style="${style}"><div class="carousel-noimg">${ic('i-image')}<span>No photo</span></div></div>`;
  const slides = imgs.map((u) => `<div class="carousel-slide"><img ${lightbox ? `class="lb-img" data-src="${esc(u)}"` : ''} src="${esc(u)}" loading="lazy" alt=""></div>`).join('');
  const multi = imgs.length > 1;
  const nav = multi ? `<button class="carousel-nav prev" type="button" aria-label="Previous photo">${ic('i-chev-l')}</button><button class="carousel-nav next" type="button" aria-label="Next photo">${ic('i-chev-r')}</button>` : '';
  const dots = multi ? `<div class="carousel-dots">${imgs.map((_, i) => `<button class="cdot${i ? '' : ' on'}" type="button" data-i="${i}" aria-label="Photo ${i + 1}"></button>`).join('')}</div>` : '';
  const count = multi ? `<span class="carousel-count">1/${imgs.length}</span>` : '';
  return `<div class="carousel" style="${style}"><div class="carousel-track">${slides}</div>${nav}${dots}${count}</div>`;
}
// Wire prev/next, dots and manual-swipe syncing for every carousel in a root.
function initCarousels(root) {
  (root ? $(root) : document).querySelectorAll('.carousel').forEach((c) => {
    if (c.dataset.wired) return;
    c.dataset.wired = '1';
    const track = c.querySelector('.carousel-track');
    const slides = track ? [...track.children] : [];
    if (slides.length < 2) return;
    let i = 0;
    const dots = [...c.querySelectorAll('.cdot')];
    const count = c.querySelector('.carousel-count');
    const sync = () => { dots.forEach((d, k) => d.classList.toggle('on', k === i)); if (count) count.textContent = `${i + 1}/${slides.length}`; };
    const go = (n) => { i = (n + slides.length) % slides.length; track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' }); sync(); };
    const prev = c.querySelector('.carousel-nav.prev'), next = c.querySelector('.carousel-nav.next');
    if (prev) prev.onclick = (e) => { e.stopPropagation(); go(i - 1); };
    if (next) next.onclick = (e) => { e.stopPropagation(); go(i + 1); };
    dots.forEach((d) => d.onclick = (e) => { e.stopPropagation(); go(Number(d.dataset.i)); });
    let st; track.addEventListener('scroll', () => { clearTimeout(st); st = setTimeout(() => { const n = Math.round(track.scrollLeft / track.clientWidth); if (n !== i) { i = n; sync(); } }, 80); }, { passive: true });
  });
}

function alertRowHTML(a) {
  const when = a.date ? fmtDate(a.date) : '';
  const extra = a.type === 'balance' && a.amount ? ' · ' + fmt(a.amount) : '';
  const actions = a.phone ? `
    <a class="iconbtn sm" title="Send on WhatsApp" href="${waLink(a.phone, alertMsg(a))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${ic('i-wa')}</a>
    <a class="iconbtn sm" title="Send SMS" href="${smsLink(a.phone, alertMsg(a))}" onclick="event.stopPropagation()">${ic('i-chat')}</a>` : '';
  return `<div class="alert-row sev-${esc(a.severity)}">
    <span class="alert-dot"></span>
    <div class="grow alert-open" ${a.booking_id ? `data-id="${a.booking_id}" style="cursor:pointer"` : ''}>
      <div class="nm">${esc(a.title)}</div><div class="dt">${esc(a.text)}${extra}${when ? ' · ' + when : ''}</div></div>
    <div class="alert-actions">${actions}</div></div>`;
}
// Venue photo gallery for the dashboard (uses VENUE.media loaded with the venue).
function galleryCardHTML() {
  if (!featureOn('media')) return '';
  const imgs = (VENUE.media || []).filter((m) => m.kind !== 'video').slice(0, 8);
  const body = carouselHTML(imgs.map((m) => m.url), { h: 240, round: '12px' })
    + (imgs.length ? '' : `<div class="sub" style="margin-top:10px;text-align:center">No photos yet. Add some in Settings → Photos &amp; Videos.</div>`);
  return `<div class="card pad" style="margin-top:18px"><div class="card-h"><h3>Venue photos</h3><a href="#/settings">Manage</a></div>${body}</div>`;
}
function rowBooking(b, showBal) {
  return `<div class="row click" data-id="${b.id}">
    <div class="ava">${initials(b.customer_name)}</div>
    <div class="grow"><div class="nm">${esc(b.customer_name)}${b.event_type ? ' · ' + esc(b.event_type) : ''}</div>
      <div class="dt">${esc(b.hall_name)} · ${fmtDate(b.event_date)} · ${esc(b.slot_name)}${b.guest_count ? ' · ' + b.guest_count + ' guests' : ''}</div></div>
    ${showBal ? `<div class="amt" style="color:var(--amber-txt)">${fmt(b.balance)}</div>` : pill(b.status)}</div>`;
}

// ---- Calendar ----
async function renderCalendar() {
  setNav('calendar');
  $('#view').innerHTML = `<div class="page-h"><div><h1>Calendar</h1><div class="sub">Colour shows each day's status</div></div>
    <select class="field" id="hallSel" style="width:auto">${VENUE.halls.map((h) => `<option value="${h.id}" ${h.id == calState.hall ? 'selected' : ''}>${esc(h.name)}</option>`).join('')}</select></div>
    <div class="calwrap">
      <div class="card pad"><div class="calbar"><div class="m" id="calM"></div>
        <div class="nav-b"><button class="iconbtn" id="prevM">${ic('i-chev-l')}</button><button class="iconbtn" id="nextM">${ic('i-chev-r')}</button></div></div>
        <div class="cgrid" id="cg"></div>
        <div class="legend">
          <span class="lg"><span class="s" style="background:var(--ok)"></span>Confirmed</span>
          <span class="lg"><span class="s" style="background:var(--warn)"></span>Tentative</span>
          <span class="lg"><span class="s" style="background:var(--stone)"></span>Blocked</span>
          <span class="lg"><span class="s" style="background:var(--muted2)"></span>Available</span></div></div>
      <div class="card pad" id="dayPanel">${emptyState('i-cal', 'Select a date to see its slots.')}</div>
    </div>`;
  if (!VENUE.halls.find((h) => h.id == calState.hall)) calState.hall = VENUE.halls[0].id;
  $('#hallSel').value = calState.hall;
  $('#hallSel').onchange = (e) => { calState.hall = Number(e.target.value); drawCal(); };
  $('#prevM').onclick = () => shiftMonth(-1);
  $('#nextM').onclick = () => shiftMonth(1);
  drawCal();
}
function shiftMonth(delta) {
  const [y, m] = calState.month.split('-').map(Number);
  calState.month = new Date(y, m - 1 + delta, 1).toISOString().slice(0, 7); drawCal();
}
async function drawCal() {
  const { month, hall } = calState;
  const [y, m] = month.split('-').map(Number);
  $('#calM').textContent = `${MONTHS[m - 1]} ${y}`;
  const data = await api.get(`calendar?month=${month}&hall=${hall}`);
  const first = new Date(y, m - 1, 1).getDay(), days = new Date(y, m, 0).getDate();
  const TAGS = { confirmed: 'Booked', tentative: 'Hold', blocked: 'Blocked' };
  let html = WD.map((w) => `<div class="wd">${w}</div>`).join('');
  for (let i = 0; i < first; i++) html += `<div class="d mut"></div>`;
  for (let dd = 1; dd <= days; dd++) {
    const iso = `${month}-${String(dd).padStart(2, '0')}`;
    const st = data.days[iso] || '';
    html += `<div class="d ${st} ${iso === todayISO() ? 'today' : ''}" data-date="${iso}">
      <span class="dn">${dd}</span>${st ? `<span class="dtag">${TAGS[st]}</span>` : ''}</div>`;
  }
  const cg = $('#cg'); cg.innerHTML = html;
  cg.querySelectorAll('.d[data-date]').forEach((c) => c.onclick = () => {
    cg.querySelectorAll('.d').forEach((x) => x.classList.remove('sel')); c.classList.add('sel'); showDay(c.dataset.date);
  });
}
async function showDay(date) {
  const data = await api.get(`day?date=${date}&hall=${calState.hall}`);
  const p = $('#dayPanel');
  const SLOT_TAG = { confirmed: 'Booked', tentative: 'Hold', blocked: 'Blocked' };
  p.innerHTML = `<div class="card-h"><h3>${fmtDate(date)}</h3></div>` + data.slots.map((s) => `
    <div class="slotrow">
      <div class="grow"><div class="s1">${esc(s.name)}${s.status !== 'free' ? ` <span class="pill p-${s.status}"><span class="dt"></span>${SLOT_TAG[s.status]}</span>` : ''}</div>
        <div class="s2">${s.status === 'free' ? 'Available' : s.status === 'blocked' ? 'Blocked' : (s.booking ? esc(s.booking.customer_name) + (s.booking.event_type ? ' · ' + esc(s.booking.event_type) : '') : 'Booked')}</div></div>
      ${s.status === 'free'
        ? `<div style="display:flex;gap:6px"><button class="btn btn-sec btn-sm" data-book="${s.id}">${ic('i-plus')}Book</button><button class="iconbtn" title="Block this slot" data-block="${s.id}">${ic('i-ban')}</button></div>`
        : s.status === 'blocked'
          ? `<button class="btn btn-sec btn-sm" data-unblock="${s.blockId}">Unblock</button>`
          : `<button class="btn btn-sec btn-sm" data-open="${s.booking.id}">Open</button>`}
    </div>`).join('');
  p.querySelectorAll('[data-book]').forEach((b) => b.onclick = () => openNewBooking({ date, hall: calState.hall, slot: Number(b.dataset.book) }));
  p.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => (location.hash = '#/booking/' + b.dataset.open));
  p.querySelectorAll('[data-block]').forEach((b) => b.onclick = async () => {
    const reason = prompt('Reason for blocking this slot?', 'Maintenance'); if (reason === null) return;
    await api.post('blocks', { hall: calState.hall, slot: Number(b.dataset.block), date, reason });
    toast('Slot blocked'); drawCal(); showDay(date);
  });
  p.querySelectorAll('[data-unblock]').forEach((b) => b.onclick = async () => {
    await api.del('blocks/' + b.dataset.unblock); toast('Slot unblocked'); drawCal(); showDay(date);
  });
}

// ---- Bookings ----
async function renderBookings() {
  setNav('bookings');
  $('#view').innerHTML = `<div class="page-h"><h1>Bookings</h1></div>
    <div class="filters">
      <input class="field" id="search" placeholder="Search customer…" style="max-width:240px">
      <select class="field" id="statusF" style="width:auto">
        <option value="">All statuses</option><option value="confirmed">Confirmed</option>
        <option value="tentative">Tentative</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
      </select></div><div class="card pad" id="list"></div>`;
  const load = async () => {
    const st = $('#statusF').value, q = $('#search').value;
    const rows = await api.get(`bookings?${st ? 'status=' + st + '&' : ''}${q ? 'q=' + encodeURIComponent(q) : ''}`);
    $('#list').innerHTML = rows.length ? rows.map((b) => `
      <div class="row click" data-id="${b.id}">
        <div class="ava">${initials(b.customer_name)}</div>
        <div class="grow"><div class="nm">${esc(b.customer_name)}${b.event_type ? ' · ' + esc(b.event_type) : ''}</div>
          <div class="dt">${esc(b.hall_name)} · ${fmtDate(b.event_date)} · ${esc(b.slot_name)}</div></div>
        ${b.balance > 0 && b.status !== 'cancelled' ? `<div class="amt" style="color:var(--amber-txt);margin-right:12px">${fmt(b.balance)}</div>` : ''}${pill(b.status)}</div>`).join('') : emptyState('i-book', 'No bookings found.');
    bindRows();
  };
  $('#search').oninput = load; $('#statusF').onchange = load; load();
}

// ---- Payments ----
async function renderPayments() {
  setNav('payments');
  const d = await api.get('dashboard');
  $('#view').innerHTML = `<div class="page-h"><div><h1>Payments</h1><div class="sub">Outstanding: ${fmt(d.totalBaqaya)} · ${d.outstanding.length} customers</div></div></div>
    <div class="card pad" id="list"></div>`;
  $('#list').innerHTML = d.outstanding.length ? d.outstanding.map((b) => `
    <div class="row click" data-id="${b.id}">
      <div class="ava">${initials(b.customer_name)}</div>
      <div class="grow"><div class="nm">${esc(b.customer_name)}${b.event_type ? ' · ' + esc(b.event_type) : ''}</div>
        <div class="dt">${fmtDate(b.event_date)} · received ${fmt(b.paid)} of ${fmt(b.total_amount)}</div></div>
      <div class="amt" style="color:var(--amber-txt)">${fmt(b.balance)}</div></div>`).join('') : emptyState('i-check', 'All payments cleared.');
  bindRows();
}

let calcDecor = new Set();  // decor/stage catalog item ids selected into the quote
// ---- Rate calculator (flat banquet pricing) ----
// Banquets charge a flat complete price per hall + slot (Lunch/Dinner/Full Day),
// not per head. Pick hall + slot + date and the saved price auto-fills; weekend
// and wedding-season rules add on top (or a single-date rule sets it outright).
// Guest count is only for seating (tables) — it never changes the price.
async function renderCalculator() {
  setNav('calculator');
  const evOpts = EVENTS.map((e) => `<option>${e}</option>`).join('');
  const hallOpts = VENUE.halls.map((h) => `<option value="${h.id}">${esc(h.name)}</option>`).join('');
  const slotOpts = VENUE.slots.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  $('#view').innerHTML = `
    <div class="page-h"><div><h1>Rate calculator</h1><div class="sub">Banquet quote — flat price by hall, slot &amp; date</div></div></div>
    <div class="grid" style="grid-template-columns:1fr 340px;align-items:start">
      <div class="card pad">
        <div class="two">
          <div><label class="fl">Hall</label><select class="field" id="c_hall"><option value="">—</option>${hallOpts}</select></div>
          <div><label class="fl">Function</label><select class="field" id="c_slot"><option value="">—</option>${slotOpts}</select></div>
        </div>
        <div class="two" style="margin-top:14px">
          <div><label class="fl">Event type</label><select class="field" id="c_event"><option value="">—</option>${evOpts}</select></div>
          <div><label class="fl">Event date</label><input class="field" type="date" id="c_date"></div>
        </div>
        <div style="margin-top:14px"><label class="fl">Complete hall price (Rs)</label>
          <input class="field" type="number" id="c_base" placeholder="400000">
          <div class="mono" id="c_pricenote" style="margin-top:6px;color:var(--muted)">Pick hall + function to auto-fill the saved price. Pick a date for weekend / season rates.</div></div>
        <div style="margin-top:14px"><label class="fl">Guests (for seating — doesn't change price)</label>
          <input class="field" type="number" id="c_guests" placeholder="450">
          <div class="mono" id="c_seatnote" style="margin-top:6px;color:var(--muted)"></div></div>
        ${featureOn('decor') && (VENUE.decor || []).length ? `<div class="form-sec">Decor &amp; Stage</div>
        <div class="mono" style="color:var(--muted);margin-bottom:4px">Tap to add to the quote.</div>
        <div class="decor-pick" id="c_decor"></div>` : ''}
        <div class="form-sec">Extra / fixed charges</div>
        <div id="c_extras"></div>
        <button type="button" class="btn btn-sec btn-sm" id="c_addextra" style="margin-top:6px">${ic('i-plus')}Add charge</button>
        <div class="two" style="margin-top:16px">
          <div><label class="fl">Discount (Rs)</label><input class="field" type="number" id="c_disc" placeholder="0"></div>
          <div><label class="fl">Advance received</label><input class="field" type="number" id="c_adv" placeholder="0"></div>
        </div>
      </div>
      <div class="card pad calc-sum">
        <div class="card-h"><h3>Estimate</h3></div>
        <div id="c_breakdown"></div>
        <div class="totbox"><span class="k">GRAND TOTAL</span><span class="v" id="c_total">Rs 0</span></div>
        <div class="pr" style="margin-top:8px"><span class="k">Balance due</span><span class="v" id="c_bal">Rs 0</span></div>
        <button class="btn btn-pri" id="c_book" style="width:100%;margin-top:14px">${ic('i-plus')}Create booking from quote</button>
        <button class="btn btn-sec" id="c_copy" style="width:100%;margin-top:8px">${ic('i-wa')}Copy quote text</button>
      </div>
    </div>`;

  const g = (id) => $('#' + id);
  const num = (id) => Number(g(id)?.value) || 0;

  // Read the form into a tidy object: flat hall price (+ date rules) + decor +
  // extras − discount = grand total; − advance = balance.
  function compute() {
    const base = num('c_base');
    const pr = resolveFlatPrice(base, g('c_date').value);
    const hallPrice = pr.total;
    const decorSel = (VENUE.decor || []).filter((d) => calcDecor.has(d.id));
    const decorTotal = decorSel.reduce((s, d) => s + (d.price || 0), 0);
    const extras = [...$('#c_extras').querySelectorAll('.calc-row')].map((r) => {
      const i = r.querySelectorAll('input');
      return { name: i[0].value.trim() || 'Charge', amt: Number(i[1].value) || 0 };
    }).filter((e) => e.amt);
    const extrasTotal = extras.reduce((s, e) => s + e.amt, 0);
    const discount = num('c_disc');
    const grand = Math.max(0, hallPrice + decorTotal + extrasTotal - discount);
    const advance = num('c_adv');
    const guests = num('c_guests');
    return { base, pr, hallPrice, decorSel, decorTotal, extras, extrasTotal, discount, grand, advance, balance: grand - advance, guests };
  }

  function recalc() {
    const c = compute();
    const rows = [];
    if (c.pr.setRule) {
      rows.push([`Hall price · ${esc(ruleLabel(c.pr.setRule))}`, fmt(c.hallPrice)]);
    } else {
      rows.push(['Hall price', fmt(c.base)]);
      c.pr.adds.forEach((r) => rows.push([`${esc(ruleLabel(r))} (${ruleAdjText(r)})`, fmt(r.adj_value)]));
    }
    c.decorSel.forEach((d) => rows.push([esc(d.name), fmt(d.price)]));
    c.extras.forEach((e) => rows.push([esc(e.name), fmt(e.amt)]));
    if (c.discount) rows.push(['Discount', '− ' + fmt(c.discount)]);
    if (c.advance) rows.push(['Advance received', '− ' + fmt(c.advance)]);
    $('#c_breakdown').innerHTML = rows.map(([k, v]) => `<div class="pr"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
    g('c_total').textContent = fmt(c.grand);
    g('c_bal').textContent = fmt(c.balance);
    // Price note under the complete-price field.
    const note = g('c_pricenote');
    if (c.pr.setRule) note.innerHTML = `<span style="color:var(--amber-txt)">${esc(ruleLabel(c.pr.setRule))}: price set to ${fmt(c.hallPrice)} for this date.</span>`;
    else if (c.pr.adds.length) note.innerHTML = `<span style="color:var(--amber-txt)">${c.pr.adds.map((r) => esc(ruleLabel(r)) + ' ' + ruleAdjText(r)).join(' · ')} → ${fmt(c.hallPrice)}</span>`;
    else note.innerHTML = g('c_date').value ? 'Base price (no weekend/season rule for this date).' : 'Pick hall + function to auto-fill; pick a date for weekend / season rates.';
    // Seating note.
    const hall = VENUE.halls.find((h) => h.id === Number(g('c_hall').value));
    const cap = hall && hall.capacity;
    const sn = g('c_seatnote');
    if (!c.guests) sn.innerHTML = '';
    else sn.innerHTML = `${tablesFor(c.guests)} tables (≈10/table)` + (cap ? ` · hall capacity ${cap}` + (c.guests > cap ? ` <span style="color:var(--rose)">— over capacity!</span>` : '') : '');
  }

  // Auto-fill the saved flat price for the chosen hall + slot.
  function autofillPrice() {
    const hall = Number(g('c_hall').value), slot = Number(g('c_slot').value);
    if (!hall || !slot) return;
    const p = hallSlotPrice(hall, slot);
    if (p) g('c_base').value = p;
  }

  // Decor/stage catalog cards — tap to add/remove from the quote.
  function renderDecorPicker() {
    const box = g('c_decor'); if (!box) return;
    box.innerHTML = (VENUE.decor || []).map((d) => `
      <div class="decor-opt ${calcDecor.has(d.id) ? 'on' : ''}" data-id="${d.id}">
        ${d.image_url ? `<img src="${esc(d.image_url)}" alt="" loading="lazy">` : `<div class="decor-noimg">${ic('i-image')}</div>`}
        <span class="tick">${ic('i-check')}</span>
        <div class="decor-opt-b"><span class="nm">${esc(d.name)}</span><span class="pr">${fmt(d.price)}</span></div>
      </div>`).join('');
    box.querySelectorAll('.decor-opt').forEach((card) => card.onclick = () => {
      const id = Number(card.dataset.id);
      if (calcDecor.has(id)) calcDecor.delete(id); else calcDecor.add(id);
      card.classList.toggle('on'); recalc();
    });
  }

  // Add-row builder for extra charges.
  function addRow(container, ph1, ph2, w2, v1 = '', v2 = '') {
    const row = el({ className: 'inline-add calc-row' });
    row.style.marginTop = '8px';
    row.innerHTML = `<input class="field" placeholder="${ph1}" value="${esc(v1)}">
      <input class="field" type="number" placeholder="${ph2}" style="max-width:${w2}px" value="${esc(v2)}">
      <button type="button" class="iconbtn" title="Remove">${ic('i-x')}</button>`;
    row.querySelector('button').onclick = () => { row.remove(); recalc(); };
    row.querySelectorAll('input').forEach((i) => i.oninput = recalc);
    $(container).append(row);
  }

  function createBookingFromQuote() {
    if (!VENUE.halls.length) { toast('Add a hall first (Settings → Halls)'); return; }
    if (!VENUE.slots.length) { toast('Add slots first (Settings → Slots)'); return; }
    const c = compute();
    const hall = g('c_hall').value ? Number(g('c_hall').value) : VENUE.halls[0].id;
    const slot = g('c_slot').value ? Number(g('c_slot').value) : VENUE.slots[0].id;
    openNewBooking({ date: g('c_date').value || todayISO(), hall, slot, guests: c.guests || null, price: c.grand || null, event: g('c_event').value || null });
  }

  async function copyQuote() {
    const c = compute();
    const lines = [`${VENUE.name} — Estimate`, ''];
    const hall = VENUE.halls.find((h) => h.id === Number(g('c_hall').value));
    const slot = VENUE.slots.find((s) => s.id === Number(g('c_slot').value));
    if (hall) lines.push(`Hall: ${hall.name}${slot ? ' · ' + slot.name : ''}`);
    if (g('c_date').value) lines.push(`Date: ${g('c_date').value}`);
    if (c.guests) lines.push(`Guests: ${c.guests} (${tablesFor(c.guests)} tables)`);
    if (c.pr.setRule) lines.push(`Hall price (${ruleLabel(c.pr.setRule)}): ${fmt(c.hallPrice)}`);
    else { lines.push(`Hall price: ${fmt(c.base)}`); c.pr.adds.forEach((r) => lines.push(`${ruleLabel(r)} (${ruleAdjText(r)}): ${fmt(r.adj_value)}`)); }
    c.decorSel.forEach((d) => lines.push(`${d.name}: ${fmt(d.price)}`));
    c.extras.forEach((e) => lines.push(`${e.name}: ${fmt(e.amt)}`));
    if (c.discount) lines.push(`Discount: − ${fmt(c.discount)}`);
    lines.push(`Total: ${fmt(c.grand)}`);
    if (c.advance) lines.push(`Advance: ${fmt(c.advance)}`, `Balance: ${fmt(c.balance)}`);
    try { await navigator.clipboard.writeText(lines.join('\n')); toast('Quote copied — paste into WhatsApp'); }
    catch { toast('Could not copy on this device'); }
  }

  g('c_addextra').onclick = () => addRow('#c_extras', 'e.g. Decoration', 'Amount', 130);
  ['c_base', 'c_disc', 'c_adv', 'c_guests'].forEach((id) => g(id).oninput = recalc);
  g('c_date').oninput = recalc;
  g('c_hall').onchange = () => { autofillPrice(); recalc(); };
  g('c_slot').onchange = () => { autofillPrice(); recalc(); };
  g('c_event').onchange = recalc;
  g('c_book').onclick = () => createBookingFromQuote();
  g('c_copy').onclick = () => copyQuote();
  renderDecorPicker();
  recalc();
}

// ---- Enquiries / leads (from the public page) ----
async function renderLeads() {
  setNav('leads');
  const list = await api.get('leads');
  const STAT = { new: ['New', 'tentative'], contacted: ['Contacted', 'confirmed'], closed: ['Closed', 'blocked'] };
  const hallName = (id) => (VENUE.halls.find((h) => h.id === id) || {}).name || '';
  const pubUrl = '/' + (VENUE.slug || '');
  $('#view').innerHTML = `<div class="page-h"><div><h1>Enquiries</h1><div class="sub">Customer enquiries from your public page</div></div>
      <a class="btn btn-sec btn-sm" href="${esc(pubUrl)}" target="_blank" rel="noopener">${ic('i-link')}View public page</a></div>
    ${list.length ? list.map((l) => {
      const [label, cls] = STAT[l.status] || STAT.new;
      const meta = [l.event_type, l.event_date ? fmtDate(l.event_date) : '', l.guests ? l.guests + ' guests' : '', l.hall_id ? hallName(l.hall_id) : ''].filter(Boolean).join(' · ');
      return `<div class="card pad lead-card">
        <div class="lead-h"><div><div class="nm">${esc(l.name)}${l.phone ? ` · <span class="muted">${esc(l.phone)}</span>` : ''}</div>
          ${meta ? `<div class="sub">${esc(meta)}</div>` : ''}</div>
          <span class="pill p-${cls}"><span class="dt"></span>${label}</span></div>
        ${l.message ? `<div class="lead-msg">${esc(l.message)}</div>` : ''}
        <div class="lead-acts">
          ${l.phone ? `<a class="btn btn-sec btn-sm" href="https://wa.me/${esc(l.phone.replace(/[^0-9]/g, ''))}" target="_blank" rel="noopener">${ic('i-wa')}WhatsApp</a>` : ''}
          <button class="btn btn-sec btn-sm" data-bk="${l.id}">${ic('i-plus')}Create booking</button>
          ${l.status !== 'contacted' ? `<button class="btn btn-sec btn-sm" data-st="${l.id}" data-v="contacted">Mark contacted</button>` : ''}
          ${l.status !== 'closed' ? `<button class="btn btn-sec btn-sm" data-st="${l.id}" data-v="closed">Close</button>` : ''}
          <button class="iconbtn sm" data-del="${l.id}" title="Delete">${ic('i-trash')}</button>
        </div></div>`;
    }).join('') : emptyState('i-chat', 'No enquiries yet. Share your public page link so customers can enquire.')}`;
  const byId = (id) => list.find((x) => x.id === Number(id));
  $('#view').querySelectorAll('[data-bk]').forEach((b) => b.onclick = () => {
    const l = byId(b.dataset.bk);
    openNewBooking({ name: l.name, phone: l.phone, date: l.event_date || todayISO(), event: l.event_type || null,
      hall: l.hall_id || (VENUE.halls[0] || {}).id, slot: l.slot_id || (VENUE.slots[0] || {}).id, guests: l.guests || null });
  });
  $('#view').querySelectorAll('[data-st]').forEach((b) => b.onclick = async () => {
    await api.patch('leads/' + b.dataset.st, { status: b.dataset.v }); toast('Updated'); renderLeads();
  });
  $('#view').querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Delete this enquiry?')) return;
    await api.del('leads/' + b.dataset.del); toast('Deleted'); renderLeads();
  });
}

// ---- Messages (in-app chat with customers) ----
let MSG_POLL = null;
function clearMsgPoll() { if (MSG_POLL) { clearInterval(MSG_POLL); MSG_POLL = null; } }

async function renderMessages(convId) {
  setNav('messages');
  clearMsgPoll();
  if (convId) return renderMessageThread(Number(convId));
  const list = await api.get('conversations');
  $('#view').innerHTML = `<div class="page-h"><div><h1>Messages</h1><div class="sub">Chat with customers — all in one place</div></div></div>
    ${list.length ? list.map((c) => `
      <div class="card pad lead-card msg-row" data-conv="${c.id}" style="cursor:pointer">
        <div class="lead-h"><div><div class="nm">${esc(c.consumer_name || 'Customer')}${c.consumer_phone ? ` · <span class="muted">${esc(c.consumer_phone)}</span>` : ''}</div>
          <div class="sub">${c.last_sender === 'owner' ? 'You: ' : ''}${esc(c.last_message || 'New conversation')}</div></div>
          ${c.unread > 0 ? `<span class="pill p-tentative"><span class="dt"></span>${c.unread} new</span>` : ''}</div>
      </div>`).join('') : emptyState('i-chat', 'No messages yet. Customers who message you from the app appear here.')}`;
  $('#view').querySelectorAll('[data-conv]').forEach((r) => r.onclick = () => { location.hash = '#/messages/' + r.dataset.conv; });
}

async function renderMessageThread(convId) {
  const draw = async () => {
    const r = await api.get('conversations/' + convId + '/messages');
    const msgs = (r && r.messages) || [];
    const box = $('#msgBox');
    if (box) {
      box.innerHTML = msgs.map((m) => {
        const mine = m.sender === 'owner';
        return `<div style="display:flex;justify-content:${mine ? 'flex-end' : 'flex-start'};margin:4px 0">
          <div style="max-width:72%;padding:8px 12px;border-radius:14px;font-size:14px;line-height:1.4;
            ${mine ? 'background:var(--pri,#A6324F);color:#fff;border-bottom-right-radius:4px' : 'background:#f2f2f2;color:#1a1a1a;border-bottom-left-radius:4px'}">${esc(m.body)}</div>
        </div>`;
      }).join('') || '<div class="muted" style="text-align:center;padding:30px">No messages yet.</div>';
      box.scrollTop = box.scrollHeight;
    }
  };
  $('#view').innerHTML = `
    <div class="page-h"><div><button class="btn btn-sec btn-sm" id="msgBack">${ic('i-link')}Back to messages</button></div></div>
    <div class="card" style="display:flex;flex-direction:column;height:62vh">
      <div id="msgBox" style="flex:1;overflow-y:auto;padding:14px"></div>
      <div style="display:flex;gap:8px;padding:12px;border-top:1px solid #eee">
        <input class="field" id="msgInput" placeholder="Type a reply…" style="flex:1" autocomplete="off">
        <button class="btn btn-pri" id="msgSend">Send</button>
      </div>
    </div>`;
  $('#msgBack').onclick = () => { location.hash = '#/messages'; };
  const input = $('#msgInput'), send = $('#msgSend');
  const doSend = async () => {
    const body = input.value.trim(); if (!body) return;
    input.value = ''; send.disabled = true;
    try { await api.post('conversations/' + convId + '/messages', { body }); await draw(); }
    catch { toast('Could not send. Please try again.'); }
    finally { send.disabled = false; input.focus(); }
  };
  send.onclick = doSend;
  input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doSend(); } };
  await draw();
  MSG_POLL = setInterval(draw, 5000);   // live-refresh the open thread
}

// ---- Booking detail ----
async function renderBookingDetail(id) {
  const b = await api.get('bookings/' + id);
  if (b.error) { $('#view').innerHTML = `<div class="empty">Booking not found.</div>`; return; }
  const pct = b.total_amount ? Math.round(b.paid / b.total_amount * 100) : 0;
  $('#view').innerHTML = `
    <div class="page-h"><div style="display:flex;align-items:center;gap:14px">
      <button class="iconbtn" id="backBtn">${ic('i-chev-l')}</button>
      <div><h1>${esc(b.customer_name)}</h1><div class="sub">${esc(b.customer_phone || 'No phone')} · Booking #${b.id}</div></div>
    </div><div style="display:flex;gap:8px;align-items:center">${b.status !== 'cancelled' ? `<button class="iconbtn" id="editBtn" title="Edit">${ic('i-edit')}</button>` : ''}${pill(b.status)}</div></div>
    <div class="grid" style="grid-template-columns:1fr 340px;align-items:start">
      <div class="card pad">
        <div class="card-h"><h3>Details</h3></div>
        <div class="row"><div class="grow mono">Event type</div><b>${esc(b.event_type || '—')}</b></div>
        <div class="row"><div class="grow mono">Date · Slot</div><b>${fmtDate(b.event_date)} · ${esc(b.slot_name)}</b></div>
        <div class="row"><div class="grow mono">Hall</div><b>${esc(b.hall_name)}</b></div>
        <div class="row"><div class="grow mono">Guests</div><b>${b.guest_count || '—'}</b></div>
        ${b.requirements ? `<div class="row"><div class="grow mono">Requirements</div><b style="max-width:60%;text-align:right">${esc(b.requirements)}</b></div>` : ''}
        ${b.notes ? `<div class="row"><div class="grow mono">Notes</div><b style="max-width:60%;text-align:right">${esc(b.notes)}</b></div>` : ''}
        ${featureOn('beo') && b.beo_arrival ? `<div class="row"><div class="grow mono">Arrival</div><b>${esc(b.beo_arrival)}</b></div>` : ''}
        ${featureOn('beo') && b.beo_meal_time ? `<div class="row"><div class="grow mono">Meal served</div><b>${esc(b.beo_meal_time)}</b></div>` : ''}
        ${featureOn('beo') && b.beo_contact ? `<div class="row"><div class="grow mono">On-site contact</div><b style="max-width:60%;text-align:right">${esc(b.beo_contact)}</b></div>` : ''}
        <div class="card-h" style="margin-top:22px"><h3>Payments</h3><button class="btn btn-sec btn-sm" id="addPay">${ic('i-plus')}Add payment</button></div>
        <div id="payList"></div>
        ${b.notifications && b.notifications.length ? `<div class="card-h" style="margin-top:22px"><h3>Notifications</h3></div><div id="notifs"></div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="paycard">
          <div class="pr"><span class="k">Total</span><span class="v">${fmt(b.total_amount)}</span></div>
          <div class="pr"><span class="k">Received</span><span class="v">${fmt(b.paid)}</span></div>
          <div class="pr tot"><span class="k">Balance</span><span class="v">${fmt(b.balance)}</span></div>
          <div class="bar"><i style="width:${pct}%"></i></div></div>
        <button class="btn btn-sec" id="waBtn">${ic('i-wa')}Send WhatsApp reminder</button>
        <button class="btn btn-sec" id="smsBtn">${ic('i-chat')}Send SMS reminder</button>
        ${featureOn('beo') && b.status !== 'cancelled' ? `<button class="btn btn-sec" id="beoBtn">${ic('i-book')}Print event sheet (BEO)</button>` : ''}
        ${b.status === 'tentative' ? `<button class="btn btn-pri" id="confirmBtn">${ic('i-check')}Confirm booking</button>` : ''}
        ${b.status === 'confirmed' ? `<button class="btn btn-sec" id="completeBtn">${ic('i-check')}Mark completed</button>` : ''}
        ${b.status !== 'cancelled' ? `<button class="btn btn-danger" id="cancelBtn">${ic('i-trash')}Cancel booking</button>` : ''}
      </div></div>`;
  $('#backBtn').onclick = () => (location.hash = '#/bookings');
  $('#payList').innerHTML = b.payments.length ? b.payments.map((p) => `<div class="row"><div class="grow"><div class="nm">${cap(p.method)}</div><div class="dt">${p.paid_on}</div></div><div class="amt">${fmt(p.amount)}</div></div>`).join('') : `<div class="empty">No payments yet.</div>`;
  if ($('#notifs')) $('#notifs').innerHTML = b.notifications.map((n) => `<div class="row"><div class="grow"><div class="nm">${n.template.replace(/_/g, ' ')}</div><div class="dt">${new Date(n.sent_at).toLocaleString('en-GB')}</div></div><span class="pill p-confirmed"><span class="dt"></span>${cap(n.status)}</span></div>`).join('');
  $('#addPay').onclick = () => openAddPayment(b);
  if ($('#editBtn')) $('#editBtn').onclick = () => openEditBooking(b);
  if ($('#beoBtn')) $('#beoBtn').onclick = () => printBEO(b);
  // Build the reminder message once (balance reminder if money is due, else an event reminder).
  const reminderMsg = () => b.balance > 0 ? msgBalance(b.customer_name, b.event_date, b.balance) : msgEvent(b.customer_name, b.event_date, b.hall_name);
  $('#waBtn').onclick = () => {
    if (!b.customer_phone) return toast('No phone number on this booking');
    window.open(waLink(b.customer_phone, reminderMsg()), '_blank');
    api.post(`bookings/${b.id}/remind`).catch(() => {});
    toast('Opening WhatsApp…', true);
  };
  $('#smsBtn').onclick = () => {
    if (!b.customer_phone) return toast('No phone number on this booking');
    window.location.href = smsLink(b.customer_phone, reminderMsg());
  };
  if ($('#confirmBtn')) $('#confirmBtn').onclick = busy(async () => {
    const r = await api.post(`bookings/${b.id}/confirm`);
    if (!r.ok) return toast(r.data.message || 'Could not confirm — the slot may already be booked.');
    toast('Booking confirmed · WhatsApp sent', true); renderBookingDetail(id);
  });
  if ($('#completeBtn')) $('#completeBtn').onclick = busy(async () => {
    const r = await api.post(`bookings/${b.id}/complete`);
    if (!r.ok) return toast(r.data.message || 'Could not update. Please try again.');
    toast('Marked as completed'); renderBookingDetail(id);
  });
  if ($('#cancelBtn')) $('#cancelBtn').onclick = busy(async () => {
    const reason = prompt('Reason for cancellation?'); if (reason === null) return;
    const r = await api.post(`bookings/${b.id}/cancel`, { reason });
    if (!r.ok) return toast(r.data.message || 'Could not cancel. Please try again.');
    toast('Booking cancelled'); renderBookingDetail(id);
  });
}

// ---- Banquet Event Order (BEO) — printable staff sheet ----
// Opens a clean, print-first A4 document in a new window built from the booking
// + venue details. Staff get one sheet with pax, timings, menu, setup, special
// requests and the payment position. Self-contained (inline CSS) so it prints
// identically anywhere and needs no server round-trip.
function printBEO(b) {
  const v = VENUE || {};
  const ml = (s) => esc(s || '').replace(/\n/g, '<br>');          // multi-line → <br>
  const venueLine = [v.area, v.city].filter(Boolean).join(', ');
  const addr = [v.address, venueLine].filter(Boolean).join(' · ');
  const row = (k, val) => val ? `<tr><th>${k}</th><td>${val}</td></tr>` : '';
  const block = (title, body) => body ? `<div class="sec"><h2>${title}</h2><div class="body">${body}</div></div>` : '';
  const printedOn = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Event sheet — ${esc(b.customer_name)}</title>
  <style>
    *{box-sizing:border-box} html,body{margin:0;padding:0}
    body{font:14px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;background:#f3f4f6}
    .sheet{max-width:820px;margin:18px auto;background:#fff;padding:36px 40px;box-shadow:0 2px 12px rgba(0,0,0,.08)}
    .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #111;padding-bottom:14px}
    .top .venue{font-size:20px;font-weight:700} .top .meta{font-size:12px;color:#555;margin-top:3px}
    .top .right{text-align:right} .top h1{font-size:16px;letter-spacing:1px;margin:0;text-transform:uppercase}
    .top .right .meta{margin-top:4px}
    table.kv{width:100%;border-collapse:collapse;margin:16px 0}
    table.kv th{text-align:left;width:150px;color:#555;font-weight:600;vertical-align:top;padding:5px 8px 5px 0;font-size:13px}
    table.kv td{padding:5px 0;vertical-align:top;border-bottom:1px solid #eee}
    .grid2{display:flex;gap:28px} .grid2 .col{flex:1}
    .sec{margin-top:18px} .sec h2{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#555;border-bottom:1px solid #ddd;padding-bottom:4px;margin:0 0 8px}
    .sec .body{white-space:normal;min-height:22px}
    .pay{margin-top:18px;border:1px solid #ddd;border-radius:8px;overflow:hidden}
    .pay div{display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #eee}
    .pay div:last-child{border-bottom:0} .pay .tot{font-weight:700;background:#fafafa}
    .sign{display:flex;gap:40px;margin-top:46px} .sign .s{flex:1;border-top:1px solid #111;padding-top:6px;font-size:12px;color:#555}
    .foot{margin-top:24px;text-align:center;color:#999;font-size:11px}
    .noprint{text-align:center;margin:14px}
    .noprint button{font:inherit;padding:9px 20px;border:0;border-radius:8px;background:#111;color:#fff;cursor:pointer}
    @media print{body{background:#fff} .sheet{box-shadow:none;margin:0;max-width:none;padding:0} .noprint{display:none}}
  </style></head><body>
  <div class="noprint"><button onclick="window.print()">Print / Save as PDF</button></div>
  <div class="sheet">
    <div class="top">
      <div><div class="venue">${esc(v.name || 'Banquet')}</div><div class="meta">${esc(addr)}${v.phone ? ' · ' + esc(v.phone) : ''}</div></div>
      <div class="right"><h1>Banquet Event Order</h1><div class="meta">Booking #${b.id} · ${cap(b.status)}<br>Printed ${esc(printedOn)}</div></div>
    </div>
    <div class="grid2">
      <div class="col"><table class="kv">
        ${row('Customer', esc(b.customer_name))}
        ${row('Phone', esc(b.customer_phone || '—'))}
        ${row('Event', esc(b.event_type || '—'))}
        ${row('Guests (pax)', b.guest_count || '—')}
      </table></div>
      <div class="col"><table class="kv">
        ${row('Date', fmtDate(b.event_date))}
        ${row('Function', esc(b.slot_name || '—'))}
        ${row('Hall', esc(b.hall_name || '—'))}
        ${row('Arrival', esc(b.beo_arrival || '—'))}
        ${row('Meal served', esc(b.beo_meal_time || '—'))}
      </table></div>
    </div>
    ${block('Menu / Food', ml(b.beo_menu))}
    ${block('Setup &amp; Seating', ml(b.beo_setup))}
    ${block('Special requests', ml(b.requirements))}
    ${block('On-site contact', esc(b.beo_contact || ''))}
    <div class="pay">
      <div><span>Total</span><span>${fmt(b.total_amount)}</span></div>
      <div><span>Received</span><span>${fmt(b.paid)}</span></div>
      <div class="tot"><span>Balance due</span><span>${fmt(b.balance)}</span></div>
    </div>
    <div class="sign"><div class="s">Prepared by (venue)</div><div class="s">Confirmed by (client)</div></div>
    <div class="foot">Generated by Venue Diary · ${esc(v.name || '')}</div>
  </div>
  <script>window.addEventListener('load',function(){setTimeout(function(){window.print();},250);});<\/script>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast('Allow pop-ups to open the event sheet'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

// ---- Import ----
async function renderImport() {
  setNav('import');
  $('#view').innerHTML = `<div class="page-h"><div><h1>Import old diary</h1><div class="sub">Quick-add past or existing bookings in bulk</div></div>
    <button class="btn btn-sec" id="addRow">${ic('i-plus')}Add row</button></div>
    <div class="card pad"><div style="overflow-x:auto"><table class="imp"><thead><tr>
      <th>Customer</th><th>Phone</th><th>Date</th><th>Hall</th><th>Slot</th><th>Event</th><th>Guests</th><th>Total</th><th>Status</th><th></th>
    </tr></thead><tbody id="impBody"></tbody></table></div>
    <div style="margin-top:18px;display:flex;gap:10px"><button class="btn btn-pri" id="doImport">${ic('i-upload')}Import all</button>
      <span class="mono" id="impNote" style="align-self:center"></span></div></div>`;
  const hallOpts = VENUE.halls.map((h) => `<option value="${h.id}">${esc(h.name)}</option>`).join('');
  const slotOpts = VENUE.slots.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  const evOpts = EVENTS.map((e) => `<option>${e}</option>`).join('');
  const addRow = () => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="field sm" data-f="customer_name" placeholder="Name"></td>
      <td><input class="field sm" data-f="customer_phone" placeholder="+92…"></td>
      <td><input class="field sm" type="date" data-f="date"></td>
      <td><select class="field sm" data-f="hall">${hallOpts}</select></td>
      <td><select class="field sm" data-f="slot">${slotOpts}</select></td>
      <td><select class="field sm" data-f="event_type">${evOpts}</select></td>
      <td><input class="field sm" type="number" data-f="guest_count" style="width:70px"></td>
      <td><input class="field sm" type="number" data-f="total_amount" style="width:100px"></td>
      <td><select class="field sm" data-f="status"><option value="confirmed">Confirmed</option><option value="completed">Completed</option><option value="tentative">Tentative</option></select></td>
      <td><button class="iconbtn" title="Remove">${ic('i-x')}</button></td>`;
    tr.querySelector('button').onclick = () => tr.remove();
    $('#impBody').append(tr);
  };
  $('#addRow').onclick = addRow;
  addRow(); addRow();
  $('#doImport').onclick = busy(async () => {
    const rows = [...$('#impBody').querySelectorAll('tr')].map((tr) => {
      const o = {}; tr.querySelectorAll('[data-f]').forEach((f) => o[f.dataset.f] = f.value); return o;
    }).filter((o) => o.customer_name && o.date);
    if (!rows.length) return toast('Fill at least one row (name + date)');
    const r = await api.post('import', { rows });
    if (!r.ok) return toast(r.data.message || 'Import failed. Please try again.');
    $('#impNote').textContent = `${r.data.created} imported` + (r.data.errors.length ? `, ${r.data.errors.length} skipped` : '');
    toast(`${r.data.created} bookings imported`);
    $('#impBody').innerHTML = ''; addRow();
  });
}

// ---- Settings ----
let setTab = 'profile';
async function renderSettings() {
  setNav('settings');
  VENUE = await api.get('venue');
  const tabs = [['profile', 'Venue profile'], ['halls', 'Halls'], ['slots', 'Slots'], ['rates', 'Pricing'],
    ...(featureOn('media') ? [['media', 'Photos & Videos']] : []),
    ...(featureOn('decor') ? [['decor', 'Decor & Stage']] : [])];
  if (setTab === 'media' && !featureOn('media')) setTab = 'profile';
  if (setTab === 'decor' && !featureOn('decor')) setTab = 'profile';
  $('#view').innerHTML = `<div class="page-h"><h1>Settings</h1></div>
    <div class="tabs">${tabs.map(([k, n]) => `<button class="tab ${k === setTab ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('')}</div>
    <div id="setBody"></div>`;
  document.querySelectorAll('.tab').forEach((t) => t.onclick = () => { setTab = t.dataset.tab; renderSettings(); });
  if (setTab === 'profile') setProfile();
  if (setTab === 'halls') setHalls();
  if (setTab === 'slots') setSlots();
  if (setTab === 'rates') setRates();
  if (setTab === 'media') setMedia();
  if (setTab === 'decor') setDecor();
}

// ---- Settings · Photos & Videos ----
async function setMedia() {
  const hallOpts = `<option value="">Whole venue</option>` + VENUE.halls.map((h) => `<option value="${h.id}">${esc(h.name)}</option>`).join('');
  $('#setBody').innerHTML = `<div class="card pad" style="max-width:760px">
    <div class="card-h"><h3>Photos &amp; Videos</h3></div>
    <div class="uploader">
      <label class="fl" style="margin:0 8px 0 0">Attach to</label>
      <select class="field" id="m_hall" style="max-width:200px">${hallOpts}</select>
      <input type="file" id="m_file" accept="image/*,video/*" multiple hidden>
      <button class="btn btn-pri" id="m_pick">${ic('i-upload')}Upload</button>
      <span class="mono" id="m_status"></span>
    </div>
    <div class="media-grid" id="m_grid"></div>
    <div class="mono" style="margin-top:10px">Photos upload instantly (auto-compressed). Videos need a connected Blob store. Attach to the whole venue or a specific hall.</div>
  </div>`;
  $('#m_pick').onclick = () => $('#m_file').click();
  $('#m_file').onchange = (e) => uploadMedia([...e.target.files]);
  await renderMediaGrid();
}
async function renderMediaGrid() {
  const list = await api.get('media');
  const hallName = (id) => (VENUE.halls.find((h) => h.id === id) || {}).name || 'Venue';
  $('#m_grid').innerHTML = list.length ? list.map((mi) => `
    <div class="media-item">
      ${mi.kind === 'video'
        ? `<video class="lb-img" data-src="${esc(mi.url)}" data-kind="video" src="${esc(mi.url)}" preload="metadata" muted></video>`
        : `<img class="lb-img" data-src="${esc(mi.url)}" src="${esc(mi.url)}" loading="lazy" alt="">`}
      <div class="media-meta"><span>${esc(hallName(mi.hall_id))}</span>
        <button class="iconbtn sm" data-del="${mi.id}" title="Delete">${ic('i-trash')}</button></div>
    </div>`).join('') : emptyState('i-upload', 'No photos or videos yet. Tap Upload to add some.');
  bindLightbox('#m_grid');
  $('#m_grid').querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Remove this file?')) return;
    await api.del('media/' + b.dataset.del); toast('Removed'); renderMediaGrid();
  });
}
// Resize/compress an image in the browser to a small JPEG data URL. This lets
// photo uploads work everywhere with no external storage. Videos still use Blob.
function imageToDataUrl(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image')); };
    img.src = url;
  });
}
async function uploadMedia(files) {
  if (!files.length) return;
  const st = $('#m_status'); const hallId = $('#m_hall').value || null;
  let done = 0, failed = 0;
  for (const file of files) {
    st.textContent = `Uploading ${done + failed + 1}/${files.length}…`;
    try {
      if (file.type.startsWith('image/')) {
        const url = await imageToDataUrl(file);
        const r = await api.post('media', { url, kind: 'image', hall_id: hallId });
        if (!r.ok) throw new Error(r.data.message || 'save failed');
      } else {
        // Video (or other): uploads straight to Vercel Blob (needs a Blob store).
        const { upload } = await import('/vendor/blob-client.js');
        const blob = await upload(file.name, file, { access: 'public', handleUploadUrl: '/api/media/upload', clientPayload: TOKEN, contentType: file.type });
        const r = await api.post('media', { url: blob.url, kind: 'video', hall_id: hallId });
        if (!r.ok) throw new Error(r.data.message || 'save failed');
      }
      done++;
    } catch (e) { failed++; console.error('Upload failed for', file.name, e); }
  }
  st.textContent = '';
  if (done) toast(`${done} file(s) uploaded`);
  if (failed) toast(`${failed} file(s) failed. Photos always work; videos need a Blob store to be connected.`);
  renderMediaGrid();
}

// ---- Settings · Decor & Stage ----
// A priced catalog: each item is a reference photo + name + rate the owner can
// show customers and drop into a quote. Categories: decor / stage / other.
const DECOR_CATS = [['decor', 'Decor'], ['stage', 'Stage'], ['other', 'Other']];
async function setDecor() {
  $('#setBody').innerHTML = `<div class="card pad" style="max-width:820px">
    <div class="card-h"><h3>Decor &amp; Stage catalog</h3>
      <button class="btn btn-pri btn-sm" id="dc_add">${ic('i-plus')}Add item</button></div>
    <div class="mono" style="color:var(--muted);margin-bottom:12px">Add your decor &amp; stage designs with a reference photo and rate. These show in the rate calculator so you can drop them into a quote.</div>
    <div class="media-grid" id="dc_grid"></div>
  </div>`;
  $('#dc_add').onclick = () => decorForm();
  await renderDecorGrid();
}
async function renderDecorGrid() {
  const list = await api.get('decor');
  const catLabel = (c) => (DECOR_CATS.find((x) => x[0] === c) || [, 'Decor'])[1];
  $('#dc_grid').innerHTML = list.length ? list.map((it) => `
    <div class="media-item decor-card">
      ${it.image_url
        ? `<img class="lb-img" data-src="${esc(it.image_url)}" src="${esc(it.image_url)}" loading="lazy" alt="${esc(it.name)}">`
        : `<div class="decor-noimg">${ic('i-image')}</div>`}
      <div class="decor-body">
        <div class="decor-top"><span class="pill p-free"><span class="dt"></span>${esc(catLabel(it.category))}</span><span class="decor-price">${fmt(it.price)}</span></div>
        <div class="decor-name">${esc(it.name)}</div>
        ${it.description ? `<div class="decor-desc">${esc(it.description)}</div>` : ''}
        <div class="decor-acts">
          <button class="btn btn-sec btn-sm" data-edit="${it.id}">${ic('i-edit')}Edit</button>
          <button class="iconbtn sm" data-del="${it.id}" title="Delete">${ic('i-trash')}</button>
        </div>
      </div>
    </div>`).join('') : emptyState('i-image', 'No decor or stage items yet. Tap “Add item”.');
  bindLightbox('#dc_grid');
  const byId = (id) => list.find((x) => x.id === Number(id));
  $('#dc_grid').querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => decorForm(byId(b.dataset.edit)));
  $('#dc_grid').querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Delete this item?')) return;
    await api.del('decor/' + b.dataset.del); toast('Deleted'); renderDecorGrid();
  });
}
// Add/edit a decor item in a modal, with an in-browser compressed photo upload.
function decorForm(item = null) {
  let imageUrl = item?.image_url || null;
  const catOpts = DECOR_CATS.map(([v, n]) => `<option value="${v}" ${item?.category === v ? 'selected' : ''}>${n}</option>`).join('');
  modal(item ? 'Edit item' : 'Add decor / stage item', `
    <label class="fl">Reference photo</label>
    <div class="decor-up"><div class="decor-preview" id="dc_prev">${imageUrl ? `<img src="${esc(imageUrl)}" alt="">` : ic('i-image')}</div>
      <div><input type="file" id="dc_file" accept="image/*" hidden>
        <button type="button" class="btn btn-sec btn-sm" id="dc_pick">${ic('i-upload')}Choose photo</button>
        <div class="mono" id="dc_upst" style="margin-top:6px;color:var(--muted)">JPG/PNG — auto-compressed.</div></div></div>
    <label class="fl">Name</label><input class="field" id="dc_name" placeholder="e.g. Floral Stage" value="${esc(item?.name || '')}">
    <div class="two"><div><label class="fl">Category</label><select class="field" id="dc_cat">${catOpts}</select></div>
      <div><label class="fl">Rate (Rs)</label><input class="field" type="number" id="dc_price" placeholder="80000" value="${item?.price || ''}"></div></div>
    <label class="fl">Description (optional)</label><textarea class="field" id="dc_desc" placeholder="What's included…">${esc(item?.description || '')}</textarea>`,
    `<button class="btn btn-sec" id="dc_cancel">Cancel</button><button class="btn btn-pri" id="dc_save">${ic('i-check')}Save</button>`);
  const g = (id) => $('#' + id);
  g('dc_pick').onclick = () => g('dc_file').click();
  g('dc_file').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    g('dc_upst').textContent = 'Processing…';
    try { imageUrl = await imageToDataUrl(file, 1400, 0.82); g('dc_prev').innerHTML = `<img src="${imageUrl}" alt="">`; g('dc_upst').textContent = 'Photo ready'; }
    catch { g('dc_upst').textContent = 'Could not read this image'; }
  };
  g('dc_cancel').onclick = closeModal;
  g('dc_save').onclick = busy(async () => {
    const body = { name: g('dc_name').value.trim(), category: g('dc_cat').value, price: Number(g('dc_price').value) || 0, description: g('dc_desc').value.trim() || null, image_url: imageUrl };
    if (!body.name) return toast('Please enter a name');
    const r = item ? await api.patch('decor/' + item.id, body) : await api.post('decor', body);
    if (!r.ok) return toast(r.data.message || 'Could not save. Please try again.');
    closeModal(); toast('Saved'); renderDecorGrid();
  });
}
function setProfile() {
  const v = VENUE;
  $('#setBody').innerHTML = `<div class="card pad" style="max-width:620px">
    <div class="two"><div><label class="fl">Venue name</label><input class="field" id="s_name" value="${esc(v.name)}"></div>
      <div><label class="fl">Phone</label><input class="field" id="s_phone" value="${esc(v.phone || '')}"></div></div>
    <div class="two"><div><label class="fl">City</label><input class="field" id="s_city" value="${esc(v.city || '')}"></div>
      <div><label class="fl">Area</label><input class="field" id="s_area" value="${esc(v.area || '')}"></div></div>
    <label class="fl">Address</label><input class="field" id="s_address" value="${esc(v.address || '')}">
    <div class="two"><div><label class="fl">Min capacity</label><input class="field" type="number" id="s_cmin" value="${v.capacity_min || ''}"></div>
      <div><label class="fl">Max capacity</label><input class="field" type="number" id="s_cmax" value="${v.capacity_max || ''}"></div></div>
    <label class="fl">Facilities</label><div class="chips" id="s_fac">${v.all_facilities.map((f) => `<span class="chip ${v.facilities.includes(f) ? 'on' : ''}" data-f="${f}">${f}</span>`).join('')}</div>
    ${locationPickerHTML('s', v)}
    <button class="btn btn-pri" id="s_save" style="margin-top:20px">${ic('i-check')}Save changes</button></div>`;
  setupLocationPicker('s', v, () => $('#s_city').value);
  $('#s_fac').querySelectorAll('.chip').forEach((c) => c.onclick = () => c.classList.toggle('on'));
  $('#s_save').onclick = busy(async () => {
    const facilities = [...$('#s_fac').querySelectorAll('.chip.on')].map((c) => c.dataset.f);
    const r = await api.patch('venue', {
      name: $('#s_name').value, phone: $('#s_phone').value, city: $('#s_city').value, area: $('#s_area').value,
      address: $('#s_address').value, capacity_min: Number($('#s_cmin').value) || null, capacity_max: Number($('#s_cmax').value) || null, facilities,
      ...readPicker('s'),
    });
    if (!r.ok) return toast(r.data.message || 'Could not save. Please try again.');
    VENUE = await api.get('venue'); $('#brandVenue').textContent = VENUE.name; toast('Venue profile saved');
  });
}
function setHalls() {
  $('#setBody').innerHTML = `<div class="card pad" style="max-width:560px">
    <div id="hallList"></div>
    <div class="inline-add"><input class="field" id="nh_name" placeholder="New hall name">
      <input class="field" id="nh_cap" type="number" placeholder="Capacity" style="max-width:120px">
      <button class="btn btn-pri" id="nh_add">${ic('i-plus')}Add</button></div></div>`;
  $('#hallList').innerHTML = VENUE.halls.map((h) => `<div class="row"><div class="grow"><div class="nm">${esc(h.name)}</div><div class="dt">Capacity ${h.capacity || '—'}</div></div>
    <button class="iconbtn" data-del="${h.id}" title="Remove">${ic('i-trash')}</button></div>`).join('') || `<div class="empty">No halls yet.</div>`;
  $('#hallList').querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Remove this hall?')) return;
    const r = await api.del('halls/' + b.dataset.del);
    if (!r.ok) return toast(r.data.message || 'Cannot remove');
    VENUE = await api.get('venue'); setHalls(); toast('Hall removed');
  });
  $('#nh_add').onclick = busy(async () => {
    if (!$('#nh_name').value.trim()) return toast('Please enter a hall name');
    const r = await api.post('halls', { name: $('#nh_name').value.trim(), capacity: Number($('#nh_cap').value) || null });
    if (!r.ok) return toast(r.data.message || 'Could not add this hall. Please try again.');
    VENUE = await api.get('venue'); setHalls(); toast('Hall added');
  });
}
function setSlots() {
  $('#setBody').innerHTML = `<div class="card pad" style="max-width:560px">
    <div id="slotList"></div>
    <div class="inline-add"><input class="field" id="ns_name" placeholder="New slot name (e.g. Morning)">
      <button class="btn btn-pri" id="ns_add">${ic('i-plus')}Add</button></div>
    <div class="mono" style="margin-top:12px">Default slots: Lunch &amp; Dinner. Full Day overlaps both.</div></div>`;
  $('#slotList').innerHTML = VENUE.slots.map((s) => `<div class="row"><div class="grow"><div class="nm">${esc(s.name)}</div></div>
    <button class="iconbtn" data-del="${s.id}" title="Remove">${ic('i-trash')}</button></div>`).join('') || `<div class="empty">No slots.</div>`;
  $('#slotList').querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Remove this slot?')) return;
    const r = await api.del('slots/' + b.dataset.del);
    if (!r.ok) return toast(r.data.message || 'Cannot remove');
    VENUE = await api.get('venue'); setSlots(); toast('Slot removed');
  });
  $('#ns_add').onclick = busy(async () => {
    if (!$('#ns_name').value.trim()) return toast('Please enter a slot name');
    const r = await api.post('slots', { name: $('#ns_name').value.trim() });
    if (!r.ok) return toast(r.data.message || 'Could not add this slot. Please try again.');
    VENUE = await api.get('venue'); setSlots(); toast('Slot added');
  });
}
function setRates() {
  const noHallsOrSlots = !VENUE.halls.length || !VENUE.slots.length;
  $('#setBody').innerHTML = `<div class="card pad" style="max-width:620px">
    <div class="card-h"><h3>Hall prices (flat, complete)</h3></div>
    <div class="mono" style="color:var(--muted);margin-bottom:10px">Set the complete price for each hall &amp; function (Lunch / Dinner / Full Day). This is the whole-event price — no per-head. Leave blank for none.</div>
    ${noHallsOrSlots ? `<div class="empty">Add halls and slots first (Settings → Halls / Slots).</div>`
      : VENUE.halls.map((h) => `<div class="form-sec">${esc(h.name)}</div>
        ${VENUE.slots.map((s) => `<div class="row"><div class="grow"><div class="nm">${esc(s.name)}</div></div>
          <input class="field hp-in" type="number" data-hall="${h.id}" data-slot="${s.id}" placeholder="0" value="${hallSlotPrice(h.id, s.id) || ''}" style="max-width:160px">
        </div>`).join('')}`).join('')}
  </div>
  <div class="card pad" style="max-width:620px;margin-top:16px">
    <div class="card-h"><h3>Date &amp; weekend charges</h3>
      <button class="btn btn-pri btn-sm" id="pr_add">${ic('i-plus')}Add rule</button></div>
    <div class="mono" style="color:var(--muted);margin-bottom:10px">Add to the hall price for weekends, a season (date range), or a specific date — or set an exact price for one date. Weekend &amp; season charges add up; a single date overrides. Applied automatically in the calculator &amp; new bookings.</div>
    <div id="pr_list"></div>
  </div>`;
  $('#setBody').querySelectorAll('.hp-in').forEach((inp) => inp.onchange = async () => {
    const r = await api.post('hall-prices', { hall_id: Number(inp.dataset.hall), slot_id: Number(inp.dataset.slot), price: Number(inp.value) || 0 });
    if (!r.ok) return toast(r.data.message || 'Could not save price.');
    VENUE = await api.get('venue'); toast('Price saved');
  });
  $('#pr_add').onclick = () => pricingForm();
  renderPricingList();
}
// List of saved date charges (weekend / season / single-date).
function renderPricingList() {
  const rules = VENUE.pricing || [];
  const when = (r) => r.kind === 'weekday' ? String(r.weekdays || '').split(',').map(Number).map((n) => WD_SHORT[n]).join(', ')
    : r.kind === 'range' ? `${r.start_date} → ${r.end_date}` : r.start_date;
  $('#pr_list').innerHTML = rules.length ? rules.map((r) => `<div class="row">
    <div class="grow"><div class="nm">${esc(ruleLabel(r))}</div><div class="dt">${esc(when(r))}</div></div>
    <div class="amt">${esc(ruleAdjText(r))}</div>
    <button class="iconbtn sm" data-pedit="${r.id}" title="Edit" style="margin-left:10px">${ic('i-edit')}</button>
    <button class="iconbtn sm" data-pdel="${r.id}" title="Delete">${ic('i-trash')}</button></div>`).join('')
    : `<div class="empty">No date charges yet. Tap “Add rule”.</div>`;
  $('#pr_list').querySelectorAll('[data-pedit]').forEach((b) => b.onclick = () => pricingForm(rules.find((x) => x.id === Number(b.dataset.pedit))));
  $('#pr_list').querySelectorAll('[data-pdel]').forEach((b) => b.onclick = async () => {
    if (!confirm('Delete this rule?')) return;
    await api.del('pricing/' + b.dataset.pdel); VENUE = await api.get('venue'); setRates(); toast('Rule deleted');
  });
}
// Add / edit a date charge. Fields change with the chosen rule type.
function pricingForm(rule = null) {
  let kind = rule?.kind || 'weekday';
  const selDays = new Set(rule ? String(rule.weekdays || '').split(',').map(Number) : [0, 6]); // default Sat+Sun
  const kinds = [['weekday', 'Weekend / weekday'], ['range', 'Date range (season)'], ['date', 'Single date']];
  const adjs = [['flat_add', '+ Rs (add to hall price)'], ['flat_set', 'Set exact Rs for this date']];
  modal(rule ? 'Edit date charge' : 'Add date charge', `
    <label class="fl">Rule type</label>
    <select class="field" id="pf_kind">${kinds.map(([v, n]) => `<option value="${v}" ${kind === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <div id="pf_when" style="margin-top:12px"></div>
    <div class="two" style="margin-top:12px">
      <div><label class="fl">Adjustment</label><select class="field" id="pf_adjtype">${adjs.map(([v, n]) => `<option value="${v}" ${rule?.adj_type === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div><label class="fl">Amount (Rs)</label><input class="field" type="number" id="pf_val" step="1000" placeholder="100000" value="${rule?.adj_value ?? ''}"></div>
    </div>
    <label class="fl">Label (optional)</label><input class="field" id="pf_label" placeholder="e.g. Weekend, Wedding season" value="${esc(rule?.label || '')}">`,
    `<button class="btn btn-sec" id="pf_cancel">Cancel</button><button class="btn btn-pri" id="pf_save">${ic('i-check')}Save</button>`);
  const g = (id) => $('#' + id);
  function renderWhen() {
    kind = g('pf_kind').value;
    if (kind === 'weekday') {
      g('pf_when').innerHTML = `<label class="fl">Days</label><div class="chips" id="pf_days">${WD_SHORT.map((n, i) => `<span class="chip ${selDays.has(i) ? 'on' : ''}" data-d="${i}">${n}</span>`).join('')}</div>`;
      g('pf_days').querySelectorAll('.chip').forEach((c) => c.onclick = () => { const d = Number(c.dataset.d); selDays.has(d) ? selDays.delete(d) : selDays.add(d); c.classList.toggle('on'); });
    } else if (kind === 'range') {
      g('pf_when').innerHTML = `<div class="two"><div><label class="fl">From</label><input class="field" type="date" id="pf_start" value="${rule?.start_date || ''}"></div>
        <div><label class="fl">To</label><input class="field" type="date" id="pf_end" value="${rule?.end_date || ''}"></div></div>`;
    } else {
      g('pf_when').innerHTML = `<label class="fl">Date</label><input class="field" type="date" id="pf_start" value="${rule?.start_date || ''}">`;
    }
  }
  renderWhen();
  g('pf_kind').onchange = renderWhen;
  g('pf_cancel').onclick = closeModal;
  g('pf_save').onclick = busy(async () => {
    const body = { kind, adj_type: g('pf_adjtype').value, adj_value: Number(g('pf_val').value) || 0, label: g('pf_label').value.trim() || null };
    if (kind === 'weekday') body.weekdays = [...selDays].sort().join(',');
    else { body.start_date = g('pf_start').value; if (kind === 'range') body.end_date = g('pf_end').value; }
    const r = rule ? await api.patch('pricing/' + rule.id, body) : await api.post('pricing', body);
    if (!r.ok) return toast(r.data.message || 'Could not save this rule.');
    closeModal(); VENUE = await api.get('venue'); setRates(); toast('Saved');
  });
}

// ---- modals ----
function closeModal() { $('#modal-root').innerHTML = ''; }
function modal(title, bodyHTML, footHTML, cls = '') {
  $('#modal-root').innerHTML = `<div class="overlay"><div class="modal ${cls}">
    <div class="modal-h"><h2>${esc(title)}</h2><button class="iconbtn" id="mClose">${ic('i-x')}</button></div>
    <div class="modal-b">${bodyHTML}</div><div class="modal-f">${footHTML}</div></div></div>`;
  $('#mClose').onclick = closeModal;
  $('.overlay').onclick = (e) => { if (e.target.classList.contains('overlay')) closeModal(); };
}

// ---- location map picker (Leaflet + OpenStreetMap, free, no API key) -------
const PK_CENTER = [30.3753, 69.3451]; // geographic centre of Pakistan
const CITY_CENTERS = {
  lahore: [31.5204, 74.3587], karachi: [24.8607, 67.0011], islamabad: [33.6844, 73.0479],
  rawalpindi: [33.5651, 73.0169], faisalabad: [31.4504, 73.1350], multan: [30.1575, 71.5249],
  peshawar: [34.0151, 71.5249], quetta: [30.1798, 66.9750], gujranwala: [32.1877, 74.1945],
  sialkot: [32.4945, 74.5229], hyderabad: [25.3960, 68.3578], bahawalpur: [29.3956, 71.6836],
  sargodha: [32.0836, 72.6711], abbottabad: [34.1688, 73.2215], gujrat: [32.5731, 74.0789],
};
const gmapsLink = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;
const _mapPickers = {}; // prefix -> { map, marker }

// Pull coordinates out of a pasted Google Maps URL or a plain "lat, lng" string.
// (Short goo.gl / maps.app.goo.gl links redirect server-side and can't be read here.)
function parseCoords(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const pats = [
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,        // .../@31.52,74.35,15z
    /[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,    // ...?q=31.52,74.35
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,        // ...!3d31.52!4d74.35
    /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/, // plain "31.52, 74.35"
  ];
  for (const re of pats) {
    const m = s.match(re);
    if (m) {
      const lat = Number(m[1]), lng = Number(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return [lat, lng];
    }
  }
  return null;
}

function coordLabel(lat, lng) {
  return `Pin set at <b>${(+lat).toFixed(5)}, ${(+lng).toFixed(5)}</b> · <a href="${gmapsLink(lat, lng)}" target="_blank" rel="noopener">View on Google Maps ↗</a>`;
}

// Markup for the picker block; `v` may carry existing latitude/longitude.
// The heavy map is kept collapsed (and un-initialised) until the user asks for
// it, so forms open instantly instead of waiting on map tiles to load.
function locationPickerHTML(prefix, v = {}) {
  const has = v.latitude != null && v.longitude != null;
  return `
  <div class="loc-box">
    ${has ? '' : `<button type="button" class="loc-reveal" id="${prefix}_reveal">
      <span class="loc-reveal-ic">${ic('i-home')}</span>
      <span class="loc-reveal-txt"><b>Pin this venue on the map</b><span>Search, use GPS, or paste a Google Maps link — optional</span></span>
      <span class="loc-reveal-chev">${ic('i-chev-r')}</span></button>`}
    <div class="loc-inner" id="${prefix}_inner" ${has ? '' : 'hidden'}>
      <div class="loc-tools">
        <input class="field" id="${prefix}_search" placeholder="Search area / address…">
        <button type="button" class="btn btn-sec btn-sm" id="${prefix}_find">Search</button>
        <button type="button" class="btn btn-sec btn-sm" id="${prefix}_gps">Use my location</button>
      </div>
      <div class="loc-tools">
        <input class="field" id="${prefix}_gmap" placeholder="…or paste a Google Maps link / coordinates">
        <button type="button" class="btn btn-sec btn-sm" id="${prefix}_gset">Set</button>
      </div>
      <div class="map-wrap" id="${prefix}_map"></div>
      <div class="loc-coords" id="${prefix}_coords">${has ? coordLabel(v.latitude, v.longitude) : 'Tap the map, drag the pin, or use a button above to set the exact spot.'}</div>
    </div>
    <input type="hidden" id="${prefix}_lat" value="${has ? v.latitude : ''}">
    <input type="hidden" id="${prefix}_lng" value="${has ? v.longitude : ''}">
  </div>`;
}

// Decide whether to build the map now (existing pin) or defer it behind the
// reveal button (fresh form) — deferring keeps the form snappy.
function setupLocationPicker(prefix, v = {}, cityFn = null) {
  const has = v.latitude != null && v.longitude != null;
  if (has) return initLocationPicker(prefix, v, cityFn);
  const reveal = $('#' + prefix + '_reveal');
  if (!reveal) return;
  reveal.onclick = () => {
    reveal.remove();
    $('#' + prefix + '_inner').hidden = false;
    initLocationPicker(prefix, v, cityFn);
  };
}

// Wire up the Leaflet map after the HTML is in the DOM. `cityFn` (optional)
// returns the current city text, so a fresh venue centres on the right city.
function initLocationPicker(prefix, v = {}, cityFn = null) {
  const mapEl = $('#' + prefix + '_map');
  if (!mapEl) return;
  if (!window.L) { // Leaflet (CDN) unavailable — keep manual paste/coords working.
    mapEl.innerHTML = '<div class="map-fallback">Map could not load (offline?). You can still paste a Google Maps link or coordinates above.</div>';
    wireCoordButtons(prefix, null, v, cityFn);
    return;
  }
  if (_mapPickers[prefix]?.map) { try { _mapPickers[prefix].map.remove(); } catch {} }

  const has = v.latitude != null && v.longitude != null;
  const city = (cityFn ? cityFn() : v.city || '').trim().toLowerCase();
  const start = has ? [+v.latitude, +v.longitude] : (CITY_CENTERS[city] || PK_CENTER);
  const zoom = has ? 16 : (CITY_CENTERS[city] ? 12 : 5);

  const map = L.map(mapEl, { scrollWheelZoom: false }).setView(start, zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap',
  }).addTo(map);

  let marker = has ? L.marker(start, { draggable: true }).addTo(map) : null;
  const rec = _mapPickers[prefix] = { map, marker };

  const setPoint = (lat, lng, recenter = true) => {
    if (!rec.marker) { rec.marker = L.marker([lat, lng], { draggable: true }).addTo(map); rec.marker.on('dragend', () => { const p = rec.marker.getLatLng(); commit(p.lat, p.lng, false); }); }
    else rec.marker.setLatLng([lat, lng]);
    if (recenter) map.setView([lat, lng], Math.max(map.getZoom(), 15));
    commit(lat, lng);
  };
  const commit = (lat, lng) => {
    $('#' + prefix + '_lat').value = lat;
    $('#' + prefix + '_lng').value = lng;
    $('#' + prefix + '_coords').innerHTML = coordLabel(lat, lng);
  };
  if (marker) marker.on('dragend', () => { const p = marker.getLatLng(); commit(p.lat, p.lng); });
  map.on('click', (e) => setPoint(e.latlng.lat, e.latlng.lng, false));

  // Leaflet mis-sizes when its container was hidden (modal/tab) at creation.
  setTimeout(() => map.invalidateSize(), 60);
  setTimeout(() => map.invalidateSize(), 250);

  wireCoordButtons(prefix, setPoint, v, cityFn);
}

function wireCoordButtons(prefix, setPoint, v, cityFn) {
  const coordsBox = $('#' + prefix + '_coords');
  const apply = (lat, lng) => {
    if (setPoint) setPoint(lat, lng);
    else { $('#' + prefix + '_lat').value = lat; $('#' + prefix + '_lng').value = lng; coordsBox.innerHTML = coordLabel(lat, lng); }
  };
  $('#' + prefix + '_gps').onclick = () => {
    if (!navigator.geolocation) return toast('Location not supported on this device');
    coordsBox.textContent = 'Finding your location…';
    navigator.geolocation.getCurrentPosition(
      (pos) => apply(pos.coords.latitude, pos.coords.longitude),
      () => { coordsBox.textContent = 'Could not get your location. Allow location access, or tap the map.'; },
      { enableHighAccuracy: true, timeout: 10000 });
  };
  $('#' + prefix + '_gset').onclick = () => {
    const c = parseCoords($('#' + prefix + '_gmap').value);
    if (!c) return toast('Paste a Google Maps link with coordinates, or "lat, lng"');
    apply(c[0], c[1]);
  };
  const doSearch = async () => {
    const qstr = $('#' + prefix + '_search').value.trim();
    if (!qstr) return;
    const direct = parseCoords(qstr);
    if (direct) return apply(direct[0], direct[1]);
    coordsBox.textContent = 'Searching…';
    try {
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=pk&q=' + encodeURIComponent(qstr);
      const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
      const j = await r.json();
      if (!j.length) { coordsBox.textContent = 'No match. Try a nearby landmark, or tap the map.'; return; }
      apply(Number(j[0].lat), Number(j[0].lon));
    } catch { coordsBox.textContent = 'Search failed. Tap the map to set the pin instead.'; }
  };
  $('#' + prefix + '_find').onclick = doSearch;
  $('#' + prefix + '_search').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } };
}

// Read the chosen coordinates back out (for saving).
function readPicker(prefix) {
  const lat = $('#' + prefix + '_lat').value, lng = $('#' + prefix + '_lng').value;
  return { latitude: lat === '' ? null : Number(lat), longitude: lng === '' ? null : Number(lng) };
}

function openNewBooking(pre = {}) {
  const st = { event: null, ...pre };
  const hallOpts = VENUE.halls.map((h) => `<option value="${h.id}" ${h.id == st.hall ? 'selected' : ''}>${esc(h.name)}</option>`).join('');
  const slotOpts = VENUE.slots.map((s) => `<option value="${s.id}" ${s.id == st.slot ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  modal('New booking', `
    <label class="fl">Customer name</label><input class="field" id="f_name" placeholder="Full name">
    <label class="fl">Phone</label><input class="field" id="f_phone" placeholder="+92 3XX XXXXXXX">
    <label class="fl">Event type</label><div class="chips" id="f_event">${EVENTS.map((e) => `<span class="chip" data-ev="${e}">${e}</span>`).join('')}</div>
    <div class="two"><div><label class="fl">Hall</label><select class="field" id="f_hall">${hallOpts}</select></div>
      <div><label class="fl">Slot</label><select class="field" id="f_slot">${slotOpts}</select></div></div>
    <div class="two"><div><label class="fl">Date</label><input class="field" type="date" id="f_date" value="${st.date || ''}"></div>
      <div><label class="fl">Guests (seating)</label><input class="field" type="number" id="f_guests" placeholder="450"></div></div>
    <div class="two"><div><label class="fl">Complete price (Rs)</label><input class="field" type="number" id="f_price" placeholder="400000"></div>
      <div><label class="fl">Advance</label><input class="field" type="number" id="f_adv" placeholder="0"></div></div>
    <div class="mono" id="f_pricenote" style="color:var(--muted);margin-top:4px"></div>
    <label class="fl">Additional requirements</label><textarea class="field" id="f_req" placeholder="Decoration, menu, stage, special requests…"></textarea>
    <label class="fl">Notes (internal)</label><textarea class="field" id="f_notes" placeholder="Optional"></textarea>
    <div class="totbox"><span class="k">TOTAL</span><span class="v" id="f_total">Rs 0</span></div><div id="f_avail"></div>`,
    `<button class="btn btn-sec" id="b_tent">Save as tentative</button><button class="btn btn-pri" id="b_conf">${ic('i-check')}Confirm</button>`);
  const g = (id) => $('#' + id);
  g('f_event').querySelectorAll('.chip').forEach((c) => c.onclick = () => {
    g('f_event').querySelectorAll('.chip').forEach((x) => x.classList.remove('on')); c.classList.add('on'); st.event = c.dataset.ev;
  });
  // Auto-fill the flat complete price for the chosen hall + slot + date.
  function autofillPrice() {
    const base = hallSlotPrice(Number(g('f_hall').value), Number(g('f_slot').value));
    const pr = resolveFlatPrice(base, g('f_date').value);
    g('f_price').value = pr.total || '';
    const note = g('f_pricenote');
    if (pr.setRule) note.textContent = `${ruleLabel(pr.setRule)}: price set to ${fmt(pr.total)} for this date.`;
    else if (pr.adds.length) note.textContent = `${fmt(base)} + ${pr.adds.map((r) => ruleLabel(r) + ' ' + ruleAdjText(r)).join(' + ')} = ${fmt(pr.total)}`;
    else note.textContent = base ? '' : 'No saved price for this hall + function — enter it manually.';
    recalc();
  }
  function recalc() { const t = Number(g('f_price').value) || 0; g('f_total').textContent = fmt(t); st.total = t; }
  g('f_price').oninput = recalc;
  async function checkAvail() {
    const date = g('f_date').value; if (!date) { g('f_avail').innerHTML = ''; return; }
    const { data } = await api.post('check', { hall: Number(g('f_hall').value), date, slot: Number(g('f_slot').value) });
    g('f_avail').innerHTML = !data.free
      ? `<div class="warn">${ic('i-warn')}This slot already has a ${data.conflict?.type === 'block' ? 'block' : 'confirmed booking'}${data.conflict?.customer_name ? ' (' + esc(data.conflict.customer_name) + ')' : ''}. You can still save it as tentative.</div>`
      : data.hold
        ? `<div class="note">${ic('i-warn')}This slot has a hold for ${esc(data.hold.customer_name)}${data.hold.slot_name ? ' · ' + esc(data.hold.slot_name) : ''}. You can still book it.</div>`
        : `<div class="ok">${ic('i-check')}This slot is available.</div>`;
  }
  ['f_hall', 'f_slot', 'f_date'].forEach((id) => g(id).onchange = () => { autofillPrice(); checkAvail(); });
  // Prefill from the rate calculator ("Create booking from quote").
  if (st.event) { const chip = [...g('f_event').querySelectorAll('.chip')].find((c) => c.dataset.ev === st.event); if (chip) chip.classList.add('on'); }
  if (st.name) g('f_name').value = st.name;
  if (st.phone) g('f_phone').value = st.phone;
  if (st.guests) g('f_guests').value = st.guests;
  if (st.price != null) g('f_price').value = st.price;
  else autofillPrice();
  recalc();
  if (st.date) checkAvail();
  async function submit(status) {
    const body = {
      customer_name: g('f_name').value.trim(), customer_phone: g('f_phone').value.trim(), event_type: st.event,
      hall: Number(g('f_hall').value), slot: Number(g('f_slot').value), date: g('f_date').value,
      guest_count: Number(g('f_guests').value) || null, total_amount: st.total || 0,
      advance: Number(g('f_adv').value) || 0, notes: g('f_notes').value.trim() || null,
      requirements: g('f_req').value.trim() || null, status,
    };
    if (!body.customer_name || !body.date) return toast('Customer name and date are required');
    const r = await api.post('bookings', body);
    if (r.status === 409) { g('f_avail').innerHTML = `<div class="warn">${ic('i-warn')}${esc(r.data.message || 'This slot is already booked.')}</div>`; return; }
    if (!r.ok) return toast(r.data.message || 'Could not save this booking. Please try again.');
    closeModal(); toast(status === 'confirmed' ? 'Booking confirmed · WhatsApp sent' : 'Tentative booking saved', status === 'confirmed');
    location.hash = '#/booking/' + r.data.id;
  }
  $('#b_tent').onclick = busy(() => submit('tentative'));
  $('#b_conf').onclick = busy(() => submit('confirmed'));
}

function openEditBooking(b) {
  modal('Edit booking', `
    <label class="fl">Customer name</label><input class="field" id="e_name" value="${esc(b.customer_name)}">
    <label class="fl">Phone</label><input class="field" id="e_phone" value="${esc(b.customer_phone || '')}">
    <label class="fl">Event type</label><div class="chips" id="e_event">${EVENTS.map((e) => `<span class="chip ${e === b.event_type ? 'on' : ''}" data-ev="${e}">${e}</span>`).join('')}</div>
    <div class="two"><div><label class="fl">Guests</label><input class="field" type="number" id="e_guests" value="${b.guest_count || ''}"></div>
      <div><label class="fl">Total amount</label><input class="field" type="number" id="e_total" value="${b.total_amount || 0}"></div></div>
    <label class="fl">Additional requirements</label><textarea class="field" id="e_req">${esc(b.requirements || '')}</textarea>
    <label class="fl">Notes (internal)</label><textarea class="field" id="e_notes">${esc(b.notes || '')}</textarea>
    ${featureOn('beo') ? `
    <div class="form-sec">Event order (BEO) — staff sheet</div>
    <div class="two"><div><label class="fl">Guest arrival time</label><input class="field" id="e_arrival" value="${esc(b.beo_arrival || '')}" placeholder="8:00 PM"></div>
      <div><label class="fl">Meal / serving time</label><input class="field" id="e_meal" value="${esc(b.beo_meal_time || '')}" placeholder="9:30 PM"></div></div>
    <label class="fl">On-site contact (name · phone)</label><input class="field" id="e_contact" value="${esc(b.beo_contact || '')}" placeholder="Event manager · 0300…">
    <label class="fl">Menu / food</label><textarea class="field" id="e_menu" placeholder="Starters, main course, dessert…">${esc(b.beo_menu || '')}</textarea>
    <label class="fl">Setup &amp; seating</label><textarea class="field" id="e_setup" placeholder="Stage, seating layout, table count, decor…">${esc(b.beo_setup || '')}</textarea>` : ''}`,
    `<button class="btn btn-sec" id="e_cancel">Cancel</button><button class="btn btn-pri" id="e_save">Save</button>`);
  let event = b.event_type;
  $('#e_event').querySelectorAll('.chip').forEach((c) => c.onclick = () => { $('#e_event').querySelectorAll('.chip').forEach((x) => x.classList.remove('on')); c.classList.add('on'); event = c.dataset.ev; });
  $('#e_cancel').onclick = closeModal;
  $('#e_save').onclick = busy(async () => {
    if (!$('#e_name').value.trim()) return toast('Customer name is required');
    const r = await api.patch('bookings/' + b.id, {
      customer_name: $('#e_name').value.trim(), customer_phone: $('#e_phone').value.trim(), event_type: event,
      guest_count: Number($('#e_guests').value) || null, total_amount: Number($('#e_total').value) || 0,
      notes: $('#e_notes').value.trim() || null, requirements: $('#e_req').value.trim() || null,
      ...(featureOn('beo') ? {
        beo_arrival: $('#e_arrival').value.trim() || null, beo_meal_time: $('#e_meal').value.trim() || null,
        beo_contact: $('#e_contact').value.trim() || null, beo_menu: $('#e_menu').value.trim() || null,
        beo_setup: $('#e_setup').value.trim() || null,
      } : {}),
    });
    if (!r.ok) return toast(r.data.message || 'Could not update. Please try again.');
    closeModal(); toast('Booking updated'); renderBookingDetail(b.id);
  });
}

function openAddPayment(b) {
  modal('Add payment', `
    <label class="fl">Amount</label><input class="field" type="number" id="p_amt" placeholder="200000">
    <label class="fl">Method</label><div class="chips" id="p_method">${METHODS.map((m, i) => `<span class="chip ${i === 0 ? 'on' : ''}" data-m="${m.toLowerCase().split(' ')[0]}">${m}</span>`).join('')}</div>
    <label class="fl">Date</label><input class="field" type="date" id="p_date" value="${todayISO()}">
    <div class="totbox"><span class="k">CURRENT BALANCE</span><span class="v">${fmt(b.balance)}</span></div>`,
    `<button class="btn btn-sec" id="p_cancel">Cancel</button><button class="btn btn-pri" id="p_save">Save payment</button>`);
  let method = 'cash';
  $('#p_method').querySelectorAll('.chip').forEach((c) => c.onclick = () => { $('#p_method').querySelectorAll('.chip').forEach((x) => x.classList.remove('on')); c.classList.add('on'); method = c.dataset.m; });
  $('#p_cancel').onclick = closeModal;
  $('#p_save').onclick = busy(async () => {
    const amount = Number($('#p_amt').value); if (!amount || amount <= 0) return toast('Please enter a valid amount');
    const r = await api.post(`bookings/${b.id}/payments`, { amount, method, paid_on: $('#p_date').value });
    if (!r.ok) return toast(r.data.message || 'Could not add this payment. Please try again.');
    closeModal(); toast('Payment added · balance updated'); renderBookingDetail(b.id);
  });
}

// ---- boot ----
// Guard: a brand-new venue may have no halls/slots yet.
function startNewBooking(pre) {
  if (!VENUE.halls || !VENUE.halls.length) { toast('Add a hall first (Settings → Halls)'); location.hash = '#/settings'; return; }
  if (!VENUE.slots || !VENUE.slots.length) { toast('Add slots first (Settings → Slots)'); location.hash = '#/settings'; return; }
  openNewBooking(pre || { date: todayISO(), hall: VENUE.halls[0].id, slot: VENUE.slots[0].id });
}

function startApp() {
  $('#login').innerHTML = ''; $('#app').hidden = false;
  $('#brandVenue').textContent = VENUE.name;
  applyFeatureNav();
  const bell = $('#bellBtn');
  if (bell) bell.onclick = toggleNotif;
  loadAlerts();
  $('#newBtn').onclick = () => startNewBooking();
  const lb = $('#logoutBtn');
  // "Back to Admin" is only ever for an admin who opened a banquet — never for owners.
  if (ME?.role === 'admin' && ADMIN_VENUE) { lb.innerHTML = ic('i-chev-l') + 'Back to Admin'; lb.onclick = busy(backToAdmin); }
  else { lb.innerHTML = ic('i-logout') + 'Log out'; lb.onclick = () => { if (confirm('Log out?')) logout(); }; }
  if (!listenerSet) { window.addEventListener('hashchange', route); document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closeNotif(); closeLightbox(); } }); listenerSet = true; }
  if (!location.hash) location.hash = '#/home';
  route();
}
(async function init() {
  if (TOKEN) { try { return await enterApp(); } catch { /* fall through */ } }
  renderLogin();
})();
