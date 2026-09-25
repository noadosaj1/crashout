import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { COLLISION_GROUPS, CRASH_CONTACT_FORCE_GATE, NET_INTERPOLATION_DELAY } from '@/config/constants'
import { getVehicleSpec } from '@/config/vehicles'
import { buildVehicleMesh, type VehicleMeshParts } from '@/game/vehicles/VehicleMesh'
import type { PhysicsWorld } from '@/game/physics/PhysicsWorld'
import type { NetPlayerAppearance, NetVehicleState } from '@/lib/networking/types'

interface Snapshot {
  t: number
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  velocity: THREE.Vector3
  steer: number
  damage: number
  boosting: boolean
}

const BUFFER_SIZE = 12
const _v = new THREE.Vector3()

/**
 * Another player's car.
 *
 * Rendering is driven by an interpolation buffer played back
 * `NET_INTERPOLATION_DELAY` behind real time, so packet jitter never shows. The
 * body is kinematic-position-based: it follows the network transform exactly,
 * but still pushes the local player's dynamic car, so ramming each other
 * produces a real collision on both machines.
 */
export class RemoteVehicle {
  readonly playerId: string
  username: string
  readonly body: RAPIER.RigidBody
  readonly collider: RAPIER.Collider
  readonly mesh: VehicleMeshParts
  readonly object: THREE.Group
  readonly label: THREE.Sprite

  private readonly buffer: Snapshot[] = []
  private readonly renderPos = new THREE.Vector3()
  private readonly renderQuat = new THREE.Quaternion()
  private steer = 0
  private damage = 0
  private wheelSpin = 0
  private lastPacketAt = 0
  private appearance: NetPlayerAppearance
  private readonly physics: PhysicsWorld
  private disposed = false

