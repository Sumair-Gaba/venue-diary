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
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();
  const deb = useRef(null);
  const inputRef = useRef(null);

  const load = useCallback(async (p, query, ar) => {
    setLoading(true);
    try {
      const r = await api.venues({ q: query, area: ar, page: p });
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
    load(1, nq, na);
    if (p.focus) setTimeout(() => inputRef.current?.focus(), 350);
  }, [route.params]); // eslint-disable-line

  const onSearch = (t) => {
    setQ(t);
    clearTimeout(deb.current);
    deb.current = setTimeout(() => load(1, t, area), 300);
  };
  const pickArea = (a) => { setArea(a); load(1, q, a); };

  const header = (
    <View style={styles.header}>
      <Text style={styles.h1}>Hall Finder</Text>
      <Text style={styles.sub}>{total ? `${total} venues in Karachi` : 'Browse Karachi venues'}</Text>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={C.muted} />
        <TextInput ref={inputRef} style={styles.search} placeholder="Search by name…" placeholderTextColor={C.muted} value={q} onChangeText={onSearch} returnKeyType="search" />
        {!!q && <TouchableOpacity onPress={() => onSearch('')}><Ionicons name="close-circle" size={18} color={C.muted} /></TouchableOpacity>}
      </View>
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

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <FlatList
        data={items}
        keyExtractor={(it) => String(it.id)}
        numColumns={2}
        ListHeaderComponent={header}
        columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
        contentContainerStyle={{ gap: 12, paddingBottom: insets.bottom + 80 }}
        onEndReached={() => { if (page < pages && !loading) load(page + 1, q, area); }}
        onEndReachedThreshold={1}
        ListFooterComponent={loading ? <ActivityIndicator color={C.primary} style={{ marginVertical: 20 }} /> : null}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>No venues found.</Text> : null}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={() => navigation.navigate('Venue', { slug: item.slug, name: item.name })}>
            {item.photos?.[0]
              ? <Image source={{ uri: item.photos[0] }} style={styles.cardImg} contentFit="cover" transition={150} />
              : <View style={[styles.cardImg, styles.noimg]}><Ionicons name="image-outline" size={26} color={C.muted} /></View>}
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
  cardImg: { width: '100%', height: 130, backgroundColor: C.paper },
  noimg: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: 10 },
  cardName: { color: C.text, fontWeight: '700', fontSize: 13.5, lineHeight: 18 },
  cardArea: { color: C.muted, fontSize: 12, marginTop: 3 },
  empty: { textAlign: 'center', color: C.muted, marginTop: 40 },
});
