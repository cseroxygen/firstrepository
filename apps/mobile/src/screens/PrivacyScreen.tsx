import React, { useState } from 'react'
import { ScrollView, Text, View, useColorScheme, Pressable, StyleSheet, Alert } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Linking from 'expo-linking'
import { useTranslation } from 'react-i18next'
import { Tokens } from '@/components/SettingsUI'
import { useDB } from '@/lib/db'
import { clearHistory } from '@/lib/history'
import { emit, EVENTS } from '@/lib/events'
import { ensureNamespace } from '@/lib/ns'
import { defaultApiBase } from '@/lib/config'

export const PRIVACY_URL = 'https://example.com/privacy'

export default function PrivacyScreen() {
  const light = useColorScheme() !== 'dark'
  const c = Tokens.color(light)
  const { t } = useTranslation()
  const db = useDB()
  const [clearing, setClearing] = useState(false)

  const handleClearData = () => {
    Alert.alert(
      'Delete all HomeRef data?',
      'This removes manuals, receipts, and preferences from this device and deletes the files stored for your current HomeRef account. This cannot be undone.',
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              setClearing(true)
              const fallbackBase = defaultApiBase()
              const base = (await AsyncStorage.getItem('api_base')) || fallbackBase
              const ns = (await AsyncStorage.getItem('namespace')) || ''
              if (ns) {
                const u = new URL(`${base}/manuals`)
                u.searchParams.set('namespace', ns)
                await fetch(u.toString(), { method: 'DELETE' })
              }
              await db.resetAll()
              await clearHistory()
              await AsyncStorage.removeItem('namespace')
              await AsyncStorage.removeItem('api_base')
              const freshNs = await ensureNamespace()
              try { await AsyncStorage.setItem('namespace', freshNs) } catch {}
              emit(EVENTS.dataCleared)
              Alert.alert('Data cleared', 'All local and cloud data for this account has been removed.')
            } catch (e:any) {
              Alert.alert('Reset failed', e?.message || String(e))
            } finally {
              setClearing(false)
            }
          },
        },
      ],
    )
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic">
      <View style={styles.pageHeading}>
        <Text style={[styles.body, { color: c.secondary }]}>We built HomeRef so you always know where your information lives. Here’s a quick overview of how your data is handled and the controls you have.</Text>
      </View>

      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}> 
        <Text style={[styles.cardTitle, { color: c.text }]}>Your information stays private</Text>
        <Text style={[styles.body, { color: c.secondary }]}>Manuals, photos, and notes sync only with your HomeRef account. We never sell personal data and we don’t ingest your content for advertising.</Text>
      </View>

      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}> 
        <Text style={[styles.cardTitle, { color: c.text }]}>You’re in control</Text>
        <Text style={[styles.body, { color: c.secondary }]}>You can export or remove your content at any time. If you change devices, signing in with the same account is all it takes to bring your library back.</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => Linking.openURL(PRIVACY_URL)}
        style={[styles.linkButton, { borderColor: c.border }]}
      >
        <Text style={[styles.linkButtonText, { color: c.text }]}>Read the full privacy policy</Text>
      </Pressable>

      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}> 
        <Text style={[styles.cardTitle, { color: c.text }]}>Need a fresh start?</Text>
        <Text style={[styles.body, { color: c.secondary }]}>Use the button below to erase your HomeRef data everywhere. We recommend exporting anything you want to keep first.</Text>
        <Pressable
          accessibilityRole="button"
          disabled={clearing}
          onPress={handleClearData}
          style={[styles.destructiveButton, clearing && styles.destructiveButtonDisabled]}
        >
          <Text style={styles.destructiveButtonText}>{clearing ? 'Clearing…' : 'Clear all my data'}</Text>
        </Pressable>
      </View>

      <View style={{ height: 32 }} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  pageHeading: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 12 },
  body: { fontSize: 15, lineHeight: 22 },
  card: { marginHorizontal: 20, marginTop: 16, borderRadius: 18, borderWidth: 1, padding: 20, gap: 12 },
  cardTitle: { fontSize: 18, fontWeight: '600' },
  linkButton: { marginHorizontal: 20, marginTop: 20, borderRadius: 14, borderWidth: 1, paddingHorizontal: 20, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  linkButtonText: { fontSize: 15, fontWeight: '600' },
  destructiveButton: { marginTop: 12, borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#DC2626' },
  destructiveButtonDisabled: { opacity: 0.6 },
  destructiveButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
})
