import Constants from 'expo-constants'

const extras = (Constants?.expoConfig as any)?.extra || {}

export function defaultApiBase() {
  return extras.apiBase || 'https://api.homeref.online'
}
