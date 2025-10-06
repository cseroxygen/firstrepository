import { Stack } from 'expo-router'
import { useEffect } from 'react'
import { initI18n } from '@/lib/i18n'

export default function RootLayout() {
  useEffect(() => { initI18n() }, [])
  return (
    <Stack screenOptions={{ headerShown: false }}>
  <Stack.Screen name="index" options={{ headerShown: false }} />
  <Stack.Screen name="auth" options={{ headerShown: true, title: 'Sign in' }} />
  <Stack.Screen name="register" options={{ headerShown: true, title: 'Create account' }} />
  <Stack.Screen name="reset-password" options={{ headerShown: true, title: 'Reset password' }} />
  <Stack.Screen name="auth-callback" options={{ headerShown: true, title: 'Signing in…' }} />
  <Stack.Screen name="update-password" options={{ headerShown: true, title: 'Update password' }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  )
}
