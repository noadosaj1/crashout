import type * as THREE from 'three'
import type { DamageRegion } from '@/types'

export interface CrashEvent {
  /** Normalised 0..1 severity used for effects and scoring. */
  severity: number
  /** Velocity the car lost in the impact, m/s. */
  deltaV: number
  position: THREE.Vector3
  normal: THREE.Vector3
  region: DamageRegion
  /** True when the local player's car was involved. */
  local: boolean
  /** True when the other body was another vehicle rather than world geometry. */
  vehicleToVehicle: boolean
  vehicleId: string
  /** The other player's id when this was a player-versus-player hit. */
  otherPlayerId: string | null
}

export interface NotificationEvent {
  text: string
  tone: 'info' | 'success' | 'warn' | 'reward'
  /** Seconds. */
  ttl?: number
}

/**
 * Every event here has at least one subscriber. Adding one nothing listens to
 * is how an event bus turns into a graveyard.
 */
export interface GameEvents {
  crash: CrashEvent
  notify: NotificationEvent
}
