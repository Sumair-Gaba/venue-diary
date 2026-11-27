// Month calendar per hall: see which dates are confirmed / tentative / free.
// Pick a hall, swipe months, tap a free date to start a new booking for it.
// Backed by GET /calendar?month=YYYY-MM&hall=ID.
import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { C, R } from '../theme';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const ymOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const pad = (n) => String(n).padStart(2, '0');
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function CalendarScreen({ navigation }) {
  const [halls, setHalls] = useState([]);
  const [hall, setHall] = useState(null);
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [days, setDays] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingCal, setLoadingCal] = useState(false);
  const insets = useSafeAreaInsets();

  // halls once
  useEffect(() => {
    (async () => {
      try {
        const r = await api.venue();
        const hs = r.ok ? (r.data?.halls || []) : [];
        setHalls(hs);
        setHall(hs[0]?.id || null);
      } catch {} finally { setLoading(false); }
    })();
  }, []);

  const loadCal = useCallback(async () => {
    if (!hall) { setDays({}); return; }
    setLoadingCal(true);
    try {
      const r = await api.calendar({ month: ymOf(cursor), hall });
      setDays(r.ok ? (r.data?.days || {}) : {});
    } catch { setDays({}); } finally { setLoadingCal(false); }
  }, [hall, cursor]);

  useFocusEffect(useCallback(() => { loadCal(); }, [loadCal]));

  if (loading) return <View style={styles.center}><ActivityIndicator color={C.primary} size="large" /></View>;

  const year = cursor.getFullYear(), month = cursor.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const stepMonth = (delta) => { const d = new Date(cursor); d.setMonth(d.getMonth() + delta); setDays({}); setCursor(d); };

  const onDay = (d) => {
    const iso = `${year}-${pad(month + 1)}-${pad(d)}`;
    const st = days[iso];
    if (st) return; // booked/tentative — no detail id from calendar; leave as info
    navigation.navigate('NewBooking', { date: iso });
  };

  return (
    <View style={styles.fill}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}><Ionicons name="arrow-back" size={24} color="#fff" /></TouchableOpacity>
        <Text style={styles.headerTitle}>Calendar</Text>
        <View style={{ width: 24 }} />
      </View>

      {!halls.length ? (
        <View style={styles.center}>
          <Ionicons name="business-outline" size={46} color={C.muted} />
          <Text style={styles.muted}>Add a hall first to see its calendar.</Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {/* hall picker */}
          <View style={styles.hallRow}>
            {halls.map((h) => (
              <TouchableOpacity key={h.id} style={[styles.hallChip, hall === h.id && styles.hallOn]} onPress={() => { setDays({}); setHall(h.id); }} activeOpacity={0.8}>
                <Text style={[styles.hallText, hall === h.id && styles.hallTextOn]} numberOfLines={1}>{h.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* month nav */}
          <View style={styles.monthNav}>
            <TouchableOpacity onPress={() => stepMonth(-1)} hitSlop={10} style={styles.navBtn}><Ionicons name="chevron-back" size={22} color={C.text} /></TouchableOpacity>
            <Text style={styles.monthLabel}>{MONTHS[month]} {year}</Text>
            <TouchableOpacity onPress={() => stepMonth(1)} hitSlop={10} style={styles.navBtn}><Ionicons name="chevron-forward" size={22} color={C.text} /></TouchableOpacity>
          </View>

          {/* weekday row */}
          <View style={styles.weekRow}>
            {WEEK.map((w, i) => <Text key={i} style={styles.weekCell}>{w}</Text>)}
          </View>

          {/* grid */}
          <View style={styles.grid}>
            {cells.map((d, i) => {
              if (d === null) return <View key={'e' + i} style={styles.cell} />;
              const iso = `${year}-${pad(month + 1)}-${pad(d)}`;
              const st = days[iso];
              const isToday = iso === todayISO();
              const bg = st === 'confirmed' ? '#E6F4EA' : st === 'tentative' ? '#FFF4E0' : 'transparent';
              const dot = st === 'confirmed' ? '#1E7E4B' : st === 'tentative' ? '#B7791F' : null;
              return (
                <TouchableOpacity key={iso} style={styles.cell} activeOpacity={st ? 1 : 0.6} onPress={() => onDay(d)}>
                  <View style={[styles.dayBox, { backgroundColor: bg }, isToday && styles.today]}>
                    <Text style={[styles.dayNum, isToday && styles.todayNum]}>{d}</Text>
                    {dot && <View style={[styles.dot, { backgroundColor: dot }]} />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {loadingCal && <ActivityIndicator color={C.primary} style={{ marginTop: 10 }} />}

          {/* legend */}
          <View style={styles.legend}>
            <Legend color="#1E7E4B" label="Confirmed" />
            <Legend color="#B7791F" label="Tentative" />
            <Legend color={C.line} label="Free · tap to book" ring />
          </View>
        </View>
      )}
    </View>
  );
}

function Legend({ color, label, ring }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, ring ? { borderWidth: 2, borderColor: color, backgroundColor: 'transparent' } : { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  muted: { color: C.muted, fontSize: 14, textAlign: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: C.primary, paddingHorizontal: 14, paddingBottom: 12 },
  headerTitle: { flex: 1, color: '#fff', fontSize: 17, fontWeight: '800', textAlign: 'center' },
  hallRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 14 },
  hallChip: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, maxWidth: '48%' },
  hallOn: { backgroundColor: C.primary, borderColor: C.primary },
  hallText: { color: C.text, fontWeight: '700', fontSize: 13 },
  hallTextOn: { color: '#fff' },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 6 },
  navBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' },
  monthLabel: { fontSize: 18, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  weekRow: { flexDirection: 'row', paddingHorizontal: 8 },
  weekCell: { flex: 1, textAlign: 'center', color: C.muted, fontWeight: '800', fontSize: 12, paddingVertical: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 3 },
  dayBox: { flex: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 3 },
  today: { borderWidth: 2, borderColor: C.primary },
  dayNum: { color: C.text, fontSize: 15, fontWeight: '600' },
  todayNum: { color: C.primary, fontWeight: '800' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, justifyContent: 'center', padding: 18 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendText: { color: C.muted, fontSize: 12.5, fontWeight: '600' },
});
