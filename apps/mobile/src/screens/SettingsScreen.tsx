import React, { useCallback, useState } from 'react'
import { View, Text, useColorScheme, Alert, ScrollView } from 'react-native'
import { useRouter } from 'expo-router'
import { SectionHeader, SettingsRow, DestructiveRow, Tokens } from '@/components/SettingsUI'
import { i18n } from '@/lib/i18n'
import { requestReview } from '@/lib/review'
import { logout, getSession } from '@/lib/auth'
import { useTranslation } from 'react-i18next'

export default function SettingsScreen() {
  const light = useColorScheme() !== 'dark'
  const c = Tokens.color(light)
  const r = useRouter()
  const { t } = useTranslation()
  const [loggedIn, setLoggedIn] = useState(false)
  const [userEmail, setUserEmail] = useState<string>('')
  React.useEffect(()=>{ (async()=>{ const s = await getSession(); setLoggedIn(!!s); setUserEmail(s?.user?.email || '') })() },[])

  const onReview = useCallback(async () => {
    const ok = await requestReview('0.1.0')
    if (ok) Alert.alert(t('toast.thanksForRating'))
  }, [t])

  const langMap: Record<string,string> = { en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano', pt: 'Português', nl: 'Nederlands', zh: '中文' }
  const currentLang = langMap[(i18n.language || 'en').slice(0,2)] || 'English'

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentInsetAdjustmentBehavior="automatic">

      <SectionHeader title="Preferences" />
      <SettingsRow title={t('settings.language')} icon="globe-outline" iconColor="#0A84FF" trailing={<Text style={{ color: c.secondary }}>{currentLang}</Text>} onPress={() => r.push('(tabs)/settings/language')} />
      <SettingsRow title={t('settings.history')} icon="time-outline" onPress={() => r.push('(tabs)/settings/history')} />

  <SectionHeader title="App" />
      <SettingsRow title={t('settings.likeUs')} icon="star" iconColor="#FFCC00" chevron={true} onPress={onReview} />
      <SettingsRow title={t('settings.privacy')} icon="shield-checkmark-outline" onPress={() => r.push('(tabs)/settings/privacy')} />

      <SectionHeader title="Account" />
      {loggedIn ? (
        <>
          <SettingsRow title={userEmail || 'Account'} icon="person-circle-outline" onPress={undefined} chevron={false} />
          <DestructiveRow title={t('settings.logout')} icon="log-out-outline" onPress={() => {
            Alert.alert(t('settings.logout'), undefined, [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('common.confirm'), style: 'destructive', onPress: async () => { await logout(); setLoggedIn(false); setUserEmail(''); r.replace('/auth') } },
            ])
          }} />
        </>
      ) : (
        <SettingsRow title="Sign in" icon="person-circle-outline" onPress={() => r.push('/auth')} />
      )}
    </ScrollView>
  )
}
