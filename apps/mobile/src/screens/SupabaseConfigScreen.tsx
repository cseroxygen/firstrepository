import React, { useEffect, useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { resetSupabase } from '@/lib/supabase'
import Constants from 'expo-constants'

export default function SupabaseConfigScreen() {
  const extras = (Constants?.expoConfig as any)?.extra || {}
  const [url, setUrl] = useState('')
  const [anon, setAnon] = useState('')
  useEffect(() => {
    (async () => {
      const a = (await AsyncStorage.getItem('supabase_anon')) || extras.supabaseAnon || ''
      const u = (await AsyncStorage.getItem('supabase_url')) || extras.supabaseUrl || ''
      setAnon(a); setUrl(u)
    })()
  }, [])
  return (
    <View style={s.container}>
      <Text style={s.title}>Supabase</Text>
      <TextInput placeholder="URL (https://xyz.supabase.co)" autoCapitalize='none' value={url} onChangeText={setUrl} style={s.inp} />
      <TextInput placeholder="Anon key" autoCapitalize='none' value={anon} onChangeText={setAnon} style={s.inp} />
      <Pressable style={s.btn} onPress={async()=>{
        await AsyncStorage.setItem('supabase_url', url.trim())
        await AsyncStorage.setItem('supabase_anon', anon.trim())
        resetSupabase()
        Alert.alert('Saved', 'Supabase configuration saved. Try sign-in again.')
      }}>
        <Text style={s.btnTxt}>Save</Text>
      </Pressable>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex:1, padding:16, gap:12 },
  title: { fontSize:22, fontWeight:'600' },
  inp: { borderWidth:1, borderColor:'#E5E7EB', borderRadius:12, padding:12 },
  btn: { backgroundColor:'#0A84FF', borderWidth:1, borderColor:'#0A84FF', paddingVertical:12, paddingHorizontal:16, borderRadius:12, alignItems:'center', justifyContent:'center' },
  btnTxt: { color:'#fff', fontWeight:'700' as const },
})
