// Vendor home: a quick daily snapshot — today's events, this week's bookings,
// pending balance — plus shortcuts to leads and messages with unread badges.
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { clearToken } from '../store';
import { C, R } from '../theme';

const fmt = (n) => 'Rs ' + Number(n || 0).toLocaleString('en-IN');

export default function HomeScreen({ navigation, onLogout }) {
  const [me, setMe] = useState(null);
  const [dash, setDash] = useState(null);
  const [leadNew, setLeadNew] = useState(0);
  const [msgUnread, setMsgUnread] = useState(0);
  const [alerts, setAlerts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    try {
      const [meR, dR, lR, cR, nR] = await Promise.all([api.me(), api.dashboard(), api.leads(), api.conversations(), api.notifications()]);
      setMe(meR.data || null);
      setDash(dR.data || null);
      setLeadNew(Array.isArray(lR.data) ? lR.data.filter((l) => l.status === 'new').length : 0);
      setMsgUnread(Array.isArray(cR.data) ? cR.data.reduce((s, c) => s + (c.unread || 0), 0) : 0);
      setAlerts(Array.isArray(nR.data) ? nR.data.length : 0);
    } catch (e) { if (e.unauthorized) onLogout?.(); }
    finally { setLoading(false); setRefreshing(false); }
  }, [onLogout]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <View style={styles.center}><ActivityIndicator color={C.primary} size="large" /></View>;

  const hasVenue = me?.hasVenue;
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.primary} />}
    >
      <LinearGradient colors={[C.primary, C.primaryDark]} style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headRow}>
          <View>
            <Text style={styles.greet}>{greet} 👋</Text>
            <Text style={styles.name}>{me?.name || 'Partner'}</Text>
          </View>
          <View style={styles.headActions}>
            <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.navigate('Notifications')} hitSlop={8}>
              <Ionicons name="notifications-outline" size={22} color="#fff" />
              {alerts > 0 && <View style={styles.bellBadge}><Text style={styles.bellBadgeText}>{alerts > 9 ? '9+' : alerts}</Text></View>}
            </TouchableOpacity>
            {hasVenue && (
              <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.navigate('Manage')} hitSlop={8}>
                <Ionicons name="settings-outline" size={21} color="#fff" />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.iconBtn} onPress={async () => { await clearToken(); onLogout?.(); }} hitSlop={8}>
              <Ionicons name="log-out-outline" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>

      {!hasVenue ? (
        <View style={styles.pending}>
          <Ionicons name="hourglass-outline" size={46} color={C.muted} />
          <Text style={styles.pendingText}>No venue linked yet</Text>
          <Text style={styles.pendingSub}>Your account isn’t linked to a venue. Please contact the Venue Dekho team to get set up.</Text>
        </View>
      ) : (
        <View style={styles.body}>
          {/* Stat tiles */}
          <View style={styles.tiles}>
            <View style={styles.tile}>
              <Text style={styles.tileNum}>{dash?.todays?.length || 0}</Text>
              <Text style={styles.tileLabel}>Events today</Text>
            </View>
            <View style={styles.tile}>
              <Text style={styles.tileNum}>{dash?.weekCount || 0}</Text>
              <Text style={styles.tileLabel}>This week</Text>
            </View>
          </View>
          <View style={styles.tileWide}>
            <Text style={styles.tileLabel}>Pending balance</Text>
            <Text style={styles.tileBig}>{fmt(dash?.totalBaqaya || 0)}</Text>
          </View>

          {/* Shortcuts */}
          <TouchableOpacity style={styles.link} activeOpacity={0.85} onPress={() => navigation.navigate('LeadsTab')}>
            <View style={[styles.linkIcon, { backgroundColor: '#FDEEF2' }]}><Ionicons name="megaphone" size={20} color={C.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Enquiries</Text>
              <Text style={styles.linkSub}>New customer enquiries</Text>
            </View>
            {leadNew > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{leadNew}</Text></View>}
            <Ionicons name="chevron-forward" size={20} color={C.muted} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.link} activeOpacity={0.85} onPress={() => navigation.navigate('MessagesTab')}>
            <View style={[styles.linkIcon, { backgroundColor: '#EAF2FD' }]}><Ionicons name="chatbubbles" size={20} color="#2D6CDF" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Messages</Text>
              <Text style={styles.linkSub}>Chat with customers</Text>
            </View>
            {msgUnread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{msgUnread}</Text></View>}
            <Ionicons name="chevron-forward" size={20} color={C.muted} />
          </TouchableOpacity>

          {/* Today's events list */}
          <Text style={styles.sectionH}>Today’s events</Text>
          {(dash?.todays || []).length ? dash.todays.map((b) => (
            <TouchableOpacity key={b.id} style={styles.eventRow} activeOpacity={0.85} onPress={() => navigation.navigate('BookingDetail', { id: b.id })}>
              <View style={styles.eventDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.eventName}>{b.customer_name}</Text>
                <Text style={styles.eventMeta}>{[b.hall_name, b.slot_name, b.event_type].filter(Boolean).join(' · ')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.muted} />
            </TouchableOpacity>
          )) : <Text style={styles.muted}>No events today.</Text>}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  header: { paddingHorizontal: 18, paddingBottom: 22, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  greet: { color: 'rgba(255,255,255,0.85)', fontSize: 14 },
  name: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: -0.4, marginTop: 2 },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  bellBadge: { position: 'absolute', top: 2, right: 2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 1.5, borderColor: C.primaryDark },
  bellBadgeText: { color: C.dark, fontSize: 10, fontWeight: '900' },
  pending: { alignItems: 'center', justifyContent: 'center', gap: 8, padding: 36, marginTop: 40 },
  pendingText: { color: C.text, fontSize: 18, fontWeight: '700' },
  pendingSub: { color: C.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  body: { padding: 16, gap: 12 },
  tiles: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1, backgroundColor: C.paper, borderRadius: R.md, padding: 16, borderWidth: 1, borderColor: C.line },
  tileNum: { fontSize: 30, fontWeight: '800', color: C.primary, letterSpacing: -1 },
  tileLabel: { color: C.muted, fontSize: 13, fontWeight: '600', marginTop: 2 },
  tileWide: { backgroundColor: C.paper, borderRadius: R.md, padding: 16, borderWidth: 1, borderColor: C.line },
  tileBig: { fontSize: 26, fontWeight: '800', color: C.text, letterSpacing: -0.5, marginTop: 4 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: R.md, padding: 14, borderWidth: 1, borderColor: C.line },
  linkIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  linkTitle: { color: C.text, fontWeight: '700', fontSize: 15 },
  linkSub: { color: C.muted, fontSize: 12.5, marginTop: 2 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  sectionH: { fontSize: 17, fontWeight: '800', color: C.text, marginTop: 10 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: R.md, padding: 12, borderWidth: 1, borderColor: C.line },
  eventDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary },
  eventName: { color: C.text, fontWeight: '700', fontSize: 14.5 },
  eventMeta: { color: C.muted, fontSize: 12.5, marginTop: 2 },
  muted: { color: C.muted, fontSize: 14 },
});
