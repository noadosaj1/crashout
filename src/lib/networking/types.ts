import type { GadgetId } from '@/types'

export interface NetIdentity {
  playerId: string
  username: string
}

/** Compact per-tick vehicle state. Keys are short because this goes out 15×/sec. */
export interface NetVehicleState {
  /** position */
  p: [number, number, number]
  /** rotation quaternion */
  q: [number, number, number, number]
  /** linear velocity, used for extrapolation between packets */
  v: [number, number, number]
  /** angular velocity */
  a: [number, number, number]
  /** steering angle, for wheel visuals */
  s: number
  /** overall damage 0..1 */
  d: number
  /** boosting */
  b: 0 | 1
}

export interface NetPlayerAppearance {
  specId: string
  paint: string
  wheelStyle: string
  accent: string
}

export type NetMessage =
  /** Sent on join and whenever appearance changes. */
  | { t: 'hello'; id: string; name: string; look: NetPlayerAppearance }
  /** Asks everyone already in the session to re-announce themselves. */
  | { t: 'who'; id: string }
  | { t: 'bye'; id: string }
  | { t: 'state'; id: string; n: number; s: NetVehicleState }
  | {
      t: 'crash'
      id: string
      p: [number, number, number]
      sev: number
      /** true when the impact was against another player */
      pvp: boolean
    }
  | {
      t: 'gadget'
      id: string
      g: GadgetId
      /** hazard instance id so removals match */
      hid: string
      p: [number, number, number]
      /** heading in radians */
      h: number
    }
  | { t: 'gadget-off'; hid: string }
  | { t: 'race'; id: string; activityId: string; checkpoint: number; finished: boolean; time: number }
  | { t: 'chat'; id: string; name: string; text: string }

export type NetStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface TransportInfo {
  /** Human-readable name shown in the session panel. */
  label: string
  /** True when other machines can actually join. */
  remote: boolean
  /** Shown to the player when `remote` is false. */
  note?: string
}

/**
 * The only surface the game uses to talk to other players. Swapping in an
 * authoritative server later means writing one more implementation of this,
 * not touching gameplay code.
 */
export interface NetworkTransport {
  readonly info: TransportInfo
  readonly status: NetStatus
  connect(sessionCode: string, identity: NetIdentity): Promise<void>
  disconnect(): Promise<void>
  /** Fire-and-forget. Implementations may drop messages under load. */
  send(message: NetMessage): void
  onMessage(handler: (message: NetMessage) => void): () => void
  onStatusChange(handler: (status: NetStatus) => void): () => void
}
