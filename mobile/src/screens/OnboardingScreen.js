// First-launch welcome: capture the visitor's name (stored locally, no password)
// so the home screen can greet them. A clean, branded intro.
import { useState } from 'react';
import { ImageBackground, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { setUser } from '../store';
import { C } from '../theme';

export default function OnboardingScreen({ onDone }) {
  const [name, setName] = useState('');
  const go = async () => {
    const n = name.trim();
    await setUser({ name: n || 'Guest', city: 'Karachi' });
    onDone();
  };
  return (
    <ImageBackground
      source={{ uri: 'https://images.unsplash.com/photo-1519741497674-611481863552?w=1200&q=80' }}
      style={styles.bg}
    >
      <LinearGradient colors={['rgba(20,8,16,0.35)', 'rgba(20,8,16,0.85)', '#140810']} style={StyleSheet.absoluteFill} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
        <View style={styles.top}>
          <View style={styles.logo}><Ionicons name="sparkles" size={26} color={C.gold} /></View>
          <Text style={styles.brand}>Venue<Text style={{ color: C.gold }}>Diary</Text></Text>
        </View>
        <View style={styles.bottom}>
          <Text style={styles.h1}>Find Karachi's finest{'\n'}wedding venues</Text>
          <Text style={styles.sub}>Browse 1000+ banquets, marquees & lawns. Watch venue reels, compare and enquire — all in one place.</Text>
          <Text style={styles.label}>What should we call you?</Text>
          <TextInput
            style={styles.input}
            placeholder="Your name"
            placeholderTextColor="rgba(255,255,255,0.5)"
            value={name}
            onChangeText={setName}
            returnKeyType="go"
            onSubmitEditing={go}
          />
          <TouchableOpacity style={styles.btn} onPress={go} activeOpacity={0.9}>
            <Text style={styles.btnText}>Get started</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#140810' },
  wrap: { flex: 1, justifyContent: 'space-between', padding: 26, paddingTop: 70, paddingBottom: 44 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  brand: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  bottom: {},
  h1: { color: '#fff', fontSize: 34, fontWeight: '800', letterSpacing: -0.8, lineHeight: 40 },
  sub: { color: 'rgba(255,255,255,0.78)', fontSize: 15, lineHeight: 22, marginTop: 14 },
  label: { color: 'rgba(255,255,255,0.9)', fontSize: 13.5, fontWeight: '600', marginTop: 28, marginBottom: 8 },
  input: { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 14, height: 54, paddingHorizontal: 18, color: '#fff', fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, height: 54, borderRadius: 14, marginTop: 16 },
  btnText: { color: '#fff', fontSize: 16.5, fontWeight: '700' },
});
