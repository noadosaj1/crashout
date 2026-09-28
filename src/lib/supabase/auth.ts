import type { Session, User } from '@supabase/supabase-js'
import { getSupabase, isSupabaseConfigured } from './client'

export interface AuthState {
  user: User | null
  session: Session | null
}

export async function getCurrentSession(): Promise<AuthState> {
  const supabase = getSupabase()
  if (!supabase) return { user: null, session: null }
  const { data } = await supabase.auth.getSession()
  return { user: data.session?.user ?? null, session: data.session }
}

export function onAuthChange(handler: (state: AuthState) => void): () => void {
  const supabase = getSupabase()
  if (!supabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    handler({ user: session?.user ?? null, session })
  })
  return () => data.subscription.unsubscribe()
}

/**
 * Creates an account.
 *
 * Returns false when the project has email confirmation switched on, which is
 * Supabase's default: the call succeeds, but no session comes back until the
 * link in the email is clicked. Without this the sign-up form just stops, with
 * no error and no session, and looks broken.
 */
export async function signUp(email: string, password: string, username: string): Promise<boolean> {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // Read by the handle_new_user trigger to seed the profile row.
    options: { data: { username } },
  })
  if (error) throw error
  return data.session !== null
}

export async function signIn(email: string, password: string): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signOut(): Promise<void> {
  await getSupabase()?.auth.signOut()
}

export { isSupabaseConfigured }
