// Saved venues — the visitor's favourites (stored locally, tap the heart on any
// venue). A friendly empty state nudges them to explore.
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getFavs } from '../store';
import { C, R } from '../theme';

export default function SavedScreen({ navigation }) {
  const [favs, setFavs] = useState([]);
  const insets = useSafeAreaInsets();
  useFocusEffect(useCallback(() => { let on = true; getFavs().then((f) => on && setFavs(f)); return () => { on = false; }; }, []));

  return (
    <View style={[styles.fill, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.h1}>Saved venues</Text>
      <Text style={styles.sub}>{favs.length ? `${favs.length} saved` : 'Your favourites appear here'}</Text>
      {favs.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="heart-outline" size={54} color={C.line} />
          <Text style={styles.emptyText}>No saved venues yet</Text>
          <Text style={styles.emptySub}>Tap the heart on any venue to save it for later.</Text>
          <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate('HomeTab')} activeOpacity={0.85}>
            <Text style={styles.btnText}>Explore venues</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={favs}
          keyExtractor={(it) => it.slug}
          numColumns={2}
          columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
          contentContainerStyle={{ gap: 12, paddingTop: 14, paddingBottom: insets.bottom + 80 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={() => navigation.navigate('Venue', { slug: item.slug, name: item.name })}>
              {item.photo
                ? <Image source={{ uri: item.photo }} style={styles.img} contentFit="cover" transition={150} />
                : <View style={[styles.img, styles.noimg]}><Ionicons name="image-outline" size={24} color={C.muted} /></View>}
              <View style={{ padding: 10 }}>
                <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
                {!!item.area && <Text style={styles.area} numberOfLines={1}>{item.area}</Text>}
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  h1: { fontSize: 26, fontWeight: '800', color: C.text, letterSpacing: -0.4, paddingHorizontal: 16 },
  sub: { color: C.muted, marginTop: 2, fontSize: 13.5, paddingHorizontal: 16 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 30 },
  emptyText: { color: C.text, fontSize: 17, fontWeight: '700', marginTop: 6 },
  emptySub: { color: C.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  btn: { backgroundColor: C.primary, paddingHorizontal: 22, height: 46, borderRadius: 999, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14.5 },
  card: { flex: 1, backgroundColor: C.card, borderRadius: R.md, overflow: 'hidden', borderWidth: 1, borderColor: C.line },
  img: { width: '100%', height: 130, backgroundColor: C.paper },
  noimg: { alignItems: 'center', justifyContent: 'center' },
  name: { color: C.text, fontWeight: '700', fontSize: 13.5, lineHeight: 18 },
  area: { color: C.muted, fontSize: 12, marginTop: 3 },
});
