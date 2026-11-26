// Expo push notifications — server side. Sends to the free Expo push service
// (https://exp.host). No paid provider, no SDK/dependency needed (Node 24 has a
// global fetch). Consumer push tokens live in consumer.push_token.
import { all } from './db.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const isExpoToken = (t) => typeof t === 'string' && /^ExponentPushToken\[/.test(t);

// Send one notification to many Expo tokens. `data` deep-links on tap (e.g.
// { slug, name }). Returns { sent, failed }. Best-effort — never throws.
export async function sendPush(tokens, { title, body, data = {} } = {}) {
  const list = [...new Set((tokens || []).filter(isExpoToken))];
  if (!list.length || !title) return { sent: 0, failed: 0 };
  const messages = list.map((to) => ({ to, title, body: body || '', data, sound: 'default', channelId: 'default' }));

  let sent = 0, failed = 0;
  // Expo accepts up to 100 messages per request; chunk to be safe.
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const r = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk),
      });
      const j = await r.json().catch(() => null);
      const data = Array.isArray(j?.data) ? j.data : [];
      for (const d of data) (d?.status === 'ok' ? sent++ : failed++);
      failed += Math.max(0, chunk.length - data.length);
    } catch { failed += chunk.length; }
  }
  return { sent, failed };
}

// Broadcast to every consumer that has a push token (optionally filtered by
// city). Powers app-only deal/announcement pushes. Returns { recipients, sent, failed }.
export async function broadcastToConsumers({ title, body, data = {}, city = null } = {}) {
  const rows = city
    ? await all('SELECT push_token FROM consumer WHERE push_token IS NOT NULL AND city=?', [city])
    : await all('SELECT push_token FROM consumer WHERE push_token IS NOT NULL');
  const tokens = rows.map((r) => r.push_token);
  const res = await sendPush(tokens, { title, body, data });
  return { recipients: tokens.length, ...res };
}
