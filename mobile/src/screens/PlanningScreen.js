// Planning hub: tools that keep couples coming back — budget calculator, a
// wedding checklist, and venue comparison.
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, R } from '../theme';

const TOOLS = [
  { key: 'Budget', title: 'Budget Calculator', sub: 'Estimate your event cost in seconds', icon: 'calculator', colors: ['#A6324F', '#7E2239'] },
  { key: 'Checklist', title: 'Wedding Checklist', sub: 'Track every task to the big day', icon: 'checkbox', colors: ['#2D7FF9', '#1E5FD0'] },
  { key: 'Compare', title: 'Compare Venues', sub: 'Put your saved venues side by side', icon: 'git-compare', colors: ['#C79A4B', '#9A7430'] },
];

export default function PlanningScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={styles.fill} contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 90, paddingHorizontal: 16 }}>
      <Text style={styles.h1}>Planning</Text>
      <Text style={styles.sub}>Tools to plan your perfect event</Text>
      {TOOLS.map((t) => (
        <TouchableOpacity key={t.key} activeOpacity={0.9} style={styles.card} onPress={() => navigation.navigate(t.key)}>
          <LinearGradient colors={t.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.grad}>
            <View style={styles.icon}><Ionicons name={t.icon} size={26} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{t.title}</Text>
              <Text style={styles.cardSub}>{t.sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.9)" />
          </LinearGradient>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  h1: { fontSize: 26, fontWeight: '800', color: C.text, letterSpacing: -0.4 },
  sub: { color: C.muted, marginTop: 2, fontSize: 13.5, marginBottom: 18 },
  card: { borderRadius: 20, overflow: 'hidden', marginBottom: 14 },
  grad: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 20 },
  icon: { width: 52, height: 52, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontWeight: '800', fontSize: 17 },
  cardSub: { color: 'rgba(255,255,255,0.9)', fontSize: 13, marginTop: 3 },
});
