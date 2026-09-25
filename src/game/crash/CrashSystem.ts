import * as THREE from 'three'
import {
  CRASH_CONTACT_FORCE_GATE,
  CRASH_DELTA_V_REFERENCE,
  CRASH_DELTA_V_THRESHOLD,
} from '@/config/constants'
import { gameEvents } from '@/game/core/GameEvents'
import { regionFromLocalDirection } from '@/game/vehicles/damage'
import type { Vehicle } from '@/game/vehicles/Vehicle'
import type { ParticleSystem } from '@/game/effects/ParticleSystem'
import type { ChaseCamera } from '@/game/camera/ChaseCamera'
import type { AudioSystem } from '@/game/audio/AudioSystem'
import type { BuiltWorld, WorldProp } from '@/game/world/WorldBuilder'

/**
 * Damage dealt by a maximum-severity crash, before crash resistance. One
 * full-speed impact leaves a car visibly wrecked but still driveable; two
 * finish the job.
 */
const DAMAGE_PER_SEVERITY = 1.5

const _pos = new THREE.Vector3()
const _normal = new THREE.Vector3()
const _local = new THREE.Vector3()

interface PendingCrash {
  vehicle: Vehicle
  force: number
  nx: number
  ny: number
  nz: number
  vehicleToVehicle: boolean
  otherPlayerId: string | null
  prop: WorldProp | null
}

/**
 * Turns contacts into damage, effects, audio and score.
 *
 * Severity comes from how much velocity the solver took off the car in one step
 * (`Vehicle.lastImpactDeltaV`), not from raw contact force. Force scales with
 * vehicle mass and spikes on ordinary resting contact, so it makes a terrible
 * severity signal; it is used only as a cheap gate for *which* contacts are
 * worth looking at, and to identify what was hit.
 *
 * Contacts also arrive many times per step for a single crash, so hits are
 * collected per vehicle and only the strongest is resolved.
 */
export class CrashSystem {
  private readonly vehiclesByCollider = new Map<number, Vehicle>()
  /** Remote players' collider handles, so a hit can name who it was against. */
  private remotePlayersByCollider: ReadonlyMap<number, string> = new Map()
  private readonly pending = new Map<string, PendingCrash>()
  /** Per-vehicle lockout so grinding along a wall does not shred the car. */
  private readonly cooldowns = new Map<string, number>()

  private particles: ParticleSystem | null = null
  private camera: ChaseCamera | null = null
  private audio: AudioSystem | null = null
  private world: BuiltWorld | null = null
  private localVehicleId: string | null = null

  attach(deps: {
    particles: ParticleSystem
    camera: ChaseCamera
    audio: AudioSystem
    world: BuiltWorld
  }): void {
    this.particles = deps.particles
    this.camera = deps.camera
    this.audio = deps.audio
    this.world = deps.world
  }

  /** Supplied by the network client; maps remote collider handles to player ids. */
  setRemoteColliders(map: ReadonlyMap<number, string>): void {
    this.remotePlayersByCollider = map
  }

  setLocalVehicle(vehicle: Vehicle | null): void {
    this.localVehicleId = vehicle?.id ?? null
  }

  registerVehicle(vehicle: Vehicle): void {
    this.vehiclesByCollider.set(vehicle.collider.handle, vehicle)
  }

  unregisterVehicle(vehicle: Vehicle): void {
    this.vehiclesByCollider.delete(vehicle.collider.handle)
    this.cooldowns.delete(vehicle.id)
    this.pending.delete(vehicle.id)
  }

  /** Wired to `PhysicsWorld.setContactHandler`. Runs inside the physics step. */
  readonly onContactForce = (
    colliderA: number,
    colliderB: number,
    magnitude: number,
    dirX: number,
    dirY: number,
    dirZ: number,
  ): void => {
    if (magnitude < CRASH_CONTACT_FORCE_GATE) return
    const a = this.vehiclesByCollider.get(colliderA)
    const b = this.vehiclesByCollider.get(colliderB)
    if (!a && !b) return

    const remoteA = this.remotePlayersByCollider.get(colliderA) ?? null
    const remoteB = this.remotePlayersByCollider.get(colliderB) ?? null
    const vehicleToVehicle = (!!a && !!b) || !!remoteA || !!remoteB
    const propA = this.world?.propColliders.get(colliderA) ?? null
    const propB = this.world?.propColliders.get(colliderB) ?? null

    if (a) this.record(a, magnitude, dirX, dirY, dirZ, vehicleToVehicle, remoteB, propB)
    if (b) this.record(b, magnitude, -dirX, -dirY, -dirZ, vehicleToVehicle, remoteA, propA)
  }

