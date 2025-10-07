import React, { useEffect, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { signInWithGoogle, signInWithApple, signInEmail, getSession } from '@/lib/auth'
import { ensureSupabase } from '@/lib/supabase'
import AsyncStorage from '@react-native-async-storage/async-storage'

export default function AuthScreen() {
  const r = useRouter()
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // On mount, if session exists navigate; also subscribe to auth state changes so once email confirmed (signup flow) we auto-forward.
  useEffect(()=>{
    let unsub: any
    const handleSession = async (session: any | null | undefined) => {
      if (!session) return
      try {
        const pending = await AsyncStorage.getItem('pending_recovery')
        if (pending) {
          r.replace('/update-password')
          return
        }
      } catch {}
      r.replace('/(tabs)')
    }

    (async()=>{
      const s = await getSession();
      await handleSession(s)
      const sb = await ensureSupabase()
      const { data: listener } = sb.auth.onAuthStateChange(async (_event, session)=>{
        if (session) {
          await handleSession(session)
        }
      })
      unsub = listener.subscription.unsubscribe
    })()
    return ()=>{ try { unsub && unsub() } catch {} }
  },[])

  type Mode = 'signin' | 'oauth'
  const run = async (fn: ()=>Promise<void>, mode: Mode) => {
    setBusy(true); setErr(null); setInfo(null)
    try {
      await fn();
      // After attempting auth, explicitly verify a session exists before navigating.
      const sess = await getSession();
      if (!sess) {
        setInfo('No active session yet. Verify your credentials or reset your password.');
        return; // Do not navigate without an active session.
      }
      r.replace('/(tabs)')
    } catch(e:any) {
      const msg = e?.message || String(e)
      // Existing user detection (Supabase common message patterns)
      if (/already registered|User already registered|User already exists/i.test(msg) && email) {
        setInfo('An account with this email already exists. Sign in instead or set a password via “Forgot password”. If you previously used Google/Apple, sign in with that provider; data is unified by email.')
      } else if (/Invalid login credentials/i.test(msg)) {
        setInfo('Invalid credentials. If you created this account through Google or Apple, use that provider or reset your password.')
      } else if (/Email not confirmed/i.test(msg)) {
        setInfo('Email not confirmed yet. Please confirm via the link sent to your inbox.')
      } else {
        setErr(msg)
      }
    } finally { setBusy(false) }
  }

  return (
    <SafeAreaView style={s.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.flex}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.header}>
            <Text style={s.brand}>HomeRef</Text>
            <Text style={s.subtitle}>Keep manuals, receipts, and projects organized for your home.</Text>
          </View>

          <View style={s.card}>
            <View style={s.cardHeader}>
              <Text style={s.cardTitle}>Welcome back</Text>
              <Text style={s.cardSubtitle}>Sign in to continue using HomeRef.</Text>
            </View>

            {!!err && <Text style={s.error}>{err}</Text>}
            {!!info && <Text style={s.info}>{info}</Text>}

            <Pressable
              disabled={busy}
              style={({ pressed }) => [
                s.providerBtn,
                s.providerGoogle,
                pressed && !busy ? s.buttonPressed : null,
                busy ? s.buttonDisabled : null,
              ]}
              onPress={() => run(() => signInWithGoogle(true), 'oauth')}
            >
              <Text style={s.providerBtnTxt}>Continue with Google</Text>
            </Pressable>

            <Pressable
              disabled={busy}
              style={({ pressed }) => [
                s.providerBtn,
                s.providerApple,
                pressed && !busy ? s.buttonPressed : null,
                busy ? s.buttonDisabled : null,
              ]}
              onPress={() => run(signInWithApple, 'oauth')}
            >
              <Text style={s.providerBtnTxt}>Continue with Apple</Text>
            </Pressable>

            <View style={s.divider}>
              <View style={s.dividerLine} />
              <Text style={s.dividerLabel}>or use email</Text>
              <View style={s.dividerLine} />
            </View>

            <View style={s.field}>
              <Text style={s.label}>Email</Text>
              <TextInput
                placeholder="you@example.com"
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                style={s.input}
                placeholderTextColor="#94A3B8"
              />
            </View>

            <View style={s.field}>
              <Text style={s.label}>Password</Text>
              <TextInput
                placeholder="••••••••"
                secureTextEntry
                value={pw}
                onChangeText={setPw}
                style={s.input}
                placeholderTextColor="#94A3B8"
              />
            </View>

            <Pressable
              disabled={busy || !email || !pw}
              style={({ pressed }) => [
                s.primaryBtn,
                pressed && !(busy || !email || !pw) ? s.buttonPressed : null,
                busy || !email || !pw ? s.buttonDisabled : null,
              ]}
              onPress={() => run(() => signInEmail(email.trim(), pw), 'signin')}
            >
              <Text style={s.primaryBtnTxt}>Sign in</Text>
            </Pressable>

            <View style={s.linksRow}>
              <Pressable disabled={busy} onPress={() => r.push('/register')} accessibilityRole="button" style={s.linkBtn}>
                <Text style={s.linkText}>Create account</Text>
              </Pressable>
              <Pressable disabled={busy} onPress={() => r.push('/reset-password')} accessibilityRole="button" style={s.linkBtn}>
                <Text style={s.linkText}>Forgot password?</Text>
              </Pressable>
            </View>

            {busy && (
              <View style={s.busyRow}>
                <ActivityIndicator color="#0A84FF" />
                <Text style={s.busyText}>Working on it…</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
const s = StyleSheet.create({
  safeArea: { flex:1, backgroundColor:'#0B1220' },
  flex: { flex:1 },
  scroll: { flexGrow:1, padding:24, paddingBottom:40 },
  header: { marginBottom:24 },
  brand: { fontSize:32, fontWeight:'800', color:'#fff', letterSpacing:0.3 },
  subtitle: { color:'rgba(255,255,255,0.78)', fontSize:15, lineHeight:22, marginTop:8 },
  card: {
    backgroundColor:'#fff',
    borderRadius:24,
    padding:24,
    gap:16,
    shadowColor:'#0B1220',
    shadowOpacity:0.16,
    shadowOffset:{ width:0, height:14 },
    shadowRadius:28,
    elevation:8,
  },
  cardHeader: { gap:4 },
  cardTitle: { fontSize:24, fontWeight:'700', color:'#111827' },
  cardSubtitle: { fontSize:15, color:'#6B7280' },
  error: { color:'crimson', fontSize:14, lineHeight:20 },
  info: { color:'#4B5563', fontSize:14, lineHeight:20 },
  providerBtn: { borderRadius:14, paddingVertical:14, alignItems:'center', justifyContent:'center' },
  providerGoogle: { backgroundColor:'#EA4335' },
  providerApple: { backgroundColor:'#111827' },
  providerBtnTxt: { color:'#fff', fontWeight:'600', fontSize:16 },
  buttonPressed: { opacity:0.85 },
  buttonDisabled: { opacity:0.6 },
  divider: { flexDirection:'row', alignItems:'center', gap:12 },
  dividerLine: { flex:1, height:1, backgroundColor:'#E5E7EB' },
  dividerLabel: { fontSize:12, letterSpacing:1, textTransform:'uppercase', color:'#9CA3AF', fontWeight:'600' },
  field: { gap:6 },
  label: { fontSize:13, color:'#64748B', fontWeight:'600' },
  input: {
    borderWidth:1,
    borderColor:'#D1D5DB',
    borderRadius:12,
    paddingHorizontal:14,
    paddingVertical:12,
    fontSize:16,
    backgroundColor:'#F9FAFB',
    color:'#111827',
  },
  primaryBtn: { backgroundColor:'#0A84FF', borderRadius:14, paddingVertical:14, alignItems:'center', justifyContent:'center' },
  primaryBtnTxt: { color:'#fff', fontWeight:'700', fontSize:16 },
  linksRow: { flexDirection:'row', justifyContent:'space-between', flexWrap:'wrap', marginTop:4 },
  linkBtn: { paddingVertical:8 },
  linkText: { color:'#0A84FF', fontWeight:'600' },
  busyRow: { flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8 },
  busyText: { color:'#4B5563', fontSize:13 },
})
