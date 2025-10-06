import React, { useEffect, useRef, useState } from 'react'
import { View, ActivityIndicator, Text } from 'react-native'
import { useURL } from 'expo-linking'
import * as ExpoLinking from 'expo-linking'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ensureSupabase } from '@/lib/supabase'
import AsyncStorage from '@react-native-async-storage/async-storage'

type TokenField = 'code' | 'accessToken' | 'refreshToken' | 'otpToken' | 'type' | 'email'
type CallbackTokens = Partial<Record<TokenField, string>>
type AuthParamKey = 'code' | 'access_token' | 'refresh_token' | 'token' | 'type' | 'email'
type AuthParams = Partial<Record<AuthParamKey, string | string[]>>

const TOKEN_KEY_MAP: ReadonlyArray<[TokenField, AuthParamKey]> = [
  ['code', 'code'],
  ['accessToken', 'access_token'],
  ['refreshToken', 'refresh_token'],
  ['otpToken', 'token'],
  ['type', 'type'],
  ['email', 'email'],
]

export default function AuthCallback() {
  const params = useLocalSearchParams<AuthParams>()
  const urlFromHook = useURL()
  const [linkUrl, setLinkUrl] = useState<string | null>(urlFromHook ?? null)
  const url = linkUrl
  console.log('[auth-callback] component mounted', params, url)
  const r = useRouter()
  const [err, setErr] = useState<string | null>(null)
  const handledRef = useRef(false)

  useEffect(() => {
    if (handledRef.current) return

    console.log('[auth-callback] effect triggered', { params, url })

    let cancelled = false
    const run = async () => {
      try {
        const resolvedUrl = url ?? await ExpoLinking.getInitialURL()
        const tokens = extractAuthTokens(params, resolvedUrl)
        console.log('[auth-callback] incoming params', params, resolvedUrl)
        console.log('[auth-callback] resolved tokens', tokens)
        const sb = await ensureSupabase()

        if (!tokens) {
          if (!resolvedUrl) {
            return
          }
          handledRef.current = true
          const { data: sessionCheck } = await sb.auth.getSession()
          if (!cancelled) {
            if (sessionCheck.session) {
              r.replace('/(tabs)')
            } else {
              setErr('No auth credentials found in the callback. Re-open the link from HomeRef on this device.')
            }
          }
          return
        }

        handledRef.current = true

        const emailHint = tokens.email
          || toSingle(params.email)
          || extractEmail(resolvedUrl)
          || (typeof window !== 'undefined' ? extractEmail(window.location?.href) : undefined)
          || await AsyncStorage.getItem('last_signup_email')
          || undefined

        if (tokens.otpToken) {
          if (!emailHint) {
            throw new Error('Missing email context for verification. Open the confirmation link from the same device where you signed up or sign in with Google first.')
          }
          const { data: verifyData, error: verifyError } = await sb.auth.verifyOtp({ type: (tokens.type as any) || 'signup', email: emailHint, token: tokens.otpToken })
          if (verifyError) throw verifyError
          if (!verifyData.session) {
            const { data: sessionAfterVerify, error: sessionErr } = await sb.auth.getSession()
            if (sessionErr) throw sessionErr
            if (!sessionAfterVerify.session) throw new Error('Verification succeeded but no session was created. Try signing in manually.')
          }
        } else if (tokens.code) {
          const { error } = await sb.auth.exchangeCodeForSession(tokens.code)
          if (error) throw error
        } else if (tokens.accessToken) {
          const { error } = await sb.auth.setSession({
            access_token: tokens.accessToken,
            refresh_token: tokens.refreshToken ?? '',
          })
          if (error) {
            const { data: sessionAfterSet } = await sb.auth.getSession()
            if (!sessionAfterSet.session) throw error
          }
        } else {
          throw new Error('Auth callback missing credentials.')
        }

        const { data: sessionData, error: sessionError } = await sb.auth.getSession()
        if (sessionError) throw sessionError
        if (!sessionData.session) throw new Error('No active session after auth callback.')

        if (!cancelled) {
          if (tokens.type === 'recovery') {
            r.replace('/update-password')
          } else {
            r.replace('/(tabs)')
          }
        }
      } catch (e: any) {
        const msg = e?.message || String(e)
        console.error('[auth-callback] failed', msg, e)
        if (!cancelled) {
          setErr(msg)
        }
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [params, url, r])

  useEffect(() => {
    if (urlFromHook) {
      setLinkUrl(urlFromHook)
    }
  }, [urlFromHook])

  useEffect(() => {
    const subscription = ExpoLinking.addEventListener('url', (event) => {
      console.log('[auth-callback] event url', event.url)
      setLinkUrl(event.url)
    })
    return () => {
      subscription.remove()
    }
  }, [])

  return (
    <View style={{ flex:1, alignItems:'center', justifyContent:'center', padding:24 }}>
      <ActivityIndicator />
      {!!err && <Text style={{ color:'crimson', marginTop:12, textAlign:'center' }}>{err}</Text>}
    </View>
  )
}

function extractAuthTokens(params: AuthParams, urlFromHook?: string | null): CallbackTokens | null {
  const combined: CallbackTokens = {}
  mergeTokens(combined, tokensFromParams(params))
  mergeTokens(combined, tokensFromUrl(urlFromHook))
  if (typeof window !== 'undefined' && typeof window.location?.href === 'string') {
    mergeTokens(combined, tokensFromUrl(window.location.href))
  }

  if (combined.code || (combined.accessToken && combined.refreshToken) || combined.otpToken) {
    return combined
  }
  return null
}

function tokensFromParams(params: AuthParams): CallbackTokens {
  const result: CallbackTokens = {}
  TOKEN_KEY_MAP.forEach(([field, key]) => {
    const value = toSingle(params[key])
    if (value) {
      result[field] = value
    }
  })
  return result
}

function tokensFromUrl(rawUrl?: string | null): CallbackTokens {
  const result: CallbackTokens = {}
  if (!rawUrl) return result
  const [base, hash] = rawUrl.split('#')

  if (base) {
    try {
      const parsed = new URL(base)
      mergeSearchParams(result, parsed.searchParams)
      if (!result.email) {
        const email = parsed.searchParams.get('email')
        if (email) result.email = email
      }
    } catch {
      // Ignore invalid URLs (e.g., truncated links)
    }
  }

  if (hash) {
    const hashParams = new URLSearchParams(hash)
    mergeSearchParams(result, hashParams)
    if (!result.email) {
      const email = hashParams.get('email')
      if (email) result.email = email
    }
  }

  return result
}

function mergeSearchParams(target: CallbackTokens, params: URLSearchParams | null | undefined) {
  if (!params) return
  TOKEN_KEY_MAP.forEach(([field, key]) => {
    if (!target[field]) {
      const value = params.get(key)
      if (value) {
        target[field] = value
      }
    }
  })
}

function mergeTokens(target: CallbackTokens, source: CallbackTokens) {
  TOKEN_KEY_MAP.forEach(([field]) => {
    if (!target[field] && source[field]) {
      target[field] = source[field]
    }
  })
}

function toSingle(value?: string | string[] | null): string | undefined {
  if (!value) return undefined
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry) return entry
    }
    return undefined
  }
  return value
}

function hasCallbackParams(params: AuthParams): boolean {
  return TOKEN_KEY_MAP.some(([, key]) => {
    const value = params[key]
    if (Array.isArray(value)) {
      return value.some(Boolean)
    }
    return Boolean(value)
  })
}

function extractEmail(rawUrl?: string | null): string | undefined {
  if (!rawUrl) return undefined
  try {
    const parsed = new URL(rawUrl)
    const email = parsed.searchParams.get('email')
    if (email) return email
  } catch {}
  const hash = rawUrl.includes('#') ? rawUrl.split('#')[1] : undefined
  if (hash) {
    try {
      const params = new URLSearchParams(hash)
      const email = params.get('email')
      if (email) return email
    } catch {}
  }
  return undefined
}
