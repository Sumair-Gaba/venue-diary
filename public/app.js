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
const pill = (status) => `<span class="pill p-${status}"><span class="dt"></span>${cap(status)}</span>`;
const kpi = (icon, n, label) => `<div class="kpi"><div class="ico">${ic(icon)}</div><div class="kmeta"><div class="n">${n}</div><div class="l">${label}</div></div></div>`;
const emptyState = (icon, text) => `<div class="empty"><span class="empty-ic">${ic(icon)}</span><span>${esc(text)}</span></div>`;

let VENUE = null;
let ME = null;
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
  ADMIN_VENUE = null; VENUE = null; ME = null;
  closeModal();
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
  if (mode === 'owner') return renderOwnerLogin(slug);
  $('#login').innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <div class="auth-logo">${ic('i-gear')}</div>
    <h2>Venue Diary</h2>
    <p class="auth-sub">Admin sign in · email &amp; password</p>
    <div id="auth-step"></div>
  </div><div class="auth-foot">Echo DMC · admin panel</div></div>`;
  adminLoginStep();
}
// Branded owner login for a specific banquet slug.
async function renderOwnerLogin(slug) {
  const v = await api.get('public/venue?slug=' + encodeURIComponent(slug));
  if (!v || v.error) {
    $('#login').innerHTML = `<div class="auth-wrap"><div class="auth-card">
      <div class="auth-logo">${ic('i-warn')}</div>
      <h2>Banquet not found</h2>
      <p class="auth-sub">No banquet is registered at this link. Please check the URL with your administrator (Echo DMC).</p>
    </div><div class="auth-foot">Venue Diary</div></div>`;
    return;
  }
  $('#login').innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <div class="auth-logo">${ic('i-cal')}</div>
    <h2>${esc(v.name)}</h2>
    <p class="auth-sub">Owner sign in · phone &amp; OTP</p>
    <div id="auth-step"></div>
  </div><div class="auth-foot">${esc([v.city, v.area].filter(Boolean).join(', ') || 'Banquet owner portal')}</div></div>`;
  phoneStep();
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
  location.hash = '#/home'; renderLogin();
}

