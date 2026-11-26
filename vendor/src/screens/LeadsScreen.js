// Vendor leads: customer enquiries from the public page / app. Mark contacted or
// closed; tap the phone to call. Pull to refresh.
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, FlatList, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { C, R } from '../theme';

const STAT = { new: ['New', '#FDEEF2', C.primary], contacted: ['Contacted', '#EAF2FD', '#2D6CDF'], closed: ['Closed', '#EFEFEF', '#777'] };

export default function LeadsScreen({ onLogout }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    try { const r = await api.leads(); setList(Array.isArray(r.data) ? r.data : []); }
    catch (e) { if (e.unauthorized) onLogout?.(); }
    finally { setLoading(false); }
  }, [onLogout]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setStatus = async (id, status) => {
    setList((l) => l.map((x) => (x.id === id ? { ...x, status } : x)));
    try { await api.setLeadStatus(id, status); } catch {}
  };

  return (
    <View style={[styles.fill, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.h1}>Enquiries</Text>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(it) => String(it.id)}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: insets.bottom + 20 }}
          ListEmptyComponent={<View style={styles.empty}><Ionicons name="megaphone-outline" size={46} color={C.line} /><Text style={styles.emptyText}>No enquiries yet</Text></View>}
          renderItem={({ item }) => {
            const [label, bg, color] = STAT[item.status] || STAT.new;
            const meta = [item.event_type, item.event_date, item.guests ? item.guests + ' guests' : ''].filter(Boolean).join(' · ');
            return (
              <View style={styles.card}>
                <View style={styles.cardTop}>
                  <Text style={styles.name}>{item.name}</Text>
                  <View style={[styles.pill, { backgroundColor: bg }]}><Text style={[styles.pillText, { color }]}>{label}</Text></View>
                </View>
                {!!meta && <Text style={styles.meta}>{meta}</Text>}
                {!!item.message && <Text style={styles.msg}>{item.message}</Text>}
                <View style={styles.acts}>
                  {!!item.phone && (
                    <TouchableOpacity style={styles.act} onPress={() => Linking.openURL('tel:' + item.phone)}>
                      <Ionicons name="call" size={15} color={C.primary} /><Text style={styles.actText}>Call</Text>
                    </TouchableOpacity>
                  )}
                  {item.status !== 'contacted' && (
                    <TouchableOpacity style={styles.act} onPress={() => setStatus(item.id, 'contacted')}>
                      <Ionicons name="checkmark" size={15} color={C.primary} /><Text style={styles.actText}>Contacted</Text>
                    </TouchableOpacity>
                  )}
                  {item.status !== 'closed' && (
                    <TouchableOpacity style={styles.act} onPress={() => setStatus(item.id, 'closed')}>
                      <Ionicons name="close" size={15} color={C.primary} /><Text style={styles.actText}>Close</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  h1: { fontSize: 26, fontWeight: '800', color: C.text, letterSpacing: -0.4, paddingHorizontal: 16, marginBottom: 6 },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 8, padding: 40 },
  emptyText: { color: C.muted, fontSize: 15, fontWeight: '600' },
  card: { backgroundColor: C.card, borderRadius: R.md, padding: 14, borderWidth: 1, borderColor: C.line },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { color: C.text, fontWeight: '800', fontSize: 15.5 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: 11.5, fontWeight: '800' },
  meta: { color: C.muted, fontSize: 13, marginTop: 4 },
  msg: { color: C.text, fontSize: 13.5, marginTop: 8, lineHeight: 19, backgroundColor: C.paper, borderRadius: 10, padding: 10 },
  acts: { flexDirection: 'row', gap: 8, marginTop: 12 },
  act: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12 },
  actText: { color: C.primary, fontWeight: '700', fontSize: 12.5 },
});
