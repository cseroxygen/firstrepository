import Constants from 'expo-constants'

const extras = (Constants?.expoConfig as any)?.extra || {}

export function defaultApiBase() {
  return extras.apiBase || 'http://192.168.68.62:8000'
}
