import type { RealtimeChannel } from '@supabase/supabase-js'
import { getSupabase } from '@/lib/supabase/client'
import type { NetIdentity, NetMessage, NetStatus, NetworkTransport, TransportInfo } from './types'

/**
 * Multiplayer over Supabase Realtime broadcast — a websocket fan-out, *not*
 * Postgres writes. Nothing here touches the database; positions never hit a
 * table. Persistent state (money, garage) goes through `lib/persistence`.
 *
 * This is the simplest transport that gives real cross-machine play. Replacing
 * it with an authoritative game server means implementing `NetworkTransport`
 * again and changing one line in `createTransport`.
 */
export class SupabaseRealtimeTransport implements NetworkTransport {
  readonly info: TransportInfo = {
    label: 'Supabase Realtime',
    remote: true,
  }

  private channel: RealtimeChannel | null = null
  private identity: NetIdentity | null = null
  private messageHandlers = new Set<(m: NetMessage) => void>()
  private statusHandlers = new Set<(s: NetStatus) => void>()
  private _status: NetStatus = 'idle'

  get status(): NetStatus {
    return this._status
  }

  private setStatus(status: NetStatus): void {
    if (this._status === status) return
    this._status = status
    for (const h of this.statusHandlers) h(status)
  }

  async connect(sessionCode: string, identity: NetIdentity): Promise<void> {
    const supabase = getSupabase()
    if (!supabase) throw new Error('Supabase is not configured')

    await this.disconnect()
    this.identity = identity
    this.setStatus('connecting')

    const channel = supabase.channel(`world:${sessionCode}`, {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: identity.playerId },
      },
    })
    this.channel = channel

    channel.on('broadcast', { event: 'm' }, (payload) => {
      const message = payload.payload as NetMessage
      if ('id' in message && message.id === this.identity?.playerId) return
      for (const h of this.messageHandlers) h(message)
    })

    // Presence gives us reliable leave detection even when a tab is killed.
    channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
      for (const presence of leftPresences as Array<{ playerId?: string }>) {
        if (presence.playerId && presence.playerId !== identity.playerId) {
          for (const h of this.messageHandlers) h({ t: 'bye', id: presence.playerId })
        }
      }
    })

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Realtime connection timed out')), 12_000)
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout)
          void channel.track({ playerId: identity.playerId, username: identity.username })
          this.setStatus('connected')
          resolve()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timeout)
          this.setStatus('error')
          reject(new Error(`Realtime channel failed: ${status}`))
        }
      })
    })
  }

  async disconnect(): Promise<void> {
    if (this.channel) {
      if (this.identity) this.send({ t: 'bye', id: this.identity.playerId })
      await this.channel.unsubscribe()
      getSupabase()?.removeChannel(this.channel)
    }
    this.channel = null
    this.identity = null
    this.setStatus('idle')
  }

  send(message: NetMessage): void {
    if (!this.channel || this._status !== 'connected') return
    void this.channel.send({ type: 'broadcast', event: 'm', payload: message })
  }

  onMessage(handler: (message: NetMessage) => void): () => void {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }

  onStatusChange(handler: (status: NetStatus) => void): () => void {
    this.statusHandlers.add(handler)
    handler(this._status)
    return () => this.statusHandlers.delete(handler)
  }
}
