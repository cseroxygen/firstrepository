import { DeviceEventEmitter, EmitterSubscription } from 'react-native'

export const EVENTS = {
  dataCleared: 'homeref:data-cleared',
} as const

export type EventName = typeof EVENTS[keyof typeof EVENTS]

export function emit(event: EventName, payload?: unknown) {
  DeviceEventEmitter.emit(event, payload)
}

export function listen(event: EventName, handler: (payload?: unknown) => void): () => void {
  const sub: EmitterSubscription = DeviceEventEmitter.addListener(event, handler)
  return () => {
    try { sub.remove() } catch {}
  }
}

