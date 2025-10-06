import AsyncStorage from '@react-native-async-storage/async-storage'
import { getSession } from './auth'
import { wipeAllLocalData } from './db'
import { clearHistory } from './history'

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0, v = c == 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

/**
 * ensureNamespace
 * Returns a namespace that is unique per authenticated user. If a Supabase user
 * is logged in, we derive a stable namespace from their user id (first 16 chars)
 * and persist it. If the logged-in user changes compared to the last stored user,
 * we clear local cached DB + history so libraries don't leak across accounts.
 * For anonymous (not signed in) usage we fall back to a random uuid namespace
 * persisted for that anonymous session. Once a user signs in for the first time
 * we switch to the per-user namespace automatically.
 */
export async function ensureNamespace(): Promise<string> {
  // Current Supabase user id (if any)
  let userId: string | null = null
  try { const sess = await getSession(); userId = sess?.user?.id || null } catch {}
  const currentUserKey = userId || 'anonymous'

  const dataOwner = await AsyncStorage.getItem('data_user_id')
  const lastUser = await AsyncStorage.getItem('last_user_id')

  // If data owner differs from current user, wipe all local persisted domain data
  if (dataOwner && dataOwner !== currentUserKey) {
    try { await wipeAllLocalData() } catch {}
    try { await clearHistory() } catch {}
    // Remove legacy generic namespace so a fresh one (or user specific) is generated
    try { await AsyncStorage.removeItem('namespace') } catch {}
  }

  // Persist last seen user id for audit/diff (do not remove on logout so we can detect switches)
  if (lastUser !== currentUserKey) {
    try { await AsyncStorage.setItem('last_user_id', currentUserKey) } catch {}
  }

  // Choose key for namespace storage – per-user for signed-in, generic for anonymous
  const nsKey = userId ? `namespace:user:${userId}` : 'namespace:anon'
  let ns = await AsyncStorage.getItem(nsKey)
  if (!ns) {
    ns = userId ? (`u_${userId.replace(/[^a-z0-9]/gi,'').slice(0,16)}` || uuid()) : uuid()
    await AsyncStorage.setItem(nsKey, ns)
  }
  // Convenience pointer used by existing API calls
  try { await AsyncStorage.setItem('namespace', ns) } catch {}
  // Record current user as data owner
  if (dataOwner !== currentUserKey) {
    try { await AsyncStorage.setItem('data_user_id', currentUserKey) } catch {}
  }
  return ns
}


