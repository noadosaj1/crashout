import * as THREE from 'three'
import type { GadgetId } from '@/types'
import { GADGETS } from '@/config/gadgets'
import type { Vehicle } from '@/game/vehicles/Vehicle'
import type { ParticleSystem } from '@/game/effects/ParticleSystem'
import type { AudioSystem } from '@/game/audio/AudioSystem'

/** A hazard as anything outside the gadget system needs to see it. */
export interface ActiveHazard {
  gadgetId: GadgetId
  position: THREE.Vector3
}

interface Hazard {
  id: string
  gadgetId: GadgetId
  position: THREE.Vector3
  heading: number
  expiresAt: number
  mesh: THREE.Object3D
  ownerId: string
  /** Per-vehicle re-trigger lockout so a bounce pad fires once per pass. */
  lastTriggered: Map<string, number>
}

const _thumperAway = new THREE.Vector3()

const DISC = new THREE.CircleGeometry(1, 20)
DISC.rotateX(-Math.PI / 2)
const PAD = new THREE.BoxGeometry(1, 0.3, 1)
const STRIP = new THREE.BoxGeometry(1, 0.18, 1)
const PUFF = new THREE.SphereGeometry(1, 10, 8)
const CHARGE = new THREE.CylinderGeometry(1, 1.15, 0.5, 12)

/**
 * Hazards dropped by gadgets. Deliberately *not* physics sensors: a hazard is a
 * position, a radius and an expiry, checked against nearby cars each frame.
 * That keeps them trivially serialisable for the network and cheap to simulate.
 *
 * Adding a gadget = one entry in config/gadgets.ts + one case in `buildVisual`
 * and `applyEffect`.
 */
export class GadgetSystem {
  readonly object = new THREE.Group()
  private readonly hazards = new Map<string, Hazard>()
  private readonly cooldowns = new Map<GadgetId, number>()
  private readonly materials = new Map<GadgetId, THREE.Material>()
  private time = 0

  private particles: ParticleSystem | null = null
  private audio: AudioSystem | null = null
  private broadcast: ((hazard: { id: string; gadgetId: GadgetId; position: THREE.Vector3; heading: number }) => void) | null = null

  attach(deps: {
    particles: ParticleSystem
    audio: AudioSystem
    broadcast: (hazard: { id: string; gadgetId: GadgetId; position: THREE.Vector3; heading: number }) => void
  }): void {
    this.particles = deps.particles
    this.audio = deps.audio
    this.broadcast = deps.broadcast
  }

  private material(gadgetId: GadgetId): THREE.Material {
    let m = this.materials.get(gadgetId)
    if (!m) {
      const spec = GADGETS[gadgetId]
      m =
        gadgetId === 'smoke_screen'
          ? new THREE.MeshBasicMaterial({ color: spec.color, transparent: true, opacity: 0.4, depthWrite: false })
          : new THREE.MeshStandardMaterial({
              color: spec.color,
              roughness: gadgetId === 'oil_slick' ? 0.08 : 0.6,
              metalness: gadgetId === 'oil_slick' ? 0.9 : 0.2,
              transparent: true,
              opacity: 0.92,
            })
      this.materials.set(gadgetId, m)
    }
    return m
  }

  cooldownRemaining(gadgetId: GadgetId): number {
    return Math.max(0, (this.cooldowns.get(gadgetId) ?? 0) - this.time)
  }

  isReady(gadgetId: GadgetId): boolean {
    return this.cooldownRemaining(gadgetId) <= 0
  }

  /** Local player pressed the gadget key. Returns false if still cooling down. */
  deploy(gadgetId: GadgetId, vehicle: Vehicle): boolean {
    if (!this.isReady(gadgetId)) return false
    const spec = GADGETS[gadgetId]

    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(vehicle.rotation)
    const position = vehicle.position.clone().addScaledVector(forward, -spec.dropDistance)
    position.y = Math.max(0.08, position.y - vehicle.spec.dimensions.halfHeight)
    const heading = Math.atan2(forward.x, forward.z)

    this.cooldowns.set(gadgetId, this.time + spec.cooldown)
    const id = crypto.randomUUID()
    this.spawn(id, gadgetId, position, heading, vehicle.id)
    this.audio?.playGadget()
    this.broadcast?.({ id, gadgetId, position, heading })
    return true
  }

