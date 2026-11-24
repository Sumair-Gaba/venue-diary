// Wedding checklist: a default task list the user can tick off, with progress.
// State persists locally (AsyncStorage) so it's a reason to reopen the app.
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, R } from '../theme';

const DEFAULT = [
  'Set your budget', 'Pick your event date', 'Shortlist venues on Venue Diary',
  'Visit top 3 venues', 'Book the venue & pay advance', 'Finalise catering / menu',
  'Book decor & stage', 'Photographer & videographer', 'Send invitations',
  'Confirm guest count with venue', 'Plan the event timeline (BEO)', 'Clear the balance payment',
];
const KEY = 'vd_checklist';

export default function ChecklistScreen({ navigation }) {
  const [done, setDone] = useState({});
  const insets = useSafeAreaInsets();

  useEffect(() => { AsyncStorage.getItem(KEY).then((s) => { if (s) setDone(JSON.parse(s)); }); }, []);
  const toggle = (i) => {
    const next = { ...done, [i]: !done[i] };
    setDone(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next));
  };

  const count = DEFAULT.filter((_, i) => done[i]).length;
  const pct = Math.round((count / DEFAULT.length) * 100);

  return (
    <View style={styles.fill}>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}><Ionicons name="chevron-back" size={22} color={C.text} /></TouchableOpacity>
        <Text style={styles.title}>Wedding Checklist</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>
        <View style={styles.progressCard}>
          <Text style={styles.progNum}>{pct}%</Text>
          <Text style={styles.progText}>{count} of {DEFAULT.length} done</Text>
          <View style={styles.bar}><View style={[styles.barFill, { width: `${pct}%` }]} /></View>
        </View>
        {DEFAULT.map((task, i) => (
          <TouchableOpacity key={i} style={styles.item} activeOpacity={0.7} onPress={() => toggle(i)}>
            <Ionicons name={done[i] ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={done[i] ? C.wa : C.line} />
            <Text style={[styles.task, done[i] && styles.taskDone]}>{task}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
  back: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: C.text },
  progressCard: { backgroundColor: C.primary, borderRadius: R.lg, padding: 20, marginBottom: 16 },
  progNum: { color: '#fff', fontSize: 34, fontWeight: '800' },
  progText: { color: 'rgba(255,255,255,0.9)', fontSize: 13.5, marginTop: 2 },
  bar: { height: 8, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 4, marginTop: 14, overflow: 'hidden' },
  barFill: { height: 8, backgroundColor: C.gold, borderRadius: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line },
  task: { flex: 1, color: C.text, fontSize: 15 },
  taskDone: { color: C.muted, textDecorationLine: 'line-through' },
});
