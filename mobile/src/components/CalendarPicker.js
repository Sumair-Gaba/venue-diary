// A small, dependency-free month calendar. Tap a day to pick it (returns an
// ISO yyyy-mm-dd string); past days are disabled. Used in the Explore filters
// sheet to check venue availability on a date.
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, R } from '../theme';

const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export default function CalendarPicker({ value, onChange }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const init = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00') : today;
  const [view, setView] = useState({ y: init.getFullYear(), m: init.getMonth() });

  const first = new Date(view.y, view.m, 1).getDay();        // weekday of the 1st
  const days = new Date(view.y, view.m + 1, 0).getDate();    // days in month
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const step = (n) => { const d = new Date(view.y, view.m + n, 1); setView({ y: d.getFullYear(), m: d.getMonth() }); };
  const atStart = view.y === today.getFullYear() && view.m === today.getMonth();

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => !atStart && step(-1)} disabled={atStart} hitSlop={8} style={styles.nav}>
          <Ionicons name="chevron-back" size={20} color={atStart ? C.line : C.text} />
        </TouchableOpacity>
        <Text style={styles.title}>{MON[view.m]} {view.y}</Text>
        <TouchableOpacity onPress={() => step(1)} hitSlop={8} style={styles.nav}>
          <Ionicons name="chevron-forward" size={20} color={C.text} />
        </TouchableOpacity>
      </View>
      <View style={styles.grid}>
        {WD.map((w, i) => <View key={'w' + i} style={styles.cell}><Text style={styles.wd}>{w}</Text></View>)}
        {cells.map((d, i) => {
          if (!d) return <View key={'e' + i} style={styles.cell} />;
          const s = iso(view.y, view.m, d);
          const dt = new Date(view.y, view.m, d); dt.setHours(0, 0, 0, 0);
          const past = dt < today;
          const sel = value === s;
          return (
            <TouchableOpacity key={s} style={styles.cell} disabled={past} onPress={() => onChange(sel ? '' : s)} activeOpacity={0.7}>
              <View style={[styles.day, sel && styles.daySel]}>
                <Text style={[styles.dayText, past && styles.dayPast, sel && styles.dayTextSel]}>{d}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: C.paper, borderRadius: R.md, padding: 10, borderWidth: 1, borderColor: C.line },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: 6 },
  nav: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '800', color: C.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  wd: { color: C.muted, fontSize: 11, fontWeight: '700' },
  day: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  daySel: { backgroundColor: C.primary },
  dayText: { color: C.text, fontSize: 13.5, fontWeight: '600' },
  dayPast: { color: C.line },
  dayTextSel: { color: '#fff', fontWeight: '800' },
});
