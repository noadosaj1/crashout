import type { NetIdentity, NetMessage, NetStatus, NetworkTransport, TransportInfo } from './types'

/**
 * Same-machine multiplayer over BroadcastChannel. Every browser tab on this
 * device that joins the same code sees the others, which makes multiplayer
 * testable (and playable split-screen) with no backend configured at all.
 */
export class LocalBroadcastTransport implements NetworkTransport {
  readonly info: TransportInfo = {
    label: 'Local (this device)',
    remote: false,
    note: 'Other browser tabs on this computer can join. Configure Supabase to play over the internet.',
  }

  private channel: BroadcastChannel | null = null
  private identity: NetIdentity | null = null
  private messageHandlers = new Set<(m: NetMessage) => void>()
  private statusHandlers = new Set<(s: NetStatus) => void>()
  private _status: NetStatus = 'idle'

  get status(): NetStatus {
    return this._status
  }

  private setStatus(status: NetStatus): void {
    this._status = status
    for (const h of this.statusHandlers) h(status)
  }

  async connect(sessionCode: string, identity: NetIdentity): Promise<void> {
    await this.disconnect()
    this.identity = identity
    this.setStatus('connecting')
    this.channel = new BroadcastChannel(`crashout:${sessionCode}`)
    this.channel.onmessage = (event: MessageEvent<NetMessage>) => {
      const message = event.data
      // BroadcastChannel does not echo to the sender, but guard anyway.
      if ('id' in message && message.id === this.identity?.playerId) return
      for (const h of this.messageHandlers) h(message)
    }
    this.setStatus('connected')
  }

  async disconnect(): Promise<void> {
    if (this.channel && this.identity) {
      this.channel.postMessage({ t: 'bye', id: this.identity.playerId } satisfies NetMessage)
    }
    this.channel?.close()
    this.channel = null
    this.identity = null
    this.setStatus('idle')
  }

  send(message: NetMessage): void {
    this.channel?.postMessage(message)
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
