// Activity feed — the same "what needs my attention" list the web dashboard
// shows: events today/tomorrow, tentative bookings to confirm, payments pending,
// and new enquiries. Backed by GET /notifications (venueAlerts). Each item taps
// through to the booking or the enquiries tab.
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, FlatList, Linking, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { C, R } from '../theme';

const fmt = (n) => 'Rs ' + Number(n || 0).toLocaleString('en-IN');

// Per alert type: icon + tint. Severity (alert/warn/info) drives the left bar.
const TYPE = {
  event_today: ['calendar', C.primary],
  event_tomorrow: ['calendar-outline', '#2D6CDF'],
  tentative: ['help-circle', '#B7791F'],
  balance: ['cash', '#B7791F'],
  lead: ['megaphone', C.primary],
};
const SEV = { alert: C.primary, warn: '#B7791F', info: '#2D6CDF' };

export default function NotificationsScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    try { const r = await api.notifications(); setItems(Array.isArray(r.data) ? r.data : []); }
    catch {} finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openItem = (it) => {
    if (it.booking_id) navigation.navigate('BookingDetail', { id: it.booking_id });
    else if (it.lead_id) navigation.navigate('Tabs', { screen: 'LeadsTab' });
  };

  return (
    <View style={styles.fill}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}><Ionicons name="arrow-back" size={24} color="#fff" /></TouchableOpacity>
        <Text style={styles.headerTitle}>Activity</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it, i) => (it.type + '-' + (it.booking_id || it.lead_id || i))}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.primary} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="checkmark-done-circle-outline" size={50} color={C.line} />
              <Text style={styles.emptyText}>All caught up</Text>
              <Text style={styles.emptySub}>New enquiries, bookings to confirm and payments due will show here.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const [icon, tint] = TYPE[item.type] || ['notifications', C.primary];
            const bar = SEV[item.severity] || C.line;
            const tappable = !!(item.booking_id || item.lead_id);
            return (
              <TouchableOpacity style={styles.card} activeOpacity={tappable ? 0.85 : 1} disabled={!tappable} onPress={() => openItem(item)}>
                <View style={[styles.bar, { backgroundColor: bar }]} />
                <View style={[styles.iconWrap, { backgroundColor: tint + '1A' }]}>
                  <Ionicons name={icon} size={20} color={tint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{item.title}</Text>
                  <Text style={styles.text}>{item.text}</Text>
                  {item.type === 'balance' && item.amount > 0 && <Text style={styles.amount}>{fmt(item.amount)} due</Text>}
                </View>
                {!!item.phone && (
                  <TouchableOpacity style={styles.callBtn} hitSlop={8} onPress={() => Linking.openURL('tel:' + item.phone)}>
                    <Ionicons name="call" size={17} color={C.primary} />
                  </TouchableOpacity>
                )}
                {tappable && <Ionicons name="chevron-forward" size={18} color={C.muted} />}
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: C.primary, paddingHorizontal: 14, paddingBottom: 12 },
  headerTitle: { flex: 1, color: '#fff', fontSize: 17, fontWeight: '800', textAlign: 'center' },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 6, padding: 44, marginTop: 30 },
  emptyText: { color: C.text, fontSize: 17, fontWeight: '800' },
  emptySub: { color: C.muted, fontSize: 13.5, textAlign: 'center', lineHeight: 20 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: R.md, padding: 14, paddingLeft: 16, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  iconWrap: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontWeight: '800', fontSize: 14.5 },
  text: { color: C.muted, fontSize: 13, marginTop: 2 },
  amount: { color: '#B7791F', fontSize: 13, fontWeight: '800', marginTop: 4 },
  callBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FDEEF2', alignItems: 'center', justifyContent: 'center' },
});
