// Home: a proper discovery landing — greeting, a big "Hall Finder" search, quick
// categories, a Venue Reels carousel (tap → full-screen reels), popular venues,
// and browse-by-area. This is the app's entry surface (reels are a section here,
// not the whole screen).
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ReelCard from '../components/ReelCard';
import { api } from '../api';
import { getUser } from '../store';
import { C, R } from '../theme';

const CATS = [
  { label: 'Wedding Halls', q: 'hall', icon: 'business' },
  { label: 'Marquees', q: 'marquee', icon: 'bonfire' },
  { label: 'Lawns', q: 'lawn', icon: 'leaf' },
  { label: 'Banquets', q: 'banquet', icon: 'wine' },
  { label: 'Ballrooms', q: 'ballroom', icon: 'sparkles' },
];

export default function HomeScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [reels, setReels] = useState([]);
  const [popular, setPopular] = useState([]);
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();

  useFocusEffect(useCallback(() => {
    let on = true;
    (async () => {
      const u = await getUser(); if (on) setUser(u);
      try {
        const [r, v, a] = await Promise.all([api.reels({ limit: 12 }), api.venues({ page: 1, limit: 10 }), api.areas()]);
        if (!on) return;
        setReels(r.items || []);
        setPopular(v.items || []);
        setAreas((a || []).slice(0, 12));
      } catch {} finally { if (on) setLoading(false); }
    })();
    return () => { on = false; };
  }, []));

  const openReels = (index) => navigation.navigate('Reels', { items: reels, index });
  const openExplore = (params) => navigation.navigate('ExploreTab', params);
  const openVenue = (v) => navigation.navigate('Venue', { slug: v.slug, name: v.name });

  if (loading) return <View style={styles.center}><ActivityIndicator color={C.primary} size="large" /></View>;

  return (
    <ScrollView style={styles.fill} contentContainerStyle={{ paddingBottom: insets.bottom + 90 }} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <LinearGradient colors={[C.primary, C.primaryDark]} style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headRow}>
          <View>
            <Text style={styles.hello}>Hello, {user?.name || 'Guest'} 👋</Text>
            <View style={styles.locRow}>
              <Ionicons name="location-sharp" size={13} color={C.gold} />
              <Text style={styles.loc}>{user?.city || 'Karachi'}, Pakistan</Text>
            </View>
          </View>
          <View style={styles.avatar}><Text style={styles.avatarText}>{(user?.name || 'G').trim().charAt(0).toUpperCase()}</Text></View>
        </View>
        <Text style={styles.tagline}>Find your perfect venue ✨</Text>
        <TouchableOpacity style={styles.search} activeOpacity={0.9} onPress={() => openExplore({ focus: true })}>
          <Ionicons name="search" size={19} color={C.muted} />
          <Text style={styles.searchText}>Search banquets, marquees, lawns…</Text>
        </TouchableOpacity>
      </LinearGradient>

      {/* Categories */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cats}>
        {CATS.map((c) => (
          <TouchableOpacity key={c.q} style={styles.cat} activeOpacity={0.8} onPress={() => openExplore({ q: c.q })}>
            <View style={styles.catIcon}><Ionicons name={c.icon} size={22} color={C.primary} /></View>
            <Text style={styles.catText}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Venue Reels */}
      {reels.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>✨ Venue Reels</Text>
            <TouchableOpacity onPress={() => openReels(0)}><Text style={styles.seeAll}>Watch all</Text></TouchableOpacity>
          </View>
          <FlatList
            data={reels}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(it) => 'r' + it.id}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
            renderItem={({ item, index }) => <ReelCard venue={item} onPress={() => openReels(index)} />}
          />
        </View>
      )}

      {/* Popular */}
      {popular.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>📍 Popular in Karachi</Text>
            <TouchableOpacity onPress={() => openExplore({})}><Text style={styles.seeAll}>See all</Text></TouchableOpacity>
          </View>
          <FlatList
            data={popular}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(it) => 'p' + it.id}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.pcard} activeOpacity={0.85} onPress={() => openVenue(item)}>
                {item.photos?.[0]
                  ? <Image source={{ uri: item.photos[0] }} style={styles.pimg} contentFit="cover" transition={150} />
                  : <View style={[styles.pimg, styles.noimg]}><Ionicons name="image-outline" size={24} color={C.muted} /></View>}
                <View style={{ padding: 10 }}>
                  <Text style={styles.pname} numberOfLines={1}>{item.name}</Text>
                  {!!item.area && <Text style={styles.parea} numberOfLines={1}>{item.area}</Text>}
                </View>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* Browse by area */}
      {areas.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { paddingHorizontal: 16 }]}>Browse by area</Text>
          <View style={styles.areaWrap}>
            {areas.map((a) => (
              <TouchableOpacity key={a.area} style={styles.areaChip} activeOpacity={0.8} onPress={() => openExplore({ area: a.area })}>
                <Text style={styles.areaText} numberOfLines={1}>{a.area}</Text>
                <Text style={styles.areaCount}>{a.count}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  header: { paddingHorizontal: 16, paddingBottom: 20, borderBottomLeftRadius: 26, borderBottomRightRadius: 26 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hello: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  loc: { color: 'rgba(255,255,255,0.85)', fontSize: 12.5 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 18 },
  tagline: { color: '#fff', fontSize: 15, fontWeight: '600', marginTop: 18, opacity: 0.95 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 14, height: 50, paddingHorizontal: 16, marginTop: 10 },
  searchText: { color: C.muted, fontSize: 14.5 },
  cats: { paddingHorizontal: 16, paddingVertical: 18, gap: 16 },
  cat: { alignItems: 'center', gap: 7, width: 72 },
  catIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line },
  catText: { fontSize: 11.5, color: C.text, fontWeight: '600', textAlign: 'center' },
  section: { marginTop: 10, marginBottom: 6 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  seeAll: { color: C.primary, fontWeight: '700', fontSize: 13 },
  pcard: { width: 180, backgroundColor: C.card, borderRadius: R.md, overflow: 'hidden', borderWidth: 1, borderColor: C.line },
  pimg: { width: '100%', height: 120, backgroundColor: C.paper },
  noimg: { alignItems: 'center', justifyContent: 'center' },
  pname: { color: C.text, fontWeight: '700', fontSize: 13.5 },
  parea: { color: C.muted, fontSize: 12, marginTop: 2 },
  areaWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginTop: 12 },
  areaChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.paper, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 13, borderWidth: 1, borderColor: C.line, maxWidth: 200 },
  areaText: { color: C.text, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  areaCount: { color: C.primary, fontSize: 12, fontWeight: '700' },
});
