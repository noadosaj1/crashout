import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import type { VehicleCustomization, VehicleDamage, VehicleSpec, VehicleUpgrades, DamageRegion } from '@/types'
import { upgradeMultiplier } from '@/config/upgrades'
import { COLLISION_GROUPS, CRASH_CONTACT_FORCE_GATE } from '@/config/constants'
import type { PhysicsWorld } from '@/game/physics/PhysicsWorld'
import type { DriveInput } from '@/game/input/InputManager'
import { buildVehicleMesh, type VehicleMeshParts } from './VehicleMesh'
import {
  applyRegionDamage,
  createDamage,
  createRegionDamage,
  damageModifiers,
  overallDamage,
  type RegionDamage,
} from './damage'

/**
 * Converts the arcade `acceleration` stat into Newtons. Tuned so the starter
 * hatch pulls ~7.5 m/s² and the supercar ~13 m/s².
 */
const DRIVE_FORCE_SCALE = 0.6
const BRAKE_FORCE_SCALE = 0.5
/** Extra downward force proportional to v², keeps cars planted at speed. */
const DOWNFORCE = 0.55
/** How much of a wheel's lateral slip is cancelled per step before clamping. */
const LATERAL_STIFFNESS = 0.85
/** Longitudinal traction budget relative to lateral, so wheelspin is rarer than slides. */
const LONGITUDINAL_GRIP_SCALE = 1.35
const HANDBRAKE_REAR_GRIP = 0.22
/** Constant rolling resistance, as a fraction of vehicle weight. */
const ROLLING_RESISTANCE = 0.022
/** Hard ceiling on speed, as a multiple of the quoted top speed. */
const OVERSPEED_LIMIT = 1.08
/** Per-wheel suspension force ceiling, as a multiple of vehicle mass. */
const MAX_SUSPENSION_G = 42
/** Torque applied per unit of input while all four wheels are off the ground. */
const AIR_CONTROL = 2.6
/**
 * How hard the car is pulled toward the yaw rate its steering asks for, in
 * 1/seconds. A raycast car has no self-centring of its own: with the wheels
 * straight, a car that is already rotating has no lateral slip for the tires to
 * resist, so the rotation locks in and the car curves away forever. Real cars
 * self-centre through steering geometry; this does the same job directly, and
 * is also what makes turn-in feel immediate rather than vague.
 */
const YAW_ASSIST = 8

export interface WheelState {
  /** Chassis-local hardpoint the suspension ray starts from. */
  local: THREE.Vector3
  isFront: boolean
  isLeft: boolean
  grounded: boolean
  /** 0..1 suspension compression, for visuals. */
  compression: number
  /** Last suspension force in Newtons. */
  load: number
  /** Longitudinal slip magnitude, drives skid smoke. */
  slip: number
  /** Accumulated spin angle for wheel rotation. */
  spin: number
  contactPoint: THREE.Vector3
  contactNormal: THREE.Vector3
  /** Surface grip multiplier from whatever the wheel is touching. */
  surfaceGrip: number
}

export interface VehicleOptions {
  id: string
  spec: VehicleSpec
  upgrades: VehicleUpgrades
  customization: VehicleCustomization
  position: THREE.Vector3
  heading: number
  isLocal: boolean
}

// Scratch vectors. Each has exactly one role so no two call sites can alias —
// an earlier version reused these and silently broke three of the four wheels.
const _tmpA = new THREE.Vector3()
const _tmpB = new THREE.Vector3()
const _q1 = new THREE.Quaternion()
const _m1 = new THREE.Matrix4()

/**
 * Raycast vehicle: one rigid-body chassis plus four spring rays. This keeps
 * collisions fully rigid-body (so crashes are real physics) while handling stays
 * arcade — no tire model, no gearbox, no engine map.
 */
export class Vehicle {
  readonly id: string
  readonly spec: VehicleSpec
  readonly upgrades: VehicleUpgrades
  readonly isLocal: boolean
  readonly body: RAPIER.RigidBody
  readonly collider: RAPIER.Collider
  readonly mesh: VehicleMeshParts
  readonly object: THREE.Group
  readonly wheels: WheelState[] = []
  readonly damage: VehicleDamage = createDamage()
  readonly regionDamage: RegionDamage = createRegionDamage()

  /** Derived stats after upgrades; recomputed when upgrades change. */
  private power = 0
  private topSpeed = 0
  private brakePower = 0
  private baseGrip = 0
  private maxSteer = 0
  /**
   * Aerodynamic drag coefficient, solved so that full throttle balances drag
   * exactly at the car's quoted top speed. Without a real drag term the only
   * limiter is the drive-force falloff, and cars creep toward a speed they never
   * actually reach — which made every number in the garage a lie.
   */
  private dragCoefficient = 0
  /** Yaw inertia and wheelbase, cached for the steering assist. */
  private readonly inertiaY: number
  private readonly wheelbase: number

