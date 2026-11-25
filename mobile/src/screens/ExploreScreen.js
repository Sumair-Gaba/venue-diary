// Explore / Hall Finder: a photo-forward venue grid with search, an area
// filter, and a Filters sheet (budget, guests/capacity, verified-only, top
// rated, facilities, and a date-availability calendar). Backed by
// GET /api/public/venues (paginated + filtered). Accepts { q, area, focus }
// params from Home (category taps, area taps, search focus).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import CalendarPicker from '../components/CalendarPicker';
import { api } from '../api';
import { C, R } from '../theme';

const fmt = (n) => 'Rs ' + Number(n || 0).toLocaleString('en-IN');
const BUDGETS = [
  { label: 'Under 2 lakh', min: 0, max: 200000 },
  { label: '2–5 lakh', min: 200000, max: 500000 },
  { label: '5–10 lakh', min: 500000, max: 1000000 },
  { label: '10 lakh+', min: 1000000, max: 0 },
];
const GUESTS = [300, 500, 800, 1200];
const FACILITIES = ['AC', 'Parking', 'Generator', 'Bridal room', 'Separate halls', 'Valet', 'Stage', 'DJ allowed', 'Outside catering'];
const EMPTY = { budget: -1, guests: 0, verified: false, sort: '', facilities: [], date: '' };

const paramsFor = (f) => ({
  guests: f.guests || '',
  minBudget: f.budget >= 0 ? BUDGETS[f.budget].min : '',
  maxBudget: f.budget >= 0 ? BUDGETS[f.budget].max : '',
  verified: f.verified ? 'true' : '',
  facilities: f.facilities.join(','),
  sort: f.sort,
  date: f.date,
});
const activeCount = (f) =>
  (f.budget >= 0 ? 1 : 0) + (f.guests ? 1 : 0) + (f.verified ? 1 : 0) + (f.sort ? 1 : 0) + f.facilities.length + (f.date ? 1 : 0);

