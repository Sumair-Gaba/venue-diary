// Vendor (owner) API client. Talks to the same Venue Diary backend as the web
// dashboard and consumer app. Owner auth = phone + OTP → a bearer token stored
// locally; every call sends Authorization: Bearer <token>.
import { getToken, clearToken } from './store';

export const BASE_URL = 'https://venue-diary-two.vercel.app/api';

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
  venue: () => req('GET', 'venue'),
  leads: () => req('GET', 'leads'),
  setLeadStatus: (id, status) => req('PATCH', 'leads/' + id, { status }),
  // chat
  conversations: () => req('GET', 'conversations'),
  messages: (id) => req('GET', 'conversations/' + id + '/messages'),
  sendMessage: (id, body) => req('POST', 'conversations/' + id + '/messages', { body }),
};
