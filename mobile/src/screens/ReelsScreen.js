// Full-screen vertical "reels" feed of venues. Each reel plays a photo
// auto-reel (Ken-Burns) with a gradient overlay, venue info and quick actions
// (WhatsApp enquiry, details). Swipe up for the next venue.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import KenBurns from '../components/KenBurns';
import { api, waLink, BASE_URL } from '../api';
import { C } from '../theme';

export default function ReelsScreen({ navigation }) {
  const [reels, setReels] = useState([]);
  const [page, setPage] = useState(1);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [h, setH] = useState(0);
  const insets = useSafeAreaInsets();
  const more = useRef(true);

  const load = useCallback(async (p) => {
    try {
      const r = await api.reels({ page: p });
      more.current = (r.items || []).length > 0;
      setReels((cur) => (p === 1 ? r.items : [...cur, ...r.items]));
    } catch (e) { /* offline — keep what we have */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(1); }, [load]);

  const onViewable = useRef(({ viewableItems }) => {
    if (viewableItems.length) setActive(viewableItems[0].index || 0);
  }).current;

  const siteUrl = BASE_URL.replace(/\/api$/, '');
  const enquire = (v) => {
    const text = `Hello ${v.name}, I saw your venue on Venue Diary. Is it available? Please share details.`;
    Linking.openURL(v.phone ? waLink(v.phone, text) : `${siteUrl}/${v.slug}`);
  };
  const goVenue = (v) => navigation.navigate('Venue', { slug: v.slug, name: v.name });

  if (loading) return <View style={styles.center}><ActivityIndicator color={C.gold} size="large" /></View>;

  return (
    <View style={styles.fill} onLayout={(e) => setH(e.nativeEvent.layout.height)}>
      {h > 0 && (
        <FlatList
          data={reels}
          keyExtractor={(it) => String(it.id)}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          snapToInterval={h}
          decelerationRate="fast"
          getItemLayout={(_, i) => ({ length: h, offset: h * i, index: i })}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
          onEndReached={() => { if (more.current) { const np = page + 1; setPage(np); load(np); } }}
          onEndReachedThreshold={1.5}
          renderItem={({ item, index }) => (
            <View style={{ height: h, backgroundColor: C.dark }}>
              <KenBurns photos={item.photos} active={index === active} />
              <LinearGradient colors={['rgba(0,0,0,0.35)', 'transparent', 'transparent', 'rgba(0,0,0,0.9)']} style={StyleSheet.absoluteFill} />

              <View style={[styles.brand, { top: insets.top + 6 }]}>
                <Text style={styles.brandText}>Venue<Text style={{ color: C.gold }}>Diary</Text></Text>
                <Text style={styles.brandSub}>Karachi banquets</Text>
              </View>

              <View style={[styles.side, { bottom: insets.bottom + 150 }]}>
                <Action icon="logo-whatsapp" label="Enquire" onPress={() => enquire(item)} />
                <Action icon="information-circle" label="Details" onPress={() => goVenue(item)} />
                <Action icon="share-social" label="Share" onPress={() => Linking.openURL(`${siteUrl}/${item.slug}`)} />
              </View>

              <View style={[styles.info, { paddingBottom: insets.bottom + 96 }]}>
                <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
                {!!item.area && (
                  <View style={styles.row}>
                    <Ionicons name="location-sharp" size={14} color={C.gold} />
                    <Text style={styles.area} numberOfLines={1}>{item.area}, Karachi</Text>
                  </View>
                )}
                <TouchableOpacity style={styles.view} onPress={() => goVenue(item)} activeOpacity={0.85}>
                  <Text style={styles.viewText}>View venue</Text>
                  <Ionicons name="arrow-forward" size={15} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

function Action({ icon, label, onPress }) {
  return (
    <TouchableOpacity style={styles.action} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.actionBtn}><Ionicons name={icon} size={26} color="#fff" /></View>
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.dark },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.dark },
  brand: { position: 'absolute', left: 16 },
  brandText: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  brandSub: { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 1 },
  side: { position: 'absolute', right: 12, alignItems: 'center', gap: 20 },
  action: { alignItems: 'center', gap: 5 },
  actionBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  actionLabel: { color: '#fff', fontSize: 11, fontWeight: '600' },
  info: { position: 'absolute', left: 16, right: 86 },
  name: { color: '#fff', fontSize: 23, fontWeight: '800', letterSpacing: -0.3, lineHeight: 28 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
  area: { color: 'rgba(255,255,255,0.88)', fontSize: 14, flexShrink: 1 },
  view: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 14, backgroundColor: C.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
  viewText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
