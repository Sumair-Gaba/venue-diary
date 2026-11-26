// Vendor chat thread: reply to a customer. Owner messages are 'owner' (mine).
// Polls every 5s so new customer messages appear live.
import { useEffect, useRef, useState, useCallback } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { C } from '../theme';

export default function ChatScreen({ route, navigation }) {
  const { conversationId, title } = route.params || {};
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const insets = useSafeAreaInsets();
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try { const r = await api.messages(conversationId); if (Array.isArray(r.data?.messages)) setMessages(r.data.messages); }
    catch {} finally { setLoading(false); }
  }, [conversationId]);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 5000);
    return () => clearInterval(pollRef.current);
  }, [load]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true); setText('');
    setMessages((m) => [...m, { id: 'tmp' + Date.now(), sender: 'owner', body, created_at: new Date().toISOString() }]);
    try { await api.sendMessage(conversationId, body); await load(); } catch {} finally { setSending(false); }
  };

  return (
    <View style={styles.fill}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}><Ionicons name="arrow-back" size={24} color="#fff" /></TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{title || 'Customer'}</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
        ) : (
          <FlatList
            data={messages}
            keyExtractor={(it) => String(it.id)}
            contentContainerStyle={{ padding: 14, gap: 8, flexGrow: 1 }}
            ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>No messages yet.</Text></View>}
            renderItem={({ item }) => {
              const mine = item.sender === 'owner';
              return (
                <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
                  <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                    <Text style={[styles.msgText, mine && { color: '#fff' }]}>{item.body}</Text>
                  </View>
                </View>
              );
            }}
          />
        )}
        <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
          <TextInput style={styles.input} placeholder="Type a reply…" placeholderTextColor={C.muted} value={text} onChangeText={setText} multiline />
          <TouchableOpacity style={[styles.sendBtn, (!text.trim() || sending) && styles.sendOff]} onPress={send} disabled={!text.trim() || sending} activeOpacity={0.85}>
            {sending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={19} color="#fff" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: C.primary, paddingHorizontal: 14, paddingBottom: 12 },
  headerTitle: { flex: 1, color: '#fff', fontSize: 17, fontWeight: '800', textAlign: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyText: { color: C.muted, fontSize: 14 },
  row: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 13, paddingVertical: 9 },
  mine: { backgroundColor: C.primary, borderBottomRightRadius: 4 },
  theirs: { backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, borderBottomLeftRadius: 4 },
  msgText: { fontSize: 15, color: C.text, lineHeight: 20 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.bg },
  input: { flex: 1, maxHeight: 120, minHeight: 44, backgroundColor: C.paper, borderRadius: 22, borderWidth: 1, borderColor: C.line, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, color: C.text, fontSize: 15 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  sendOff: { backgroundColor: C.muted },
});
