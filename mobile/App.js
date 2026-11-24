import 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import ReelsScreen from './src/screens/ReelsScreen';
import ExploreScreen from './src/screens/ExploreScreen';
import VenueScreen from './src/screens/VenueScreen';
import { C } from './src/theme';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: C.gold,
        tabBarInactiveTintColor: 'rgba(255,255,255,0.55)',
        tabBarStyle: { backgroundColor: C.dark, borderTopColor: 'rgba(255,255,255,0.08)', height: 62, paddingTop: 6, paddingBottom: 8 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={route.name === 'Reels' ? 'play-circle' : 'grid'} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Reels" component={ReelsScreen} />
      <Tab.Screen name="Explore" component={ExploreScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="light" />
        <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
          <Stack.Screen name="Tabs" component={Tabs} />
          <Stack.Screen name="Venue" component={VenueScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
