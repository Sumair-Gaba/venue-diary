// Edit a booking's customer, event and money details. Date / hall / slot are
// fixed after creation (cancel + rebook to move a booking), so they're shown
// read-only here. Saves via PATCH /bookings/:id.
import { useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { C, R } from '../theme';

export default function EditBookingScreen({ route, navigation }) {
  const { booking } = route.params || {};
  const b = booking || {};
  const [f, setF] = useState({
    customer_name: b.customer_name || '',
    customer_phone: b.customer_phone || '',
    event_type: b.event_type || '',
    guest_count: b.guest_count ? String(b.guest_count) : '',
    total_amount: b.total_amount ? String(b.total_amount) : '',
    requirements: b.requirements || '',
    notes: b.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const insets = useSafeAreaInsets();
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  const save = async () => {
    if (!f.customer_name.trim()) return Alert.alert('Customer name required', 'Please enter the customer’s name.');
    setSaving(true);
    try {
      const r = await api.updateBooking(b.id, {
        customer_name: f.customer_name.trim(),
        customer_phone: f.customer_phone.trim() || null,
        event_type: f.event_type.trim() || null,
        guest_count: f.guest_count ? Number(f.guest_count) : null,
        total_amount: f.total_amount ? Number(f.total_amount) : 0,
        requirements: f.requirements.trim() || null,
        notes: f.notes.trim() || null,
      });
      if (r.ok) { navigation.goBack(); }
      else Alert.alert('Could not save', r.data?.message || 'Please try again.');
    } catch { Alert.alert('Network error', 'Please check your connection and try again.'); }
    finally { setSaving(false); }
  };

  return (
    <View style={styles.fill}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}><Ionicons name="arrow-back" size={24} color="#fff" /></TouchableOpacity>
        <Text style={styles.headerTitle}>Edit booking</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 14 }} keyboardShouldPersistTaps="handled">
          <View style={styles.fixed}>
            <Ionicons name="lock-closed-outline" size={15} color={C.muted} />
            <Text style={styles.fixedText}>{[b.event_date, b.hall_name, b.slot_name].filter(Boolean).join(' · ')}</Text>
          </View>

          <Field label="Customer name *"><TextInput style={styles.input} value={f.customer_name} onChangeText={set('customer_name')} placeholder="Customer name" placeholderTextColor={C.muted} /></Field>
          <Field label="Phone"><TextInput style={styles.input} value={f.customer_phone} onChangeText={set('customer_phone')} keyboardType="phone-pad" placeholder="+92 3XX XXXXXXX" placeholderTextColor={C.muted} /></Field>
          <Field label="Event type"><TextInput style={styles.input} value={f.event_type} onChangeText={set('event_type')} placeholder="e.g. Wedding, Mehndi" placeholderTextColor={C.muted} /></Field>
          <Field label="Guests"><TextInput style={styles.input} value={f.guest_count} onChangeText={set('guest_count')} keyboardType="number-pad" placeholder="Number of guests" placeholderTextColor={C.muted} /></Field>
          <Field label="Total amount (Rs)"><TextInput style={styles.input} value={f.total_amount} onChangeText={set('total_amount')} keyboardType="number-pad" placeholder="0" placeholderTextColor={C.muted} /></Field>
          <Field label="Requirements"><TextInput style={[styles.input, styles.multi]} value={f.requirements} onChangeText={set('requirements')} placeholder="Decor, menu, stage…" placeholderTextColor={C.muted} multiline /></Field>
          <Field label="Notes"><TextInput style={[styles.input, styles.multi]} value={f.notes} onChangeText={set('notes')} placeholder="Any notes" placeholderTextColor={C.muted} multiline /></Field>

          <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving} activeOpacity={0.85}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save changes</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field({ label, children }) {
  return <View><Text style={styles.fieldLabel}>{label}</Text>{children}</View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: C.primary, paddingHorizontal: 14, paddingBottom: 12 },
  headerTitle: { flex: 1, color: '#fff', fontSize: 17, fontWeight: '800', textAlign: 'center' },
  fixed: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: C.paper, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.line },
  fixedText: { color: C.muted, fontSize: 13, fontWeight: '600', flex: 1 },
  fieldLabel: { color: C.text, fontSize: 13.5, fontWeight: '700', marginBottom: 7 },
  input: { backgroundColor: C.paper, borderRadius: 12, minHeight: 50, paddingHorizontal: 15, paddingVertical: 12, color: C.text, fontSize: 16, borderWidth: 1, borderColor: C.line },
  multi: { minHeight: 76, textAlignVertical: 'top' },
  saveBtn: { backgroundColor: C.primary, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
