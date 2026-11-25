// Saved venues — the visitor's favourites (stored locally, tap the heart on any
// venue). From here they can shortlist and send ONE enquiry to several venues
// at once (POST /api/public/enquiries/bulk — a lead is created per venue).
import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Alert, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getFavs, getUser } from '../store';
import { api } from '../api';
import { C, R } from '../theme';

export default function SavedScreen({ navigation }) {
  const [favs, setFavs] = useState([]);
  const [sel, setSel] = useState(() => new Set());   // selected slugs for bulk enquiry
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', date: '', guests: '', message: '' });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);         // { sent, failed }
  const insets = useSafeAreaInsets();

  useFocusEffect(useCallback(() => {
    let on = true;
    getFavs().then((f) => { if (!on) return; setFavs(f); setSel(new Set(f.map((x) => x.slug))); });
    return () => { on = false; };
  }, []));
  useEffect(() => { getUser().then((u) => setForm((f) => ({ ...f, name: u?.name && u.name !== 'Guest' ? u.name : '' }))); }, []);

  const toggle = (slug) => setSel((s) => { const n = new Set(s); n.has(slug) ? n.delete(slug) : n.add(slug); return n; });
  const selected = favs.filter((f) => sel.has(f.slug));

  const openForm = () => { setResult(null); setShowForm(true); };
  const send = async () => {
    if (!form.name.trim()) return Alert.alert('Please enter your name');
    const slugs = selected.map((f) => f.slug);
    if (!slugs.length) return Alert.alert('Select at least one venue');
    setSending(true);
    try {
      const r = await api.enquireBulk(slugs, {
        name: form.name.trim(), phone: form.phone.trim() || null,
        event_date: form.date.trim() || null, guests: Number(form.guests) || null,
        message: form.message.trim() || null,
      });
      if (r && r.ok) setResult({ sent: r.sent, failed: (r.failed || []).length });
      else Alert.alert('Could not send', r?.message || 'Please try again.');
    } catch { Alert.alert('Network error', 'Please try again.'); }
    finally { setSending(false); }
  };

  return (
    <View style={[styles.fill, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.h1}>Saved venues</Text>
      <Text style={styles.sub}>{favs.length ? `${favs.length} saved · tap to select, then enquire to all` : 'Your favourites appear here'}</Text>
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
          contentContainerStyle={{ gap: 12, paddingTop: 14, paddingBottom: insets.bottom + 100 }}
          renderItem={({ item }) => {
            const on = sel.has(item.slug);
            return (
              <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={() => navigation.navigate('Venue', { slug: item.slug, name: item.name })}>
                {item.photo
                  ? <Image source={{ uri: item.photo }} style={styles.img} contentFit="cover" transition={150} />
                  : <View style={[styles.img, styles.noimg]}><Ionicons name="image-outline" size={24} color={C.muted} /></View>}
                <TouchableOpacity style={styles.check} onPress={() => toggle(item.slug)} hitSlop={8} activeOpacity={0.8}>
                  <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={on ? C.primary : '#fff'} />
                </TouchableOpacity>
                <View style={{ padding: 10 }}>
                  <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
                  {!!item.area && <Text style={styles.area} numberOfLines={1}>{item.area}</Text>}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {favs.length > 0 && (
        <View style={[styles.bar, { paddingBottom: insets.bottom + 10 }]}>
          <TouchableOpacity style={[styles.sendAll, !selected.length && styles.sendAllOff]} onPress={openForm} disabled={!selected.length} activeOpacity={0.85}>
            <Ionicons name="paper-plane" size={18} color="#fff" />
            <Text style={styles.sendAllText}>Send enquiry to {selected.length} venue{selected.length === 1 ? '' : 's'}</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal visible={showForm} animationType="slide" transparent onRequestClose={() => setShowForm(false)}>
        <View style={styles.sheetWrap}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{result ? 'Enquiry sent' : `Enquire to ${selected.length} venue${selected.length === 1 ? '' : 's'}`}</Text>
              <TouchableOpacity onPress={() => setShowForm(false)} hitSlop={8}><Ionicons name="close" size={24} color={C.muted} /></TouchableOpacity>
            </View>
            {result ? (
              <View style={styles.ok}>
                <Ionicons name="checkmark-circle" size={22} color={C.wa} />
                <Text style={styles.okText}>
                  Sent to {result.sent} venue{result.sent === 1 ? '' : 's'}{result.failed ? ` (${result.failed} failed)` : ''}. They'll contact you soon.
                </Text>
              </View>
            ) : (
              <>
                <Text style={styles.sheetSub}>One message goes to every selected venue. Each replies to you directly.</Text>
                <TextInput style={styles.input} placeholder="Your name *" placeholderTextColor={C.muted} value={form.name} onChangeText={(t) => setForm({ ...form, name: t })} />
                <TextInput style={styles.input} placeholder="Phone (+92 3XX XXXXXXX)" placeholderTextColor={C.muted} keyboardType="phone-pad" value={form.phone} onChangeText={(t) => setForm({ ...form, phone: t })} />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TextInput style={[styles.input, { flex: 1 }]} placeholder="Date (2026-12-15)" placeholderTextColor={C.muted} value={form.date} onChangeText={(t) => setForm({ ...form, date: t })} />
                  <TextInput style={[styles.input, { flex: 1 }]} placeholder="Guests" placeholderTextColor={C.muted} keyboardType="number-pad" value={form.guests} onChangeText={(t) => setForm({ ...form, guests: t })} />
                </View>
                <TextInput style={[styles.input, { height: 80, textAlignVertical: 'top', paddingTop: 12 }]} placeholder="Message (optional)" placeholderTextColor={C.muted} multiline value={form.message} onChangeText={(t) => setForm({ ...form, message: t })} />
                <TouchableOpacity style={styles.submit} onPress={send} disabled={sending} activeOpacity={0.85}>
                  {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Send to {selected.length} venue{selected.length === 1 ? '' : 's'}</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
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
  check: { position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  name: { color: C.text, fontWeight: '700', fontSize: 13.5, lineHeight: 18 },
  area: { color: C.muted, fontSize: 12, marginTop: 3 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.line },
  sendAll: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, height: 50, borderRadius: R.md },
  sendAllOff: { backgroundColor: C.muted },
  sendAllText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: C.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, gap: 10 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: C.text },
  sheetSub: { color: C.muted, fontSize: 13, lineHeight: 18, marginBottom: 4 },
  input: { backgroundColor: C.paper, borderRadius: R.sm, borderWidth: 1, borderColor: C.line, paddingHorizontal: 12, height: 46, color: C.text, fontSize: 15 },
  submit: { backgroundColor: C.primary, height: 50, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  submitText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  ok: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#EAF8EF', borderRadius: R.md, padding: 16 },
  okText: { color: '#1C6B3A', flex: 1, fontSize: 14.5, fontWeight: '600', lineHeight: 20 },
});