  constructor(
    physics: PhysicsWorld,
    playerId: string,
    username: string,
    appearance: NetPlayerAppearance,
    labelTexture: THREE.Texture,
  ) {
    this.physics = physics
    this.playerId = playerId
    this.username = username
    this.appearance = appearance

    const spec = getVehicleSpec(appearance.specId)

    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -60, 0),
    )
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        spec.dimensions.halfWidth,
        spec.dimensions.halfHeight,
        spec.dimensions.halfLength,
      )
        .setFriction(0.3)
        .setRestitution(0.2)
        .setCollisionGroups(
          (COLLISION_GROUPS.VEHICLE << 16) | (COLLISION_GROUPS.VEHICLE | COLLISION_GROUPS.PROP),
        )
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(CRASH_CONTACT_FORCE_GATE * 0.5),
      this.body,
    )

    this.mesh = buildVehicleMesh(spec, {
      paint: appearance.paint,
      wheelStyle: appearance.wheelStyle,
      accent: appearance.accent,
    })
    this.object = this.mesh.root
    this.object.position.set(0, -60, 0)

    const material = new THREE.SpriteMaterial({
      map: labelTexture,
      depthTest: false,
      transparent: true,
    })
    this.label = new THREE.Sprite(material)
    this.label.scale.set(6, 1.5, 1)
    this.label.position.y = spec.dimensions.halfHeight + 2.4
    this.label.renderOrder = 10
    this.object.add(this.label)
  }

  get specId(): string {
    return this.appearance.specId
  }

  get position(): THREE.Vector3 {
    return this.renderPos
  }

  get damageLevel(): number {
    return this.damage
  }

  /** True when no packet has arrived recently — used to hide ghosts. */
  isStale(now: number): boolean {
    return this.lastPacketAt > 0 && now - this.lastPacketAt > 5
  }

  get hasData(): boolean {
    return this.buffer.length > 0
  }

  push(state: NetVehicleState, now: number): void {
    this.lastPacketAt = now
    const snapshot: Snapshot = {
      t: now,
      position: new THREE.Vector3(state.p[0], state.p[1], state.p[2]),
      quaternion: new THREE.Quaternion(state.q[0], state.q[1], state.q[2], state.q[3]),
      velocity: new THREE.Vector3(state.v[0], state.v[1], state.v[2]),
      steer: state.s,
      damage: state.d,
      boosting: state.b === 1,
    }
    this.buffer.push(snapshot)
    // Out-of-order packets are rare but cheap to fix.
    if (this.buffer.length > 1 && this.buffer[this.buffer.length - 2].t > snapshot.t) {
      this.buffer.sort((a, b) => a.t - b.t)
    }
    while (this.buffer.length > BUFFER_SIZE) this.buffer.shift()
  }

  /**
   * Plays the buffer back at `now - NET_INTERPOLATION_DELAY`. If the buffer has
   * run dry we extrapolate from the last known velocity rather than freezing.
   */
  update(now: number, dt: number): void {
    if (this.disposed || this.buffer.length === 0) return

    const renderTime = now - NET_INTERPOLATION_DELAY
    let a: Snapshot | null = null
    let b: Snapshot | null = null
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i].t <= renderTime) {
        a = this.buffer[i]
        b = this.buffer[i + 1] ?? null
        break
      }
    }

    if (a && b) {
      const span = b.t - a.t
      const t = span > 1e-4 ? THREE.MathUtils.clamp((renderTime - a.t) / span, 0, 1) : 0
      this.renderPos.copy(a.position).lerp(b.position, t)
      this.renderQuat.copy(a.quaternion).slerp(b.quaternion, t)
      this.steer = a.steer + (b.steer - a.steer) * t
      this.damage = a.damage + (b.damage - a.damage) * t
      this.wheelSpin += a.velocity.length() * dt * 2
    } else {
      const latest = this.buffer[this.buffer.length - 1]
      const ahead = Math.min(0.35, Math.max(0, renderTime - latest.t))
      this.renderPos.copy(latest.position).addScaledVector(latest.velocity, ahead)
      this.renderQuat.copy(latest.quaternion)
      this.steer = latest.steer
      this.damage = latest.damage
      this.wheelSpin += latest.velocity.length() * dt * 2
    }

    this.object.position.copy(this.renderPos)
    this.object.quaternion.copy(this.renderQuat)

    // Feed the kinematic body so Rapier derives a velocity for the contact.
    this.body.setNextKinematicTranslation({
      x: this.renderPos.x,
      y: this.renderPos.y,
      z: this.renderPos.z,
    })
    this.body.setNextKinematicRotation({
      x: this.renderQuat.x,
      y: this.renderQuat.y,
      z: this.renderQuat.z,
      w: this.renderQuat.w,
    })

    for (let i = 0; i < this.mesh.wheels.length; i++) {
      const wheelObj = this.mesh.wheels[i]
      wheelObj.rotation.y = i < 2 ? this.steer : 0
      for (const child of wheelObj.children) child.rotation.x = this.wheelSpin
    }

    // Damage is a single scalar over the wire; spread it across panels so the
    // silhouette still reads as wrecked.
    const d = this.damage
    this.mesh.panels.front.scale.set(1 - d * 0.12, 1 - d * 0.2, 1 - d * 0.28)
    this.mesh.panels.rear.scale.set(1 - d * 0.1, 1 - d * 0.18, 1 - d * 0.26)
    this.mesh.panels.roof.scale.set(1, 1 - d * 0.25, 1)
    this.mesh.bodyMaterial.roughness = 0.34 + d * 0.5
    for (const glass of this.mesh.glass) glass.visible = d < 0.7
  }

  /** Keeps the name tag upright and readable at distance. */
  faceCamera(cameraPosition: THREE.Vector3): void {
    const distance = _v.copy(cameraPosition).sub(this.renderPos).length()
    const scale = THREE.MathUtils.clamp(distance * 0.055, 4, 16)
    this.label.scale.set(scale, scale * 0.25, 1)
    this.label.visible = distance < 260
  }

  setAppearance(appearance: NetPlayerAppearance): boolean {
    // A different car needs a whole new body/mesh; the manager recreates it.
    if (appearance.specId !== this.appearance.specId) return false
    this.appearance = appearance
    return true
  }

  dispose(scene: THREE.Scene): void {
    if (this.disposed) return
    this.disposed = true
    scene.remove(this.object)
    this.mesh.dispose()
    ;(this.label.material as THREE.SpriteMaterial).dispose()
    this.physics.world.removeRigidBody(this.body)
  }
}
