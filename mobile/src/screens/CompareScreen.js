// Compare venues: pick up to 3 of your saved venues and see them side by side
// (photo, area, rating, pricing availability, contact). Details are fetched live.
import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { getFavs } from '../store';
import { C, R } from '../theme';

const MAX = 3;

export default function CompareScreen({ navigation }) {
  const [favs, setFavs] = useState([]);
  const [sel, setSel] = useState([]);
  const [details, setDetails] = useState({});
  const [loading, setLoading] = useState(false);
  const insets = useSafeAreaInsets();

  useFocusEffect(useCallback(() => { let on = true; getFavs().then((f) => on && setFavs(f)); return () => { on = false; }; }, []));

  const toggle = (slug) => setSel((s) => s.includes(slug) ? s.filter((x) => x !== slug) : (s.length >= MAX ? s : [...s, slug]));

  useEffect(() => {
    const missing = sel.filter((s) => !details[s]);
    if (!missing.length) return;
    setLoading(true);
    Promise.all(missing.map((s) => api.venue(s).then((v) => [s, v]).catch(() => [s, null])))
      .then((pairs) => setDetails((d) => ({ ...d, ...Object.fromEntries(pairs) })))
      .finally(() => setLoading(false));
  }, [sel]); // eslint-disable-line

  const chosen = sel.map((s) => details[s]).filter(Boolean);
  const priceOf = (v) => (v.hall_prices || []).some((p) => p.price > 0) ? 'Available' : 'Ask venue';

  if (favs.length === 0) {
    return (
      <View style={styles.fill}>
        <Header insets={insets} navigation={navigation} />
        <View style={styles.empty}>
          <Ionicons name="git-compare-outline" size={52} color={C.line} />
          <Text style={styles.emptyText}>Save some venues first</Text>
          <Text style={styles.emptySub}>Tap the heart on venues, then compare them here.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <Header insets={insets} navigation={navigation} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        <Text style={styles.pick}>Pick up to {MAX} ({sel.length} selected)</Text>
        <View style={styles.favWrap}>
          {favs.map((f) => {
            const on = sel.includes(f.slug);
            return (
              <TouchableOpacity key={f.slug} style={[styles.favChip, on && styles.favChipOn]} onPress={() => toggle(f.slug)} activeOpacity={0.8}>
                <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={on ? '#fff' : C.muted} />
                <Text style={[styles.favChipText, on && { color: '#fff' }]} numberOfLines={1}>{f.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {loading && <ActivityIndicator color={C.primary} style={{ marginTop: 20 }} />}

        {chosen.length >= 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cols}>
            {chosen.map((v) => (
              <View key={v.slug} style={styles.col}>
                {v.media?.find((m) => m.kind !== 'video')
                  ? <Image source={{ uri: v.media.find((m) => m.kind !== 'video').url }} style={styles.colImg} contentFit="cover" />
                  : <View style={[styles.colImg, styles.noimg]}><Ionicons name="image-outline" size={22} color={C.muted} /></View>}
                <Text style={styles.colName} numberOfLines={2}>{v.name}</Text>
                <Cell label="Area" value={v.area || '—'} />
                <Cell label="Rating" value={v.rating_count ? `${Number(v.rating).toFixed(1)} ★ (${v.rating_count})` : 'No reviews'} />
                <Cell label="Pricing" value={priceOf(v)} />
                <Cell label="Contact" value={v.phone ? '✓ Phone' : '—'} />
                <TouchableOpacity style={styles.openBtn} onPress={() => navigation.navigate('Venue', { slug: v.slug, name: v.name })}>
                  <Text style={styles.openText}>Open</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}
        {chosen.length === 0 && !loading && <Text style={styles.hint}>Select venues above to compare.</Text>}
      </ScrollView>
    </View>
  );
}

function Header({ insets, navigation }) {
  return (
    <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
      <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}><Ionicons name="chevron-back" size={22} color={C.text} /></TouchableOpacity>
      <Text style={styles.title}>Compare Venues</Text>
    </View>
  );
}
function Cell({ label, value }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      <Text style={styles.cellValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
  back: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: C.text },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 30 },
  emptyText: { color: C.text, fontSize: 17, fontWeight: '700', marginTop: 6 },
  emptySub: { color: C.muted, fontSize: 14, textAlign: 'center' },
  pick: { color: C.muted, fontSize: 13, fontWeight: '600', paddingHorizontal: 16, paddingTop: 14 },
  favWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16 },
  favChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.paper, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 13, borderWidth: 1, borderColor: C.line, maxWidth: 220 },
  favChipOn: { backgroundColor: C.primary, borderColor: C.primary },
  favChipText: { color: C.text, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  cols: { paddingHorizontal: 16, gap: 12, paddingTop: 6 },
  col: { width: 170, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, padding: 12 },
  colImg: { width: '100%', height: 100, borderRadius: 10, backgroundColor: C.paper },
  noimg: { alignItems: 'center', justifyContent: 'center' },
  colName: { color: C.text, fontWeight: '800', fontSize: 14, marginTop: 10, minHeight: 36 },
  cell: { borderTopWidth: 1, borderTopColor: C.line, paddingVertical: 8 },
  cellLabel: { color: C.muted, fontSize: 11, fontWeight: '600' },
  cellValue: { color: C.text, fontSize: 13.5, fontWeight: '600', marginTop: 2 },
  openBtn: { backgroundColor: C.primary, borderRadius: 10, height: 40, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  openText: { color: '#fff', fontWeight: '700', fontSize: 13.5 },
  hint: { color: C.muted, textAlign: 'center', marginTop: 24, fontSize: 13.5 },
});
