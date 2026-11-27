// A single booking in full: customer, event, money, payment history. The owner
// can confirm / complete / cancel, add a payment, and call the customer.
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator, Alert, Linking, Modal, Platform, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { C, R } from '../theme';

const fmt = (n) => 'Rs ' + Number(n || 0).toLocaleString('en-IN');
const STAT = {
  tentative: ['Tentative', '#FFF4E0', '#B7791F'],
  confirmed: ['Confirmed', '#E6F4EA', '#1E7E4B'],
  completed: ['Completed', '#EAF2FD', '#2D6CDF'],
  cancelled: ['Cancelled', '#F3F0F0', '#9A8F8F'],
};
const prettyDate = (s) => {
  if (!s) return '';
  const d = new Date(s + 'T00:00:00');
  if (isNaN(d)) return s;
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};
const PAY_METHODS = ['cash', 'bank', 'card', 'online'];

export default function BookingDetailScreen({ route, navigation }) {
  const { id } = route.params || {};
  const [b, setB] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    try { const r = await api.booking(id); if (r.ok) setB(r.data); }
    catch {} finally { setLoading(false); }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const act = async (fn, successMsg) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fn();
      if (r.ok) { setB(r.data?.id ? r.data : b); await load(); if (successMsg) Alert.alert('Done', successMsg); }
      else Alert.alert('Could not update', r.data?.message || 'Please try again.');
    } catch { Alert.alert('Network error', 'Please check your connection and try again.'); }
    finally { setBusy(false); }
  };

  const confirmThen = (title, message, fn, successMsg, destructive) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Yes', style: destructive ? 'destructive' : 'default', onPress: () => act(fn, successMsg) },
    ]);

  const submitPayment = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return Alert.alert('Enter an amount', 'Please enter a payment amount greater than zero.');
    setBusy(true);
    try {
      const r = await api.addPayment(id, { amount: amt, method, note: note.trim() || undefined });
      if (r.ok) { setB(r.data); setPayOpen(false); setAmount(''); setNote(''); setMethod('cash'); }
      else Alert.alert('Could not add payment', r.data?.message || 'Please try again.');
    } catch { Alert.alert('Network error', 'Please try again.'); }
    finally { setBusy(false); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={C.primary} size="large" /></View>;
  if (!b) return (
    <View style={styles.center}>
      <Ionicons name="alert-circle-outline" size={44} color={C.muted} />
      <Text style={styles.muted}>This booking could not be loaded.</Text>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backLink}><Text style={styles.backLinkText}>Go back</Text></TouchableOpacity>
    </View>
  );

  const [label, bg, color] = STAT[b.status] || STAT.tentative;
  const bal = Number(b.balance || 0);
  const canPay = b.status !== 'cancelled' && bal > 0;

  return (
    <View style={styles.fill}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}><Ionicons name="arrow-back" size={24} color="#fff" /></TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Booking</Text>
        {b && b.status !== 'cancelled' ? (
          <TouchableOpacity onPress={() => navigation.navigate('EditBooking', { booking: b })} hitSlop={10}><Ionicons name="create-outline" size={23} color="#fff" /></TouchableOpacity>
        ) : <View style={{ width: 24 }} />}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 30, gap: 14 }}>
        {/* Customer + status */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.name}>{b.customer_name}</Text>
            <View style={[styles.pill, { backgroundColor: bg }]}><Text style={[styles.pillText, { color }]}>{label}</Text></View>
          </View>
          {!!b.customer_phone && (
            <TouchableOpacity style={styles.phoneRow} onPress={() => Linking.openURL('tel:' + b.customer_phone)}>
              <Ionicons name="call" size={16} color={C.primary} />
              <Text style={styles.phone}>{b.customer_phone}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Event details */}
        <View style={styles.card}>
          <Text style={styles.sectionH}>Event</Text>
          <Row icon="calendar" label="Date" value={prettyDate(b.event_date)} />
          <Row icon="business" label="Hall" value={b.hall_name} />
          <Row icon="time" label="Slot" value={b.slot_name} />
          {!!b.event_type && <Row icon="sparkles" label="Type" value={b.event_type} />}
          {!!b.guest_count && <Row icon="people" label="Guests" value={String(b.guest_count)} />}
          {!!b.requirements && <Row icon="list" label="Requirements" value={b.requirements} />}
          {!!b.notes && <Row icon="document-text" label="Notes" value={b.notes} />}
        </View>

        {/* Money */}
        <View style={styles.card}>
          <Text style={styles.sectionH}>Payment</Text>
          <View style={styles.moneyRow}><Text style={styles.moneyLabel}>Total</Text><Text style={styles.moneyVal}>{fmt(b.total_amount)}</Text></View>
          <View style={styles.moneyRow}><Text style={styles.moneyLabel}>Received</Text><Text style={[styles.moneyVal, { color: '#1E7E4B' }]}>{fmt(b.paid)}</Text></View>
          <View style={[styles.moneyRow, styles.moneyTotal]}>
            <Text style={styles.balLabel}>Balance due</Text>
            <Text style={[styles.balVal, { color: bal > 0 ? '#B7791F' : '#1E7E4B' }]}>{fmt(bal)}</Text>
          </View>
          {canPay && (
            <TouchableOpacity style={styles.payBtn} activeOpacity={0.85} onPress={() => setPayOpen(true)}>
              <Ionicons name="add-circle" size={18} color="#fff" />
              <Text style={styles.payBtnText}>Add payment</Text>
            </TouchableOpacity>
          )}
          {Array.isArray(b.payments) && b.payments.length > 0 && (
            <View style={styles.payList}>
              {b.payments.map((p) => (
                <View key={p.id} style={styles.payItem}>
                  <View>
                    <Text style={styles.payAmt}>{fmt(p.amount)}</Text>
                    <Text style={styles.payMeta}>{[p.method, p.paid_on].filter(Boolean).join(' · ')}{p.note ? ` · ${p.note}` : ''}</Text>
                  </View>
                  <Ionicons name="checkmark-circle" size={18} color="#1E7E4B" />
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Status actions */}
        {b.status !== 'cancelled' && b.status !== 'completed' && (
          <View style={styles.actions}>
            {b.status === 'tentative' && (
              <TouchableOpacity style={[styles.actBtn, styles.actPrimary]} disabled={busy}
                onPress={() => confirmThen('Confirm booking', 'Mark this booking as confirmed? This reserves the slot.', () => api.confirmBooking(id), 'Booking confirmed.')}>
                <Ionicons name="checkmark-done" size={18} color="#fff" />
                <Text style={styles.actPrimaryText}>Confirm booking</Text>
              </TouchableOpacity>
            )}
            {b.status === 'confirmed' && (
              <TouchableOpacity style={[styles.actBtn, styles.actPrimary]} disabled={busy}
                onPress={() => confirmThen('Mark completed', 'Mark this event as completed?', () => api.completeBooking(id), 'Booking marked completed.')}>
                <Ionicons name="flag" size={18} color="#fff" />
                <Text style={styles.actPrimaryText}>Mark completed</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.actBtn, styles.actDanger]} disabled={busy}
              onPress={() => confirmThen('Cancel booking', 'Cancel this booking? This frees up the slot.', () => api.cancelBooking(id, 'owner cancelled'), 'Booking cancelled.', true)}>
              <Ionicons name="close-circle" size={18} color="#C0392B" />
              <Text style={styles.actDangerText}>Cancel booking</Text>
            </TouchableOpacity>
          </View>
        )}
        {busy && <ActivityIndicator color={C.primary} />}
      </ScrollView>

      {/* Add payment modal */}
      <Modal visible={payOpen} transparent animationType="slide" onRequestClose={() => setPayOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalWrap}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setPayOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 18 }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Add payment</Text>
            <Text style={styles.sheetSub}>Balance due: {fmt(bal)}</Text>
            <Text style={styles.fieldLabel}>Amount</Text>
            <TextInput style={styles.input} placeholder="0" placeholderTextColor={C.muted} keyboardType="number-pad" value={amount} onChangeText={setAmount} autoFocus />
            <Text style={styles.fieldLabel}>Method</Text>
            <View style={styles.methods}>
              {PAY_METHODS.map((mth) => (
                <TouchableOpacity key={mth} style={[styles.methodChip, method === mth && styles.methodOn]} onPress={() => setMethod(mth)}>
                  <Text style={[styles.methodText, method === mth && styles.methodTextOn]}>{mth[0].toUpperCase() + mth.slice(1)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.fieldLabel}>Note (optional)</Text>
            <TextInput style={styles.input} placeholder="e.g. advance, final settlement" placeholderTextColor={C.muted} value={note} onChangeText={setNote} />
            <TouchableOpacity style={styles.saveBtn} onPress={submitPayment} disabled={busy} activeOpacity={0.85}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save payment</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function Row({ icon, label, value }) {
  if (!value) return null;
  return (
    <View style={styles.detailRow}>
      <Ionicons name={`${icon}-outline`} size={17} color={C.muted} style={{ marginTop: 1 }} />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.bg },
  muted: { color: C.muted, fontSize: 14 },
  backLink: { marginTop: 4 }, backLinkText: { color: C.primary, fontWeight: '700' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: C.primary, paddingHorizontal: 14, paddingBottom: 12 },
  headerTitle: { flex: 1, color: '#fff', fontSize: 17, fontWeight: '800', textAlign: 'center' },
  card: { backgroundColor: C.card, borderRadius: R.md, padding: 16, borderWidth: 1, borderColor: C.line },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { flex: 1, color: C.text, fontSize: 19, fontWeight: '800', letterSpacing: -0.3 },
  pill: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 4 },
  pillText: { fontSize: 12, fontWeight: '800' },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10 },
  phone: { color: C.primary, fontSize: 15, fontWeight: '700' },
  sectionH: { fontSize: 13, fontWeight: '800', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 6 },
  detailLabel: { color: C.muted, fontSize: 14, width: 96 },
  detailValue: { flex: 1, color: C.text, fontSize: 14.5, fontWeight: '600' },
  moneyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  moneyLabel: { color: C.muted, fontSize: 14.5 },
  moneyVal: { color: C.text, fontSize: 15, fontWeight: '700' },
  moneyTotal: { borderTopWidth: 1, borderTopColor: C.line, marginTop: 6, paddingTop: 12 },
  balLabel: { color: C.text, fontSize: 15, fontWeight: '800' },
  balVal: { fontSize: 17, fontWeight: '800' },
  payBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12, marginTop: 14 },
  payBtnText: { color: '#fff', fontWeight: '800', fontSize: 14.5 },
  payList: { marginTop: 14, gap: 8, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 12 },
  payItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.paper, borderRadius: 10, padding: 11 },
  payAmt: { color: C.text, fontWeight: '800', fontSize: 14.5 },
  payMeta: { color: C.muted, fontSize: 12.5, marginTop: 2 },
  actions: { gap: 10 },
  actBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12, paddingVertical: 14 },
  actPrimary: { backgroundColor: C.primary },
  actPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  actDanger: { backgroundColor: '#FBEEEC', borderWidth: 1, borderColor: '#F0D0CB' },
  actDangerText: { color: '#C0392B', fontWeight: '800', fontSize: 15 },
  modalWrap: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.line, marginBottom: 14 },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: C.text },
  sheetSub: { color: C.muted, fontSize: 13.5, marginTop: 4, marginBottom: 8 },
  fieldLabel: { color: C.text, fontSize: 13.5, fontWeight: '700', marginTop: 14, marginBottom: 7 },
  input: { backgroundColor: C.paper, borderRadius: 12, height: 50, paddingHorizontal: 15, color: C.text, fontSize: 16, borderWidth: 1, borderColor: C.line },
  methods: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  methodChip: { borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.card },
  methodOn: { backgroundColor: C.primary, borderColor: C.primary },
  methodText: { color: C.muted, fontWeight: '700', fontSize: 13 },
  methodTextOn: { color: '#fff' },
  saveBtn: { backgroundColor: C.primary, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
