// Venue Diary — owner web dashboard (vanilla SPA). UI language: English.

// ---- api + auth -----------------------------------------------------------
let TOKEN = localStorage.getItem('vd_token') || null;
let ADMIN_VENUE = null; // when an admin is viewing a specific banquet
async function req(method, p, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  if (ADMIN_VENUE) headers['X-Venue-Id'] = String(ADMIN_VENUE);
  const r = await fetch('/api/' + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && !p.startsWith('auth/')) { logout(); throw new Error('unauthorized'); }
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
function setNav(page) {
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#/' + page));
}
function bindRows() {
  document.querySelectorAll('.row[data-id]').forEach((r) => r.onclick = () => (location.hash = '#/booking/' + r.dataset.id));
}

// ---- login ----------------------------------------------------------------
// Admins reach their login only via the /admin URL. Owners get phone + OTP and
// never see the admin option.
function isAdminPath() { return location.pathname.replace(/\/+$/, '').toLowerCase().endsWith('/admin'); }

function renderLogin() {
  $('#app').hidden = true;
  const adminMode = isAdminPath();
  const l = $('#login');
  l.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <div class="auth-logo">${ic(adminMode ? 'i-gear' : 'i-cal')}</div>
    <h2>Venue Diary</h2>
    <p class="auth-sub">${adminMode ? 'Admin sign in · email &amp; password' : 'Owner sign in · phone &amp; OTP'}</p>
    <div id="auth-step"></div>
  </div><div class="auth-foot">${adminMode ? 'Echo DMC · admin panel' : 'Banquet owner portal'}</div></div>`;
  if (adminMode) adminLoginStep(); else phoneStep();
}
function phoneStep() {
  $('#auth-step').innerHTML = `
    <label class="fl">Phone number</label>
    <input class="field" id="a_phone" placeholder="+92 3XX XXXXXXX" autocomplete="tel">
    <button class="btn btn-pri" id="a_send" style="width:100%;margin-top:16px">Send OTP</button>`;
  $('#a_phone').onkeydown = (e) => { if (e.key === 'Enter') $('#a_send').click(); };
  $('#a_send').onclick = async () => {
    const phone = $('#a_phone').value.trim();
    if (!phone) return toast('Enter a phone number');
    const r = await api.post('auth/request-otp', { phone });
    if (!r.ok) return toast('Could not send OTP');
    otpStep(phone, r.data.devCode);
  };
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
  $('#ad_in').onclick = async () => {
    const email = $('#ad_email').value.trim(), password = $('#ad_pass').value;
    if (!email || !password) return toast('Email aur password daalein');
    const r = await api.post('auth/admin-login', { email, password });
    if (!r.ok) return toast(r.data.message || 'Login failed');
    TOKEN = r.data.token; localStorage.setItem('vd_token', TOKEN);
    await enterApp();
  };
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
  $('#a_verify').onclick = async () => {
    const r = await api.post('auth/verify', { phone, code: code.value.trim() });
    if (!r.ok) return toast(r.data.message || 'Invalid code');
    TOKEN = r.data.token; localStorage.setItem('vd_token', TOKEN);
    await enterApp();
  };
}
// Decide where to land after sign-in: admin panel, owner dashboard, or a
// "not set up yet" notice for owners whose banquet the admin hasn't created.
async function enterApp() {
  ME = await api.get('me');
  if (ME && ME.role === 'admin') { ADMIN_VENUE = null; return renderAdmin(); }
  if (!ME || !ME.hasVenue) return renderNoVenue();
  ADMIN_VENUE = null;
  VENUE = await api.get('venue');
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
      <button class="btn btn-sec btn-sm" data-open="${v.id}" style="margin-top:12px;width:100%">Open dashboard ${ic('i-chev-r')}</button>
    </div>`).join('') : emptyState('i-home', 'Abhi koi banquet register nahi. "Register new banquet" dabayein.');
  $('#ad_grid').querySelectorAll('[data-open]').forEach((b) => b.onclick = () => openBanquet(Number(b.dataset.open)));
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
    <label class="fl">Banquet name *</label><input class="field" id="rb_name" placeholder="e.g. Royal Marquee">
    <div class="two"><div><label class="fl">Owner name</label><input class="field" id="rb_oname" placeholder="Owner / manager"></div>
      <div><label class="fl">Owner phone *</label><input class="field" id="rb_ophone" placeholder="+92 3XX XXXXXXX"></div></div>
    <div class="two"><div><label class="fl">City</label><input class="field" id="rb_city" placeholder="Lahore"></div>
      <div><label class="fl">Area</label><input class="field" id="rb_area" placeholder="Johar Town"></div></div>
    <label class="fl">Address</label><input class="field" id="rb_address" placeholder="Street, landmark">
    <div class="two"><div><label class="fl">Min capacity</label><input class="field" type="number" id="rb_cmin"></div>
      <div><label class="fl">Max capacity</label><input class="field" type="number" id="rb_cmax"></div></div>
    <div class="mono" style="margin-top:10px">Owner is apne phone (OTP) se login kar ke yeh dashboard dekhega.</div>`,
    `<button class="btn btn-sec" id="rb_cancel">Cancel</button><button class="btn btn-pri" id="rb_save">${ic('i-check')}Register</button>`);
  $('#rb_cancel').onclick = closeModal;
  $('#rb_save').onclick = async () => {
    const name = $('#rb_name').value.trim(), phone = $('#rb_ophone').value.trim();
    if (!name) return toast('Banquet name required');
    if (!phone) return toast('Owner phone required');
    const r = await api.post('admin/venues', {
      name, owner_name: $('#rb_oname').value.trim(), owner_phone: phone,
      city: $('#rb_city').value.trim(), area: $('#rb_area').value.trim(), address: $('#rb_address').value.trim(),
      capacity_min: Number($('#rb_cmin').value) || null, capacity_max: Number($('#rb_cmax').value) || null,
    });
    if (!r.ok) return toast(r.data.message || 'Could not register');
    closeModal(); toast('Banquet registered'); renderAdmin();
  };
}
// Owner whose banquet the admin hasn't created yet.
function renderNoVenue() {
  $('#app').hidden = true;
  $('#login').innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <div class="auth-logo">${ic('i-home')}</div>
    <h2>Account pending setup</h2>
    <p class="auth-sub">Aapka banquet abhi register nahi hua. Admin (Echo DMC) se rabta karein — woh aapka dashboard bana kar denge.</p>
    <button class="btn btn-sec" id="nv_logout" style="width:100%;margin-top:14px">Log out</button>
  </div></div>`;
  $('#nv_logout').onclick = logout;
}