  private steerAngle = 0
  private boostFuel = 0
  private boosting = false
  private groundedCount = 0
  private airborneTime = 0
  private lastAirborneTime = 0
  private flipCount = 0
  private lastUpDot = 1
  private tractionPenalty = 1
  private tractionPenaltyTimer = 0
  private recoverCooldown = 0
  private distanceAccum = 0

  /** Last known safe upright position, used by Recover. */
  private safePosition = new THREE.Vector3()
  private safeHeading = 0
  private safeTimer = 0

  private readonly renderPos = new THREE.Vector3()
  private readonly renderQuat = new THREE.Quaternion()
  private readonly prevPos = new THREE.Vector3()
  private readonly prevQuat = new THREE.Quaternion()
  private readonly currPos = new THREE.Vector3()
  private readonly currQuat = new THREE.Quaternion()

  /** Reused across wheels and steps; ray casting is the hottest path here. */
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
  /** Chassis basis for the current step. */
  private readonly up = new THREE.Vector3(0, 1, 0)
  private readonly forward = new THREE.Vector3(0, 0, 1)
  private readonly right = new THREE.Vector3(1, 0, 0)
  /** Wheel-local scratch, only ever touched inside `updateWheel`. */
  private readonly wOrigin = new THREE.Vector3()
  private readonly wContactVel = new THREE.Vector3()
  private readonly wForward = new THREE.Vector3()
  private readonly wRight = new THREE.Vector3()
  private readonly wImpulse = new THREE.Vector3()
  /** Drive/brake impulse summed over the wheels, applied once per step. */
  private readonly driveImpulse = new THREE.Vector3()
  private readonly driveTorque = new THREE.Vector3()
  private readonly wLever = new THREE.Vector3()
  /** Velocity entering the current solver step, for impact detection. */
  private readonly stepStartVel = new THREE.Vector3()
  /** Largest single-step velocity change since the last `consumeImpact()`. */
  private lastDeltaV = 0
  /** Unit direction the car was shoved in during that step. */
  private readonly lastImpactDir = new THREE.Vector3()
  private readonly physics: PhysicsWorld
  /** Set by whoever owns surface queries (world builder) to look up terrain grip. */
  surfaceGripAt: ((x: number, z: number) => number) | null = null

