// In-app chat thread with a venue. Keeps the conversation ON the platform
// (no WhatsApp). Loads the thread, sends messages, and polls every few seconds
// so the owner's replies appear without a manual refresh. Opened either with an
// existing { conversationId } or just a { slug } (a new thread, created on the
// first message).
import { useEffect, useRef, useState, useCallback } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { getDeviceId } from '../store';
import { C, R } from '../theme';

export default function ChatScreen({ route, navigation }) {
  const { slug, venueName, conversationId: initialConvId } = route.params || {};
  const [convId, setConvId] = useState(initialConvId || null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const insets = useSafeAreaInsets();
  const deviceRef = useRef(null);
  const pollRef = useRef(null);

  const load = useCallback(async (cid) => {
    const id = cid || convId;
    if (!id) { setLoading(false); return; }
    try {
      const device = deviceRef.current || (deviceRef.current = await getDeviceId());
      const r = await api.messages(device, id);
      if (Array.isArray(r?.messages)) setMessages(r.messages);
    } catch {} finally { setLoading(false); }
  }, [convId]);

  // First load: if we have no conversationId but have a slug, try to find an
  // existing thread for this venue so history shows up.
  useEffect(() => {
    let on = true;
    (async () => {
      const device = deviceRef.current || (deviceRef.current = await getDeviceId());
      let cid = initialConvId;
      if (!cid && slug) {
        try {
          const list = await api.conversations(device);
          const match = Array.isArray(list) ? list.find((c) => c.slug === slug) : null;
          if (match) cid = match.id;
        } catch {}
      }
      if (!on) return;
      if (cid) { setConvId(cid); await load(cid); } else setLoading(false);
    })();
    return () => { on = false; };
  }, [slug, initialConvId, load]);

  // Poll for new messages while the screen is open.
  useEffect(() => {
    if (!convId) return;
    pollRef.current = setInterval(() => load(convId), 5000);
    return () => clearInterval(pollRef.current);
  }, [convId, load]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setText('');
    // optimistic: show the message immediately
    const temp = { id: 'tmp' + Date.now(), sender: 'consumer', body, created_at: new Date().toISOString() };
    setMessages((m) => [...m, temp]);
    try {
      const device = deviceRef.current || (deviceRef.current = await getDeviceId());
      const r = await api.sendMessage(device, convId ? { conversation_id: convId, body } : { slug, body });
      if (r?.conversation_id) { setConvId(r.conversation_id); await load(r.conversation_id); }
    } catch {} finally { setSending(false); }
  };

  return (
    <View style={styles.fill}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}><Ionicons name="arrow-back" size={24} color="#fff" /></TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{venueName || 'Chat'}</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={C.primary} /></View>
        ) : (
          <FlatList
            data={messages}
            keyExtractor={(it) => String(it.id)}
            contentContainerStyle={{ padding: 14, gap: 8, flexGrow: 1 }}
            ListEmptyComponent={(
              <View style={styles.empty}>
                <Ionicons name="chatbubbles-outline" size={46} color={C.line} />
                <Text style={styles.emptyText}>Start the conversation</Text>
                <Text style={styles.emptySub}>Ask about availability, pricing, or a visit. The venue replies right here.</Text>
              </View>
            )}
            renderItem={({ item }) => {
              const mine = item.sender === 'consumer';
              return (
                <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
                  <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                    <Text style={[styles.msgText, mine && { color: '#fff' }]}>{item.body}</Text>
                  </View>
                </View>
              );
            }}
          />
        )}

        <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
          <TextInput
            style={styles.input}
            placeholder="Type a message…"
            placeholderTextColor={C.muted}
            value={text}
            onChangeText={setText}
            multiline
          />
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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 30 },
  emptyText: { color: C.text, fontSize: 16, fontWeight: '700', marginTop: 6 },
  emptySub: { color: C.muted, fontSize: 13.5, textAlign: 'center', lineHeight: 19 },
  bubbleRow: { flexDirection: 'row' },
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
