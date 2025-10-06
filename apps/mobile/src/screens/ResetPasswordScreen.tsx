import React, { useState } from 'react'
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { resetPassword } from '@/lib/auth'

export default function ResetPasswordScreen() {
  const r = useRouter()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true); setErr(null); setMsg(null)
    try {
      await resetPassword(email.trim())
      setMsg('If an account exists, a reset email was sent.')
    } catch (e:any) {
      setErr(e?.message || String(e))
    } finally { setBusy(false) }
  }

  return (
    <View style={s.container}>
      <Text style={{ fontSize:22, fontWeight:'600' }}>Reset password</Text>
      {!!err && <Text style={{ color:'crimson' }}>{err}</Text>}
      {!!msg && <Text style={{ color:'#06661a' }}>{msg}</Text>}
      <TextInput placeholder="Email" autoCapitalize='none' keyboardType='email-address' value={email} onChangeText={setEmail} style={s.inp} />
      <Pressable style={s.btnPrimary} disabled={busy || !email} onPress={submit}>
        <Text style={s.btnPrimaryTxt}>Send reset email</Text>
      </Pressable>
      {busy && <ActivityIndicator />}
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex:1, padding:16, gap:12 },
  inp: { borderWidth:1, borderColor:'#E5E7EB', borderRadius:12, padding:12 },
  btnPrimary: { backgroundColor:'#0A84FF', borderWidth:1, borderColor:'#0A84FF', paddingVertical:12, paddingHorizontal:16, borderRadius:12, alignItems:'center', justifyContent:'center' },
  btnPrimaryTxt: { color:'#fff', fontWeight:'700' as const },
})
