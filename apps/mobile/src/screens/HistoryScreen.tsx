import React, { useEffect, useState } from 'react'
import { View, Text, ScrollView, Pressable, ActionSheetIOS, useColorScheme, Alert, RefreshControl, ActivityIndicator } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { getHistory, deleteHistory, clearHistory } from '@/lib/history'
import { Tokens } from '@/components/SettingsUI'
import { Ionicons } from '@expo/vector-icons'
import { listen, EVENTS } from '@/lib/events'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ensureNamespace } from '@/lib/ns'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { defaultApiBase } from '@/lib/config'

export default function HistoryScreen() {
  const [items, setItems] = useState<any[]>([])
  const [clearing, setClearing] = useState(false)
  const light = useColorScheme() !== 'dark'
  const c = Tokens.color(light)
  const insets = useSafeAreaInsets()

  async function load() {
    const all = await getHistory(100)
    setItems(all)
  }

  const [refreshing, setRefreshing] = useState(false)
  useEffect(() => { load() }, [])

  useEffect(() => {
    const unsubscribe = listen(EVENTS.dataCleared, async () => {
      setItems([])
    })
    return unsubscribe
  }, [])

  const clearEverywhere = async () => {
    if (clearing) return
    Alert.alert('Clear history?', 'Deletes your recent questions from this device and requests removal for the current account on the server.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setClearing(true)
          try {
            await clearHistory()
            try {
              const fallbackBase = defaultApiBase()
              const base = (await AsyncStorage.getItem('api_base')) || fallbackBase
              const ns = await ensureNamespace()
              const url = new URL(`${base}/history`)
              if (ns) url.searchParams.set('namespace', ns)
              await fetch(url.toString(), { method: 'DELETE' })
            } catch {}
            await load()
          } catch (e:any) {
            Alert.alert('Clear failed', e?.message || String(e))
          } finally {
            setClearing(false)
          }
        },
      },
    ])
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingTop: (insets.top || 0) + 120, paddingBottom: 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async ()=>{ setRefreshing(true); await load(); setRefreshing(false) }} /> }
    >
      <View style={{ marginHorizontal:16, marginBottom:16 }}>
        <Pressable
          accessibilityRole="button"
          onPress={clearEverywhere}
          disabled={clearing}
          style={{
            borderRadius:16,
            borderWidth:1,
            borderColor:'#E5E7EB',
            paddingVertical:12,
            paddingHorizontal:16,
            backgroundColor:'#ffffff',
            flexDirection:'row',
            alignItems:'center',
            justifyContent:'center',
            gap:8,
            opacity: clearing ? 0.6 : 1,
          }}
        >
          {clearing ? (
            <>
              <ActivityIndicator size="small" color="#DC2626" />
              <Text style={{ color:'#DC2626', fontWeight:'600' }}>Clearing…</Text>
            </>
          ) : (
            <>
              <Ionicons name="trash-outline" size={18} color="#DC2626" />
              <Text style={{ color:'#DC2626', fontWeight:'600' }}>Clear history</Text>
            </>
          )}
        </Pressable>
      </View>
      {items.map(it => (
        <Pressable
          key={it.id}
          onPress={() => ActionSheetIOS.showActionSheetWithOptions({ options: ['Copy title','Delete','Cancel'], destructiveButtonIndex:1, cancelButtonIndex:2 }, async (i)=>{
            if(i===0){
              try {
                await Clipboard.setStringAsync(String(it.title || ''))
                Alert.alert('Copied', 'Title copied to clipboard.')
              } catch (e:any) {
                Alert.alert('Copy failed', e?.message || 'Unable to copy to clipboard.')
              }
            }
            if(i===1){ await deleteHistory(it.id); load() }
          })}
          style={{ backgroundColor:c.card, marginHorizontal:16, marginBottom:8, borderRadius:16, padding:14, flexDirection:'row', alignItems:'center', gap:12 }}
        >
          <Ionicons name={it.type==='query'?'chatbubble-ellipses-outline':'document-text-outline'} size={20} color={c.secondary} />
          <View style={{ flex:1 }}>
            <Text style={{ color: c.text, fontSize: 17 }} numberOfLines={1}>{it.title}</Text>
            <Text style={{ color: c.secondary, fontSize: 13 }}>{new Date(it.created_at).toLocaleString()}</Text>
          </View>
        </Pressable>
      ))}
      {items.length===0 && <Text style={{ color:c.secondary, margin:16 }}>Nothing yet</Text>}
    </ScrollView>
  )
}