// ---- ADMIN panel (platform/Echo DMC) --------------------------------------
async function renderAdmin() {
  $('#app').hidden = true;
  const list = await api.get('admin/venues');
  $('#login').innerHTML = `<div class="admin-wrap">
    <div class="admin-top">
      <div class="brand"><span class="mk">${ic('i-cal')}</span><div><b>VENUE DIARY</b><span>ADMIN PANEL</span></div></div>
      <div class="admin-actions">
        <button class="btn btn-pri" id="ad_new">${ic('i-plus')}Register new banquet</button>
        <button class="btn btn-sec" id="ad_logout">${ic('i-logout')}Log out</button>
      </div>
    </div>
    <div class="admin-body">
      <div class="page-h"><div><h1>Banquets</h1><div class="sub">${list.length} registered</div></div></div>
      <div class="admin-grid" id="ad_grid"></div>
    </div></div>`;
  $('#ad_logout').onclick = () => { if (confirm('Log out?')) logout(); };
  $('#ad_new').onclick = registerBanquetModal;
  $('#ad_grid').innerHTML = list.length ? list.map((v) => `
    <div class="vcard">
      <div class="vcard-h"><div class="vname">${esc(v.name)}</div><span class="pill p-confirmed"><span class="dt"></span>${v.hall_count} halls</span></div>
      <div class="vmeta">${ic('i-home')} ${esc([v.city, v.area].filter(Boolean).join(', ') || '—')}</div>
      <div class="vmeta">${ic('i-users')} ${esc(v.owner_name || 'Owner')} · ${esc(v.owner_phone || '—')}</div>
      <div class="vmeta">${ic('i-book')} ${v.booking_count} bookings</div>
      ${v.slug ? `<div class="vlink" data-copy="${esc(originBase() + '/' + v.slug)}" title="Copy owner link">${ic('i-link')}<span>/${esc(v.slug)}</span><span class="vlink-copy">Copy</span></div>` : ''}
      <button class="btn btn-sec btn-sm" data-open="${v.id}" style="margin-top:10px;width:100%">Open dashboard ${ic('i-chev-r')}</button>
    </div>`).join('') : emptyState('i-home', 'No banquets registered yet. Tap "Register new banquet" to add one.');
  $('#ad_grid').querySelectorAll('[data-open]').forEach((b) => b.onclick = busy(() => openBanquet(Number(b.dataset.open))));
  $('#ad_grid').querySelectorAll('[data-copy]').forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Owner link copied'); }
    catch { toast(b.dataset.copy); }
  });
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
// Owner whose banquet the admin hasn't created yet.
function renderNoVenue() {
  $('#app').hidden = true;
  $('#login').innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <div class="auth-logo">${ic('i-home')}</div>
    <h2>Account pending setup</h2>
    <p class="auth-sub">Your banquet hasn't been set up yet. Please contact the admin (Echo DMC) — they'll create your dashboard for you.</p>
    <button class="btn btn-sec" id="nv_logout" style="width:100%;margin-top:14px">Log out</button>
  </div></div>`;
  $('#nv_logout').onclick = logout;
}

// ---- router ---------------------------------------------------------------
async function route() {
  const [, page, arg] = (location.hash || '#/home').split('/');
  try {
    if (page === 'home') return await renderHome();
    if (page === 'calendar') return await renderCalendar();
    if (page === 'bookings') return await renderBookings();
    if (page === 'payments') return await renderPayments();
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
}
// Venue photo gallery for the dashboard (uses VENUE.media loaded with the venue).
function galleryCardHTML() {
  const imgs = (VENUE.media || []).filter((m) => m.kind !== 'video').slice(0, 8);
  const body = imgs.length
    ? `<div class="media-grid">${imgs.map((m) => `<div class="media-item"><img src="${esc(m.url)}" loading="lazy" alt=""></div>`).join('')}</div>`
    : emptyState('i-upload', 'No photos yet. Add some in Settings → Photos & Videos.');
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
  p.innerHTML = `<div class="card-h"><h3>${fmtDate(date)}</h3></div>` + data.slots.map((s) => `
    <div class="slotrow">
      <div class="grow"><div class="s1">${esc(s.name)}</div>
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
        ${b.notes ? `<div class="row"><div class="grow mono">Notes</div><b style="max-width:60%;text-align:right">${esc(b.notes)}</b></div>` : ''}
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
        ${b.status === 'tentative' ? `<button class="btn btn-pri" id="confirmBtn">${ic('i-check')}Confirm booking</button>` : ''}
        ${b.status === 'confirmed' ? `<button class="btn btn-sec" id="completeBtn">${ic('i-check')}Mark completed</button>` : ''}
        ${b.status !== 'cancelled' ? `<button class="btn btn-danger" id="cancelBtn">${ic('i-trash')}Cancel booking</button>` : ''}
      </div></div>`;
  $('#backBtn').onclick = () => (location.hash = '#/bookings');
  $('#payList').innerHTML = b.payments.length ? b.payments.map((p) => `<div class="row"><div class="grow"><div class="nm">${cap(p.method)}</div><div class="dt">${p.paid_on}</div></div><div class="amt">${fmt(p.amount)}</div></div>`).join('') : `<div class="empty">No payments yet.</div>`;
  if ($('#notifs')) $('#notifs').innerHTML = b.notifications.map((n) => `<div class="row"><div class="grow"><div class="nm">${n.template.replace(/_/g, ' ')}</div><div class="dt">${new Date(n.sent_at).toLocaleString('en-GB')}</div></div><span class="pill p-confirmed"><span class="dt"></span>${cap(n.status)}</span></div>`).join('');
  $('#addPay').onclick = () => openAddPayment(b);
  if ($('#editBtn')) $('#editBtn').onclick = () => openEditBooking(b);
  $('#waBtn').onclick = busy(async () => {
    const r = await api.post(`bookings/${b.id}/remind`);
    if (!r.ok) return toast(r.data.message || 'Could not send the reminder. Please try again.');
    toast('WhatsApp reminder sent', true); renderBookingDetail(id);
  });
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
  const tabs = [['profile', 'Venue profile'], ['halls', 'Halls'], ['slots', 'Slots'], ['rates', 'Rates'], ['media', 'Photos & Videos']];
  $('#view').innerHTML = `<div class="page-h"><h1>Settings</h1></div>
    <div class="tabs">${tabs.map(([k, n]) => `<button class="tab ${k === setTab ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('')}</div>
    <div id="setBody"></div>`;
  document.querySelectorAll('.tab').forEach((t) => t.onclick = () => { setTab = t.dataset.tab; renderSettings(); });
  if (setTab === 'profile') setProfile();
  if (setTab === 'halls') setHalls();
  if (setTab === 'slots') setSlots();
  if (setTab === 'rates') setRates();
  if (setTab === 'media') setMedia();
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
        ? `<video src="${esc(mi.url)}" controls preload="metadata"></video>`
        : `<img src="${esc(mi.url)}" loading="lazy" alt="">`}
      <div class="media-meta"><span>${esc(hallName(mi.hall_id))}</span>
        <button class="iconbtn sm" data-del="${mi.id}" title="Delete">${ic('i-trash')}</button></div>
    </div>`).join('') : emptyState('i-upload', 'No photos or videos yet. Tap Upload to add some.');
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
  const byHall = VENUE.halls.map((h) => ({ hall: h, rates: VENUE.rates.filter((r) => r.hall_id === h.id) }));
  $('#setBody').innerHTML = `<div class="card pad" style="max-width:620px">
    ${byHall.map((g) => `<div class="card-h" style="margin-top:8px"><h3>${esc(g.hall.name)}</h3></div>
      <div>${g.rates.map((r) => `<div class="row"><div class="grow"><div class="nm">${esc(r.event_type)}</div></div><div class="amt">${fmt(r.per_head_rate)} / head</div>
        <button class="iconbtn" data-del="${r.id}" style="margin-left:10px">${ic('i-trash')}</button></div>`).join('') || `<div class="empty">No rates.</div>`}</div>`).join('')}
    <div class="inline-add" style="margin-top:16px">
      <select class="field" id="nr_hall">${VENUE.halls.map((h) => `<option value="${h.id}">${esc(h.name)}</option>`).join('')}</select>
      <select class="field" id="nr_event">${EVENTS.map((e) => `<option>${e}</option>`).join('')}</select>
      <input class="field" id="nr_rate" type="number" placeholder="Rate" style="max-width:120px">
      <button class="btn btn-pri" id="nr_add">${ic('i-plus')}Add</button></div></div>`;
  $('#setBody').querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    await api.del('rates/' + b.dataset.del); VENUE = await api.get('venue'); setRates(); toast('Rate removed');
  });
  $('#nr_add').onclick = busy(async () => {
    if (!$('#nr_rate').value) return toast('Please enter a rate');
    const r = await api.post('rates', { hall_id: Number($('#nr_hall').value), event_type: $('#nr_event').value, per_head_rate: Number($('#nr_rate').value) });
    if (!r.ok) return toast(r.data.message || 'Could not add this rate. Please try again.');
    VENUE = await api.get('venue'); setRates(); toast('Rate added');
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
      <div><label class="fl">Guests</label><input class="field" type="number" id="f_guests" placeholder="450"></div></div>
    <div class="two"><div><label class="fl">Per-head rate</label><input class="field" type="number" id="f_rate" placeholder="2800"></div>
      <div><label class="fl">Advance</label><input class="field" type="number" id="f_adv" placeholder="0"></div></div>
    <label class="fl">Notes</label><textarea class="field" id="f_notes" placeholder="Optional"></textarea>
    <div class="totbox"><span class="k">TOTAL</span><span class="v" id="f_total">Rs 0</span></div><div id="f_avail"></div>`,
    `<button class="btn btn-sec" id="b_tent">Save as tentative</button><button class="btn btn-pri" id="b_conf">${ic('i-check')}Confirm</button>`);
  const g = (id) => $('#' + id);
  g('f_event').querySelectorAll('.chip').forEach((c) => c.onclick = () => {
    g('f_event').querySelectorAll('.chip').forEach((x) => x.classList.remove('on')); c.classList.add('on'); st.event = c.dataset.ev; autofillRate();
  });
  function autofillRate() {
    const rp = VENUE.rates.find((r) => r.hall_id === Number(g('f_hall').value) && r.event_type === st.event);
    if (rp && !g('f_rate').value) g('f_rate').value = rp.per_head_rate; recalc();
  }
  function recalc() { const t = (Number(g('f_guests').value) || 0) * (Number(g('f_rate').value) || 0); g('f_total').textContent = fmt(t); st.total = t; }
  ['f_guests', 'f_rate'].forEach((id) => g(id).oninput = recalc);
  async function checkAvail() {
    const date = g('f_date').value; if (!date) { g('f_avail').innerHTML = ''; return; }
    const { data } = await api.post('check', { hall: Number(g('f_hall').value), date, slot: Number(g('f_slot').value) });
    g('f_avail').innerHTML = data.free
      ? `<div class="ok">${ic('i-check')}This slot is available.</div>`
      : `<div class="warn">${ic('i-warn')}This slot already has a ${data.conflict?.type === 'block' ? 'block' : 'confirmed booking'}${data.conflict?.customer_name ? ' (' + esc(data.conflict.customer_name) + ')' : ''}. You can still save it as tentative.</div>`;
  }
  ['f_hall', 'f_slot', 'f_date'].forEach((id) => g(id).onchange = () => { autofillRate(); checkAvail(); });
  if (st.date) checkAvail();
  async function submit(status) {
    const body = {
      customer_name: g('f_name').value.trim(), customer_phone: g('f_phone').value.trim(), event_type: st.event,
      hall: Number(g('f_hall').value), slot: Number(g('f_slot').value), date: g('f_date').value,
      guest_count: Number(g('f_guests').value) || null, total_amount: st.total || 0,
      advance: Number(g('f_adv').value) || 0, notes: g('f_notes').value.trim() || null, status,
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
    <label class="fl">Notes</label><textarea class="field" id="e_notes">${esc(b.notes || '')}</textarea>`,
    `<button class="btn btn-sec" id="e_cancel">Cancel</button><button class="btn btn-pri" id="e_save">Save</button>`);
  let event = b.event_type;
  $('#e_event').querySelectorAll('.chip').forEach((c) => c.onclick = () => { $('#e_event').querySelectorAll('.chip').forEach((x) => x.classList.remove('on')); c.classList.add('on'); event = c.dataset.ev; });
  $('#e_cancel').onclick = closeModal;
  $('#e_save').onclick = busy(async () => {
    if (!$('#e_name').value.trim()) return toast('Customer name is required');
    const r = await api.patch('bookings/' + b.id, {
      customer_name: $('#e_name').value.trim(), customer_phone: $('#e_phone').value.trim(), event_type: event,
      guest_count: Number($('#e_guests').value) || null, total_amount: Number($('#e_total').value) || 0, notes: $('#e_notes').value.trim() || null,
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
  $('#newBtn').onclick = () => startNewBooking();
  const lb = $('#logoutBtn');
  // "Back to Admin" is only ever for an admin who opened a banquet — never for owners.
  if (ME?.role === 'admin' && ADMIN_VENUE) { lb.innerHTML = ic('i-chev-l') + 'Back to Admin'; lb.onclick = busy(backToAdmin); }
  else { lb.innerHTML = ic('i-logout') + 'Log out'; lb.onclick = () => { if (confirm('Log out?')) logout(); }; }
  if (!listenerSet) { window.addEventListener('hashchange', route); document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); }); listenerSet = true; }
  if (!location.hash) location.hash = '#/home';
  route();
}
(async function init() {
  if (TOKEN) { try { return await enterApp(); } catch { /* fall through */ } }
  renderLogin();
})();
