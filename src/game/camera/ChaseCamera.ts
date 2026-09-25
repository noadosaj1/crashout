import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { COLLISION_GROUPS } from '@/config/constants'
import type { PhysicsWorld } from '@/game/physics/PhysicsWorld'
import type { Vehicle } from '@/game/vehicles/Vehicle'

export interface CameraSettings {
  /** Base distance behind the car, before speed stretch. */
  distance: number
  height: number
  /** How quickly the rig catches up, in units/second of lerp rate. */
  stiffness: number
  baseFov: number
  maxFov: number
  shakeScale: number
}

export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  distance: 7.4,
  height: 2.9,
  stiffness: 7.5,
  baseFov: 68,
  maxFov: 90,
  shakeScale: 1,
}

const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _v3 = new THREE.Vector3()
const _q = new THREE.Quaternion()

/** Closest the collision-avoidance step may pull the camera to the car. */
const MIN_DISTANCE = 3.4

/**
 * Third-person chase rig. The anchor lags behind the car (so the world swings as
 * you turn), FOV stretches with speed, and a short ray keeps the camera from
 * ending up inside a wall.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera
  settings: CameraSettings = { ...DEFAULT_CAMERA_SETTINGS }

  private readonly desired = new THREE.Vector3()
  private readonly current = new THREE.Vector3()
  private readonly lookAt = new THREE.Vector3()
  private readonly smoothedForward = new THREE.Vector3(0, 0, 1)
  private readonly shakeOffset = new THREE.Vector3()
  private shake = 0
  private lookBackBlend = 0
  private initialised = false
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })

  private readonly physics: PhysicsWorld

  constructor(physics: PhysicsWorld, aspect: number) {
    this.physics = physics
    this.camera = new THREE.PerspectiveCamera(DEFAULT_CAMERA_SETTINGS.baseFov, aspect, 0.3, 3000)
  }

  /** Adds camera shake. `amount` is 0..1 severity. */
  addShake(amount: number): void {
    this.shake = Math.min(1.6, this.shake + amount)
  }

  reset(): void {
    this.initialised = false
    this.shake = 0
  }

  update(vehicle: Vehicle, dt: number, lookBack: boolean): void {
    const pos = vehicle.renderPosition
    const rot = vehicle.renderRotation
    const speed = vehicle.speed

    const forward = _v1.set(0, 0, 1).applyQuaternion(rot)
    // Follow the direction of travel once moving, so drifts look sideways-on.
    const vel = vehicle.body.linvel()
    const velLen = Math.hypot(vel.x, vel.z)
    if (velLen > 4) {
      _v2.set(vel.x / velLen, 0, vel.z / velLen)
      // Blend travel direction in, but never flip behind the car when reversing.
      if (_v2.dot(forward) > 0.1) forward.lerp(_v2, 0.35).normalize()
    }

    this.lookBackBlend += ((lookBack ? 1 : 0) - this.lookBackBlend) * Math.min(1, dt * 10)
    if (this.lookBackBlend > 0.001) {
      _v3.copy(forward).multiplyScalar(-1)
      forward.lerp(_v3, this.lookBackBlend).normalize()
    }

    const smoothRate = Math.min(1, this.settings.stiffness * dt)
    this.smoothedForward.lerp(forward, smoothRate)
    if (this.smoothedForward.lengthSq() < 1e-6) this.smoothedForward.copy(forward)
    this.smoothedForward.normalize()

    const speedRatio = Math.min(1, speed / 65)
    const distance = this.settings.distance + speedRatio * 2.6
    const height = this.settings.height + speedRatio * 0.5

    this.desired
      .copy(pos)
      .addScaledVector(this.smoothedForward, -distance)
      .add(_v2.set(0, height, 0))

    if (!this.initialised) {
      this.current.copy(this.desired)
      this.initialised = true
    } else {
      // Critically-damped-ish follow; framerate independent.
      const t = 1 - Math.exp(-this.settings.stiffness * dt)
      this.current.lerp(this.desired, t)
    }

    // Keep the camera out of geometry: cast from the car to the rig position.
    const toCam = _v2.copy(this.current).sub(pos)
    const dist = toCam.length()
    if (dist > 0.01) {
      toCam.divideScalar(dist)
      this.ray.origin.x = pos.x
      this.ray.origin.y = pos.y + 0.8
      this.ray.origin.z = pos.z
      this.ray.dir.x = toCam.x
      this.ray.dir.y = toCam.y
      this.ray.dir.z = toCam.z
      const hit = this.physics.world.castRay(
        this.ray,
        dist,
        true,
        undefined,
        (COLLISION_GROUPS.VEHICLE << 16) | COLLISION_GROUPS.WORLD,
        undefined,
        vehicle.body,
      )
      if (hit && hit.timeOfImpact < dist) {
        // Never pull closer than the car is long, or the camera ends up inside
        // the bodywork and the player sees the cabin from the inside.
        const safe = Math.max(MIN_DISTANCE, hit.timeOfImpact - 0.5)
        this.current.copy(pos).addScaledVector(toCam, safe)
        this.current.y += 0.9
      }
    }

    // Shake decays fast so big hits punch without lingering nausea.
    this.shake = Math.max(0, this.shake - dt * 2.4)
    const s = this.shake * this.shake * this.settings.shakeScale
    this.shakeOffset.set(
      (Math.random() - 0.5) * s * 1.1,
      (Math.random() - 0.5) * s * 0.9,
      (Math.random() - 0.5) * s * 1.1,
    )

    this.camera.position.copy(this.current).add(this.shakeOffset)
    this.lookAt.copy(pos).addScaledVector(this.smoothedForward, 6).add(_v3.set(0, 1.1, 0))
    this.camera.lookAt(this.lookAt)
    if (s > 0.001) {
      _q.setFromAxisAngle(_v3.set(0, 0, 1), (Math.random() - 0.5) * s * 0.06)
      this.camera.quaternion.multiply(_q)
    }

    const targetFov =
      this.settings.baseFov + (this.settings.maxFov - this.settings.baseFov) * speedRatio * speedRatio
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 4)
    this.camera.updateProjectionMatrix()
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }
}
