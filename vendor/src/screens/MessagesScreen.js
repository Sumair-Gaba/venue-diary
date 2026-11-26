// Vendor inbox: all customer chat threads for this venue, unread first-ish.
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { C, R } from '../theme';

export default function MessagesScreen({ navigation, onLogout }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    try { const r = await api.conversations(); setItems(Array.isArray(r.data) ? r.data : []); }
    catch (e) { if (e.unauthorized) onLogout?.(); }
    finally { setLoading(false); }
  }, [onLogout]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[styles.fill, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.h1}>Messages</Text>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
      ) : items.length === 0 ? (
        <View style={styles.empty}><Ionicons name="chatbubbles-outline" size={50} color={C.line} /><Text style={styles.emptyText}>No messages yet</Text><Text style={styles.emptySub}>Customer chats from the app appear here.</Text></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => String(it.id)}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: insets.bottom + 20 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} activeOpacity={0.85} onPress={() => navigation.navigate('Chat', { conversationId: item.id, title: item.consumer_name || 'Customer' })}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{(item.consumer_name || 'C').trim().charAt(0).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{item.consumer_name || 'Customer'}</Text>
                <Text style={[styles.last, item.unread > 0 && styles.lastUnread]} numberOfLines={1}>
                  {item.last_sender === 'owner' ? 'You: ' : ''}{item.last_message || 'New conversation'}
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
  emptyText: { color: C.text, fontSize: 16, fontWeight: '700' },
  emptySub: { color: C.muted, fontSize: 13.5, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: R.md, padding: 12, borderWidth: 1, borderColor: C.line },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: C.primary, fontWeight: '800', fontSize: 18 },
  name: { color: C.text, fontWeight: '700', fontSize: 15 },
  last: { color: C.muted, fontSize: 13.5, marginTop: 3 },
  lastUnread: { color: C.text, fontWeight: '700' },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
