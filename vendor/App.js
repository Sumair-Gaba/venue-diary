import 'react-native-gesture-handler';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import LeadsScreen from './src/screens/LeadsScreen';
import MessagesScreen from './src/screens/MessagesScreen';
import ChatScreen from './src/screens/ChatScreen';
import { getToken } from './src/store';
import { registerForPush } from './src/push';
import { C } from './src/theme';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();

const ICONS = { HomeTab: 'home', LeadsTab: 'megaphone', MessagesTab: 'chatbubbles' };

// A push can deep-link: { conversation_id } → chat; { kind:'lead' } → leads tab.
function handleNotificationData(data) {
  if (!navigationRef.isReady()) return;
  if (data?.conversation_id) navigationRef.navigate('Chat', { conversationId: data.conversation_id, title: 'Customer' });
  else if (data?.kind === 'lead') navigationRef.navigate('Tabs', { screen: 'LeadsTab' });
}

function Tabs({ onLogout }) {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: C.primary,
        tabBarInactiveTintColor: C.muted,
        tabBarStyle: { backgroundColor: '#fff', borderTopColor: C.line, height: 62, paddingTop: 6, paddingBottom: 8 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarIcon: ({ color, size, focused }) => (
          <Ionicons name={focused ? ICONS[route.name] : `${ICONS[route.name]}-outline`} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="HomeTab" options={{ title: 'Home' }}>
        {(props) => <HomeScreen {...props} onLogout={onLogout} />}
      </Tab.Screen>
      <Tab.Screen name="LeadsTab" options={{ title: 'Enquiries' }}>
        {(props) => <LeadsScreen {...props} onLogout={onLogout} />}
      </Tab.Screen>
      <Tab.Screen name="MessagesTab" options={{ title: 'Messages' }}>
        {(props) => <MessagesScreen {...props} onLogout={onLogout} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const subRef = useRef(null);

  useEffect(() => {
    getToken().then((t) => { setSignedIn(!!t); setReady(true); if (t) registerForPush(); });
    subRef.current = Notifications.addNotificationResponseReceivedListener((resp) => {
      handleNotificationData(resp?.notification?.request?.content?.data);
    });
    Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (resp) handleNotificationData(resp.notification?.request?.content?.data);
    });
    return () => subRef.current?.remove();
  }, []);

  const onLogin = useCallback(() => { setSignedIn(true); registerForPush(); }, []);
  const onLogout = useCallback(() => setSignedIn(false), []);

  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.primary} size="large" /></View>;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {signedIn ? (
        <NavigationContainer ref={navigationRef}>
          <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
            <Stack.Screen name="Tabs">
              {(props) => <Tabs {...props} onLogout={onLogout} />}
            </Stack.Screen>
            <Stack.Screen name="Chat" component={ChatScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      ) : (
        <LoginScreen onDone={onLogin} />
      )}
    </SafeAreaProvider>
  );
}