  /** Spawns a hazard that came in over the network. */
  spawnRemote(id: string, gadgetId: GadgetId, position: [number, number, number], heading: number, ownerId: string): void {
    if (this.hazards.has(id)) return
    this.spawn(id, gadgetId, new THREE.Vector3(...position), heading, ownerId)
  }

  removeRemote(id: string): void {
    this.remove(id)
  }

  private spawn(
    id: string,
    gadgetId: GadgetId,
    position: THREE.Vector3,
    heading: number,
    ownerId: string,
  ): void {
    const spec = GADGETS[gadgetId]
    const mesh = this.buildVisual(gadgetId, spec.radius)
    mesh.position.copy(position)
    mesh.rotation.y = heading
    this.object.add(mesh)
    this.hazards.set(id, {
      id,
      gadgetId,
      position: position.clone(),
      heading,
      expiresAt: this.time + spec.duration,
      mesh,
      ownerId,
      lastTriggered: new Map(),
    })
  }

  private buildVisual(gadgetId: GadgetId, radius: number): THREE.Object3D {
    const material = this.material(gadgetId)
    switch (gadgetId) {
      case 'oil_slick': {
        const mesh = new THREE.Mesh(DISC, material)
        mesh.scale.setScalar(radius)
        mesh.position.y = 0.045
        mesh.receiveShadow = false
        return mesh
      }
      case 'smoke_screen': {
        const group = new THREE.Group()
        for (let i = 0; i < 5; i++) {
          const puff = new THREE.Mesh(PUFF, material)
          puff.scale.setScalar(radius * (0.5 + Math.random() * 0.45))
          puff.position.set(
            (Math.random() - 0.5) * radius,
            radius * 0.4 + Math.random() * radius * 0.4,
            (Math.random() - 0.5) * radius,
          )
          group.add(puff)
        }
        return group
      }
      case 'bounce_pad': {
        const mesh = new THREE.Mesh(PAD, material)
        mesh.scale.set(radius * 1.6, 1, radius * 1.6)
        mesh.position.y = 0.15
        return mesh
      }
      case 'spike_strip': {
        const mesh = new THREE.Mesh(STRIP, material)
        mesh.scale.set(radius * 2.2, 1, 0.9)
        mesh.position.y = 0.09
        return mesh
      }
      case 'thumper': {
        const mesh = new THREE.Mesh(CHARGE, material)
        mesh.scale.set(radius * 0.32, 1, radius * 0.32)
        mesh.position.y = 0.25
        return mesh
      }
    }
  }

  private remove(id: string): void {
    const hazard = this.hazards.get(id)
    if (!hazard) return
    this.object.remove(hazard.mesh)
    this.hazards.delete(id)
  }

