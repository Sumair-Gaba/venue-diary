// Horizontal, swipeable image carousel for the venue detail screen. Shows dots
// and a count; a clean "No photo" placeholder when the venue has no images
// (never a dummy/stock image).
import { useState } from 'react';
import { Dimensions, FlatList, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../theme';

const { width } = Dimensions.get('window');

export default function Carousel({ photos = [], height = 320 }) {
  const [i, setI] = useState(0);

  if (!photos.length) {
    return (
      <View style={[styles.noimg, { height }]}>
        <Ionicons name="image-outline" size={40} color={C.muted} />
        <Text style={styles.noimgText}>NO PHOTO</Text>
      </View>
    );
  }
  return (
    <View style={{ height }}>
      <FlatList
        data={photos}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(_, k) => String(k)}
        onMomentumScrollEnd={(e) => setI(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => (
          <Image source={{ uri: item }} style={{ width, height }} contentFit="cover" transition={150} />
        )}
      />
      {photos.length > 1 && (
        <>
          <View style={styles.count}><Text style={styles.countText}>{i + 1}/{photos.length}</Text></View>
          <View style={styles.dots}>
            {photos.map((_, k) => <View key={k} style={[styles.dot, k === i && styles.dotOn]} />)}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  noimg: { alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.paper },
  noimgText: { color: C.muted, fontWeight: '700', fontSize: 12, letterSpacing: 1 },
  count: { position: 'absolute', top: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10 },
  countText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  dots: { position: 'absolute', bottom: 12, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotOn: { width: 16, backgroundColor: '#fff' },
});
