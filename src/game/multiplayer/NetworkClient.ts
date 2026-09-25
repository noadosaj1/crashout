import * as THREE from 'three'
import { NET_TICK_HZ } from '@/config/constants'
import type { GadgetId } from '@/types'
import type {
  NetIdentity,
  NetMessage,
  NetPlayerAppearance,
  NetStatus,
  NetworkTransport,
} from '@/lib/networking/types'
import type { PhysicsWorld } from '@/game/physics/PhysicsWorld'
import type { Vehicle } from '@/game/vehicles/Vehicle'
import { NameTagFactory } from './NameTag'
import { RemoteVehicle } from './RemoteVehicle'

export interface RemotePlayerInfo {
  playerId: string
  username: string
  specId: string
  distance: number
  damage: number
  position: [number, number, number]
}

export interface NetworkCallbacks {
  onGadget: (message: Extract<NetMessage, { t: 'gadget' }>) => void
  onGadgetOff: (hazardId: string) => void
  onRoster: (players: RemotePlayerInfo[]) => void
  onStatus: (status: NetStatus) => void
  onChat: (from: string, text: string) => void
  /** Another player reports they rammed us. See the `crash` message docs. */
  onIncomingHit: (from: string, severity: number, dir: [number, number, number]) => void
}

const SEND_INTERVAL = 1 / NET_TICK_HZ

/**
 * Owns remote player representation and outbound replication.
 *
 * Only what other players need to see goes over the wire: transform, velocity,
 * steering, damage and discrete events. Nothing here is authoritative — the
 * economy lives in Supabase and is validated there.
 */
export class NetworkClient {
  readonly object = new THREE.Group()
  private readonly remotes = new Map<string, RemoteVehicle>()
  private readonly pendingLook = new Map<string, { name: string; look: NetPlayerAppearance }>()
  private readonly nameTags = new NameTagFactory()
  private readonly physics: PhysicsWorld
  private readonly scene: THREE.Scene

  private transport: NetworkTransport | null = null
  private identity: NetIdentity | null = null
  private appearance: NetPlayerAppearance | null = null
  private callbacks: NetworkCallbacks | null = null
  private unsubscribers: Array<() => void> = []
  private sendAccumulator = 0
  private sequence = 0
  private clock = 0
  private rosterTimer = 0
  /** Colliders owned by remote cars, so the crash system can classify contacts. */
  readonly remoteColliders = new Map<number, RemoteVehicle>()
  /** The same mapping, flattened to player ids for the crash system. */
  readonly remotePlayerByCollider = new Map<number, string>()

  constructor(physics: PhysicsWorld, scene: THREE.Scene) {
    this.physics = physics
    this.scene = scene
    this.object.name = 'remote-players'
    scene.add(this.object)
  }

  get connected(): boolean {
    return this.transport?.status === 'connected'
  }

  get playerCount(): number {
    return this.remotes.size + 1
  }

  setCallbacks(callbacks: NetworkCallbacks): void {
    this.callbacks = callbacks
  }

  async connect(
    transport: NetworkTransport,
    sessionCode: string,
    identity: NetIdentity,
    appearance: NetPlayerAppearance,
  ): Promise<void> {
    await this.disconnect()
    this.transport = transport
    this.identity = identity
    this.appearance = appearance

    this.unsubscribers.push(transport.onMessage((m) => this.handle(m)))
    this.unsubscribers.push(
      transport.onStatusChange((status) => {
        this.callbacks?.onStatus(status)
      }),
    )

    await transport.connect(sessionCode, identity)
    // Announce ourselves, then ask anyone already here to do the same.
    transport.send({ t: 'hello', id: identity.playerId, name: identity.username, look: appearance })
    transport.send({ t: 'who', id: identity.playerId })
  }

  async disconnect(): Promise<void> {
    for (const un of this.unsubscribers) un()
    this.unsubscribers = []
    if (this.transport) await this.transport.disconnect()
    this.transport = null
    for (const remote of this.remotes.values()) remote.dispose(this.scene)
    this.remoteColliders.clear()
    this.remotePlayerByCollider.clear()
    this.remotes.clear()
    this.pendingLook.clear()
    this.callbacks?.onRoster([])
  }

  /** Re-announces after the player swaps cars or repaints. */
  updateAppearance(appearance: NetPlayerAppearance): void {
    this.appearance = appearance
    if (!this.transport || !this.identity) return
    this.transport.send({
      t: 'hello',
      id: this.identity.playerId,
      name: this.identity.username,
      look: appearance,
    })
  }

  broadcastCrash(
    position: THREE.Vector3,
    severity: number,
    pvp: boolean,
    target: string | null,
    direction: THREE.Vector3 | null,
  ): void {
    if (!this.transport || !this.identity) return
    this.transport.send({
      t: 'crash',
      id: this.identity.playerId,
      p: [position.x, position.y, position.z],
      sev: severity,
      pvp,
      ...(target ? { target } : {}),
      ...(direction ? { dir: [direction.x, direction.y, direction.z] as [number, number, number] } : {}),
    })
  }

  broadcastGadget(hazardId: string, gadgetId: GadgetId, position: THREE.Vector3, heading: number): void {
    if (!this.transport || !this.identity) return
    this.transport.send({
      t: 'gadget',
      id: this.identity.playerId,
      g: gadgetId,
      hid: hazardId,
      p: [position.x, position.y, position.z],
      h: heading,
    })
  }

  sendChat(text: string): void {
    if (!this.transport || !this.identity) return
    this.transport.send({ t: 'chat', id: this.identity.playerId, name: this.identity.username, text })
  }

