// Add a booking from the phone. Pick a hall + slot + date, check availability,
// fill customer/event details, optionally take an advance, then save as a
// tentative hold or a confirmed booking.
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { C, R } from '../theme';

const todayISO = () => new Date().toISOString().slice(0, 10);
const isValidDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00'));

export default function NewBookingScreen({ navigation, route }) {
  const [venue, setVenue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // form
  const [hall, setHall] = useState(null);
  const [slot, setSlot] = useState(null);
  const [date, setDate] = useState(route?.params?.date || todayISO());
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [eventType, setEventType] = useState('');
  const [guests, setGuests] = useState('');
  const [total, setTotal] = useState('');
  const [advance, setAdvance] = useState('');
  const [notes, setNotes] = useState('');

  // availability
  const [avail, setAvail] = useState(null); // {free, conflict, hold}
  const [checking, setChecking] = useState(false);

  const insets = useSafeAreaInsets();

  useEffect(() => {
    (async () => {
      try {
        const r = await api.venue();
        if (r.ok && !r.data?.needsSetup && !r.data?.needsSelection) {
          setVenue(r.data);
          if (r.data.halls?.length === 1) setHall(r.data.halls[0].id);
          if (r.data.slots?.length === 1) setSlot(r.data.slots[0].id);
        }
      } catch {} finally { setLoading(false); }
    })();
  }, []);

  const check = useCallback(async () => {
    if (!hall || !slot || !isValidDate(date)) { setAvail(null); return; }
    setChecking(true);
    try {
      const r = await api.checkSlot({ hall, slot, date });
      if (r.ok) setAvail(r.data); else setAvail(null);
    } catch { setAvail(null); } finally { setChecking(false); }
  }, [hall, slot, date]);

  useEffect(() => { check(); }, [check]);

  const save = async (status) => {
    if (!name.trim()) return Alert.alert('Customer name required', 'Please enter the customer’s name.');
    if (!hall) return Alert.alert('Pick a hall', 'Please choose a hall.');
    if (!slot) return Alert.alert('Pick a slot', 'Please choose a time slot.');
    if (!isValidDate(date)) return Alert.alert('Check the date', 'Please enter a valid date as YYYY-MM-DD.');
    if (status === 'confirmed' && avail && !avail.free) {
      return Alert.alert('Slot not available', 'This hall and slot is already booked or blocked for that date. Save as tentative instead, or pick another slot.');
    }
    setSaving(true);
    try {
      const body = {
        customer_name: name.trim(),
        customer_phone: phone.trim() || undefined,
        date, hall, slot,
        event_type: eventType.trim() || undefined,
        guest_count: guests ? Number(guests) : undefined,
        total_amount: total ? Number(total) : 0,
        notes: notes.trim() || undefined,
        status,
      };
      if (advance && Number(advance) > 0) { body.advance = Number(advance); body.advance_method = 'cash'; }
      const r = await api.createBooking(body);
      if (r.ok && r.data?.id) {
        navigation.replace('BookingDetail', { id: r.data.id });
      } else if (r.data?.error === 'BOOKING_CONFLICT') {
        Alert.alert('Slot not available', r.data.message || 'This slot was just taken. Try another slot or save as tentative.');
      } else {
        Alert.alert('Could not save', r.data?.message || 'Please check the details and try again.');
      }
    } catch { Alert.alert('Network error', 'Please check your connection and try again.'); }
    finally { setSaving(false); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={C.primary} size="large" /></View>;

  if (!venue) return (
    <View style={styles.fill}>
      <Header insets={insets} onBack={() => navigation.goBack()} />
      <View style={styles.center}>
        <Ionicons name="business-outline" size={46} color={C.muted} />
        <Text style={styles.muted}>No venue is linked to your account yet.</Text>
      </View>
    </View>
  );

  const halls = venue.halls || [];
  const slots = venue.slots || [];
  const showAvail = hall && slot && isValidDate(date);

  return (
    <View style={styles.fill}>
      <Header insets={insets} onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 16 }} keyboardShouldPersistTaps="handled">
          {/* Customer */}
          <Section title="Customer">
            <Field label="Name *">
              <TextInput style={styles.input} placeholder="Customer name" placeholderTextColor={C.muted} value={name} onChangeText={setName} />
            </Field>
            <Field label="Phone">
              <TextInput style={styles.input} placeholder="+92 3XX XXXXXXX" placeholderTextColor={C.muted} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
            </Field>
          </Section>

          {/* When + where */}
          <Section title="Event">
            <Field label="Date *">
              <TextInput style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor={C.muted} value={date} onChangeText={setDate} autoCapitalize="none" />
            </Field>
            <Field label="Hall *">
              <Chips items={halls.map((h) => [h.id, h.name])} value={hall} onPick={setHall} empty="No halls set up yet." />
            </Field>
            <Field label="Slot *">
              <Chips items={slots.map((s) => [s.id, s.name])} value={slot} onPick={setSlot} empty="No slots set up yet." />
            </Field>

            {showAvail && (
              <View style={[styles.avail, avail?.free ? styles.availFree : styles.availBusy]}>
                {checking ? <ActivityIndicator color={C.muted} size="small" /> : (
                  <>
                    <Ionicons name={avail?.free ? 'checkmark-circle' : 'alert-circle'} size={18} color={avail?.free ? '#1E7E4B' : '#B7791F'} />
                    <Text style={[styles.availText, { color: avail?.free ? '#1E7E4B' : '#B7791F' }]}>
                      {avail?.free
                        ? (avail?.hold ? 'Available — but there’s a tentative hold on this slot.' : 'This slot is available.')
                        : 'This slot is already booked or blocked for this date.'}
                    </Text>
                  </>
                )}
              </View>
            )}

            <Field label="Event type">
              <TextInput style={styles.input} placeholder="e.g. Wedding, Mehndi, Corporate" placeholderTextColor={C.muted} value={eventType} onChangeText={setEventType} />
            </Field>
            <Field label="Guests">
              <TextInput style={styles.input} placeholder="Number of guests" placeholderTextColor={C.muted} keyboardType="number-pad" value={guests} onChangeText={setGuests} />
            </Field>
          </Section>

          {/* Money */}
          <Section title="Money">
            <Field label="Total amount (Rs)">
              <TextInput style={styles.input} placeholder="0" placeholderTextColor={C.muted} keyboardType="number-pad" value={total} onChangeText={setTotal} />
            </Field>
            <Field label="Advance received (Rs)">
              <TextInput style={styles.input} placeholder="0" placeholderTextColor={C.muted} keyboardType="number-pad" value={advance} onChangeText={setAdvance} />
            </Field>
          </Section>

          <Section title="Notes">
            <TextInput style={[styles.input, styles.notes]} placeholder="Any requirements or notes" placeholderTextColor={C.muted} value={notes} onChangeText={setNotes} multiline />
          </Section>

          {/* Save */}
          <View style={styles.saveRow}>
            <TouchableOpacity style={[styles.saveBtn, styles.saveTentative]} disabled={saving} activeOpacity={0.85} onPress={() => save('tentative')}>
              <Text style={styles.saveTentativeText}>Save as tentative</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.saveBtn, styles.saveConfirm, (avail && !avail.free) && styles.saveDisabled]} disabled={saving || (!!avail && !avail.free)} activeOpacity={0.85} onPress={() => save('confirmed')}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveConfirmText}>Confirm booking</Text>}
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>Tentative holds the date softly; confirmed reserves the slot and blocks conflicts.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Header({ insets, onBack }) {
  return (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <TouchableOpacity onPress={onBack} hitSlop={10}><Ionicons name="arrow-back" size={24} color="#fff" /></TouchableOpacity>
      <Text style={styles.headerTitle}>New booking</Text>
      <View style={{ width: 24 }} />
    </View>
  );
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionH}>{title}</Text>
      <View style={{ gap: 12 }}>{children}</View>
    </View>
  );
}