  /**
   * Advances lifetimes and applies effects to the given vehicles. Each client
   * only applies hazards to cars it simulates, which keeps the result consistent
   * without any server arbitration.
   */
  update(dt: number, vehicles: Vehicle[]): void {
    this.time += dt

    for (const hazard of [...this.hazards.values()]) {
      if (this.time >= hazard.expiresAt) {
        this.remove(hazard.id)
        continue
      }

      const spec = GADGETS[hazard.gadgetId]
      const remaining = hazard.expiresAt - this.time
      // Fade out over the last second so hazards do not pop.
      const fade = Math.min(1, remaining)
      hazard.mesh.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          const m = obj.material as THREE.Material & { opacity: number }
          m.opacity = (hazard.gadgetId === 'smoke_screen' ? 0.4 : 0.92) * fade
        }
      })
      if (hazard.gadgetId === 'smoke_screen') {
        hazard.mesh.rotation.y += dt * 0.25
        hazard.mesh.position.y = hazard.position.y + Math.sin(this.time * 0.8) * 0.15
      }

      for (const vehicle of vehicles) {
        const dx = vehicle.position.x - hazard.position.x
        const dz = vehicle.position.z - hazard.position.z
        const dy = vehicle.position.y - hazard.position.y
        if (dy > 3 || dy < -2) continue
        if (dx * dx + dz * dz > spec.radius * spec.radius) continue

        const last = hazard.lastTriggered.get(vehicle.id) ?? -Infinity
        if (this.time - last < 0.7) continue
        hazard.lastTriggered.set(vehicle.id, this.time)
        this.applyEffect(hazard, vehicle)
      }
    }
  }

  private applyEffect(hazard: Hazard, vehicle: Vehicle): void {
    switch (hazard.gadgetId) {
      case 'oil_slick':
        vehicle.applyTractionPenalty(0.22, 2.6)
        this.particles?.smoke(vehicle.position, 0.3, 0x2a2730)
        break
      case 'smoke_screen':
        // Blinding is handled by the HUD overlay; the car itself is unaffected.
        break
      case 'bounce_pad': {
        const impulse = vehicle.spec.mass * 13
        vehicle.body.applyImpulse({ x: 0, y: impulse, z: 0 }, true)
        vehicle.body.applyTorqueImpulse(
          { x: (Math.random() - 0.5) * impulse * 0.6, y: 0, z: (Math.random() - 0.5) * impulse * 0.6 },
          true,
        )
        this.particles?.sparks(vehicle.position, new THREE.Vector3(0, 1, 0), 0.6)
        break
      }
      case 'thumper': {
        // Throws the car away from the charge rather than straight up, so it is
        // aimed: drop it on the inside of a corner and the victim leaves the road.
        const away = _thumperAway
          .set(vehicle.position.x - hazard.position.x, 0, vehicle.position.z - hazard.position.z)
        if (away.lengthSq() < 1e-4) away.set(Math.random() - 0.5, 0, Math.random() - 0.5)
        away.normalize()
        // Mostly sideways: the bounce pad is the one that sends you upstairs.
        const impulse = vehicle.spec.mass * 9
        vehicle.body.applyImpulse(
          { x: away.x * impulse, y: impulse * 0.45, z: away.z * impulse },
          true,
        )
        vehicle.body.applyTorqueImpulse(
          { x: away.z * impulse * 0.5, y: (Math.random() - 0.5) * impulse * 0.4, z: -away.x * impulse * 0.5 },
          true,
        )
        vehicle.applyDamage('rear', 0.12)
        this.particles?.sparks(vehicle.position, away, 1)
        this.particles?.smoke(vehicle.position, 0.8)
        break
      }
      case 'spike_strip':
        vehicle.applyTractionPenalty(0.4, 9)
        vehicle.applyDamage('front', 0.12)
        this.particles?.sparks(vehicle.position, new THREE.Vector3(0, 1, 0), 0.4)
        break
    }
  }

  /**
   * Live hazards, for systems that are not vehicles. Traffic reads this so a
   * spike strip laid across a junction catches whatever drives over it. It is a
   * map rather than an iterator because every car checks it in turn, and an
   * iterator would be spent on the first one.
   */
  get activeHazards(): ReadonlyMap<string, ActiveHazard> {
    return this.hazards
  }

  /** True when the local camera is inside a smoke cloud (drives the HUD blind overlay). */
  smokeIntensityAt(position: THREE.Vector3): number {
    let worst = 0
    for (const hazard of this.hazards.values()) {
      if (hazard.gadgetId !== 'smoke_screen') continue
      const spec = GADGETS[hazard.gadgetId]
      const d = position.distanceTo(hazard.position)
      if (d < spec.radius) worst = Math.max(worst, 1 - d / spec.radius)
    }
    return worst
  }

  clear(): void {
    for (const id of [...this.hazards.keys()]) this.remove(id)
  }

  dispose(): void {
    this.clear()
    for (const m of this.materials.values()) m.dispose()
    this.materials.clear()
  }
}
