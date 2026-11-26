// API client for the consumer app. Talks to the live Venue Diary backend
// (same Node API + Neon DB that powers the owner dashboard). All endpoints
// used here are public (no auth). To point at a local dev server, change BASE.
export const BASE_URL = 'https://venue-diary-two.vercel.app/api';

async function getJSON(path) {
  const r = await fetch(BASE_URL + path);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const qs = (o) => Object.entries(o)
  .filter(([, v]) => v !== undefined && v !== null && v !== '')
  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

export const api = {
  venues: ({ q = '', area = '', page = 1, limit = 24, date = '', guests = '', minBudget = '', maxBudget = '', verified = '', facilities = '', sort = '' } = {}) =>
    getJSON('/public/venues?' + qs({ q, area, page, limit, date, guests, minBudget, maxBudget, verified, facilities, sort })),
  areas: () => getJSON('/public/areas'),
  reels: ({ page = 1, limit = 15 } = {}) => getJSON('/public/reels?' + qs({ page, limit })),
  deals: ({ limit = 40 } = {}) => getJSON('/public/deals?' + qs({ limit })),
  near: ({ lat, lng, radius = 5 } = {}) => getJSON('/public/near?' + qs({ lat, lng, radius })),
  venue: (slug) => getJSON('/public/venue?slug=' + encodeURIComponent(slug)),
  enquire: (slug, body) => fetch(BASE_URL + '/public/enquiry?slug=' + encodeURIComponent(slug), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json()),
  enquireBulk: (slugs, body) => fetch(BASE_URL + '/public/enquiries/bulk', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slugs, ...body }),
  }).then((r) => r.json()),
  review: (slug, body) => fetch(BASE_URL + '/public/review?slug=' + encodeURIComponent(slug), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json()),
};

// Consumer (device-based) account API. The device id goes in X-Device-Id; there
// is no password/OTP. Drives cloud-synced favourites + (later) Expo push.
const devHeaders = (deviceId) => ({ 'Content-Type': 'application/json', 'X-Device-Id': deviceId });
export const consumerApi = {
  register: (deviceId, body) => fetch(BASE_URL + '/consumer/register', { method: 'POST', headers: devHeaders(deviceId), body: JSON.stringify(body || {}) }).then((r) => r.json()),
  update: (deviceId, body) => fetch(BASE_URL + '/consumer', { method: 'PATCH', headers: devHeaders(deviceId), body: JSON.stringify(body || {}) }).then((r) => r.json()),
  favourites: (deviceId) => fetch(BASE_URL + '/consumer/favourites', { headers: { 'X-Device-Id': deviceId } }).then((r) => r.json()),
  addFav: (deviceId, slug) => fetch(BASE_URL + '/consumer/favourites', { method: 'POST', headers: devHeaders(deviceId), body: JSON.stringify({ slug }) }).then((r) => r.json()),
  removeFav: (deviceId, slug) => fetch(BASE_URL + '/consumer/favourites/' + encodeURIComponent(slug), { method: 'DELETE', headers: { 'X-Device-Id': deviceId } }).then((r) => r.json()),
};

// WhatsApp deep link (no + in the number), prefilled — same approach as the web.
export const waLink = (phone, text) =>
  `https://wa.me/${String(phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
