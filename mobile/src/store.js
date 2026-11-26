// Local storage + cloud sync for the consumer app. The visitor's name (captured
// on the welcome screen, no password) and their saved/favourite venues. Each
// install has a stable device id that maps to a backend "consumer" account, so
// favourites sync across sessions/devices and we can send Expo push later.
// AsyncStorage stays the fast local cache / offline fallback; the backend is the
// source of truth when reachable (network calls are best-effort, never block UI).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { consumerApi } from './api';

const K = { user: 'vd_user', favs: 'vd_favs', device: 'vd_device' };

// ---- device identity -------------------------------------------------------
function uuid() {
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; const v = c === 'x' ? r : ((r & 0x3) | 0x8); return v.toString(16);
  });
}
export async function getDeviceId() {
  try {
    let id = await AsyncStorage.getItem(K.device);
    if (!id) { id = 'd_' + uuid() + Date.now().toString(36); await AsyncStorage.setItem(K.device, id); }
    return id;
  } catch { return 'd_' + uuid(); }
}

// ---- user ------------------------------------------------------------------
export async function getUser() {
  try { const s = await AsyncStorage.getItem(K.user); return s ? JSON.parse(s) : null; } catch { return null; }
}
export async function setUser(u) {
  try { await AsyncStorage.setItem(K.user, JSON.stringify(u)); } catch {}
  // Push the name/city to the backend account (register is an upsert).
  try { const id = await getDeviceId(); await consumerApi.register(id, { name: u?.name || '', city: u?.city || '' }); } catch {}
}

// Register/refresh the backend account on launch and pull synced favourites
// into the local cache. Best-effort — offline just keeps the local cache.
export async function ensureConsumer() {
  try {
    const id = await getDeviceId();
    const u = await getUser();
    const prof = await consumerApi.register(id, { name: u?.name || '', city: u?.city || 'Karachi' });
    if (prof && Array.isArray(prof.favourites)) await AsyncStorage.setItem(K.favs, JSON.stringify(prof.favourites));
    return prof;
  } catch { return null; }
}

// ---- favourites ------------------------------------------------------------
const photoOf = (v) => (v.photos && v.photos[0]) || (v.media && (v.media.find((m) => m.kind !== 'video') || {}).url) || v.photo || null;

export async function getFavs() {
  try { const s = await AsyncStorage.getItem(K.favs); return s ? JSON.parse(s) : []; } catch { return []; }
}

// Pull the authoritative list from the backend, refresh the local cache, return
// it. Falls back to the local cache if offline. Call this on the Saved screen.
export async function syncFavs() {
  try {
    const id = await getDeviceId();
    const list = await consumerApi.favourites(id);
    if (Array.isArray(list)) { await AsyncStorage.setItem(K.favs, JSON.stringify(list)); return list; }
  } catch {}
  return getFavs();
}

export async function toggleFav(v) {
  const favs = await getFavs();
  const i = favs.findIndex((x) => x.slug === v.slug);
  const adding = i < 0;
  if (i >= 0) favs.splice(i, 1);
  else favs.unshift({ slug: v.slug, name: v.name, area: v.area, photo: photoOf(v) });
  try { await AsyncStorage.setItem(K.favs, JSON.stringify(favs)); } catch {}   // optimistic local update
  try {   // sync to backend (best-effort)
    const id = await getDeviceId();
    if (adding) await consumerApi.addFav(id, v.slug); else await consumerApi.removeFav(id, v.slug);
  } catch {}
  return favs;
}

export async function isFav(slug) {
  return (await getFavs()).some((x) => x.slug === slug);
}
