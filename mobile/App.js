import 'react-native-gesture-handler';
import { useCallback, useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import HomeScreen from './src/screens/HomeScreen';
import ExploreScreen from './src/screens/ExploreScreen';
import SavedScreen from './src/screens/SavedScreen';
import VenueScreen from './src/screens/VenueScreen';
import ReelsScreen from './src/screens/ReelsScreen';
import MapScreen from './src/screens/MapScreen';
import PlanningScreen from './src/screens/PlanningScreen';
import BudgetScreen from './src/screens/BudgetScreen';
import ChecklistScreen from './src/screens/ChecklistScreen';
import CompareScreen from './src/screens/CompareScreen';
import ChatScreen from './src/screens/ChatScreen';
import InboxScreen from './src/screens/InboxScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import * as Notifications from 'expo-notifications';
import { getUser, ensureConsumer } from './src/store';
import { registerForPush } from './src/push';
import { C } from './src/theme';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();

// A push can deep-link on tap: { conversation_id } opens the chat thread;
// { slug } opens a venue.
function handleNotificationData(data) {
  if (!navigationRef.isReady()) return;
  if (data?.conversation_id) navigationRef.navigate('Chat', { conversationId: data.conversation_id, venueName: data.name });
  else if (data?.slug) navigationRef.navigate('Venue', { slug: data.slug, name: data.name });
}

const ICONS = { HomeTab: 'home', ExploreTab: 'search', SavedTab: 'heart', PlanningTab: 'sparkles' };

function Tabs() {
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
      <Tab.Screen name="HomeTab" component={HomeScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="ExploreTab" component={ExploreScreen} options={{ title: 'Explore' }} />
      <Tab.Screen name="SavedTab" component={SavedScreen} options={{ title: 'Saved' }} />
      <Tab.Screen name="PlanningTab" component={PlanningScreen} options={{ title: 'Planning' }} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [hasUser, setHasUser] = useState(false);

  useEffect(() => {
    getUser().then((u) => { setHasUser(!!u); setReady(true); });
    // Register the device account first, then the push token (it attaches to it).
    ensureConsumer().then(() => registerForPush());

    // Deep-link when a notification is tapped (app running or cold-started).
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      handleNotificationData(resp?.notification?.request?.content?.data);
    });
    Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (resp) handleNotificationData(resp.notification?.request?.content?.data);
    });
    return () => sub.remove();
  }, []);
  const done = useCallback(() => setHasUser(true), []);

  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.primary} size="large" /></View>;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {hasUser ? (
        <NavigationContainer ref={navigationRef}>
          <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
            <Stack.Screen name="Tabs" component={Tabs} />
            <Stack.Screen name="Venue" component={VenueScreen} />
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="Inbox" component={InboxScreen} />
            <Stack.Screen name="Reels" component={ReelsScreen} options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="Map" component={MapScreen} />
            <Stack.Screen name="Budget" component={BudgetScreen} />
            <Stack.Screen name="Checklist" component={ChecklistScreen} />
            <Stack.Screen name="Compare" component={CompareScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      ) : (
        <OnboardingScreen onDone={done} />
      )}
    </SafeAreaProvider>
  );
}
