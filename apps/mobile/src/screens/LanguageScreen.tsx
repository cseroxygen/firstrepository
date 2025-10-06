import React, { useEffect, useState } from 'react'
import { View, Text, Pressable, useColorScheme, ScrollView } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { i18n } from '@/lib/i18n'
import { Tokens } from '@/components/SettingsUI'

// Use language autonyms (native names) so they stay consistent regardless of current UI language
const choices = [
  { key: 'en', label: 'English' },
  { key: 'de', label: 'Deutsch' },
  { key: 'fr', label: 'Français' },
  { key: 'es', label: 'Español' },
  { key: 'it', label: 'Italiano' },
  { key: 'pt', label: 'Português' },
  { key: 'nl', label: 'Nederlands' },
  { key: 'zh', label: '中文' },
]

export default function LanguageScreen() {
  const [val, setVal] = useState('en')
  const light = useColorScheme() !== 'dark'
  const c = Tokens.color(light)
  const insets = useSafeAreaInsets()

  useEffect(() => { (async () => {
    const stored = await AsyncStorage.getItem('settings.language')
    if (stored && stored !== 'system') setVal(stored)
    else setVal((i18n.language || 'en').slice(0,2))
  })() }, [])

  async function onSelect(k: string) {
    setVal(k)
    await AsyncStorage.setItem('settings.language', k)
    await i18n.changeLanguage(k)
  }

  // Reserve space for the large navigation header (~56-64) plus safe area
  // Increase offset to clear large navigation title fully
  const HEADER_OFFSET = 112
  const topPad = Math.max(HEADER_OFFSET, (insets.top || 0) + HEADER_OFFSET)
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ paddingTop: topPad, paddingBottom: 24 }}>
      {choices.map(ch => (
        <Pressable key={ch.key} onPress={() => onSelect(ch.key)} style={{ padding: 16, backgroundColor: c.card, marginHorizontal: 16, marginBottom: 8, borderRadius: 16 }}>
          <Text style={{ color: c.text, fontSize: 17 }}>{ch.label}</Text>
          {val === ch.key && <Text style={{ color: c.secondary }}>✓</Text>}
        </Pressable>
      ))}
    </ScrollView>
  )
}
