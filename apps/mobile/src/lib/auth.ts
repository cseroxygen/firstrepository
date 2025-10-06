import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Linking from 'expo-linking'
import Constants from 'expo-constants'
import * as WebBrowser from 'expo-web-browser'
import { ensureSupabase } from './supabase'

// Resolve the auth callback target dynamically so it works in dev builds (Expo Go) and production binaries.
const getAuthRedirect = () => {
  const candidate = Linking.createURL('auth-callback')
  if (!candidate.startsWith('http')) {
    return candidate
  }
  const expoConfig = Constants?.expoConfig as any
  const explicitScheme = expoConfig?.scheme || expoConfig?.ios?.scheme || expoConfig?.android?.scheme
  const scheme = explicitScheme || 'homeref'
  return `${scheme}://auth-callback`
}

const appendQueryParam = (base: string, key: string, value: string) => {
  try {
    const url = new URL(base)
    url.searchParams.set(key, value)
    return url.toString()
  } catch {
    const sep = base.includes('?') ? '&' : '?'
    return `${base}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`
  }
}

export async function getSession() {
  try {
    const sb = await ensureSupabase()
    const { data } = await sb.auth.getSession()
    return data.session || null
  } catch { return null }
}

export async function signInWithGoogle(forceSelect: boolean = true) {
  const sb = await ensureSupabase()
  if (forceSelect) {
    try { await sb.auth.signOut() } catch {}
  }
  const redirectTo = getAuthRedirect()
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      // Force account chooser every time
      queryParams: { prompt: 'select_account', access_type: 'offline' },
    },
  })
  if (error) throw error
  if (!data?.url) throw new Error('No OAuth URL returned')
  // Open auth session; Supabase will redirect to our scheme including code or tokens
  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
  if (res.type === 'dismiss') throw new Error('Sign-in canceled')
  if (res.type === 'success' && res.url) {
    try {
      // Some providers return query (?code=) others fragment (#access_token=...&refresh_token=...)
      const raw = res.url
      const [base, hash] = raw.split('#')
      const u = new URL(base)
      const qp = u.searchParams
      const fp = hash ? new URLSearchParams(hash) : null
      const code = qp.get('code') || fp?.get('code')
      const access_token = qp.get('access_token') || fp?.get('access_token')
      const refresh_token = qp.get('refresh_token') || fp?.get('refresh_token')
      if (code) {
        const { error: exErr } = await sb.auth.exchangeCodeForSession(code)
        if (exErr) throw exErr
        return
      }
      if (access_token && refresh_token) {
        const { error: setErr } = await sb.auth.setSession({ access_token, refresh_token })
        if (setErr) throw setErr
        return
      }
      // As a fallback, check if session already established (some native flows auto-complete)
      const { data: sess } = await sb.auth.getSession()
      if (!sess.session) throw new Error('OAuth redirect missing credentials')
    } catch (e) {
      throw e
    }
  }
}

export async function signInWithApple() {
  // Lazy-load to avoid bundling errors before native module is installed/linked
  let AppleAuthentication: any
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    AppleAuthentication = require('expo-apple-authentication')
  } catch {
    throw new Error('Apple Sign-In module not installed')
  }
  const available = await AppleAuthentication.isAvailableAsync()
  if (!available) throw new Error('Apple Sign-In not available on this device')
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
  })
  if (!credential.identityToken) throw new Error('No identity token')
  const sb = await ensureSupabase()
  const { error } = await sb.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken })
  if (error) throw error
}

export async function signUpEmail(email: string, password: string) {
  const sb = await ensureSupabase()
  const redirectTo = getAuthRedirect()
  const redirectWithEmail = appendQueryParam(redirectTo, 'email', email)
  try { await AsyncStorage.setItem('last_signup_email', email) } catch {}
  const { error } = await sb.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: redirectWithEmail },
  })
  if (error) throw error
}

export async function signInEmail(email: string, password: string) {
  const sb = await ensureSupabase()
  const { error } = await sb.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function logout(): Promise<void> {
  try {
    const sb = await ensureSupabase()
    await sb.auth.signOut()
  } catch {}
  await AsyncStorage.removeItem('auth.token')
  try { await AsyncStorage.removeItem('last_user_id') } catch {}
}

export async function resetPassword(email: string) {
  const sb = await ensureSupabase()
  const redirectTo = getAuthRedirect()
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo,
  })
  if (error) throw error
}

export async function resendConfirmation(email: string) {
  const sb = await ensureSupabase()
  const redirectTo = getAuthRedirect()
  const redirectWithEmail = appendQueryParam(redirectTo, 'email', email)
  try { await AsyncStorage.setItem('last_signup_email', email) } catch {}
  const { error } = await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectWithEmail } }) as any
  if (error) throw error
}

export async function getAuthProfile() {
  try {
    const sb = await ensureSupabase()
    const { data: userData } = await sb.auth.getUser()
    const user = userData.user
    if (!user) return { isOauthOnly: false, providers: [] as string[] }
    const providers = (user.identities || []).map((i:any)=> i.provider).filter(Boolean)
    const hasEmailProvider = providers.includes('email')
    return { isOauthOnly: !hasEmailProvider, providers }
  } catch {
    return { isOauthOnly: false, providers: [] as string[] }
  }
}

export async function addPassword(newPassword: string) {
  const sb = await ensureSupabase()
  const { error } = await sb.auth.updateUser({ password: newPassword })
  if (error) throw error
}