function Field({ label, children }) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Chips({ items, value, onPick, empty }) {
  if (!items.length) return <Text style={styles.muted}>{empty}</Text>;
  return (
    <View style={styles.chips}>
      {items.map(([id, label]) => (
        <TouchableOpacity key={id} style={[styles.chip, value === id && styles.chipOn]} onPress={() => onPick(id)} activeOpacity={0.8}>
          <Text style={[styles.chipText, value === id && styles.chipTextOn]}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  muted: { color: C.muted, fontSize: 14, textAlign: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: C.primary, paddingHorizontal: 14, paddingBottom: 12 },
  headerTitle: { flex: 1, color: '#fff', fontSize: 17, fontWeight: '800', textAlign: 'center' },
  section: { backgroundColor: C.card, borderRadius: R.md, padding: 16, borderWidth: 1, borderColor: C.line },
  sectionH: { fontSize: 13, fontWeight: '800', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 },
  fieldLabel: { color: C.text, fontSize: 13.5, fontWeight: '700', marginBottom: 7 },
  input: { backgroundColor: C.paper, borderRadius: 12, minHeight: 50, paddingHorizontal: 15, paddingVertical: 12, color: C.text, fontSize: 16, borderWidth: 1, borderColor: C.line },
  notes: { minHeight: 80, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper },
  chipOn: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { color: C.text, fontWeight: '700', fontSize: 13.5 },
  chipTextOn: { color: '#fff' },
  avail: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, padding: 12, borderWidth: 1 },
  availFree: { backgroundColor: '#E6F4EA', borderColor: '#C3E6CE' },
  availBusy: { backgroundColor: '#FFF4E0', borderColor: '#F0DEB8' },
  availText: { flex: 1, fontSize: 13.5, fontWeight: '700' },
  saveRow: { flexDirection: 'row', gap: 10 },
  saveBtn: { flex: 1, height: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  saveTentative: { backgroundColor: C.paper, borderWidth: 1, borderColor: C.line },
  saveTentativeText: { color: C.text, fontWeight: '800', fontSize: 14.5 },
  saveConfirm: { backgroundColor: C.primary },
  saveConfirmText: { color: '#fff', fontWeight: '800', fontSize: 14.5 },
  saveDisabled: { backgroundColor: C.muted },
  hint: { color: C.muted, fontSize: 12.5, textAlign: 'center', lineHeight: 18, paddingHorizontal: 8 },
});
