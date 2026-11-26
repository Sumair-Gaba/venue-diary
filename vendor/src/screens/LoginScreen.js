// Vendor login: phone + OTP (same owner auth as the web dashboard). On success
// the bearer token is stored and the app enters the dashboard. In dev the
// backend returns the code (devCode) so we can auto-hint it.
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { setToken } from '../store';
import { C } from '../theme';

export default function LoginScreen({ onDone }) {
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const insets = useSafeAreaInsets();

  const sendOtp = async () => {
    const p = phone.trim();
    if (!p) return setErr('Enter your phone number');
    setBusy(true); setErr('');
    try {
      const r = await api.requestOtp(p);
      if (r.ok) { setDevCode(r.data?.devCode || null); setStep('code'); }
      else setErr(r.data?.message || 'Could not send the code');
    } catch { setErr('Network error'); }
    finally { setBusy(false); }
  };

  const verify = async () => {
    const c = code.trim();
    if (!c) return setErr('Enter the code');
    setBusy(true); setErr('');
    try {
      const r = await api.verify(phone.trim(), c);
      if (r.ok && r.data?.token) { await setToken(r.data.token); onDone(); }
      else setErr(r.data?.message || 'Invalid or expired code');
    } catch { setErr('Network error'); }
    finally { setBusy(false); }
  };

  return (
    <LinearGradient colors={[C.primaryDark, C.primary]} style={styles.fill}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.wrap, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 30 }]}>
        <View style={styles.brandWrap}>
          <View style={styles.logo}><Ionicons name="business" size={28} color={C.gold} /></View>
          <Text style={styles.brand}>Venue Dekho</Text>
          <Text style={styles.partner}>PARTNER</Text>
          <Text style={styles.tag}>Manage your venue, leads & chats — on the go.</Text>
        </View>

        <View style={styles.card}>
          {step === 'phone' ? (
            <>
              <Text style={styles.label}>Your phone number</Text>
              <TextInput style={styles.input} placeholder="+92 3XX XXXXXXX" placeholderTextColor={C.muted} keyboardType="phone-pad" value={phone} onChangeText={setPhone} autoFocus />
              {!!err && <Text style={styles.err}>{err}</Text>}
              <TouchableOpacity style={styles.btn} onPress={sendOtp} disabled={busy} activeOpacity={0.85}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Send code</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.label}>Enter the 4-digit code</Text>
              <TextInput style={styles.input} placeholder="----" placeholderTextColor={C.muted} keyboardType="number-pad" maxLength={4} value={code} onChangeText={setCode} autoFocus />
              {!!devCode && <Text style={styles.dev}>Dev code: {devCode}</Text>}
              {!!err && <Text style={styles.err}>{err}</Text>}
              <TouchableOpacity style={styles.btn} onPress={verify} disabled={busy} activeOpacity={0.85}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Verify & sign in</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setStep('phone'); setErr(''); setCode(''); }} style={{ marginTop: 12 }}>
                <Text style={styles.back}>Change number</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  wrap: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 24 },
  brandWrap: { alignItems: 'center', gap: 6 },
  logo: { width: 64, height: 64, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  brand: { color: '#fff', fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  partner: { color: C.gold, fontSize: 13, fontWeight: '900', letterSpacing: 3 },
  tag: { color: 'rgba(255,255,255,0.85)', fontSize: 14.5, textAlign: 'center', marginTop: 10, lineHeight: 20, paddingHorizontal: 20 },
  card: { backgroundColor: '#fff', borderRadius: 22, padding: 20 },
  label: { color: C.text, fontSize: 14, fontWeight: '700', marginBottom: 10 },
  input: { backgroundColor: C.paper, borderRadius: 14, height: 54, paddingHorizontal: 16, color: C.text, fontSize: 18, borderWidth: 1, borderColor: C.line },
  dev: { color: C.gold, fontSize: 13, fontWeight: '700', marginTop: 10 },
  err: { color: '#C0392B', fontSize: 13, marginTop: 10 },
  btn: { backgroundColor: C.primary, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  back: { color: C.muted, fontSize: 13.5, textAlign: 'center', fontWeight: '600' },
});
