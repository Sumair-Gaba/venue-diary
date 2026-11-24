// Budget calculator: estimate total event cost from guest count, a per-plate
// rate and optional extras (decor, misc). Pure client-side — no data needed.
// Produces a shareable summary for WhatsApp.
import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, R } from '../theme';

const fmt = (n) => 'Rs ' + Math.round(Number(n) || 0).toLocaleString('en-IN');

function Field({ label, value, onChange, prefix }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputWrap}>
        {!!prefix && <Text style={styles.prefix}>{prefix}</Text>}
        <TextInput style={styles.input} value={value} onChangeText={onChange} keyboardType="numeric" placeholder="0" placeholderTextColor={C.muted} />
      </View>
    </View>
  );
}

export default function BudgetScreen({ navigation }) {
  const [guests, setGuests] = useState('400');
  const [plate, setPlate] = useState('1500');
  const [decor, setDecor] = useState('');
  const [misc, setMisc] = useState('');
  const insets = useSafeAreaInsets();

  const g = Number(guests) || 0, p = Number(plate) || 0, d = Number(decor) || 0, mi = Number(misc) || 0;
  const food = g * p;
  const total = food + d + mi;
  const perHead = g ? total / g : 0;

  const share = () => {
    const t = `My event budget estimate (Venue Diary):\n• Guests: ${g}\n• Per plate: ${fmt(p)}\n• Food: ${fmt(food)}\n${d ? `• Decor: ${fmt(d)}\n` : ''}${mi ? `• Other: ${fmt(mi)}\n` : ''}• TOTAL: ${fmt(total)}\n• Per head: ${fmt(perHead)}`;
    Linking.openURL(`https://wa.me/?text=${encodeURIComponent(t)}`);
  };

  return (
    <View style={styles.fill}>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}><Ionicons name="chevron-back" size={22} color={C.text} /></TouchableOpacity>
        <Text style={styles.title}>Budget Calculator</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>
        <Field label="Number of guests" value={guests} onChange={setGuests} />
        <Field label="Per plate / per head" value={plate} onChange={setPlate} prefix="Rs" />
        <Field label="Decor & stage (optional)" value={decor} onChange={setDecor} prefix="Rs" />
        <Field label="Other charges (optional)" value={misc} onChange={setMisc} prefix="Rs" />

        <View style={styles.result}>
          <Row label={`Food (${g} × ${fmt(p)})`} value={fmt(food)} />
          {d > 0 && <Row label="Decor & stage" value={fmt(d)} />}
          {mi > 0 && <Row label="Other" value={fmt(mi)} />}
          <View style={styles.divider} />
          <Row label="Total estimate" value={fmt(total)} big />
          <Row label="Per head" value={fmt(perHead)} muted />
        </View>

        <TouchableOpacity style={styles.share} onPress={share} activeOpacity={0.85}>
          <Ionicons name="logo-whatsapp" size={18} color="#fff" />
          <Text style={styles.shareText}>Share estimate</Text>
        </TouchableOpacity>
        <Text style={styles.note}>An estimate to plan with — final pricing comes from the venue.</Text>
      </ScrollView>
    </View>
  );
}

function Row({ label, value, big, muted }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, muted && { color: C.muted }]}>{label}</Text>
      <Text style={[styles.rowValue, big && styles.rowBig, muted && { color: C.muted, fontWeight: '600' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
  back: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: C.text },
  field: { marginBottom: 14 },
  label: { color: C.text, fontWeight: '600', fontSize: 13.5, marginBottom: 7 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.paper, borderRadius: R.md, borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, height: 50 },
  prefix: { color: C.muted, fontWeight: '700', marginRight: 8 },
  input: { flex: 1, fontSize: 16, color: C.text },
  result: { backgroundColor: C.paper, borderRadius: R.lg, padding: 18, marginTop: 6, borderWidth: 1, borderColor: C.line },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  rowLabel: { color: C.text, fontSize: 14 },
  rowValue: { color: C.text, fontSize: 15, fontWeight: '700' },
  rowBig: { fontSize: 24, fontWeight: '800', color: C.primary },
  divider: { height: 1, backgroundColor: C.line, marginVertical: 8 },
  share: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.wa, height: 50, borderRadius: R.md, marginTop: 18 },
  shareText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  note: { color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 12 },
});
