// Manage the banquet: edit profile, and add/remove halls, slots and rates.
// Everything hits the same endpoints the web dashboard uses, so changes show
// up in both places. Media (photos/video) is a separate screen.
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { api } from '../api';
import { C, R } from '../theme';

const fmt = (n) => 'Rs ' + Number(n || 0).toLocaleString('en-IN');
const TABS = [['profile', 'Profile'], ['halls', 'Halls'], ['slots', 'Slots'], ['rates', 'Rates'], ['media', 'Photos']];

export default function ManageScreen({ navigation }) {
  const [venue, setVenue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('profile');
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    try {
      const r = await api.venue();
      if (r.ok && !r.data?.needsSetup && !r.data?.needsSelection) setVenue(r.data);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={C.primary} size="large" /></View>;

  return (
    <View style={styles.fill}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}><Ionicons name="arrow-back" size={24} color="#fff" /></TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Manage banquet</Text>
        <View style={{ width: 24 }} />
      </View>

      {!venue ? (
        <View style={styles.center}>
          <Ionicons name="business-outline" size={46} color={C.muted} />
          <Text style={styles.muted}>No venue linked to your account.</Text>
        </View>
      ) : (
        <>
          <View style={styles.tabs}>
            {TABS.map(([val, label]) => (
              <TouchableOpacity key={val} style={[styles.tab, tab === val && styles.tabOn]} onPress={() => setTab(val)} activeOpacity={0.8}>
                <Text style={[styles.tabText, tab === val && styles.tabTextOn]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {tab === 'profile' && <Profile venue={venue} onSaved={load} insets={insets} />}
          {tab === 'halls' && <Halls venue={venue} reload={load} insets={insets} />}
          {tab === 'slots' && <Slots venue={venue} reload={load} insets={insets} />}
          {tab === 'rates' && <Rates venue={venue} reload={load} insets={insets} />}
          {tab === 'media' && <Media insets={insets} />}
        </>
      )}
    </View>
  );
}

// ---------- Media (photos) ----------
function Media({ insets }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.media(); setItems(Array.isArray(r.data) ? r.data : []); } catch { setItems([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const pickAndUpload = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return Alert.alert('Permission needed', 'Please allow photo access to add photos.');
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 });
      if (res.canceled || !res.assets?.length) return;
      setBusy(true);
      // Resize + compress so the base64 fits comfortably within the request limit.
      const manip = await ImageManipulator.manipulateAsync(
        res.assets[0].uri,
        [{ resize: { width: 1280 } }],
        { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      const r = await api.directUpload({ data: manip.base64, contentType: 'image/jpeg', kind: 'image' });
      if (r.ok) load();
      else Alert.alert('Upload failed', r.data?.message || 'Please try again.');
    } catch { Alert.alert('Upload failed', 'Please try again.'); }
    finally { setBusy(false); }
  };

  const del = (m) => Alert.alert('Remove photo', 'Remove this photo?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => { const r = await api.deleteMedia(m.id); if (r.ok) load(); } },
  ]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 12 }}>
      <Text style={styles.hint}>Photos shown on your public page and in the app.</Text>
      <TouchableOpacity style={styles.addBtn} onPress={pickAndUpload} disabled={busy} activeOpacity={0.85}>
        {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="cloud-upload-outline" size={18} color="#fff" /><Text style={styles.addBtnText}>Add photo</Text></>}
      </TouchableOpacity>
      {items === null ? (
        <ActivityIndicator color={C.primary} style={{ marginTop: 16 }} />
      ) : items.length === 0 ? (
        <View style={styles.mediaEmpty}><Ionicons name="images-outline" size={44} color={C.line} /><Text style={styles.muted}>No photos yet</Text></View>
      ) : (
        <View style={styles.mediaGrid}>
          {items.map((m) => (
            <View key={m.id} style={styles.mediaCell}>
              <Image source={{ uri: m.url }} style={styles.mediaImg} contentFit="cover" transition={150} />
              {m.kind === 'video' && <View style={styles.vidTag}><Ionicons name="videocam" size={13} color="#fff" /></View>}
              <TouchableOpacity style={styles.mediaDel} onPress={() => del(m)} hitSlop={6}><Ionicons name="close" size={15} color="#fff" /></TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ---------- Profile ----------
function Profile({ venue, onSaved, insets }) {
  const [f, setF] = useState({
    name: venue.name || '', city: venue.city || '', area: venue.area || '', address: venue.address || '',
    capacity_min: venue.capacity_min ? String(venue.capacity_min) : '', capacity_max: venue.capacity_max ? String(venue.capacity_max) : '',
    service_charge_pct: venue.service_charge_pct != null ? String(venue.service_charge_pct) : '',
    tax_pct: venue.tax_pct != null ? String(venue.tax_pct) : '',
  });
  const [facs, setFacs] = useState(Array.isArray(venue.facilities) ? venue.facilities : []);
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const toggleFac = (x) => setFacs((p) => (p.includes(x) ? p.filter((y) => y !== x) : [...p, x]));

  const save = async () => {
    if (!f.name.trim()) return Alert.alert('Name required', 'Banquet name cannot be empty.');
    setSaving(true);
    try {
      const r = await api.updateVenue({
        name: f.name.trim(), city: f.city.trim(), area: f.area.trim(), address: f.address.trim(),
        capacity_min: f.capacity_min ? Number(f.capacity_min) : null,
        capacity_max: f.capacity_max ? Number(f.capacity_max) : null,
        service_charge_pct: f.service_charge_pct ? Number(f.service_charge_pct) : null,
        tax_pct: f.tax_pct ? Number(f.tax_pct) : null,
        facilities: facs,
      });
      if (r.ok) { Alert.alert('Saved', 'Banquet profile updated.'); onSaved(); }
      else Alert.alert('Could not save', r.data?.message || 'Please try again.');
    } catch { Alert.alert('Network error', 'Please try again.'); }
    finally { setSaving(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 14 }} keyboardShouldPersistTaps="handled">
        <Field label="Banquet name *"><TextInput style={styles.input} value={f.name} onChangeText={set('name')} placeholder="Banquet name" placeholderTextColor={C.muted} /></Field>
        <View style={styles.row2}>
          <Field label="City" flex><TextInput style={styles.input} value={f.city} onChangeText={set('city')} placeholder="Lahore" placeholderTextColor={C.muted} /></Field>
          <Field label="Area" flex><TextInput style={styles.input} value={f.area} onChangeText={set('area')} placeholder="Johar Town" placeholderTextColor={C.muted} /></Field>
        </View>
        <Field label="Address"><TextInput style={styles.input} value={f.address} onChangeText={set('address')} placeholder="Street, landmark" placeholderTextColor={C.muted} /></Field>
        <View style={styles.row2}>
          <Field label="Min capacity" flex><TextInput style={styles.input} value={f.capacity_min} onChangeText={set('capacity_min')} keyboardType="number-pad" placeholder="200" placeholderTextColor={C.muted} /></Field>
          <Field label="Max capacity" flex><TextInput style={styles.input} value={f.capacity_max} onChangeText={set('capacity_max')} keyboardType="number-pad" placeholder="800" placeholderTextColor={C.muted} /></Field>
        </View>
        <View style={styles.row2}>
          <Field label="Service charge %" flex><TextInput style={styles.input} value={f.service_charge_pct} onChangeText={set('service_charge_pct')} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.muted} /></Field>
          <Field label="Tax (GST) %" flex><TextInput style={styles.input} value={f.tax_pct} onChangeText={set('tax_pct')} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.muted} /></Field>
        </View>
        <Field label="Facilities">
          <View style={styles.chips}>
            {(venue.all_facilities || []).map((x) => (
              <TouchableOpacity key={x} style={[styles.chip, facs.includes(x) && styles.chipOn]} onPress={() => toggleFac(x)} activeOpacity={0.8}>
                <Text style={[styles.chipText, facs.includes(x) && styles.chipTextOn]}>{x}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Field>
        <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving} activeOpacity={0.85}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save profile</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ---------- Halls ----------
function Halls({ venue, reload, insets }) {
  const [name, setName] = useState('');
  const [cap, setCap] = useState('');
  const [busy, setBusy] = useState(false);
  const halls = venue.halls || [];

  const add = async () => {
    if (!name.trim()) return Alert.alert('Hall name required', 'Please enter a hall name.');
    setBusy(true);
    try { const r = await api.addHall({ name: name.trim(), capacity: cap ? Number(cap) : null }); if (r.ok) { setName(''); setCap(''); reload(); } else Alert.alert('Could not add', r.data?.message || 'Try again.'); }
    catch { Alert.alert('Network error', 'Please try again.'); } finally { setBusy(false); }
  };
  const del = (h) => Alert.alert('Remove hall', `Remove “${h.name}”?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => { const r = await api.deleteHall(h.id); if (r.ok) reload(); else Alert.alert('Could not remove', r.data?.message || 'This hall may have bookings.'); } },
  ]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 10 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.hint}>Bookings are made per hall. Add every hall / lawn.</Text>
      {halls.map((h) => (
        <Row key={h.id} title={h.name} sub={h.capacity ? `${h.capacity} guests` : 'No capacity set'} onDelete={() => del(h)} />
      ))}
      <View style={styles.addCard}>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Hall name (e.g. Grand Hall)" placeholderTextColor={C.muted} />
        <TextInput style={styles.input} value={cap} onChangeText={setCap} keyboardType="number-pad" placeholder="Capacity (optional)" placeholderTextColor={C.muted} />
        <TouchableOpacity style={styles.addBtn} onPress={add} disabled={busy} activeOpacity={0.85}>
          {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="add" size={18} color="#fff" /><Text style={styles.addBtnText}>Add hall</Text></>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// ---------- Slots ----------
function Slots({ venue, reload, insets }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const slots = venue.slots || [];

  const add = async () => {
    if (!name.trim()) return Alert.alert('Slot name required', 'e.g. Morning, Evening, Night.');
    setBusy(true);
    try { const r = await api.addSlot({ name: name.trim() }); if (r.ok) { setName(''); reload(); } else Alert.alert('Could not add', r.data?.message || 'Try again.'); }
    catch { Alert.alert('Network error', 'Please try again.'); } finally { setBusy(false); }
  };
  const del = (s) => Alert.alert('Remove slot', `Remove “${s.name}”?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => { const r = await api.deleteSlot(s.id); if (r.ok) reload(); else Alert.alert('Could not remove', r.data?.message || 'This slot may have bookings.'); } },
  ]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 10 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.hint}>Time slots a hall can be booked in — e.g. Morning, Evening, Night.</Text>
      {slots.map((s) => (
        <Row key={s.id} title={s.name} sub={s.code} onDelete={() => del(s)} />
      ))}
      <View style={styles.addCard}>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Slot name (e.g. Evening)" placeholderTextColor={C.muted} />
        <TouchableOpacity style={styles.addBtn} onPress={add} disabled={busy} activeOpacity={0.85}>
          {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="add" size={18} color="#fff" /><Text style={styles.addBtnText}>Add slot</Text></>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// ---------- Rates (per-head price per hall + event type) ----------
function Rates({ venue, reload, insets }) {
  const halls = venue.halls || [];
  const rates = venue.rates || [];
  const [hall, setHall] = useState(halls[0]?.id || null);
  const [eventType, setEventType] = useState('');
  const [rate, setRate] = useState('');
  const [busy, setBusy] = useState(false);
  const hallName = (id) => halls.find((h) => h.id === id)?.name || 'Hall';

  const add = async () => {
    if (!hall) return Alert.alert('Pick a hall', 'Add a hall first, then set its rate.');
    if (!eventType.trim()) return Alert.alert('Event type required', 'e.g. Wedding, Mehndi.');
    if (!rate || Number(rate) <= 0) return Alert.alert('Rate required', 'Enter a per-head rate.');
    setBusy(true);
    try { const r = await api.addRate({ hall_id: hall, event_type: eventType.trim(), per_head_rate: Number(rate) }); if (r.ok) { setEventType(''); setRate(''); reload(); } else Alert.alert('Could not add', r.data?.message || 'Try again.'); }
    catch { Alert.alert('Network error', 'Please try again.'); } finally { setBusy(false); }
  };
  const del = (rp) => Alert.alert('Remove rate', `Remove ${rp.event_type} rate?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => { const r = await api.deleteRate(rp.id); if (r.ok) reload(); } },
  ]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 10 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.hint}>Per-head rate for each hall and event type.</Text>
      {!halls.length && <Text style={styles.muted}>Add a hall first (Halls tab).</Text>}
      {rates.map((rp) => (
        <Row key={rp.id} title={`${rp.event_type} · ${fmt(rp.per_head_rate)}/head`} sub={hallName(rp.hall_id)} onDelete={() => del(rp)} />
      ))}
      {!!halls.length && (
        <View style={styles.addCard}>
          <View style={styles.chips}>
            {halls.map((h) => (
              <TouchableOpacity key={h.id} style={[styles.chip, hall === h.id && styles.chipOn]} onPress={() => setHall(h.id)} activeOpacity={0.8}>
                <Text style={[styles.chipText, hall === h.id && styles.chipTextOn]}>{h.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={styles.input} value={eventType} onChangeText={setEventType} placeholder="Event type (e.g. Wedding)" placeholderTextColor={C.muted} />
          <TextInput style={styles.input} value={rate} onChangeText={setRate} keyboardType="number-pad" placeholder="Per-head rate (Rs)" placeholderTextColor={C.muted} />
          <TouchableOpacity style={styles.addBtn} onPress={add} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="add" size={18} color="#fff" /><Text style={styles.addBtnText}>Add rate</Text></>}
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

// ---------- shared ----------
function Field({ label, children, flex }) {
  return <View style={flex ? { flex: 1 } : undefined}><Text style={styles.fieldLabel}>{label}</Text>{children}</View>;
}
function Row({ title, sub, onDelete }) {
  return (
    <View style={styles.listRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.listTitle}>{title}</Text>
        {!!sub && <Text style={styles.listSub}>{sub}</Text>}
      </View>
      <TouchableOpacity style={styles.delBtn} onPress={onDelete} hitSlop={8}><Ionicons name="trash-outline" size={18} color="#C0392B" /></TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  muted: { color: C.muted, fontSize: 14, textAlign: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: C.primary, paddingHorizontal: 14, paddingBottom: 12 },
  headerTitle: { flex: 1, color: '#fff', fontSize: 17, fontWeight: '800', textAlign: 'center' },
  tabs: { flexDirection: 'row', gap: 6, padding: 10, backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: C.line },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 999, alignItems: 'center', backgroundColor: C.paper, borderWidth: 1, borderColor: C.line },
  tabOn: { backgroundColor: C.primary, borderColor: C.primary },
  tabText: { color: C.muted, fontWeight: '700', fontSize: 13 },
  tabTextOn: { color: '#fff' },
  fieldLabel: { color: C.text, fontSize: 13.5, fontWeight: '700', marginBottom: 7 },
  input: { backgroundColor: C.paper, borderRadius: 12, minHeight: 50, paddingHorizontal: 15, paddingVertical: 12, color: C.text, fontSize: 16, borderWidth: 1, borderColor: C.line },
  row2: { flexDirection: 'row', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 999, paddingVertical: 9, paddingHorizontal: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper },
  chipOn: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { color: C.text, fontWeight: '700', fontSize: 13 },
  chipTextOn: { color: '#fff' },
  saveBtn: { backgroundColor: C.primary, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  hint: { color: C.muted, fontSize: 13, lineHeight: 19, marginBottom: 2 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: R.md, padding: 14, borderWidth: 1, borderColor: C.line },
  listTitle: { color: C.text, fontWeight: '700', fontSize: 15 },
  listSub: { color: C.muted, fontSize: 12.5, marginTop: 2 },
  delBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FBEEEC', alignItems: 'center', justifyContent: 'center' },
  addCard: { backgroundColor: C.card, borderRadius: R.md, padding: 14, borderWidth: 1, borderColor: C.line, gap: 10, marginTop: 6 },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 13 },
  addBtnText: { color: '#fff', fontWeight: '800', fontSize: 14.5 },
  mediaEmpty: { alignItems: 'center', justifyContent: 'center', gap: 8, padding: 40 },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mediaCell: { width: '31.5%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: C.paper, borderWidth: 1, borderColor: C.line },
  mediaImg: { width: '100%', height: '100%' },
  vidTag: { position: 'absolute', left: 6, bottom: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  mediaDel: { position: 'absolute', top: 5, right: 5, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
});