  private record(
    vehicle: Vehicle,
    force: number,
    nx: number,
    ny: number,
    nz: number,
    vehicleToVehicle: boolean,
    otherPlayerId: string | null,
    prop: WorldProp | null,
  ): void {
    const existing = this.pending.get(vehicle.id)
    if (existing && existing.force >= force) return
    this.pending.set(vehicle.id, { vehicle, force, nx, ny, nz, vehicleToVehicle, otherPlayerId, prop })
  }

  /** Call once per frame, after physics has advanced. */
  resolve(dt: number): void {
    for (const [id, until] of this.cooldowns) {
      const next = until - dt
      if (next <= 0) this.cooldowns.delete(id)
      else this.cooldowns.set(id, next)
    }

    for (const crash of this.pending.values()) this.resolveOne(crash)
    this.pending.clear()
    for (const vehicle of this.vehiclesByCollider.values()) vehicle.consumeImpact()
  }

  private resolveOne(crash: PendingCrash): void {
    const { vehicle } = crash
    if (this.cooldowns.has(vehicle.id)) return

    const deltaV = vehicle.impactDeltaV
    if (deltaV < CRASH_DELTA_V_THRESHOLD) return

    // Props soak most of the drama: ploughing through cones is not a crash.
    const propScale = crash.prop ? 0.3 : 1
    const severity = Math.min(
      1,
      ((deltaV - CRASH_DELTA_V_THRESHOLD) / CRASH_DELTA_V_REFERENCE) * propScale,
    )
    if (severity <= 0.008) return

    // A genuine second impact still lands; a continuous scrape does not.
    this.cooldowns.set(vehicle.id, severity > 0.3 ? 0.3 : 0.12)

    // The car was shoved along `impactDirection`, so the panel that took the hit
    // is the one facing the other way.
    _normal.copy(vehicle.impactDirection)
    if (_normal.lengthSq() < 1e-6) _normal.set(crash.nx, crash.ny, crash.nz)
    if (_normal.lengthSq() < 1e-6) _normal.set(0, 0, 1)
    _normal.normalize()

    vehicle.localDirection(_normal, _local)
    const region = regionFromLocalDirection(-_local.x, -_local.y, -_local.z)
    vehicle.applyDamage(region, severity * DAMAGE_PER_SEVERITY)

    // Put the effects on the panel that got hit, not at the car's centre.
    _pos.copy(vehicle.renderPosition).addScaledVector(_normal, -1.3)
    _pos.y = Math.max(0.2, _pos.y)

    this.spawnEffects(vehicle, severity, crash.vehicleToVehicle)

    if (vehicle.id === this.localVehicleId) {
      this.camera?.addShake(0.3 + severity * 1.1)
    }

    gameEvents.emit('crash', {
      severity,
      deltaV,
      position: _pos.clone(),
      normal: _normal.clone(),
      region,
      local: vehicle.id === this.localVehicleId,
      vehicleToVehicle: crash.vehicleToVehicle,
      vehicleId: vehicle.id,
      otherPlayerId: crash.otherPlayerId,
    })
  }

  private spawnEffects(vehicle: Vehicle, severity: number, vehicleToVehicle: boolean): void {
    const particles = this.particles
    if (particles) {
      particles.sparks(_pos, _normal, severity)
      if (severity > 0.12) particles.smoke(_pos, severity * 1.4)
      if (severity > 0.2) {
        particles.glass(_pos, severity)
        particles.debris(_pos, severity, vehicle.mesh.bodyMaterial.color.getHex())
      }
    }
    this.audio?.playImpact(_pos, severity, vehicleToVehicle)
  }
}
