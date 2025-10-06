import * as StoreReview from 'expo-store-review'
import * as Linking from 'expo-linking'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'

export const APP_STORE_URL = 'https://apps.apple.com/app/id0000000000'

export async function requestReview(appVersion: string): Promise<boolean> {
  const key = `rated:${appVersion}`
  const done = await AsyncStorage.getItem(key)
  if (done) return false
  let ok = false
  if (await StoreReview.isAvailableAsync()) {
    try {
      await StoreReview.requestReview()
      ok = true
    } catch {
      ok = false
    }
  }
  if (!ok) {
    try { await Linking.openURL(APP_STORE_URL) } catch {}
    ok = true
  }
  if (ok) await AsyncStorage.setItem(key, '1')
  return ok
}

