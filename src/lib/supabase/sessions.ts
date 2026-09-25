import { getSupabase } from './client'

/**
 * Session directory.
 *
 * Gameplay does not depend on any of this: the join code names a Realtime
 * channel, and two players with the same code find each other whether or not a
 * row exists. These writes exist so a host's world is discoverable and so
 * joining a code nobody is hosting can be reported as such instead of dropping
 * the player into an empty city.
 *
 * Every call is therefore best-effort and never throws into the join path.
 */

export interface SessionRecord {
  id: string
  code: string
  hostId: string
}

export async function registerHostedSession(
  code: string,
  hostId: string,
): Promise<SessionRecord | null> {
  const supabase = getSupabase()
  if (!supabase) return null
  try {
    const { data, error } = await supabase
      .from('sessions')
      .insert({ code, host_id: hostId })
      .select('id, code, host_id')
      .single()
    if (error || !data) return null
    await supabase.from('session_members').insert({ session_id: data.id, player_id: hostId })
    return { id: data.id, code: data.code, hostId: data.host_id }
  } catch {
    return null
  }
}

/** Returns the open session for a code, or null if nobody is hosting it. */
export async function findOpenSession(code: string): Promise<SessionRecord | null> {
  const supabase = getSupabase()
  if (!supabase) return null
  try {
    const { data, error } = await supabase
      .from('sessions')
      .select('id, code, host_id')
      .eq('code', code)
      .eq('is_open', true)
      .maybeSingle()
    if (error || !data) return null
    return { id: data.id, code: data.code, hostId: data.host_id }
  } catch {
    return null
  }
}

export async function joinSessionRecord(sessionId: string, playerId: string): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return
  try {
    await supabase.from('session_members').insert({ session_id: sessionId, player_id: playerId })
  } catch {
    // The player is already in the channel; membership bookkeeping is optional.
  }
}

export async function leaveSessionRecord(
  session: SessionRecord | null,
  playerId: string,
  isHost: boolean,
): Promise<void> {
  const supabase = getSupabase()
  if (!supabase || !session) return
  try {
    await supabase
      .from('session_members')
      .delete()
      .eq('session_id', session.id)
      .eq('player_id', playerId)
    if (isHost) {
      await supabase
        .from('sessions')
        .update({ is_open: false, closed_at: new Date().toISOString() })
        .eq('id', session.id)
    }
  } catch {
    // Nothing to do — the row will simply linger as closed-by-absence.
  }
}