  private handle(message: NetMessage): void {
    switch (message.t) {
      case 'hello': {
        this.pendingLook.set(message.id, { name: message.name, look: message.look })
        const existing = this.remotes.get(message.id)
        if (existing) {
          existing.username = message.name
          if (!existing.setAppearance(message.look)) {
            // Different car: rebuild.
            this.remoteColliders.delete(existing.collider.handle)
            this.remotePlayerByCollider.delete(existing.collider.handle)
            existing.dispose(this.scene)
            this.remotes.delete(message.id)
            this.ensureRemote(message.id)
          }
        } else {
          this.ensureRemote(message.id)
        }
        break
      }
      case 'who': {
        if (!this.transport || !this.identity || !this.appearance) break
        this.transport.send({
          t: 'hello',
          id: this.identity.playerId,
          name: this.identity.username,
          look: this.appearance,
        })
        break
      }
      case 'bye': {
        const remote = this.remotes.get(message.id)
        if (remote) {
          this.remoteColliders.delete(remote.collider.handle)
          this.remotePlayerByCollider.delete(remote.collider.handle)
          remote.dispose(this.scene)
          this.remotes.delete(message.id)
        }
        this.pendingLook.delete(message.id)
        break
      }
      case 'state': {
        const remote = this.ensureRemote(message.id)
        remote?.push(message.s, this.clock)
        break
      }
      case 'gadget':
        this.callbacks?.onGadget(message)
        break
      case 'gadget-off':
        this.callbacks?.onGadgetOff(message.hid)
        break
      case 'chat':
        this.callbacks?.onChat(message.name, message.text)
        break
      case 'crash': {
        // A hit aimed at us: apply it. Everything else is advisory — our own
        // sim already shows collisions, because remote cars are real bodies.
        if (message.target && message.target === this.identity?.playerId && message.dir) {
          this.callbacks?.onIncomingHit(message.id, message.sev, message.dir)
        }
        break
      }
      case 'race':
        break
    }
  }

  /** Creates the remote car once we know what they are driving. */
  private ensureRemote(playerId: string): RemoteVehicle | null {
    const existing = this.remotes.get(playerId)
    if (existing) return existing

    const pending = this.pendingLook.get(playerId)
    if (!pending) {
      // State arrived before hello — ask for identity and drop this packet.
      if (this.transport && this.identity) this.transport.send({ t: 'who', id: this.identity.playerId })
      return null
    }

    const remote = new RemoteVehicle(
      this.physics,
      playerId,
      pending.name,
      pending.look,
      this.nameTags.get(pending.name),
    )
    this.object.add(remote.object)
    this.remotes.set(playerId, remote)
    this.remoteColliders.set(remote.collider.handle, remote)
    this.remotePlayerByCollider.set(remote.collider.handle, playerId)
    return remote
  }

  /** Called once per rendered frame. */
  update(dt: number, localVehicle: Vehicle | null, cameraPosition: THREE.Vector3): void {
    this.clock += dt

    for (const [id, remote] of [...this.remotes]) {
      if (remote.isStale(this.clock)) {
        this.remoteColliders.delete(remote.collider.handle)
        this.remotePlayerByCollider.delete(remote.collider.handle)
        remote.dispose(this.scene)
        this.remotes.delete(id)
        continue
      }
      remote.update(this.clock, dt)
      remote.faceCamera(cameraPosition)
    }

    if (localVehicle && this.transport?.status === 'connected' && this.identity) {
      this.sendAccumulator += dt
      if (this.sendAccumulator >= SEND_INTERVAL) {
        this.sendAccumulator = 0
        this.sendState(localVehicle)
      }
    }

    this.rosterTimer += dt
    if (this.rosterTimer > 0.5) {
      this.rosterTimer = 0
      this.publishRoster(localVehicle)
    }
  }

  private sendState(vehicle: Vehicle): void {
    if (!this.transport || !this.identity) return
    const t = vehicle.body.translation()
    const r = vehicle.body.rotation()
    const v = vehicle.body.linvel()
    // Round to 3 decimals: the payload halves and nobody can see the difference.
    const r3 = (n: number): number => Math.round(n * 1000) / 1000
    this.transport.send({
      t: 'state',
      id: this.identity.playerId,
      n: this.sequence++,
      s: {
        p: [r3(t.x), r3(t.y), r3(t.z)],
        q: [r3(r.x), r3(r.y), r3(r.z), r3(r.w)],
        v: [r3(v.x), r3(v.y), r3(v.z)],
        s: r3(vehicle.steer),
        d: Math.round(vehicle.damageLevel * 100) / 100,
        b: vehicle.isBoosting ? 1 : 0,
      },
    })
  }

  private publishRoster(localVehicle: Vehicle | null): void {
    if (!this.callbacks) return
    const origin = localVehicle?.position
    const players: RemotePlayerInfo[] = []
    for (const remote of this.remotes.values()) {
      if (!remote.hasData) continue
      players.push({
        playerId: remote.playerId,
        username: remote.username,
        specId: remote.specId,
        distance: origin ? origin.distanceTo(remote.position) : 0,
        damage: remote.damageLevel,
        position: [remote.position.x, remote.position.y, remote.position.z],
      })
    }
    players.sort((a, b) => a.distance - b.distance)
    this.callbacks.onRoster(players)
  }

  /** Remote cars, for gadget and proximity checks. */
  get remoteVehicles(): RemoteVehicle[] {
    return [...this.remotes.values()]
  }

  dispose(): void {
    void this.disconnect()
    this.nameTags.dispose()
    this.scene.remove(this.object)
  }
}
