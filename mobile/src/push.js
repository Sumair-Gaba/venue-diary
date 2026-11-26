// Expo push notifications for the consumer app (free — no paid provider/card).
// On launch we ask permission, get the Expo push token, and save it to the
// device's backend account (consumer.push_token). The backend later sends
// notifications via Expo's free push service (e.g. "a venue replied to you").
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { getDeviceId } from './store';
import { consumerApi } from './api';

// Foreground behaviour: show a banner + play sound even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const projectId =
  Constants?.expoConfig?.extra?.eas?.projectId ||
  Constants?.easConfig?.projectId;

// Ask permission, fetch the Expo push token, and sync it to the backend.
// Best-effort and idempotent — safe to call on every launch. Returns the token
// or null (simulator, denied permission, or any error).
export async function registerForPush() {
  try {
    if (!Device.isDevice) return null;   // push only works on a real device

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Venue Diary',
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: '#A6324F',
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;

    const tokenResp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const token = tokenResp?.data;
    if (!token) return null;

    const id = await getDeviceId();
    await consumerApi.update(id, { push_token: token });   // store against this device account
    return token;
  } catch {
    return null;
  }
}
