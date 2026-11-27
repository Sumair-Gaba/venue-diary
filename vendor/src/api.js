// Vendor (owner) API client. Talks to the same Venue Diary backend as the web
// dashboard and consumer app. Owner auth = phone + OTP → a bearer token stored
// locally; every call sends Authorization: Bearer <token>.
import { getToken, clearToken } from './store';

export const BASE_URL = 'https://venue-diary-two.vercel.app/api';

// Build a ?key=value query string from a params object (skips empty values).
function qs(params) {
  if (!params) return '';
  const pairs = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return pairs.length ? '?' + pairs.map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&') : '';
}

async function req(method, path, body) {
  const token = await getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE_URL + '/' + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch {}
  if (r.status === 401) { await clearToken(); const e = new Error('unauthorized'); e.unauthorized = true; throw e; }
  return { ok: r.ok, status: r.status, data };
}

export const api = {
  // auth
  requestOtp: (phone) => req('POST', 'auth/request-otp', { phone }),
  verify: (phone, code) => req('POST', 'auth/verify', { phone, code }),
  me: () => req('GET', 'me'),
  setPushToken: (push_token) => req('PATCH', 'me', { push_token }),
  // dashboard + leads
  dashboard: () => req('GET', 'dashboard'),
  notifications: () => req('GET', 'notifications'),
  venue: () => req('GET', 'venue'),
  leads: () => req('GET', 'leads'),
  setLeadStatus: (id, status) => req('PATCH', 'leads/' + id, { status }),
  // bookings (the diary)
  bookings: (params) => req('GET', 'bookings' + qs(params)),
  booking: (id) => req('GET', 'bookings/' + id),
  createBooking: (body) => req('POST', 'bookings', body),
  updateBooking: (id, body) => req('PATCH', 'bookings/' + id, body),
  checkSlot: (body) => req('POST', 'check', body),
  calendar: (params) => req('GET', 'calendar' + qs(params)),
  confirmBooking: (id) => req('POST', 'bookings/' + id + '/confirm'),
  completeBooking: (id) => req('POST', 'bookings/' + id + '/complete'),
  cancelBooking: (id, reason) => req('POST', 'bookings/' + id + '/cancel', { reason }),
  addPayment: (id, body) => req('POST', 'bookings/' + id + '/payments', body),
  // chat
  conversations: () => req('GET', 'conversations'),
  messages: (id) => req('GET', 'conversations/' + id + '/messages'),
  sendMessage: (id, body) => req('POST', 'conversations/' + id + '/messages', { body }),
  // manage the banquet (edit profile / halls / slots / rates / media)
  updateVenue: (body) => req('PATCH', 'venue', body),
  addHall: (body) => req('POST', 'halls', body),
  updateHall: (id, body) => req('PATCH', 'halls/' + id, body),
  deleteHall: (id) => req('DELETE', 'halls/' + id),
  addSlot: (body) => req('POST', 'slots', body),
  deleteSlot: (id) => req('DELETE', 'slots/' + id),
  addRate: (body) => req('POST', 'rates', body),
  deleteRate: (id) => req('DELETE', 'rates/' + id),
  media: () => req('GET', 'media'),
  addMedia: (body) => req('POST', 'media', body),
  directUpload: (body) => req('POST', 'media/direct', body),
  deleteMedia: (id) => req('DELETE', 'media/' + id),
};
