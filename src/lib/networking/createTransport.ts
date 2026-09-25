import { isSupabaseConfigured } from '@/lib/supabase/client'
import { LocalBroadcastTransport } from './LocalBroadcastTransport'
import { SupabaseRealtimeTransport } from './SupabaseRealtimeTransport'
import type { NetworkTransport } from './types'

/** Picks the best transport available in this deployment. */
export function createTransport(): NetworkTransport {
  return isSupabaseConfigured ? new SupabaseRealtimeTransport() : new LocalBroadcastTransport()
}

/** Six-character join code, unambiguous alphabet (no O/0, I/1). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateSessionCode(): string {
  let out = ''
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  for (const byte of bytes) out += CODE_ALPHABET[byte % CODE_ALPHABET.length]
  return out
}

export function normalizeSessionCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
}