  constructor(physics: PhysicsWorld, options: VehicleOptions) {
    this.physics = physics
    this.id = options.id
    this.spec = options.spec
    this.upgrades = { ...options.upgrades }
    this.isLocal = options.isLocal

    const { halfWidth: hw, halfHeight: hh, halfLength: hl } = options.spec.dimensions

    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), options.heading)
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(options.position.x, options.position.y, options.position.z)
      .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w })
      .setLinearDamping(0.06)
      .setAngularDamping(0.45)
      .setCcdEnabled(true)
      .setCanSleep(false)
    this.body = physics.world.createRigidBody(desc)

    // Density 0: mass properties are set explicitly below so we can place the
    // centre of mass low without moving the collision shape.
    const colliderDesc = RAPIER.ColliderDesc.cuboid(hw, hh, hl)
      .setDensity(0)
      .setFriction(0.32)
      .setRestitution(0.14)
      .setCollisionGroups(
        (COLLISION_GROUPS.VEHICLE << 16) | (COLLISION_GROUPS.WORLD | COLLISION_GROUPS.VEHICLE | COLLISION_GROUPS.PROP),
      )
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(CRASH_CONTACT_FORCE_GATE * 0.5)
    this.collider = physics.world.createCollider(colliderDesc, this.body)

    const m = options.spec.mass
    const w = hw * 2
    const h = hh * 2
    const l = hl * 2
    // 0.82 factor: slightly low inertia turns in more eagerly than a real box would.
    const inertia = {
      x: (m / 12) * (h * h + l * l) * 0.82,
      y: (m / 12) * (w * w + l * l) * 0.82,
      z: (m / 12) * (w * w + h * h) * 0.82,
    }
    this.body.setAdditionalMassProperties(
      m,
      { x: 0, y: -hh * 0.55, z: 0 },
      inertia,
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    )
    this.inertiaY = inertia.y
    this.wheelbase = Math.max(1, options.spec.wheel.frontOffsetZ - options.spec.wheel.rearOffsetZ)

    const wheelY = -hh * 0.25
    const layout: Array<[number, number, boolean, boolean]> = [
      [-options.spec.wheel.offsetX, options.spec.wheel.frontOffsetZ, true, true],
      [options.spec.wheel.offsetX, options.spec.wheel.frontOffsetZ, true, false],
      [-options.spec.wheel.offsetX, options.spec.wheel.rearOffsetZ, false, true],
      [options.spec.wheel.offsetX, options.spec.wheel.rearOffsetZ, false, false],
    ]
    for (const [x, z, isFront, isLeft] of layout) {
      this.wheels.push({
        local: new THREE.Vector3(x, wheelY, z),
        isFront,
        isLeft,
        grounded: false,
        compression: 0,
        load: 0,
        slip: 0,
        spin: 0,
        contactPoint: new THREE.Vector3(),
        contactNormal: new THREE.Vector3(0, 1, 0),
        surfaceGrip: 1,
      })
    }

    this.mesh = buildVehicleMesh(options.spec, options.customization)
    this.object = this.mesh.root
    this.object.position.copy(options.position)
    this.object.quaternion.copy(rotation)

    this.currPos.copy(options.position)
    this.prevPos.copy(options.position)
    this.currQuat.copy(rotation)
    this.prevQuat.copy(rotation)
    this.safePosition.copy(options.position)
    this.safeHeading = options.heading

    this.recomputeStats()
    this.boostFuel = options.spec.boost?.capacity ?? 0
  }

  /** Recomputes upgrade-derived stats. Call after changing `upgrades`. */
  recomputeStats(): void {
    const s = this.spec
    this.power = s.acceleration * s.mass * DRIVE_FORCE_SCALE * upgradeMultiplier('acceleration', this.upgrades.acceleration)
    this.topSpeed = s.topSpeed * upgradeMultiplier('engine', this.upgrades.engine)
    this.brakePower = s.braking * s.mass * BRAKE_FORCE_SCALE * upgradeMultiplier('brakes', this.upgrades.brakes)
    this.baseGrip = s.grip * upgradeMultiplier('handling', this.upgrades.handling)
    this.maxSteer = s.steering * Math.min(1.12, upgradeMultiplier('handling', this.upgrades.handling))
    this.dragCoefficient = this.power / (this.topSpeed * this.topSpeed)
  }

  get speed(): number {
    const v = this.body.linvel()
    return Math.hypot(v.x, v.y, v.z)
  }

  get forwardSpeed(): number {
    const v = this.body.linvel()
    _tmpA.set(0, 0, 1).applyQuaternion(this.currQuat)
    return _tmpA.x * v.x + _tmpA.y * v.y + _tmpA.z * v.z
  }

  /**
   * Largest velocity change the solver applied in a single step since this was
   * last consumed. This is the crash signal: driving forces move it by a few
   * cm/s per step, a collision moves it by metres per second, and it is
   * mass-independent so one threshold works for every car.
   */
  get impactDeltaV(): number {
    return this.lastDeltaV
  }

  /**
   * World-space direction the car was pushed by the last impact. The panel that
   * took the hit is the one facing the opposite way. Derived from the velocity
   * change rather than the contact normal, because Rapier's reported force
   * direction depends on which collider landed in slot 1.
   */
  get impactDirection(): THREE.Vector3 {
    return this.lastImpactDir
  }

  consumeImpact(): void {
    this.lastDeltaV = 0
  }

  /**
   * Must be called immediately after the solver step, before contact events are
   * drained — otherwise the measured change belongs to the previous step and
   * every impact is attributed one step late.
   */
  postStep(): void {
    const v = this.body.linvel()
    const dx = v.x - this.stepStartVel.x
    const dy = v.y - this.stepStartVel.y
    const dz = v.z - this.stepStartVel.z
    const delta = Math.hypot(dx, dy, dz)
    if (delta > this.lastDeltaV) {
      this.lastDeltaV = delta
      this.lastImpactDir.set(dx / delta, dy / delta, dz / delta)
    }
  }

  get grounded(): boolean {
    return this.groundedCount > 0
  }

  get airtime(): number {
    return this.airborneTime
  }

  get lastAirtime(): number {
    return this.lastAirborneTime
  }

  get flips(): number {
    return this.flipCount
  }

  /** Current front-wheel steering angle in radians (replicated for visuals). */
  get steer(): number {
    return this.steerAngle
  }

  get isBoosting(): boolean {
    return this.boosting
  }

  get boostRatio(): number {
    const cap = this.spec.boost?.capacity ?? 0
    return cap > 0 ? this.boostFuel / cap : 0
  }

  get damageLevel(): number {
    return overallDamage(this.damage)
  }

  get canRecover(): boolean {
    return this.recoverCooldown <= 0
  }

  get recoverCooldownRemaining(): number {
    return Math.max(0, this.recoverCooldown)
  }

  /** Metres travelled since the last call. */
  consumeDistance(): number {
    const d = this.distanceAccum
    this.distanceAccum = 0
    return d
  }

  /** Temporarily kills grip — used by oil slicks and spike strips. */
  applyTractionPenalty(multiplier: number, seconds: number): void {
    this.tractionPenalty = Math.min(this.tractionPenalty, multiplier)
    this.tractionPenaltyTimer = Math.max(this.tractionPenaltyTimer, seconds)
  }

  applyDamage(region: DamageRegion, severity: number): void {
    const resistance = this.spec.crashResistance * upgradeMultiplier('durability', this.upgrades.durability)
    // resistance 0 => full severity; a fully-upgraded Tundrak takes about 45%.
    const scaled = severity / (1 + resistance * 1.5)
    applyRegionDamage(this.damage, this.regionDamage, region, scaled)
    this.updateDamageVisuals()
  }

  repair(): void {
    for (const key of Object.keys(this.damage) as Array<keyof VehicleDamage>) this.damage[key] = 0
    this.regionDamage.front = 0
    this.regionDamage.rear = 0
    this.regionDamage.left = 0
    this.regionDamage.right = 0
    this.regionDamage.roof = 0
    this.updateDamageVisuals()
  }

  /** Crumples panels and drops trim to match the current damage state. */
  private updateDamageVisuals(): void {
    const p = this.mesh.panels
    const r = this.regionDamage

    p.front.scale.set(1 - r.front * 0.18, 1 - r.front * 0.3, 1 - r.front * 0.42)
    p.front.rotation.set(r.front * 0.22, r.front * 0.1, r.front * 0.14)
    p.rear.scale.set(1 - r.rear * 0.16, 1 - r.rear * 0.28, 1 - r.rear * 0.4)
    p.rear.rotation.set(-r.rear * 0.2, -r.rear * 0.1, -r.rear * 0.12)
    p.roof.scale.set(1 - r.roof * 0.12, 1 - r.roof * 0.45, 1 - r.roof * 0.14)
    p.roof.rotation.z = r.roof * 0.1
    p.left.position.x = -this.spec.dimensions.halfWidth + r.left * 0.16
    p.left.rotation.z = -r.left * 0.2
    p.right.position.x = this.spec.dimensions.halfWidth - r.right * 0.16
    p.right.rotation.z = r.right * 0.2

    for (const glass of this.mesh.glass) glass.visible = this.damage.windows < 0.75
    this.mesh.detachable[0].visible = r.front < 0.6
    this.mesh.detachable[1].visible = r.rear < 0.6

    // Paint darkens and dulls as the body gets wrecked.
    this.mesh.bodyMaterial.roughness = 0.34 + this.damage.body * 0.5
    this.mesh.bodyMaterial.metalness = 0.42 - this.damage.body * 0.3
  }

  /** Puts the car back on its wheels at the last safe spot. */
  recover(spawn?: { position: THREE.Vector3; heading: number }): void {
    const pos = spawn ? spawn.position : this.safePosition
    const heading = spawn ? spawn.heading : this.safeHeading
    const q = _q1.setFromAxisAngle(_tmpA.set(0, 1, 0), heading)
    const y = this.groundedHeightAt(pos.x, pos.y, pos.z)
    this.body.setTranslation({ x: pos.x, y, z: pos.z }, true)
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.recoverCooldown = 3
    this.airborneTime = 0
    this.flipCount = 0
    this.tractionPenalty = 1
    this.tractionPenaltyTimer = 0
    this.syncFromBody(true)
  }

  /**
   * Finds the chassis height that puts the wheels on the ground at their normal
   * ride height. Dropping the car from a guess bottoms the suspension and
   * bounces it, which makes recovery feel broken.
   */
  private groundedHeightAt(x: number, yHint: number, z: number): number {
    const spec = this.spec
    const rideHeight =
      spec.wheel.radius + spec.suspension.restLength * 0.62 + spec.dimensions.halfHeight * 0.25
    this.ray.origin.x = x
    this.ray.origin.y = yHint + 6
    this.ray.origin.z = z
    this.ray.dir.x = 0
    this.ray.dir.y = -1
    this.ray.dir.z = 0
    const hit = this.physics.world.castRay(this.ray, 40, true, undefined, undefined, undefined, this.body)
    const groundY = hit ? yHint + 6 - hit.timeOfImpact : 0
    return groundY + rideHeight
  }

  /** Called once per fixed physics step, before `world.step`. */
  update(dt: number, input: DriveInput): void {
    this.prevPos.copy(this.currPos)
    this.prevQuat.copy(this.currQuat)
    this.syncFromBody(false)

    const linvel = this.body.linvel()
    this.stepStartVel.set(linvel.x, linvel.y, linvel.z)

    if (this.recoverCooldown > 0) this.recoverCooldown -= dt
    if (this.tractionPenaltyTimer > 0) {
      this.tractionPenaltyTimer -= dt
      if (this.tractionPenaltyTimer <= 0) this.tractionPenalty = 1
    }

    const mods = damageModifiers(this.damage, this.regionDamage.left > this.regionDamage.right ? 1 : -1)
    const rot = this.currQuat
    const up = this.up.set(0, 1, 0).applyQuaternion(rot)
    const forward = this.forward.set(0, 0, 1).applyQuaternion(rot)
    const right = this.right.set(1, 0, 0).applyQuaternion(rot)

    // --- Steering -----------------------------------------------------------
    const speed = this.speed
    const speedRatio = Math.min(1, speed / Math.max(1, this.topSpeed))
    // Steering authority drops with speed so the car does not snap-spin at 200 km/h.
    const steerLimit = this.maxSteer * mods.steerRange * (1 - speedRatio * 0.55)
    const targetSteer = input.steer * steerLimit + mods.steerBias
    this.steerAngle += (targetSteer - this.steerAngle) * Math.min(1, 14 * dt)

    // --- Boost --------------------------------------------------------------
    const boostSpec = this.spec.boost
    if (boostSpec) {
      this.boosting = input.boost && this.boostFuel > 0.02 && this.damage.engine < 0.9
      if (this.boosting) this.boostFuel = Math.max(0, this.boostFuel - dt)
      else this.boostFuel = Math.min(boostSpec.capacity, this.boostFuel + boostSpec.regen * dt)
    } else {
      this.boosting = false
    }

    this.groundedCount = 0
    let totalLoad = 0
    for (const wheel of this.wheels) this.updateWheel(wheel, dt, up, forward, right, input, mods)
    for (const wheel of this.wheels) totalLoad += wheel.load

    // --- Airborne handling --------------------------------------------------
    if (this.groundedCount === 0) {
      this.airborneTime += dt
      if (this.airborneTime > 0.18) {
        // Pitch with throttle/brake, roll+yaw with steering. Makes jumps playful.
        const t = AIR_CONTROL * this.spec.mass * 0.5
        _tmpA.copy(right).multiplyScalar((input.brake - input.throttle) * t)
        this.body.applyTorqueImpulse({ x: _tmpA.x * dt, y: _tmpA.y * dt, z: _tmpA.z * dt }, true)
        _tmpA.copy(forward).multiplyScalar(input.steer * t * 1.2)
        this.body.applyTorqueImpulse({ x: _tmpA.x * dt, y: _tmpA.y * dt, z: _tmpA.z * dt }, true)
        _tmpA.set(0, input.steer * t * 0.35, 0)
        this.body.applyTorqueImpulse({ x: _tmpA.x * dt, y: _tmpA.y * dt, z: _tmpA.z * dt }, true)
      }
    } else {
      if (this.airborneTime > 0.35) this.lastAirborneTime = this.airborneTime
      this.airborneTime = 0
      // Downforce scales with v²; without it cars go light and skittish at speed.
      const df = DOWNFORCE * this.spec.mass * speedRatio * speedRatio
      this.body.applyImpulseAtPoint(
        { x: -up.x * df * dt, y: -up.y * df * dt, z: -up.z * df * dt },
        this.body.translation(),
        true,
      )
    }

    // Aerodynamic drag, on the body rather than through the tires so it applies
    // in the air too and is never clipped by the traction budget.
    if (speed > 0.5) {
      const linvel = this.body.linvel()
      const drag = this.dragCoefficient * speed * speed * dt
      this.body.applyImpulse(
        {
          x: (-linvel.x / speed) * drag,
          y: (-linvel.y / speed) * drag * 0.3,
          z: (-linvel.z / speed) * drag,
        },
        true,
      )
    }

    this.applyDriveForces(right)

    // --- Steering assist -----------------------------------------------------
    if (this.groundedCount > 0) {
      const yaw = this.body.angvel().y
      // The yaw rate the front wheels are asking for, from bicycle geometry.
      const targetYaw = (this.forwardSpeed * Math.tan(this.steerAngle)) / this.wheelbase
      // Authority falls away as the car leaves the ground, goes sideways or
      // pulls the handbrake, so drifts stay drifts instead of being corrected
      // out from under the player.
      // Damping only: the assist may slow a rotation the driver did not ask
      // for, never add one. Adding rotation lets it spin the body while the
      // velocity carries straight on, and the car crabs sideways at absurd slip
      // angles under any steering input the tires cannot actually deliver.
      const overRotating =
        Math.sign(yaw) !== Math.sign(targetYaw) || Math.abs(yaw) > Math.abs(targetYaw)
      if (overRotating) {
        let slip = 0
        for (const wheel of this.wheels) slip = Math.max(slip, wheel.slip)
        const authority =
          (this.groundedCount / 4) * (input.handbrake ? 0.2 : 1) * (1 - Math.min(0.75, slip * 0.75))
        const torque = (targetYaw - yaw) * this.inertiaY * YAW_ASSIST * authority
        this.body.applyTorqueImpulse({ x: 0, y: torque * dt, z: 0 }, true)
      }
    }

    // Count flips for crash scoring: each time the car passes through inverted.
    const upDot = up.y
    if (this.lastUpDot > 0 && upDot <= 0) this.flipCount++
    this.lastUpDot = upDot

    // --- Boost thrust -------------------------------------------------------
    if (this.boosting && boostSpec) {
      const f = boostSpec.force * mods.power
      this.body.applyImpulseAtPoint(
        { x: forward.x * f * dt, y: forward.y * f * dt, z: forward.z * f * dt },
        this.body.translation(),
        true,
      )
    }

    // Track a safe respawn point while upright, on the ground and roughly still.
    this.safeTimer -= dt
    if (this.safeTimer <= 0 && this.groundedCount >= 3 && up.y > 0.8 && speed < 42) {
      this.safeTimer = 0.75
      this.safePosition.copy(this.currPos)
      this.safeHeading = Math.atan2(forward.x, forward.z)
    }

    this.distanceAccum += speed * dt
    void totalLoad
  }

  private updateWheel(
    wheel: WheelState,
    dt: number,
    up: THREE.Vector3,
    forward: THREE.Vector3,
    right: THREE.Vector3,
    input: DriveInput,
    mods: ReturnType<typeof damageModifiers>,
  ): void {
    const spec = this.spec
    const susp = spec.suspension
    const maxDistance = susp.restLength + spec.wheel.radius

    // Ray origin: the suspension hardpoint in world space.
    const origin = this.wOrigin.copy(wheel.local).applyQuaternion(this.currQuat).add(this.currPos)
    this.ray.origin.x = origin.x
    this.ray.origin.y = origin.y
    this.ray.origin.z = origin.z
    this.ray.dir.x = -up.x
    this.ray.dir.y = -up.y
    this.ray.dir.z = -up.z
    const hit = this.physics.world.castRayAndGetNormal(
      this.ray,
      maxDistance,
      true,
      undefined,
      undefined,
      undefined,
      this.body,
    )

    if (!hit) {
      wheel.grounded = false
      wheel.load = 0
      wheel.compression = Math.max(0, wheel.compression - dt * 6)
      wheel.slip *= 0.9
      wheel.spin += this.forwardSpeed / spec.wheel.radius * dt
      return
    }

    wheel.grounded = true
    this.groundedCount++
    const distance = hit.timeOfImpact
    const compression = maxDistance - distance
    wheel.compression = Math.min(1, compression / Math.max(0.01, susp.travel + 0.001))
    wheel.contactPoint.copy(origin).addScaledVector(up, -distance)
    wheel.contactNormal.set(hit.normal.x, hit.normal.y, hit.normal.z)
    wheel.surfaceGrip = this.surfaceGripAt?.(wheel.contactPoint.x, wheel.contactPoint.z) ?? 1

    // --- Suspension ---------------------------------------------------------
    const contactVel = this.velocityAtPoint(wheel.contactPoint, this.wContactVel)
    const verticalVel = contactVel.dot(up)
    const stiffnessN = susp.stiffness * spec.mass
    const dampingN = susp.damping * spec.mass * (0.4 + 0.6 * mods.damping)
    let suspensionForce = compression * stiffnessN - verticalVel * dampingN
    // Springs push, they never pull the car down onto the road. The ceiling
    // stops a hard landing from firing the car back into orbit.
    suspensionForce = Math.max(0, Math.min(suspensionForce, spec.mass * MAX_SUSPENSION_G))
    wheel.load = suspensionForce

    // Along the contact normal, not the chassis up axis. Once the body rolls,
    // a force along chassis-up has a horizontal component, and four of them at
    // four asymmetrically-loaded contact points add up to a steady yaw torque
    // that quietly steers the car off a straight line.
    _tmpB.copy(wheel.contactNormal).multiplyScalar(suspensionForce * dt)
    this.body.applyImpulseAtPoint({ x: _tmpB.x, y: _tmpB.y, z: _tmpB.z }, wheel.contactPoint, true)

    // --- Traction -----------------------------------------------------------
    // Wheel basis projected onto the contact plane.
    const steer = wheel.isFront ? this.steerAngle : 0
    const wheelForward = this.wForward.copy(forward).applyAxisAngle(up, steer)
    const wheelRight = this.wRight.copy(right).applyAxisAngle(up, steer)
    const n = wheel.contactNormal
    wheelForward.addScaledVector(n, -wheelForward.dot(n)).normalize()
    wheelRight.addScaledVector(n, -wheelRight.dot(n)).normalize()

    const surface = wheel.surfaceGrip * this.tractionPenalty
    const gripCoefficient = this.baseGrip * mods.grip * surface
    const isRear = !wheel.isFront
    const handbrakeCut = input.handbrake && isRear ? HANDBRAKE_REAR_GRIP : 1
    const lateralBudget = gripCoefficient * handbrakeCut * suspensionForce * dt
    // Handbrake-and-throttle is the drift control: rear lateral grip collapses
    // but the rears keep driving, so the slide can be held. Handbrake alone
    // locks them and also cuts their longitudinal grip, so the car slides to a
    // stop rather than braking on rails.
    const longitudinalCut = input.handbrake && isRear && input.throttle < 0.02 ? 0.45 : 1
    const longitudinalBudget =
      gripCoefficient * LONGITUDINAL_GRIP_SCALE * longitudinalCut * suspensionForce * dt

    const cornerMass = spec.mass * 0.25
    const lateralVel = contactVel.dot(wheelRight)
    let lateralImpulse = -lateralVel * cornerMass * LATERAL_STIFFNESS
    lateralImpulse = THREE.MathUtils.clamp(lateralImpulse, -lateralBudget, lateralBudget)

    const longitudinalVel = contactVel.dot(wheelForward)
    let driveImpulse = 0

    const driven =
      spec.drivetrain === 'awd' || (spec.drivetrain === 'fwd' ? wheel.isFront : isRear)
    const drivenCount = spec.drivetrain === 'awd' ? 4 : 2

    if (input.handbrake && isRear && input.throttle < 0.02) {
      // Handbrake with no throttle: locked rears. Deliberately an impulse, not a
      // force — it asks to cancel the wheel's forward motion outright and is
      // then clipped to the traction budget, which is what a locked wheel does.
      driveImpulse = -longitudinalVel * cornerMass * 0.45
    } else if (input.throttle > 0.02 && driven) {
      // Thrust is flat; aerodynamic drag (applied to the body in `update`) is
      // what sets top speed. This only stops a downhill run from overspeeding.
      const ceiling = this.topSpeed * OVERSPEED_LIMIT
      const falloff = Math.max(0, 1 - Math.pow(Math.max(0, longitudinalVel) / ceiling, 6))
      driveImpulse = (input.throttle * this.power * mods.power * falloff * dt) / drivenCount
    }

    if (input.brake > 0.02) {
      if (longitudinalVel > 0.4) {
        driveImpulse -= (input.brake * this.brakePower * mods.braking * dt) / 4
      } else {
        // Brake at a standstill becomes reverse; capped well below forward speed.
        const reverseTop = this.topSpeed * 0.32
        const falloff = Math.max(0, 1 - Math.abs(Math.min(0, longitudinalVel)) / reverseTop)
        if (driven) driveImpulse -= (input.brake * this.power * 0.55 * mods.power * falloff * dt) / drivenCount
      }
    }

    if (input.throttle < 0.02 && input.brake < 0.02) {
      // Rolling resistance, as a *force* (note the dt). An earlier version
      // applied this as a raw impulse, which coasted the car to a stop at
      // ~33 m/s² and made the whole world feel like treacle.
      const rolling = ROLLING_RESISTANCE * spec.mass * 22.5 * Math.sign(longitudinalVel)
      driveImpulse -= (rolling * dt) / 4
      // Below walking pace, settle the car instead of creeping forever.
      if (Math.abs(longitudinalVel) < 0.6) driveImpulse += -longitudinalVel * cornerMass * 0.4
    }

    const clampedDrive = THREE.MathUtils.clamp(driveImpulse, -longitudinalBudget, longitudinalBudget)
    // Slip = how much force the tire wanted but could not deliver, plus raw sideways
    // sliding. Drives skid marks, tire smoke and skid audio.
    const longitudinalSlip = Math.abs(driveImpulse - clampedDrive) / Math.max(1, longitudinalBudget)
    const lateralSlip = Math.max(0, Math.abs(lateralVel) - 1.2) * 0.12
    wheel.slip = Math.min(1, longitudinalSlip + lateralSlip)

    // Lateral force acts at the real contact patch: that offset is what turns
    // steering into yaw.
    const lateral = this.wImpulse.copy(wheelRight).multiplyScalar(lateralImpulse)
    this.body.applyImpulseAtPoint({ x: lateral.x, y: lateral.y, z: lateral.z }, wheel.contactPoint, true)

    // Drive and brake force is accumulated instead of applied here; `update`
    // applies the sum. See `applyDriveForces` for why.
    const longitudinal = this.wImpulse.copy(wheelForward).multiplyScalar(clampedDrive)
    this.driveImpulse.add(longitudinal)
    const com = this.body.worldCom()
    this.wLever.set(
      wheel.contactPoint.x - com.x,
      wheel.contactPoint.y - com.y,
      wheel.contactPoint.z - com.z,
    )
    this.driveTorque.x += this.wLever.y * longitudinal.z - this.wLever.z * longitudinal.y
    this.driveTorque.y += this.wLever.z * longitudinal.x - this.wLever.x * longitudinal.z
    this.driveTorque.z += this.wLever.x * longitudinal.y - this.wLever.y * longitudinal.x

    wheel.spin += (longitudinalVel / spec.wheel.radius) * dt
  }

  /**
   * Applies the accumulated drive/brake force as one impulse at the centre of
   * mass plus the pitch-and-roll couple it earned at the contact patches — with
   * the yaw component of that couple removed.
   *
   * Applying it at the patches directly looks more correct and is a trap. As
   * soon as the body rolls by a fraction of a degree the two patches stop being
   * symmetric about the centre of mass, so equal drive forces no longer cancel
   * in yaw; the resulting yaw causes more roll, and the car winds itself into a
   * permanent turn with the wheels pointing dead ahead. Measured, an untouched
   * car left a 200 m straight by 13 metres.
   *
   * The cost is that a genuine left/right traction split no longer steers the
   * car. That is a trade worth making: torque steer on split-mu is a detail,
   * and driving straight is not.
   */
  private applyDriveForces(right: THREE.Vector3): void {
    if (this.driveImpulse.lengthSq() > 1e-10) {
      this.body.applyImpulse(
        { x: this.driveImpulse.x, y: this.driveImpulse.y, z: this.driveImpulse.z },
        true,
      )
    }
    // Keep only the pitch component. For a laterally symmetric car the drive
    // couple *is* pure pitch — squat under power, dive under braking. Anything
    // about the other two axes is the geometric artifact of the contact patches
    // shifting, and it is what feeds back into yaw.
    const torque = this.driveTorque
    const pitch = torque.dot(right)
    if (Math.abs(pitch) > 1e-5) {
      torque.copy(right).multiplyScalar(pitch)
      this.body.applyTorqueImpulse({ x: torque.x, y: torque.y, z: torque.z }, true)
    }
    this.driveImpulse.set(0, 0, 0)
    this.driveTorque.set(0, 0, 0)
  }

  private velocityAtPoint(point: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    const linvel = this.body.linvel()
    const angvel = this.body.angvel()
    const com = this.body.worldCom()
    const rx = point.x - com.x
    const ry = point.y - com.y
    const rz = point.z - com.z
    return target.set(
      linvel.x + (angvel.y * rz - angvel.z * ry),
      linvel.y + (angvel.z * rx - angvel.x * rz),
      linvel.z + (angvel.x * ry - angvel.y * rx),
    )
  }

  private syncFromBody(resetInterpolation: boolean): void {
    const t = this.body.translation()
    const r = this.body.rotation()
    this.currPos.set(t.x, t.y, t.z)
    this.currQuat.set(r.x, r.y, r.z, r.w)
    if (resetInterpolation) {
      this.prevPos.copy(this.currPos)
      this.prevQuat.copy(this.currQuat)
    }
  }

  /** Called once per rendered frame with the physics interpolation factor. */
  render(alpha: number, dt: number): void {
    this.renderPos.copy(this.prevPos).lerp(this.currPos, alpha)
    this.renderQuat.copy(this.prevQuat).slerp(this.currQuat, alpha)
    this.object.position.copy(this.renderPos)
    this.object.quaternion.copy(this.renderQuat)

    const hh = this.spec.dimensions.halfHeight
    const susp = this.spec.suspension
    for (let i = 0; i < this.wheels.length; i++) {
      const wheel = this.wheels[i]
      const visual = this.mesh.wheels[i]
      const drop = wheel.grounded
        ? susp.restLength - (wheel.compression * (susp.travel + 0.001))
        : susp.restLength
      visual.position.y = -hh * 0.25 - drop
      visual.rotation.set(0, wheel.isFront ? this.steerAngle : 0, 0)
      // Wheel spin lives on the child tire meshes so steering stays on the pivot.
      for (const child of visual.children) child.rotation.x = wheel.spin
    }

    const braking = this.mesh.brakeLights.material as THREE.MeshStandardMaterial
    braking.emissiveIntensity = 0.5
    const flame = this.mesh.boostFlames.material as THREE.MeshBasicMaterial
    flame.opacity += ((this.boosting ? 0.85 : 0) - flame.opacity) * Math.min(1, dt * 14)
    this.mesh.boostFlames.visible = flame.opacity > 0.02
    this.mesh.boostFlames.scale.z = 1.1 + Math.random() * 0.5 * flame.opacity
  }

  setBrakeLights(on: boolean): void {
    const mat = this.mesh.brakeLights.material as THREE.MeshStandardMaterial
    mat.emissiveIntensity = on ? 2.2 : 0.5
  }

  /** Position/rotation for camera and HUD, already interpolated. */
  get renderPosition(): THREE.Vector3 {
    return this.renderPos
  }

  get renderRotation(): THREE.Quaternion {
    return this.renderQuat
  }

  get position(): THREE.Vector3 {
    return this.currPos
  }

  get rotation(): THREE.Quaternion {
    return this.currQuat
  }

  /** Teleports without the recovery cooldown — used on spawn and vehicle swap. */
  teleport(position: THREE.Vector3, heading: number): void {
    const q = _q1.setFromAxisAngle(_tmpA.set(0, 1, 0), heading)
    this.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true)
    this.lastDeltaV = 0
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.safePosition.copy(position)
    this.safeHeading = heading
    this.syncFromBody(true)
    this.object.position.copy(position)
    this.object.quaternion.copy(q)
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.object)
    this.mesh.dispose()
    this.physics.world.removeRigidBody(this.body)
  }

  /** Local-space direction of a world-space impact, for damage regions. */
  localDirection(worldDir: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    _m1.makeRotationFromQuaternion(this.currQuat).invert()
    return target.copy(worldDir).applyMatrix4(_m1)
  }
}