export default function ExploreScreen({ navigation, route }) {
  const [items, setItems] = useState([]);
  const [areas, setAreas] = useState([]);
  const [q, setQ] = useState('');
  const [area, setArea] = useState('');
  const [filters, setFilters] = useState(EMPTY);
  const [draft, setDraft] = useState(EMPTY);
  const [showFilters, setShowFilters] = useState(false);
  const [showAreas, setShowAreas] = useState(false);
  const [areaQuery, setAreaQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();
  const deb = useRef(null);
  const inputRef = useRef(null);

  const load = useCallback(async (p, query, ar, f) => {
    setLoading(true);
    try {
      const r = await api.venues({ q: query, area: ar, page: p, ...paramsFor(f) });
      setPages(r.pages); setTotal(r.total); setPage(r.page);
      setItems((cur) => (p === 1 ? r.items : [...cur, ...r.items]));
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { api.areas().then(setAreas).catch(() => {}); }, []);

  useEffect(() => {
    const p = route.params || {};
    const nq = p.q || ''; const na = p.area || '';
    setQ(nq); setArea(na);
    load(1, nq, na, filters);
    if (p.focus) setTimeout(() => inputRef.current?.focus(), 350);
  }, [route.params]); // eslint-disable-line

  const onSearch = (t) => {
    setQ(t);
    clearTimeout(deb.current);
    deb.current = setTimeout(() => load(1, t, area, filters), 300);
  };
  const pickArea = (a) => { setArea(a); load(1, q, a, filters); };

  const openFilters = () => { setDraft(filters); setShowFilters(true); };
  const applyFilters = () => { setFilters(draft); setShowFilters(false); load(1, q, area, draft); };
  const clearFilters = () => setDraft(EMPTY);

  const nActive = activeCount(filters);
  const showAvail = !!filters.date;
  const availChip = (a) => a === 'available' ? { label: 'Available', bg: 'rgba(28,107,58,0.92)' }
    : a === 'booked' ? { label: 'Booked', bg: 'rgba(176,42,55,0.92)' }
    : { label: 'Ask venue', bg: 'rgba(60,54,70,0.8)' };

  const header = (
    <View style={styles.header}>
      <Text style={styles.h1}>Hall Finder</Text>
      <Text style={styles.sub}>{total ? `${total} venue${total === 1 ? '' : 's'} found` : 'Browse Karachi venues'}</Text>
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={C.muted} />
          <TextInput ref={inputRef} style={styles.search} placeholder="Search by name…" placeholderTextColor={C.muted} value={q} onChangeText={onSearch} returnKeyType="search" />
          {!!q && <TouchableOpacity onPress={() => onSearch('')}><Ionicons name="close-circle" size={18} color={C.muted} /></TouchableOpacity>}
        </View>
        <TouchableOpacity style={[styles.filterBtn, nActive > 0 && styles.filterBtnOn]} onPress={openFilters} activeOpacity={0.85}>
          <Ionicons name="options-outline" size={20} color={nActive > 0 ? '#fff' : C.primary} />
          {nActive > 0 && <View style={styles.fCount}><Text style={styles.fCountText}>{nActive}</Text></View>}
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={styles.areaSel} onPress={() => { setAreaQuery(''); setShowAreas(true); }} activeOpacity={0.85}>
        <Ionicons name="location-outline" size={17} color={C.primary} />
        <Text style={[styles.areaSelText, !area && { color: C.muted }]} numberOfLines={1}>{area || 'All areas — tap to search'}</Text>
        {area
          ? <TouchableOpacity onPress={() => pickArea('')} hitSlop={10}><Ionicons name="close-circle" size={18} color={C.muted} /></TouchableOpacity>
          : <Ionicons name="chevron-down" size={18} color={C.muted} />}
      </TouchableOpacity>
    </View>
  );

  const areaMatches = areas.filter((a) => a.area.toLowerCase().includes(areaQuery.trim().toLowerCase()));

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <FlatList
        data={items}
        keyExtractor={(it) => String(it.id)}
        numColumns={2}
        ListHeaderComponent={header}
        columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
        contentContainerStyle={{ gap: 12, paddingBottom: insets.bottom + 80 }}
        onEndReached={() => { if (page < pages && !loading) load(page + 1, q, area, filters); }}
        onEndReachedThreshold={1}
        ListFooterComponent={loading ? <ActivityIndicator color={C.primary} style={{ marginVertical: 20 }} /> : null}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>No venues match your filters.</Text> : null}
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
              <View style={styles.cardMeta}>
                <Text style={styles.cardPrice} numberOfLines={1}>{item.price_from ? `From ${fmt(item.price_from)}` : 'Price on request'}</Text>
                {item.rating_count > 0 && (
                  <View style={styles.rate}><Ionicons name="star" size={11} color={C.gold} /><Text style={styles.rateText}>{Number(item.rating).toFixed(1)}</Text></View>
                )}
              </View>
            </View>
          </TouchableOpacity>
        )}
      />

      <Modal visible={showFilters} animationType="slide" transparent onRequestClose={() => setShowFilters(false)}>
        <View style={styles.sheetWrap}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 10 }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Filters</Text>
              <TouchableOpacity onPress={() => setShowFilters(false)} hitSlop={8}><Ionicons name="close" size={24} color={C.muted} /></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.fLabel}>Budget (complete event price)</Text>
              <View style={styles.wrapChips}>
                {BUDGETS.map((b, i) => {
                  const on = draft.budget === i;
                  return <TouchableOpacity key={b.label} style={[styles.fchip, on && styles.fchipOn]} onPress={() => setDraft((d) => ({ ...d, budget: on ? -1 : i }))} activeOpacity={0.8}>
                    <Text style={[styles.fchipText, on && styles.fchipTextOn]}>{b.label}</Text></TouchableOpacity>;
                })}
              </View>

              <Text style={styles.fLabel}>Capacity (guests)</Text>
              <View style={styles.wrapChips}>
                {GUESTS.map((g) => {
                  const on = draft.guests === g;
                  return <TouchableOpacity key={g} style={[styles.fchip, on && styles.fchipOn]} onPress={() => setDraft((d) => ({ ...d, guests: on ? 0 : g }))} activeOpacity={0.8}>
                    <Text style={[styles.fchipText, on && styles.fchipTextOn]}>{g}+ guests</Text></TouchableOpacity>;
                })}
              </View>

              <Text style={styles.fLabel}>Show</Text>
              <View style={styles.wrapChips}>
                <TouchableOpacity style={[styles.fchip, draft.verified && styles.fchipOn]} onPress={() => setDraft((d) => ({ ...d, verified: !d.verified }))} activeOpacity={0.8}>
                  <Ionicons name="checkmark-circle" size={13} color={draft.verified ? '#fff' : C.primary} />
                  <Text style={[styles.fchipText, draft.verified && styles.fchipTextOn, { marginLeft: 4 }]}>Verified only</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.fchip, draft.sort === 'rating' && styles.fchipOn]} onPress={() => setDraft((d) => ({ ...d, sort: d.sort === 'rating' ? '' : 'rating' }))} activeOpacity={0.8}>
                  <Ionicons name="star" size={13} color={draft.sort === 'rating' ? '#fff' : C.gold} />
                  <Text style={[styles.fchipText, draft.sort === 'rating' && styles.fchipTextOn, { marginLeft: 4 }]}>Top rated</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.fLabel}>Facilities</Text>
              <View style={styles.wrapChips}>
                {FACILITIES.map((f) => {
                  const on = draft.facilities.includes(f);
                  return <TouchableOpacity key={f} style={[styles.fchip, on && styles.fchipOn]} activeOpacity={0.8}
                    onPress={() => setDraft((d) => ({ ...d, facilities: on ? d.facilities.filter((x) => x !== f) : [...d.facilities, f] }))}>
                    <Text style={[styles.fchipText, on && styles.fchipTextOn]}>{f}</Text></TouchableOpacity>;
                })}
              </View>

              <Text style={styles.fLabel}>Check availability on a date</Text>
              <CalendarPicker value={draft.date} onChange={(s) => setDraft((d) => ({ ...d, date: s }))} />
              <Text style={styles.fHint}>Verified venues show Available / Booked for this date. Others show “Ask venue”.</Text>
            </ScrollView>

            <View style={styles.sheetBar}>
              <TouchableOpacity style={styles.clearBtn} onPress={clearFilters} activeOpacity={0.85}><Text style={styles.clearText}>Clear all</Text></TouchableOpacity>
              <TouchableOpacity style={styles.applyBtn} onPress={applyFilters} activeOpacity={0.85}><Text style={styles.applyText}>Show results</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showAreas} animationType="slide" transparent onRequestClose={() => setShowAreas(false)}>
        <View style={styles.sheetWrap}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 10, height: '82%' }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Choose area</Text>
              <TouchableOpacity onPress={() => setShowAreas(false)} hitSlop={8}><Ionicons name="close" size={24} color={C.muted} /></TouchableOpacity>
            </View>
            <View style={[styles.searchBox, { marginTop: 8 }]}>
              <Ionicons name="search" size={18} color={C.muted} />
              <TextInput style={styles.search} placeholder="Search area…" placeholderTextColor={C.muted} value={areaQuery} onChangeText={setAreaQuery} autoFocus />
              {!!areaQuery && <TouchableOpacity onPress={() => setAreaQuery('')}><Ionicons name="close-circle" size={18} color={C.muted} /></TouchableOpacity>}
            </View>
            <FlatList
              data={[{ area: '', count: 0 }, ...areaMatches]}
              keyExtractor={(it) => it.area || 'all'}
              keyboardShouldPersistTaps="handled"
              style={{ marginTop: 10 }}
              ListEmptyComponent={<Text style={styles.empty}>No area matches “{areaQuery}”.</Text>}
              renderItem={({ item }) => {
                const on = area === item.area;
                return (
                  <TouchableOpacity style={styles.areaRow} onPress={() => { pickArea(item.area); setShowAreas(false); }} activeOpacity={0.7}>
                    <Text style={[styles.areaRowText, on && { color: C.primary, fontWeight: '800' }]}>{item.area || 'All areas'}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {!!item.area && <Text style={styles.areaRowCount}>{item.count}</Text>}
                      {on && <Ionicons name="checkmark" size={18} color={C.primary} />}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  h1: { fontSize: 26, fontWeight: '800', color: C.text, letterSpacing: -0.4 },
  sub: { color: C.muted, marginTop: 2, fontSize: 13.5 },
  searchRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.paper, borderRadius: R.md, paddingHorizontal: 14, height: 46, borderWidth: 1, borderColor: C.line },
  search: { flex: 1, color: C.text, fontSize: 15 },
  filterBtn: { width: 46, height: 46, borderRadius: R.md, borderWidth: 1.5, borderColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  filterBtnOn: { backgroundColor: C.primary, borderColor: C.primary },
  fCount: { position: 'absolute', top: -6, right: -6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  fCountText: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
  areaSel: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, height: 44, paddingHorizontal: 14, borderRadius: R.md, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line },
  areaSelText: { flex: 1, color: C.text, fontSize: 14.5, fontWeight: '600' },
  areaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line },
  areaRowText: { color: C.text, fontSize: 15, fontWeight: '600' },
  areaRowCount: { color: C.muted, fontSize: 13, fontWeight: '700' },
  chips: { marginTop: 14, marginHorizontal: -16, paddingHorizontal: 16 },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: 999, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, justifyContent: 'center', maxWidth: 190 },
  chipOn: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { color: C.text, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  card: { flex: 1, backgroundColor: C.card, borderRadius: R.md, overflow: 'hidden', borderWidth: 1, borderColor: C.line },
  cardImg: { width: '100%', height: 130, backgroundColor: C.paper },
  noimg: { alignItems: 'center', justifyContent: 'center' },
  vBadge: { position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(28,107,58,0.92)', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  vBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  aBadge: { position: 'absolute', top: 8, right: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  aBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  cardBody: { padding: 10 },
  cardName: { color: C.text, fontWeight: '700', fontSize: 13.5, lineHeight: 18 },
  cardArea: { color: C.muted, fontSize: 12, marginTop: 3 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  cardPrice: { color: C.primary, fontSize: 12, fontWeight: '800', flex: 1 },
  rate: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  rateText: { color: C.text, fontSize: 11.5, fontWeight: '700' },
  empty: { textAlign: 'center', color: C.muted, marginTop: 40 },
  // filter sheet
  sheetWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: C.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 14, maxHeight: '88%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sheetTitle: { fontSize: 19, fontWeight: '800', color: C.text },
  fLabel: { fontSize: 13.5, fontWeight: '800', color: C.text, marginTop: 18, marginBottom: 10 },
  fHint: { color: C.muted, fontSize: 12, marginTop: 8, lineHeight: 17 },
  wrapChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fchip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, height: 38, borderRadius: 999, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line },
  fchipOn: { backgroundColor: C.primary, borderColor: C.primary },
  fchipText: { color: C.text, fontSize: 13, fontWeight: '600' },
  fchipTextOn: { color: '#fff' },
  sheetBar: { flexDirection: 'row', gap: 10, paddingTop: 12, paddingBottom: 4, borderTopWidth: 1, borderTopColor: C.line, marginTop: 10 },
  clearBtn: { paddingHorizontal: 18, height: 50, borderRadius: R.md, borderWidth: 1.5, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  clearText: { color: C.text, fontWeight: '700', fontSize: 14.5 },
  applyBtn: { flex: 1, height: 50, borderRadius: R.md, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  applyText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
