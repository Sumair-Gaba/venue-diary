// Expo push for the vendor app (free). On login we register the owner's Expo
// push token with the backend (PATCH /me { push_token }) so new enquiries and
// customer messages alert them instantly.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const projectId =
  Constants?.expoConfig?.extra?.eas?.projectId ||
  Constants?.easConfig?.projectId;

export async function registerForPush() {
  try {
    if (!Device.isDevice) return null;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Venue Dekho Partner',
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: '#A6324F',
      });
    }
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;
    const tokenResp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const token = tokenResp?.data;
    if (token) await api.setPushToken(token);
    return token || null;
  } catch { return null; }
}