// ---- router ---------------------------------------------------------------
async function route() {
  const [, page, arg] = (location.hash || '#/home').split('/');
  if (page === 'home') return renderHome();
  if (page === 'calendar') return renderCalendar();
  if (page === 'bookings') return renderBookings();
  if (page === 'payments') return renderPayments();
  if (page === 'import') return renderImport();
  if (page === 'settings') return renderSettings();
  if (page === 'booking') return renderBookingDetail(arg);
  renderHome();
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
    <div class="card pad" style="margin-top:18px"><div class="card-h"><h3>Outstanding payments</h3><a href="#/payments">View all</a></div><div id="baqList"></div></div>`;
  $('#hNew').onclick = () => startNewBooking();
  $('#todayList').innerHTML = d.todays.length ? d.todays.map((b) => rowBooking(b)).join('') : emptyState('i-cal', 'No events scheduled for today.');
  $('#baqList').innerHTML = d.outstanding.length ? d.outstanding.slice(0, 6).map((b) => rowBooking(b, true)).join('') : emptyState('i-check', 'All payments cleared.');
  bindRows();
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
  $('#waBtn').onclick = async () => { await api.post(`bookings/${b.id}/remind`); toast('WhatsApp reminder sent', true); renderBookingDetail(id); };
  if ($('#confirmBtn')) $('#confirmBtn').onclick = async () => {
    const r = await api.post(`bookings/${b.id}/confirm`);
    if (!r.ok) return toast('Could not confirm — slot conflict');
    toast('Booking confirmed · WhatsApp sent', true); renderBookingDetail(id);
  };
  if ($('#completeBtn')) $('#completeBtn').onclick = async () => { await api.post(`bookings/${b.id}/complete`); toast('Marked as completed'); renderBookingDetail(id); };
  if ($('#cancelBtn')) $('#cancelBtn').onclick = async () => {
    const reason = prompt('Reason for cancellation?'); if (reason === null) return;
    await api.post(`bookings/${b.id}/cancel`, { reason }); toast('Booking cancelled'); renderBookingDetail(id);
  };
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
  $('#doImport').onclick = async () => {
    const rows = [...$('#impBody').querySelectorAll('tr')].map((tr) => {
      const o = {}; tr.querySelectorAll('[data-f]').forEach((f) => o[f.dataset.f] = f.value); return o;
    }).filter((o) => o.customer_name && o.date);
    if (!rows.length) return toast('Fill at least one row (name + date)');
    const r = await api.post('import', { rows });
    if (!r.ok) return toast('Import failed');
    $('#impNote').textContent = `${r.data.created} imported` + (r.data.errors.length ? `, ${r.data.errors.length} skipped` : '');
    toast(`${r.data.created} bookings imported`);
    $('#impBody').innerHTML = ''; addRow();
  };
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
    <div class="mono" style="margin-top:10px">Images &amp; videos dono chalte hain. Har banquet ya kisi khaas hall ke liye.</div>
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
    </div>`).join('') : emptyState('i-upload', 'Abhi koi photo/video nahi. Upload daba kar add karein.');
  $('#m_grid').querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Remove this file?')) return;
    await api.del('media/' + b.dataset.del); toast('Removed'); renderMediaGrid();
  });
}
async function uploadMedia(files) {
  if (!files.length) return;
  const st = $('#m_status'); const hallId = $('#m_hall').value || null;
  try {
    const { upload } = await import('/vendor/blob-client.js');
    let n = 0;
    for (const file of files) {
      st.textContent = `Uploading ${++n}/${files.length}…`;
      const blob = await upload(file.name, file, { access: 'public', handleUploadUrl: '/api/media/upload', clientPayload: TOKEN, contentType: file.type });
      const r = await api.post('media', { url: blob.url, kind: file.type.startsWith('video') ? 'video' : 'image', hall_id: hallId });
      if (!r.ok) throw new Error(r.data.message || 'save failed');
    }
    st.textContent = ''; toast(`${files.length} file(s) uploaded`); renderMediaGrid();
  } catch (e) {
    st.textContent = ''; toast('Upload failed: ' + (e.message || 'error'));
  }
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
    <button class="btn btn-pri" id="s_save" style="margin-top:20px">${ic('i-check')}Save changes</button></div>`;
  $('#s_fac').querySelectorAll('.chip').forEach((c) => c.onclick = () => c.classList.toggle('on'));
  $('#s_save').onclick = async () => {
    const facilities = [...$('#s_fac').querySelectorAll('.chip.on')].map((c) => c.dataset.f);
    await api.patch('venue', {
      name: $('#s_name').value, phone: $('#s_phone').value, city: $('#s_city').value, area: $('#s_area').value,
      address: $('#s_address').value, capacity_min: Number($('#s_cmin').value) || null, capacity_max: Number($('#s_cmax').value) || null, facilities,
    });
    VENUE = await api.get('venue'); $('#brandVenue').textContent = VENUE.name; toast('Venue profile saved');
  };
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
  $('#nh_add').onclick = async () => {
    if (!$('#nh_name').value.trim()) return toast('Enter a hall name');
    await api.post('halls', { name: $('#nh_name').value.trim(), capacity: Number($('#nh_cap').value) || null });
    VENUE = await api.get('venue'); setHalls(); toast('Hall added');
  };
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
  $('#ns_add').onclick = async () => {
    if (!$('#ns_name').value.trim()) return toast('Enter a slot name');
    await api.post('slots', { name: $('#ns_name').value.trim() });
    VENUE = await api.get('venue'); setSlots(); toast('Slot added');
  };
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
  $('#nr_add').onclick = async () => {
    if (!$('#nr_rate').value) return toast('Enter a rate');
    await api.post('rates', { hall_id: Number($('#nr_hall').value), event_type: $('#nr_event').value, per_head_rate: Number($('#nr_rate').value) });
    VENUE = await api.get('venue'); setRates(); toast('Rate added');
  };
}

// ---- modals ----
function closeModal() { $('#modal-root').innerHTML = ''; }
function modal(title, bodyHTML, footHTML) {
  $('#modal-root').innerHTML = `<div class="overlay"><div class="modal">
    <div class="modal-h"><h2>${esc(title)}</h2><button class="iconbtn" id="mClose">${ic('i-x')}</button></div>
    <div class="modal-b">${bodyHTML}</div><div class="modal-f">${footHTML}</div></div></div>`;
  $('#mClose').onclick = closeModal;
  $('.overlay').onclick = (e) => { if (e.target.classList.contains('overlay')) closeModal(); };
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
    if (r.status === 409) { g('f_avail').innerHTML = `<div class="warn">${ic('i-warn')}${esc(r.data.message || 'Slot already booked.')}</div>`; return; }
    if (!r.ok) return toast('Error: ' + (r.data.message || r.status));
    closeModal(); toast(status === 'confirmed' ? 'Booking confirmed · WhatsApp sent' : 'Tentative booking saved', status === 'confirmed');
    location.hash = '#/booking/' + r.data.id;
  }
  $('#b_tent').onclick = () => submit('tentative');
  $('#b_conf').onclick = () => submit('confirmed');
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
  $('#e_save').onclick = async () => {
    await api.patch('bookings/' + b.id, {
      customer_name: $('#e_name').value.trim(), customer_phone: $('#e_phone').value.trim(), event_type: event,
      guest_count: Number($('#e_guests').value) || null, total_amount: Number($('#e_total').value) || 0, notes: $('#e_notes').value.trim() || null,
    });
    closeModal(); toast('Booking updated'); renderBookingDetail(b.id);
  };
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
  $('#p_save').onclick = async () => {
    const amount = Number($('#p_amt').value); if (!amount || amount <= 0) return toast('Enter an amount');
    const r = await api.post(`bookings/${b.id}/payments`, { amount, method, paid_on: $('#p_date').value });
    if (!r.ok) return toast('Error'); closeModal(); toast('Payment added · balance updated'); renderBookingDetail(b.id);
  };
}

// ---- boot ----
// Guard: a brand-new venue may have no halls/slots yet.
function startNewBooking(pre) {
  if (!VENUE.halls || !VENUE.halls.length) { toast('Pehle ek hall add karein (Settings → Halls)'); location.hash = '#/settings'; return; }
  if (!VENUE.slots || !VENUE.slots.length) { toast('Pehle slots add karein (Settings → Slots)'); location.hash = '#/settings'; return; }
  openNewBooking(pre || { date: todayISO(), hall: VENUE.halls[0].id, slot: VENUE.slots[0].id });
}

function startApp() {
  $('#login').innerHTML = ''; $('#app').hidden = false;
  $('#brandVenue').textContent = VENUE.name;
  $('#newBtn').onclick = () => startNewBooking();
  const lb = $('#logoutBtn');
  if (ADMIN_VENUE) { lb.innerHTML = ic('i-chev-l') + 'Back to Admin'; lb.onclick = backToAdmin; }
  else lb.onclick = () => { if (confirm('Log out?')) logout(); };
  if (!listenerSet) { window.addEventListener('hashchange', route); document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); }); listenerSet = true; }
  if (!location.hash) location.hash = '#/home';
  route();
}
(async function init() {
  if (TOKEN) { try { return await enterApp(); } catch { /* fall through */ } }
  renderLogin();
})();
