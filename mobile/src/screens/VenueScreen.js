// Venue detail: image carousel, location, pricing table, and enquiry (WhatsApp
// one-tap + an in-app enquiry form posting to /api/public/enquiry).
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Carousel from '../components/Carousel';
import { api, waLink } from '../api';
import { isFav, toggleFav, getUser } from '../store';
import { C, R } from '../theme';

const fmt = (n) => 'Rs ' + Number(n || 0).toLocaleString('en-IN');

// A row of stars; pass onPress to make it an input.
function Stars({ value = 0, size = 16, onPress }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const ic = <Ionicons key={n} name={n <= value ? 'star' : 'star-outline'} size={size} color={C.gold} />;
        return onPress ? <TouchableOpacity key={n} onPress={() => onPress(n)} hitSlop={6}>{ic}</TouchableOpacity> : ic;
      })}
    </View>
  );
}

export default function VenueScreen({ route, navigation }) {
  const { slug, name } = route.params;
  const [v, setV] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', phone: '', date: '' });
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [fav, setFav] = useState(false);
  const [rev, setRev] = useState({ show: false, rating: 0, comment: '', name: '', sending: false, sent: false });
  const insets = useSafeAreaInsets();

  useEffect(() => { api.venue(slug).then(setV).catch(() => {}).finally(() => setLoading(false)); }, [slug]);
  useEffect(() => { isFav(slug).then(setFav); }, [slug]);
  useEffect(() => { getUser().then((u) => setRev((r) => ({ ...r, name: u?.name && u.name !== 'Guest' ? u.name : '' }))); }, []);
  const onFav = async () => { if (!v) return; const favs = await toggleFav({ ...v, slug }); setFav(favs.some((x) => x.slug === slug)); };

  const submitReview = async () => {
    if (!rev.name.trim()) return Alert.alert('Please enter your name');
    if (!rev.rating) return Alert.alert('Please choose a rating');
    setRev((r) => ({ ...r, sending: true }));
    try {
      const res = await api.review(slug, { name: rev.name.trim(), rating: rev.rating, comment: rev.comment.trim() || null });
      if (res && (res.ok || res.id)) {
        const fresh = await api.venue(slug); setV(fresh);
        setRev((r) => ({ ...r, show: false, sent: true, rating: 0, comment: '', sending: false }));
      } else { Alert.alert('Could not post', res?.message || 'Please try again.'); setRev((r) => ({ ...r, sending: false })); }
    } catch { Alert.alert('Network error'); setRev((r) => ({ ...r, sending: false })); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={C.primary} size="large" /></View>;
  if (!v || v.error) return <View style={styles.center}><Text style={{ color: C.muted }}>Venue not found.</Text></View>;

  const photos = (v.media || []).filter((m) => m.kind !== 'video').map((m) => m.url);
  const loc = [v.city, v.area].filter(Boolean).join(', ');
  const priceOf = (h, s) => (v.hall_prices || []).find((p) => p.hall_id === h && p.slot_id === s)?.price || 0;
  const hasPrices = (v.hall_prices || []).some((p) => p.price > 0);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([v.name, v.area, 'Karachi'].filter(Boolean).join(' '))}`;

  const waText = `Hello ${v.name}, I saw your venue on Venue Diary. Is it available? Please share details.`;

  const submit = async () => {
    if (!form.name.trim()) return Alert.alert('Please enter your name');
    setSending(true);
    try {
      const r = await api.enquire(slug, { name: form.name.trim(), phone: form.phone.trim() || null, event_date: form.date || null });
      if (r && (r.ok || r.id)) setSent(true);
      else Alert.alert('Could not send', 'Please try again.');
    } catch { Alert.alert('Network error', 'Please try again.'); }
    finally { setSending(false); }
  };

  return (
    <View style={styles.fill}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 100 }} showsVerticalScrollIndicator={false}>
        <View>
          <Carousel photos={photos} height={320} />
          <TouchableOpacity style={[styles.back, { top: insets.top + 8 }]} onPress={() => navigation.goBack()} activeOpacity={0.85}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.heart, { top: insets.top + 8 }]} onPress={onFav} activeOpacity={0.85}>
            <Ionicons name={fav ? 'heart' : 'heart-outline'} size={22} color={fav ? '#FF5A7A' : '#fff'} />
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          <Text style={styles.name}>{v.name || name}</Text>
          {!!v.verified && (
            <View style={styles.verified}>
              <Ionicons name="checkmark-circle" size={14} color="#1C6B3A" />
              <Text style={styles.verifiedText}>Verified venue</Text>
            </View>
          )}
          {!!loc && <View style={styles.row}><Ionicons name="location-sharp" size={15} color={C.primary} /><Text style={styles.loc}>{loc}</Text></View>}
          {!!v.address && <Text style={styles.addr}>{v.address}</Text>}

          <View style={styles.actionsRow}>
            <TouchableOpacity style={[styles.btn, styles.btnMsg]} activeOpacity={0.85}
              onPress={() => navigation.navigate('Chat', { slug, venueName: v.name || name })}>
              <Ionicons name="chatbubble-ellipses" size={18} color="#fff" />
              <Text style={styles.btnText}>Message</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnSec]} activeOpacity={0.85} onPress={() => Linking.openURL(mapsUrl)}>
              <Ionicons name="map" size={17} color={C.primary} />
              <Text style={[styles.btnText, { color: C.primary }]}>Map</Text>
            </TouchableOpacity>
          </View>

          {!!(v.facilities || []).length && (
            <View style={styles.chipsWrap}>
              {v.facilities.map((f) => <View key={f} style={styles.fchip}><Text style={styles.fchipText}>{f}</Text></View>)}
            </View>
          )}

          <Text style={styles.sectionH}>Pricing</Text>
          {hasPrices && v.halls?.length && v.slots?.length ? (
            <View style={styles.table}>
              <View style={[styles.tr, styles.trHead]}>
                <Text style={[styles.th, { flex: 1.4 }]}>Hall</Text>
                {v.slots.map((s) => <Text key={s.id} style={styles.th}>{s.name}</Text>)}
              </View>
              {v.halls.map((h) => (
                <View key={h.id} style={styles.tr}>
                  <Text style={[styles.td, styles.tdHall, { flex: 1.4 }]}>{h.name}</Text>
                  {v.slots.map((s) => { const p = priceOf(h.id, s.id); return <Text key={s.id} style={styles.td}>{p ? fmt(p) : '—'}</Text>; })}
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.muted}>Contact the venue for pricing.</Text>
          )}

          <Text style={styles.sectionH}>Send an enquiry</Text>
          {sent ? (
            <View style={styles.ok}>
              <Ionicons name="checkmark-circle" size={20} color={C.wa} />
              <Text style={styles.okText}>Thank you! {v.name} will contact you soon.</Text>
            </View>
          ) : (
            <View style={styles.formCard}>
              <TextInput style={styles.input} placeholder="Your name *" placeholderTextColor={C.muted} value={form.name} onChangeText={(t) => setForm({ ...form, name: t })} />
              <TextInput style={styles.input} placeholder="Phone (+92 3XX XXXXXXX)" placeholderTextColor={C.muted} keyboardType="phone-pad" value={form.phone} onChangeText={(t) => setForm({ ...form, phone: t })} />
              <TextInput style={styles.input} placeholder="Event date (e.g. 2026-12-15)" placeholderTextColor={C.muted} value={form.date} onChangeText={(t) => setForm({ ...form, date: t })} />
              <TouchableOpacity style={styles.submit} onPress={submit} disabled={sending} activeOpacity={0.85}>
                {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Send enquiry</Text>}
              </TouchableOpacity>
            </View>
          )}

          {/* Reviews */}
          <Text style={styles.sectionH}>Reviews{v.rating_count ? ` (${v.rating_count})` : ''}</Text>
          {v.rating_count > 0 && (
            <View style={styles.ratingRow}>
              <Text style={styles.ratingBig}>{Number(v.rating).toFixed(1)}</Text>
              <View>
                <Stars value={Math.round(v.rating)} size={16} />
                <Text style={styles.ratingCount}>{v.rating_count} review{v.rating_count > 1 ? 's' : ''}</Text>
              </View>
            </View>
          )}
          {(v.reviews || []).map((r, i) => (
            <View key={i} style={styles.revItem}>
              <View style={styles.revTop}>
                <Text style={styles.revName}>{r.name}</Text>
                <Stars value={r.rating} size={13} />
              </View>
              {!!r.comment && <Text style={styles.revComment}>{r.comment}</Text>}
            </View>
          ))}
          {!(v.reviews || []).length && <Text style={styles.muted}>No reviews yet — be the first to review!</Text>}

          {rev.sent ? (
            <View style={[styles.ok, { marginTop: 12 }]}><Ionicons name="checkmark-circle" size={20} color={C.wa} /><Text style={styles.okText}>Thanks for your review!</Text></View>
          ) : rev.show ? (
            <View style={[styles.formCard, { marginTop: 12 }]}>
              <Text style={styles.revFormLabel}>Your rating</Text>
              <Stars value={rev.rating} size={30} onPress={(n) => setRev((r) => ({ ...r, rating: n }))} />
              <TextInput style={[styles.input, { marginTop: 10 }]} placeholder="Your name *" placeholderTextColor={C.muted} value={rev.name} onChangeText={(t) => setRev((r) => ({ ...r, name: t }))} />
              <TextInput style={[styles.input, { height: 80, textAlignVertical: 'top', paddingTop: 12 }]} placeholder="Share your experience…" placeholderTextColor={C.muted} multiline value={rev.comment} onChangeText={(t) => setRev((r) => ({ ...r, comment: t }))} />
              <TouchableOpacity style={styles.submit} onPress={submitReview} disabled={rev.sending} activeOpacity={0.85}>
                {rev.sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Post review</Text>}
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.writeBtn} onPress={() => setRev((r) => ({ ...r, show: true }))} activeOpacity={0.85}>
              <Ionicons name="create-outline" size={18} color={C.primary} />
              <Text style={styles.writeText}>Write a review</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  back: { position: 'absolute', left: 14, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  heart: { position: 'absolute', right: 14, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16 },
  name: { fontSize: 24, fontWeight: '800', color: C.text, letterSpacing: -0.4, lineHeight: 29 },
  verified: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, marginTop: 8, backgroundColor: '#EAF8EF', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  verifiedText: { color: '#1C6B3A', fontSize: 12, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  loc: { color: C.text, fontSize: 14.5, fontWeight: '600' },
  addr: { color: C.muted, fontSize: 13.5, marginTop: 5, lineHeight: 19 },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 46, borderRadius: R.md },
  btnMsg: { backgroundColor: C.primary },
  btnSec: { backgroundColor: C.paper, borderWidth: 1, borderColor: C.line },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14.5 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  fchip: { backgroundColor: C.paper, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: C.line },
  fchipText: { color: C.text, fontSize: 12.5, fontWeight: '600' },
  sectionH: { fontSize: 17, fontWeight: '800', color: C.text, marginTop: 26, marginBottom: 12 },
  muted: { color: C.muted, fontSize: 14 },
  table: { borderWidth: 1, borderColor: C.line, borderRadius: R.md, overflow: 'hidden' },
  tr: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.line },
  trHead: { borderTopWidth: 0, backgroundColor: C.paper },
  th: { flex: 1, padding: 10, fontSize: 12.5, fontWeight: '700', color: C.muted, textAlign: 'center' },
  td: { flex: 1, padding: 10, fontSize: 13, color: C.text, textAlign: 'center' },
  tdHall: { textAlign: 'left', fontWeight: '700' },
  formCard: { backgroundColor: C.paper, borderRadius: R.md, padding: 14, gap: 10, borderWidth: 1, borderColor: C.line },
  input: { backgroundColor: C.bg, borderRadius: R.sm, borderWidth: 1, borderColor: C.line, paddingHorizontal: 12, height: 46, color: C.text, fontSize: 15 },
  submit: { backgroundColor: C.primary, height: 48, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  ok: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#EAF8EF', borderRadius: R.md, padding: 14 },
  okText: { color: '#1C6B3A', flex: 1, fontSize: 14, fontWeight: '600' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  ratingBig: { fontSize: 36, fontWeight: '800', color: C.text, letterSpacing: -1 },
  ratingCount: { color: C.muted, fontSize: 12.5, marginTop: 3 },
  revItem: { borderTopWidth: 1, borderTopColor: C.line, paddingVertical: 12 },
  revTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  revName: { color: C.text, fontWeight: '700', fontSize: 14 },
  revComment: { color: C.muted, fontSize: 13.5, marginTop: 4, lineHeight: 19 },
  revFormLabel: { color: C.text, fontWeight: '700', fontSize: 13.5, marginBottom: 8 },
  writeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: C.primary, borderRadius: R.md, height: 48, marginTop: 12 },
  writeText: { color: C.primary, fontWeight: '700', fontSize: 14.5 },
});
