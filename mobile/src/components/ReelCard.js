// A tall 9:16 reel thumbnail for the home "Venue Reels" carousel. Tapping it
// opens the full-screen reel viewer at this venue.
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../theme';

export default function ReelCard({ venue, onPress, width = 140 }) {
  const photo = venue.photos && venue.photos[0];
  return (
    <TouchableOpacity style={[styles.card, { width, height: width * 1.6 }]} activeOpacity={0.85} onPress={onPress}>
      {photo
        ? <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
        : <View style={[StyleSheet.absoluteFill, styles.noimg]}><Ionicons name="image-outline" size={26} color="rgba(255,255,255,0.6)" /></View>}
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={StyleSheet.absoluteFill} />
      <View style={styles.play}><Ionicons name="play" size={16} color="#fff" /></View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={2}>{venue.name}</Text>
        {!!venue.area && <Text style={styles.area} numberOfLines={1}>{venue.area}</Text>}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, overflow: 'hidden', backgroundColor: '#17141c' },
  noimg: { alignItems: 'center', justifyContent: 'center' },
  play: { position: 'absolute', top: 10, right: 10, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  body: { position: 'absolute', left: 10, right: 10, bottom: 10 },
  name: { color: '#fff', fontWeight: '700', fontSize: 13, lineHeight: 16 },
  area: { color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 2 },
});
