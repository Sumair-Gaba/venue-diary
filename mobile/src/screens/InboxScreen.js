// Messages inbox — all the consumer's chat threads with venues, newest first.
// Unread threads are highlighted. Tapping one opens the chat.
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { getDeviceId } from '../store';
import { C, R } from '../theme';

export default function InboxScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();

  useFocusEffect(useCallback(() => {
    let on = true;
    (async () => {
      try {
        const device = await getDeviceId();
        const list = await api.conversations(device);
        if (on && Array.isArray(list)) setItems(list);
      } catch {} finally { if (on) setLoading(false); }
    })();
    return () => { on = false; };
  }, []));

  return (
    <View style={[styles.fill, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.h1}>Messages</Text>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="chatbubbles-outline" size={54} color={C.line} />
          <Text style={styles.emptyText}>No messages yet</Text>
          <Text style={styles.emptySub}>Open any venue and tap “Message” to chat with them here.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => String(it.id)}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: insets.bottom + 20 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('Chat', { conversationId: item.id, venueName: item.venue_name, slug: item.slug })}
            >
              {item.photo
                ? <Image source={{ uri: item.photo }} style={styles.avatar} contentFit="cover" />
                : <View style={[styles.avatar, styles.noimg]}><Ionicons name="business" size={20} color={C.muted} /></View>}
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{item.venue_name}</Text>
                <Text style={[styles.last, item.unread > 0 && styles.lastUnread]} numberOfLines={1}>
                  {item.last_sender === 'consumer' ? 'You: ' : ''}{item.last_message || 'Start chatting'}
                </Text>
              </View>
              {item.unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{item.unread}</Text></View>}
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  h1: { fontSize: 26, fontWeight: '800', color: C.text, letterSpacing: -0.4, paddingHorizontal: 16, marginBottom: 6 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 30 },
  emptyText: { color: C.text, fontSize: 17, fontWeight: '700', marginTop: 6 },
  emptySub: { color: C.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: R.md, padding: 12, borderWidth: 1, borderColor: C.line },
  avatar: { width: 52, height: 52, borderRadius: 12, backgroundColor: C.paper },
  noimg: { alignItems: 'center', justifyContent: 'center' },
  name: { color: C.text, fontWeight: '700', fontSize: 15 },
  last: { color: C.muted, fontSize: 13.5, marginTop: 3 },
  lastUnread: { color: C.text, fontWeight: '700' },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
