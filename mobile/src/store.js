// Lightweight local storage for the consumer app: the visitor's name (captured
// on the welcome screen, no password) and their saved/favourite venues.
import AsyncStorage from '@react-native-async-storage/async-storage';

const K = { user: 'vd_user', favs: 'vd_favs' };

export async function getUser() {
  try { const s = await AsyncStorage.getItem(K.user); return s ? JSON.parse(s) : null; } catch { return null; }
}
export async function setUser(u) {
  try { await AsyncStorage.setItem(K.user, JSON.stringify(u)); } catch {}
}

export async function getFavs() {
  try { const s = await AsyncStorage.getItem(K.favs); return s ? JSON.parse(s) : []; } catch { return []; }
}
const photoOf = (v) => (v.photos && v.photos[0]) || (v.media && (v.media.find((m) => m.kind !== 'video') || {}).url) || null;
export async function toggleFav(v) {
  const favs = await getFavs();
  const i = favs.findIndex((x) => x.slug === v.slug);
  if (i >= 0) favs.splice(i, 1);
  else favs.unshift({ slug: v.slug, name: v.name, area: v.area, photo: photoOf(v) });
  try { await AsyncStorage.setItem(K.favs, JSON.stringify(favs)); } catch {}
  return favs;
}
export async function isFav(slug) {
  return (await getFavs()).some((x) => x.slug === slug);
}
