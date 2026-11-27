// The diary: every booking for this venue. Search by customer, filter by status,
// tap a card for the full detail. The + button adds a new booking from the phone.
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { C, R } from '../theme';

const fmt = (n) => 'Rs ' + Number(n || 0).toLocaleString('en-IN');
const STAT = {
  tentative: ['Tentative', '#FFF4E0', '#B7791F'],
  confirmed: ['Confirmed', '#E6F4EA', '#1E7E4B'],
  completed: ['Completed', '#EAF2FD', '#2D6CDF'],
  cancelled: ['Cancelled', '#F3F0F0', '#9A8F8F'],
};
const FILTERS = [['', 'All'], ['tentative', 'Tentative'], ['confirmed', 'Confirmed'], ['completed', 'Completed']];

const prettyDate = (s) => {
  if (!s) return '';
  const d = new Date(s + 'T00:00:00');
  if (isNaN(d)) return s;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

export default function BookingsScreen({ navigation, onLogout }) {
  const [list, setList] = useState([]);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const insets = useSafeAreaInsets();

  const load = useCallback(async (opts = {}) => {
    try {
      const r = await api.bookings({ status: opts.status ?? status, q: opts.q ?? q });
      setList(Array.isArray(r.data) ? r.data : []);
    } catch (e) { if (e.unauthorized) onLogout?.(); }
    finally { setLoading(false); setRefreshing(false); }
  }, [onLogout, status, q]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pickFilter = (s) => { setStatus(s); setLoading(true); load({ status: s }); };

  return (
    <View style={[styles.fill, { paddingTop: insets.top + 8 }]}>
      <View style={styles.top}>
        <Text style={styles.h1}>Diary</Text>
        <TouchableOpacity style={styles.addTop} activeOpacity={0.85} onPress={() => navigation.navigate('NewBooking')}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={styles.addTopText}>New</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={17} color={C.muted} />
        <TextInput
          style={styles.search}
          placeholder="Search by customer name"
          placeholderTextColor={C.muted}
          value={q}
          onChangeText={setQ}
          onSubmitEditing={() => { setLoading(true); load(); }}
          returnKeyType="search"
        />
        {!!q && <TouchableOpacity onPress={() => { setQ(''); setLoading(true); load({ q: '' }); }} hitSlop={8}><Ionicons name="close-circle" size={18} color={C.muted} /></TouchableOpacity>}
      </View>

      <View style={styles.filters}>
        {FILTERS.map(([val, label]) => (
          <TouchableOpacity key={val || 'all'} style={[styles.chip, status === val && styles.chipOn]} onPress={() => pickFilter(val)} activeOpacity={0.8}>
            <Text style={[styles.chipText, status === val && styles.chipTextOn]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(it) => String(it.id)}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: insets.bottom + 90 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.primary} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="calendar-outline" size={46} color={C.line} />
              <Text style={styles.emptyText}>No bookings {status ? STAT[status]?.[0].toLowerCase() : 'yet'}</Text>
              <Text style={styles.emptySub}>Tap “New” to add one.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const [label, bg, color] = STAT[item.status] || STAT.tentative;
            const meta = [prettyDate(item.event_date), item.hall_name, item.slot_name].filter(Boolean).join(' · ');
            const bal = Number(item.balance || 0);
            return (
              <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={() => navigation.navigate('BookingDetail', { id: item.id })}>
                <View style={styles.cardTop}>
                  <Text style={styles.name} numberOfLines={1}>{item.customer_name}</Text>
                  <View style={[styles.pill, { backgroundColor: bg }]}><Text style={[styles.pillText, { color }]}>{label}</Text></View>
                </View>
                <Text style={styles.meta}>{meta}</Text>
                {!!item.event_type && <Text style={styles.evt}>{item.event_type}{item.guest_count ? ` · ${item.guest_count} guests` : ''}</Text>}
                <View style={styles.money}>
                  <Text style={styles.total}>{fmt(item.total_amount)}</Text>
                  {item.status !== 'cancelled' && (
                    bal > 0
                      ? <Text style={styles.due}>{fmt(bal)} due</Text>
                      : Number(item.total_amount) > 0 && <Text style={styles.paid}>Paid in full</Text>
                  )}
                </View>
              </TouchableOpacity>
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
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 8 },
  h1: { fontSize: 26, fontWeight: '800', color: C.text, letterSpacing: -0.4 },
  addTop: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.primary, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  addTopText: { color: '#fff', fontWeight: '800', fontSize: 13.5 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, backgroundColor: C.paper, borderRadius: 14, borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, height: 46 },
  search: { flex: 1, color: C.text, fontSize: 15 },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 12 },
  chip: { borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.card },
  chipOn: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { color: C.muted, fontWeight: '700', fontSize: 12.5 },
  chipTextOn: { color: '#fff' },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 6, padding: 44 },
  emptyText: { color: C.text, fontSize: 16, fontWeight: '700' },
  emptySub: { color: C.muted, fontSize: 13.5 },
  card: { backgroundColor: C.card, borderRadius: R.md, padding: 14, borderWidth: 1, borderColor: C.line },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { flex: 1, color: C.text, fontWeight: '800', fontSize: 15.5 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: 11.5, fontWeight: '800' },
  meta: { color: C.muted, fontSize: 13, marginTop: 5 },
  evt: { color: C.text, fontSize: 13, marginTop: 3, fontWeight: '600' },
  money: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.line },
  total: { color: C.text, fontSize: 15, fontWeight: '800' },
  due: { color: '#B7791F', fontSize: 13, fontWeight: '800' },
  paid: { color: '#1E7E4B', fontSize: 13, fontWeight: '800' },
});
