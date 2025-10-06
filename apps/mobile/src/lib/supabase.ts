import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import Constants from 'expo-constants'

let client: SupabaseClient | null = null

export async function ensureSupabase(url?: string, anon?: string) {
  // Priority: explicit args -> AsyncStorage -> app config extras
  const extras = (Constants?.expoConfig as any)?.extra || {}
  const sbUrl = url || (await AsyncStorage.getItem('supabase_url')) || extras.supabaseUrl
  const sbAnon = anon || (await AsyncStorage.getItem('supabase_anon')) || extras.supabaseAnon
  if (!sbUrl || !sbAnon) throw new Error('Supabase not configured')
  if (!client) {
    client = createClient(sbUrl, sbAnon, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        storage: AsyncStorage as any,
        detectSessionInUrl: false,
      },
    })
  }
  return client
}

export { client as supabaseClient }

export function resetSupabase() { client = null }

