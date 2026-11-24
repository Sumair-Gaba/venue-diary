// Photo "auto-reel": a slow Ken-Burns zoom over a venue's photos, cross-fading
// between them. This is the day-one stand-in for real video reels — it uses the
// venue's real photos (never a dummy). When real videos are uploaded later, a
// <Video> can replace this component per reel.
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

export default function KenBurns({ photos = [], active = true }) {
  const list = photos.length ? photos : [null];
  const [idx, setIdx] = useState(0);
  const zoom = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;

  // Continuous slow zoom while this reel is the active (visible) one.
  useEffect(() => {
    if (!active) return undefined;
    zoom.setValue(0);
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(zoom, { toValue: 1, duration: 7000, useNativeDriver: true }),
      Animated.timing(zoom, { toValue: 0, duration: 7000, useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, [active]);

  // Cross-fade through the photos when a venue has more than one.
  useEffect(() => {
    if (!active || list.length < 2) return undefined;
    const t = setInterval(() => {
      Animated.timing(fade, { toValue: 0, duration: 450, useNativeDriver: true }).start(() => {
        setIdx((i) => (i + 1) % list.length);
        Animated.timing(fade, { toValue: 1, duration: 450, useNativeDriver: true }).start();
      });
    }, 3800);
    return () => clearInterval(t);
  }, [active, list.length]);

  const scale = zoom.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] });
  const src = list[idx];

  return (
    <View style={styles.wrap}>
      <Animated.View style={{ flex: 1, opacity: fade, transform: [{ scale }] }}>
        {src
          ? <Image source={{ uri: src }} style={styles.img} contentFit="cover" transition={150} />
          : <View style={[styles.img, styles.noimg]} />}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', overflow: 'hidden' },
  img: { width: '100%', height: '100%' },
  noimg: { width: '100%', height: '100%', backgroundColor: '#17141c' },
});
