import { Stack } from 'expo-router'

export default function SettingsStack() {
  return (
    <Stack screenOptions={{ headerShown: true, headerLargeTitle: true }}>
      <Stack.Screen name="index" options={{ title: 'Settings' }} />
      <Stack.Screen name="language" options={{ title: 'Language' }} />
      <Stack.Screen name="history" options={{ title: 'History' }} />
      <Stack.Screen name="privacy" options={{ title: 'Data privacy' }} />
    </Stack>
  )
}
