import React, { useEffect, useState } from 'react'
import { Redirect } from 'expo-router'
import { getSession } from '@/lib/auth'

export default function Index() {
  const [ready, setReady] = useState(false)
  const [authed, setAuthed] = useState(false)
  useEffect(() => {
    (async () => {
      const s = await getSession()
      setAuthed(!!s)
      setReady(true)
    })()
  }, [])
  if (!ready) return null
  return <Redirect href={authed ? '/(tabs)' : '/auth'} />
}
