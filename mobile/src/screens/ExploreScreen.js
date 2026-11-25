// Explore / Hall Finder: a photo-forward venue grid with search and an area
// filter. Backed by GET /api/public/venues (paginated). Accepts { q, area,
// focus } params from Home (category taps, area taps, search focus).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { C, R } from '../theme';

export default function ExploreScreen({ navigation, route }) {
  const [items, setItems] = useState([]);
  const [areas, setAreas] = useState([]);
  const [q, setQ] = useState('');
  const [area, setArea] = useState('');
  const [date, setDate] = useState('');
  const [onlyAvail, setOnlyAvail] = useState(false);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();
  const deb = useRef(null);
  const inputRef = useRef(null);

  const load = useCallback(async (p, query, ar, dt) => {
    setLoading(true);
    try {
      const r = await api.venues({ q: query, area: ar, page: p, date: dt });
      setPages(r.pages); setTotal(r.total); setPage(r.page);
      setItems((cur) => (p === 1 ? r.items : [...cur, ...r.items]));
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { api.areas().then(setAreas).catch(() => {}); }, []);

  // React to params from Home (category / area / search-focus) and initial load.
  useEffect(() => {
    const p = route.params || {};
    const nq = p.q || ''; const na = p.area || '';
    setQ(nq); setArea(na);
    load(1, nq, na, date);
    if (p.focus) setTimeout(() => inputRef.current?.focus(), 350);
  }, [route.params]); // eslint-disable-line

  const onSearch = (t) => {
    setQ(t);
    clearTimeout(deb.current);
    deb.current = setTimeout(() => load(1, t, area, date), 300);
  };
  const pickArea = (a) => { setArea(a); load(1, q, a, date); };
  // Apply / clear a date to check availability. A valid date re-queries so the
  // server annotates each venue as available / booked / unknown.
  const applyDate = (t) => {
    setDate(t);
    if (!t || /^\d{4}-\d{2}-\d{2}$/.test(t)) {
      clearTimeout(deb.current);
      deb.current = setTimeout(() => load(1, q, area, t), 300);
    }
  };
  const clearDate = () => { setDate(''); setOnlyAvail(false); load(1, q, area, ''); };

  const header = (
    <View style={styles.header}>
      <Text style={styles.h1}>Hall Finder</Text>
      <Text style={styles.sub}>{total ? `${total} venues in Karachi` : 'Browse Karachi venues'}</Text>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={C.muted} />
        <TextInput ref={inputRef} style={styles.search} placeholder="Search by name…" placeholderTextColor={C.muted} value={q} onChangeText={onSearch} returnKeyType="search" />
        {!!q && <TouchableOpacity onPress={() => onSearch('')}><Ionicons name="close-circle" size={18} color={C.muted} /></TouchableOpacity>}
      </View>
      <View style={styles.searchBox}>
        <Ionicons name="calendar-outline" size={18} color={C.muted} />
        <TextInput style={styles.search} placeholder="Check a date (e.g. 2026-12-15)" placeholderTextColor={C.muted} value={date} onChangeText={applyDate} keyboardType="numbers-and-punctuation" />
        {!!date && <TouchableOpacity onPress={clearDate}><Ionicons name="close-circle" size={18} color={C.muted} /></TouchableOpacity>}
      </View>
      {!!date && /^\d{4}-\d{2}-\d{2}$/.test(date) && (
        <TouchableOpacity style={[styles.availToggle, onlyAvail && styles.availToggleOn]} onPress={() => setOnlyAvail((x) => !x)} activeOpacity={0.8}>
          <Ionicons name={onlyAvail ? 'checkbox' : 'square-outline'} size={18} color={onlyAvail ? '#fff' : C.primary} />
          <Text style={[styles.availToggleText, onlyAvail && { color: '#fff' }]}>Only show available venues</Text>
        </TouchableOpacity>
      )}
      <FlatList
        data={[{ area: '', count: 0 }, ...areas]}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(it) => it.area || 'all'}
        style={styles.chips}
        contentContainerStyle={{ gap: 8, paddingRight: 16 }}
        renderItem={({ item }) => {
          const on = area === item.area;
          return (
            <TouchableOpacity style={[styles.chip, on && styles.chipOn]} onPress={() => pickArea(item.area)} activeOpacity={0.8}>
              <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
                {item.area ? `${item.area} (${item.count})` : 'All areas'}
              </Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );

  const showAvail = !!date && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const data = showAvail && onlyAvail ? items.filter((i) => i.availability === 'available') : items;
  const availChip = (a) => {
    if (a === 'available') return { label: 'Available', bg: 'rgba(28,107,58,0.92)' };
    if (a === 'booked') return { label: 'Booked', bg: 'rgba(176,42,55,0.92)' };
    return { label: 'Ask venue', bg: 'rgba(60,54,70,0.8)' };
  };

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <FlatList
        data={data}
        keyExtractor={(it) => String(it.id)}
        numColumns={2}
        ListHeaderComponent={header}
        columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
        contentContainerStyle={{ gap: 12, paddingBottom: insets.bottom + 80 }}
        onEndReached={() => { if (page < pages && !loading) load(page + 1, q, area, date); }}
        onEndReachedThreshold={1}
        ListFooterComponent={loading ? <ActivityIndicator color={C.primary} style={{ marginVertical: 20 }} /> : null}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>No venues found.</Text> : null}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={() => navigation.navigate('Venue', { slug: item.slug, name: item.name })}>
            {item.photos?.[0]
              ? <Image source={{ uri: item.photos[0] }} style={styles.cardImg} contentFit="cover" transition={150} />
              : <View style={[styles.cardImg, styles.noimg]}><Ionicons name="image-outline" size={26} color={C.muted} /></View>}
            {!!item.verified && (
              <View style={styles.vBadge}><Ionicons name="checkmark-circle" size={12} color="#fff" /><Text style={styles.vBadgeText}>Verified</Text></View>
            )}
            {showAvail && !!item.availability && (
              <View style={[styles.aBadge, { backgroundColor: availChip(item.availability).bg }]}>
                <Text style={styles.aBadgeText}>{availChip(item.availability).label}</Text>
              </View>
            )}
            <View style={styles.cardBody}>
              <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
              {!!item.area && <Text style={styles.cardArea} numberOfLines={1}>{item.area}</Text>}
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  h1: { fontSize: 26, fontWeight: '800', color: C.text, letterSpacing: -0.4 },
  sub: { color: C.muted, marginTop: 2, fontSize: 13.5 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.paper, borderRadius: R.md, paddingHorizontal: 14, height: 46, marginTop: 14, borderWidth: 1, borderColor: C.line },
  search: { flex: 1, color: C.text, fontSize: 15 },
  chips: { marginTop: 14, marginHorizontal: -16, paddingHorizontal: 16 },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: 999, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, justifyContent: 'center', maxWidth: 190 },
  chipOn: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { color: C.text, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  card: { flex: 1, backgroundColor: C.card, borderRadius: R.md, overflow: 'hidden', borderWidth: 1, borderColor: C.line },
  vBadge: { position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(28,107,58,0.92)', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  vBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  aBadge: { position: 'absolute', top: 8, right: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  aBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  availToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: C.primary },
  availToggleOn: { backgroundColor: C.primary },
  availToggleText: { color: C.primary, fontSize: 13, fontWeight: '700' },
  cardImg: { width: '100%', height: 130, backgroundColor: C.paper },
  noimg: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: 10 },
  cardName: { color: C.text, fontWeight: '700', fontSize: 13.5, lineHeight: 18 },
  cardArea: { color: C.muted, fontSize: 12, marginTop: 3 },
  empty: { textAlign: 'center', color: C.muted, marginTop: 40 },
});
