import Constants from 'expo-constants'

const extras = (Constants?.expoConfig as any)?.extra || {}

export function defaultApiBase() {
  return extras.apiBase || 'http://46.101.240.53:8000'
}
