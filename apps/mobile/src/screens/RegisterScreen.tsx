import React, { useState } from 'react'
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet, SafeAreaView, ScrollView, KeyboardAvoidingView, Platform } from 'react-native'
import { useRouter } from 'expo-router'
import { signUpEmail, resendConfirmation, getSession } from '@/lib/auth'
import { ensureSupabase } from '@/lib/supabase'

export default function RegisterScreen() {
  const r = useRouter()
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true); setErr(null); setInfo(null)
    try {
      const target = email.trim()
      await signUpEmail(target, pw)
      setInfo(`We sent a confirmation link to ${target}. Check your inbox (and spam) then return to this app to continue.`)
    } catch(e:any){
      const msg = e?.message || String(e)
      if (/already registered|already exists/i.test(msg)) {
        setInfo('Account already exists. Sign in instead.')
      } else {
        setErr(msg)
      }
    } finally { setBusy(false) }
  }

  React.useEffect(()=>{ (async()=>{ const sess = await getSession(); if(sess){ r.replace('/(tabs)') } })() },[])
  React.useEffect(()=>{ let unsub:any; (async()=>{ const sb = await ensureSupabase(); const { data } = sb.auth.onAuthStateChange((_e,s)=>{ if(s){ r.replace('/(tabs)') } }); unsub = data.subscription.unsubscribe })(); return ()=>{ try{unsub&&unsub()}catch{} } },[])

  return (
    <SafeAreaView style={s.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.flex}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps='handled'>
          <View style={s.container}>
            <Text style={s.title}>Create account</Text>
            {!!err && <Text style={s.err}>{err}</Text>}
            {!!info && <Text style={s.info}>{info}</Text>}
            <TextInput placeholder='Email' autoCapitalize='none' keyboardType='email-address' value={email} onChangeText={setEmail} style={s.inp} />
            <TextInput placeholder='Password' secureTextEntry value={pw} onChangeText={setPw} style={s.inp} />
            <Pressable style={s.btnPrimary} disabled={busy || !email || !pw} onPress={submit}>
              <Text style={s.btnPrimaryTxt}>Register</Text>
            </Pressable>
            <View style={s.linksRow}>
              <Pressable disabled={busy || !email} onPress={async()=>{ if(!email){ return } try { setBusy(true); const target = email.trim(); await resendConfirmation(target); setInfo(`Confirmation email re-sent to ${target}.`); } catch(e:any){ setErr(e?.message||String(e)) } finally { setBusy(false) } }} style={s.linkBtn}>
                <Text style={s.link}>Resend confirmation</Text>
              </Pressable>
            </View>
            {busy && <ActivityIndicator />}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safeArea: { flex:1 },
  flex: { flex:1 },
  scroll: { flexGrow:1, padding:16, paddingBottom:32 },
  container: { flex:1, gap:12 },
  title: { fontSize:22, fontWeight:'600' },
  inp: { borderWidth:1, borderColor:'#E5E7EB', borderRadius:12, padding:12 },
  btnPrimary: { backgroundColor:'#0A84FF', borderWidth:1, borderColor:'#0A84FF', paddingVertical:12, paddingHorizontal:16, borderRadius:12, alignItems:'center', justifyContent:'center' },
  btnPrimaryTxt: { color:'#fff', fontWeight:'700' as const },
  link: { color:'#0A84FF' },
  err: { color:'crimson' },
  info: { color:'#6B7280' },
  linksRow: { flexDirection:'row', flexWrap:'wrap', justifyContent:'center' },
  linkBtn: { padding:8 },
})
