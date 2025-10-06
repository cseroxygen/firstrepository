import { Tabs } from 'expo-router'
import { useEffect, useState } from 'react'
import { i18n } from '@/lib/i18n'
import { Ionicons } from '@expo/vector-icons'

export default function TabsLayout() {
  const [lng, setLng] = useState(i18n.language)
  // Subscribe to language changes so tab labels update
  useEffect(() => {
    const handler = (l: string) => setLng(l)
    // @ts-ignore
    i18n.on && i18n.on('languageChanged', handler)
    return () => { /* @ts-ignore */ i18n.off && i18n.off('languageChanged', handler) }
  }, [])
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: '#0A84FF',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: String(i18n.t('tabs.chat')),
          tabBarIcon: ({ color, focused, size }) => (
            <Ionicons name={focused ? 'chatbubble' : 'chatbubble-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: String(i18n.t('tabs.library')),
          tabBarIcon: ({ color, focused, size }) => (
            <Ionicons name={focused ? 'albums' : 'albums-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: String(i18n.t('tabs.settings')),
          headerShown: false,
          tabBarIcon: ({ color, focused, size }) => (
            <Ionicons name={focused ? 'settings' : 'settings-outline'} color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  )
}
