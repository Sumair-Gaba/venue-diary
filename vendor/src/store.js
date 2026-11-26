// Local storage for the vendor app: the owner's session token + cached profile.
import AsyncStorage from '@react-native-async-storage/async-storage';

const K = { token: 'vd_vendor_token', user: 'vd_vendor_user' };

export async function getToken() {
  try { return await AsyncStorage.getItem(K.token); } catch { return null; }
}
export async function setToken(t) {
  try { await AsyncStorage.setItem(K.token, t); } catch {}
}
export async function clearToken() {
  try { await AsyncStorage.multiRemove([K.token, K.user]); } catch {}
}
export async function getProfile() {
  try { const s = await AsyncStorage.getItem(K.user); return s ? JSON.parse(s) : null; } catch { return null; }
}
export async function setProfile(u) {
  try { await AsyncStorage.setItem(K.user, JSON.stringify(u)); } catch {}
}
