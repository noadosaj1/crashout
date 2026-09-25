import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * Supabase is optional: without credentials the game runs fully offline with
 * local persistence and same-device multiplayer. Only the anon key is ever
 * exposed here, and Row Level Security is what actually protects the data.
 */
export const isSupabaseConfigured = Boolean(url && anonKey)

let client: SupabaseClient<Database> | null = null

export function getSupabase(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured) return null
  client ??= createClient<Database>(url!, anonKey!, {
    auth: { persistSession: true, autoRefreshToken: true },
    realtime: { params: { eventsPerSecond: 30 } },
  })
  return client
}
