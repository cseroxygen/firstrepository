import React, { useState } from 'react'
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { ensureSupabase } from '@/lib/supabase'

export default function UpdatePasswordScreen() {
  const r = useRouter()
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      const sb = await ensureSupabase()
      const { error } = await sb.auth.updateUser({ password: pw })
      if (error) throw error
      r.replace('/(tabs)')
    } catch (e:any) { setErr(e?.message || String(e)) } finally { setBusy(false) }
  }

  return (
    <View style={s.container}>
      <Text style={{ fontSize:22, fontWeight:'600' }}>Set new password</Text>
      {!!err && <Text style={{ color:'crimson' }}>{err}</Text>}
      <TextInput placeholder="New password" secureTextEntry value={pw} onChangeText={setPw} style={s.inp} />
      <Pressable style={s.btnPrimary} disabled={busy || !pw} onPress={submit}>
        <Text style={s.btnPrimaryTxt}>Update password</Text>
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
