import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { COLLISION_GROUPS, CRASH_CONTACT_FORCE_GATE } from '@/config/constants'
import {
  TRAFFIC_COLORS,
  TRAFFIC_DENSITY,
  TRAFFIC_DESPAWN,
  TRAFFIC_SILHOUETTES,
  TRAFFIC_SPAWN_MAX,
  TRAFFIC_SPAWN_MIN,
  TRAFFIC_SPAWN_VIEW_MIN,
  TRAFFIC_WRECK_LIFETIME,
  type TrafficSilhouette,
} from '@/config/traffic'
import { GADGETS } from '@/config/gadgets'
import type { PhysicsWorld } from '@/game/physics/PhysicsWorld'
import { enableInstanceColors } from '@/game/effects/instancedColor'
import type { ActiveHazard } from '@/game/gadgets/GadgetSystem'
import { TrafficNetwork, type Lane } from './TrafficNetwork'

/** Everything the traffic needs to know about the rest of the frame. */
export interface TrafficContext {
  playerPosition: THREE.Vector3 | null
  /** Where the camera looks, so cars do not appear on screen. */
  viewDirection: THREE.Vector3 | null
  playerVelocity: THREE.Vector3 | null
  /** Live gadget hazards, or null when nothing is dropped. */
  hazards: ReadonlyMap<string, ActiveHazard> | null
}

interface TrafficCar {
  silhouette: number
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
  color: THREE.Color
  lane: Lane
  next: Lane
  /** Distance travelled along the current lane. */
  s: number
  speed: number
  /** Per-car speed preference, so the traffic is not a metronome. */
  mood: number
  heading: number
  wrecked: boolean
  wreckedAt: number
  /** Driving badly until this time: blinded by smoke, or sliding on oil. */
  crawlUntil: number
  position: THREE.Vector3
}

const RIDE_HEIGHT_MARGIN = 0.34
/** How far ahead the steering aims. Longer means smoother, lazier corners. */
const LOOKAHEAD_MIN = 7
const LOOKAHEAD_FACTOR = 0.75
const MAX_YAW_RATE = 1.6
const ACCEL = 6
const BRAKE = 14
/** Cars closer than this ahead in the same lane cause braking. */
const FOLLOW_DISTANCE = 26
/** An impact this close in time, and this near a miss, releases a car early. */
const BRACE_TIME = 0.6
const BRACE_MISS = 3
const BRACE_CLOSING_SPEED = 4
/** Only cars this close are even considered for an early release. */
const BRACE_DISTANCE = 30
/** How long a car keeps driving badly after a hazard, and how slowly. */
const CRAWL_TIME = 2.5
const CRAWL_SPEED = 3
/** How far off line an oil slick throws a car, in radians. */
const OIL_SWERVE = 0.3

/** Horizontal half-angle counted as "on screen", with a margin on the camera. */
const VIEW_COS = Math.cos(THREE.MathUtils.degToRad(55))
/** Eye and roof heights for the line-of-sight test. */
const EYE_HEIGHT = 1.6
const ROOF_HEIGHT = 0.9
/** Membership PROP, filter WORLD: the sight ray only ever hits the scenery. */
const SIGHT_FILTER = (COLLISION_GROUPS.PROP << 16) | COLLISION_GROUPS.WORLD

const _v = new THREE.Vector3()
const _eye = new THREE.Vector3()
const _view = new THREE.Vector3()
const _target = new THREE.Vector3()
const _matrix = new THREE.Matrix4()
const _quat = new THREE.Quaternion()
const _scale = new THREE.Vector3(1, 1, 1)
const _up = new THREE.Vector3(0, 1, 0)

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Cars that drive themselves around the road network.
 *
 * They are kinematic while driving, which keeps them cheap and makes them shove
 * the player rather than being shoved. The moment one takes a real hit it turns
 * into an ordinary dynamic body and tumbles, so the interesting case is the only
 * one that costs anything.
 *
 * All of them draw from one instanced mesh per silhouette, so a full city of
 * traffic is three draw calls.
 */
export class TrafficSystem {
  readonly object = new THREE.Group()
  readonly network = new TrafficNetwork()

  private readonly cars: TrafficCar[] = []
  private readonly byCollider = new Map<number, TrafficCar>()
  private readonly sightRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })
  private readonly batches: THREE.InstancedMesh[] = []
  private readonly colorAttributes: THREE.InstancedBufferAttribute[] = []
  private readonly physics: PhysicsWorld
  private readonly random = mulberry32(0xc0ffee)
  private readonly weights: number[]
  private time = 0
  private enabled = true
  private unsubscribeContacts: (() => void) | null = null

  constructor(physics: PhysicsWorld) {
    this.physics = physics
    this.object.name = 'traffic'
    this.weights = TRAFFIC_SILHOUETTES.map((s) => s.weight)

    for (const silhouette of TRAFFIC_SILHOUETTES) {
      const geometry = enableInstanceColors(buildSilhouetteGeometry(silhouette))
      // vertexColors lets the geometry's own tints (glass, tyres) survive being
      // multiplied by the per-instance paint.
      const material = new THREE.MeshStandardMaterial({
        metalness: 0.4,
        roughness: 0.45,
        vertexColors: true,
      })
      const mesh = new THREE.InstancedMesh(geometry, material, TRAFFIC_DENSITY + 8)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.frustumCulled = false
      mesh.count = 0
      const colors = new THREE.InstancedBufferAttribute(
        new Float32Array((TRAFFIC_DENSITY + 8) * 3).fill(1),
        3,
      )
      mesh.instanceColor = colors
      this.object.add(mesh)
      this.batches.push(mesh)
      this.colorAttributes.push(colors)
    }

    this.unsubscribeContacts = physics.addContactHandler(this.onContact)
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return
    this.enabled = enabled
    if (!enabled) this.clear()
  }

  get count(): number {
    return this.cars.length
  }

  get wreckCount(): number {
    return this.cars.filter((c) => c.wrecked).length
  }

  /** Any contact hard enough turns a driving car into a loose one. */
  private readonly onContact = (
    colliderA: number,
    colliderB: number,
    magnitude: number,
    dirX: number,
    dirY: number,
    dirZ: number,
  ): void => {
    if (magnitude < CRASH_CONTACT_FORCE_GATE * 0.4) return
    const a = this.byCollider.get(colliderA)
    const b = this.byCollider.get(colliderB)
    if (a && !a.wrecked) this.wreck(a, dirX, dirY, dirZ, magnitude)
    if (b && !b.wrecked) this.wreck(b, -dirX, -dirY, -dirZ, magnitude)
  }

  /**
   * Hands a car to the solver, carrying its driving speed over so it does not
   * stop dead at the moment it stops being scripted.
   */
  private goDynamic(car: TrafficCar): void {
    car.wrecked = true
    car.wreckedAt = this.time
    car.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
    car.body.setEnabledRotations(true, true, true, true)
    car.body.setLinvel(
      { x: Math.sin(car.heading) * car.speed, y: 0, z: Math.cos(car.heading) * car.speed },
      true,
    )
  }

  /**
   * A kinematic body has infinite mass: hitting one is hitting a wall, and it
   * would total the player at any speed. Cars about to be hit are released to
   * the solver a moment early, so the impact is one car against another.
   */
  private braceForImpact(car: TrafficCar, position: THREE.Vector3, velocity: THREE.Vector3): boolean {
    const rx = car.position.x - position.x
    const rz = car.position.z - position.z
    const vx = velocity.x - Math.sin(car.heading) * car.speed
    const vz = velocity.z - Math.cos(car.heading) * car.speed
    const closing = vx * vx + vz * vz
    if (closing < BRACE_CLOSING_SPEED * BRACE_CLOSING_SPEED) return false
    // Time of closest approach, and how far apart the two are at that moment.
    // `r` points at the car and shrinks at the closing velocity, so the gap at
    // time t is r - v*t.
    const t = (rx * vx + rz * vz) / closing
    if (t <= 0 || t > BRACE_TIME) return false
    const missX = rx - vx * t
    const missZ = rz - vz * t
    return missX * missX + missZ * missZ < BRACE_MISS * BRACE_MISS
  }

  /**
   * Whatever the player dropped on the road applies to traffic too — which is
   * most of what makes a gadget worth carrying when nobody else is online.
   * Returns true when the car has been taken out of its lane.
   */
  private hazardHit(car: TrafficCar, hazards: ReadonlyMap<string, ActiveHazard>): boolean {
    for (const hazard of hazards.values()) {
      const radius = GADGETS[hazard.gadgetId].radius
      const dx = car.position.x - hazard.position.x
      const dz = car.position.z - hazard.position.z
      if (dx * dx + dz * dz > radius * radius) continue

      // Smoke and oil cost a driver control, not the car. Taking them out of
      // their lane instead leaves a wreck where they stood, and one slick on a
      // downtown avenue silts the whole street up within a minute.
      if (hazard.gadgetId === 'smoke_screen') {
        car.crawlUntil = this.time + CRAWL_TIME
        continue
      }
      if (hazard.gadgetId === 'oil_slick') {
        car.crawlUntil = this.time + CRAWL_TIME
        car.heading += (this.random() - 0.5) * OIL_SWERVE
        continue
      }

      const silhouette = TRAFFIC_SILHOUETTES[car.silhouette]
      this.goDynamic(car)
      if (hazard.gadgetId === 'bounce_pad') {
        car.body.applyImpulse({ x: 0, y: silhouette.mass * 12, z: 0 }, true)
      } else if (hazard.gadgetId === 'thumper') {
        // Thrown away from the charge, the same as a player's car.
        const length = Math.max(0.001, Math.hypot(dx, dz))
        const impulse = silhouette.mass * 9
        car.body.applyImpulse(
          { x: (dx / length) * impulse, y: impulse * 0.45, z: (dz / length) * impulse },
          true,
        )
      }
      const spin = silhouette.mass * (hazard.gadgetId === 'spike_strip' ? 9 : 5)
      car.body.applyTorqueImpulse({ x: 0, y: (this.random() - 0.5) * spin, z: 0 }, true)
      return true
    }
    return false
  }

  private wreck(car: TrafficCar, dx: number, dy: number, dz: number, magnitude: number): void {
    if (car.wrecked) return
    this.goDynamic(car)
    // Carry the hit through. Switching type alone leaves the car limp for a step
    // and it looks like it simply stopped rather than being hit.
    const silhouette = TRAFFIC_SILHOUETTES[car.silhouette]
    const impulse = Math.min(magnitude * 0.004, silhouette.mass * 12)
    car.body.applyImpulse({ x: dx * impulse, y: Math.abs(dy) * impulse * 0.35 + impulse * 0.12, z: dz * impulse }, true)
    car.body.applyTorqueImpulse(
      {
        x: (this.random() - 0.5) * impulse * 0.9,
        y: (this.random() - 0.5) * impulse * 1.4,
        z: (this.random() - 0.5) * impulse * 0.9,
      },
      true,
    )
  }

  private pickSilhouette(): number {
    const total = this.weights.reduce((a, b) => a + b, 0)
    let roll = this.random() * total
    for (let i = 0; i < this.weights.length; i++) {
      roll -= this.weights[i]
      if (roll <= 0) return i
    }
    return 0
  }

  private pickExit(lane: Lane): Lane {
    if (lane.exits.length === 0) return lane
    return lane.exits[Math.floor(this.random() * lane.exits.length)]
  }

  /**
   * Whether the player would watch a car appear at this spot. Being off to the
   * side counts as hidden, and so does having a building in the way — in a city
   * that second case is the common one, and it is what lets traffic stay dense
   * without popping in.
   */
  private inSight(near: THREE.Vector3, position: THREE.Vector3, viewDirection: THREE.Vector3): boolean {
    _view.copy(viewDirection)
    _view.y = 0
    if (_view.lengthSq() < 1e-6) return false // Looking straight down.
    _view.normalize()

    _v.copy(position).sub(near)
    _v.y = 0
    const flat = _v.length()
    if (flat < 1e-3) return true
    if (_v.dot(_view) / flat < VIEW_COS) return false

    _eye.copy(near)
    _eye.y += EYE_HEIGHT
    _v.copy(position)
    _v.y += ROOF_HEIGHT
    _v.sub(_eye)
    const distance = _v.length()
    _v.multiplyScalar(1 / distance)
    this.sightRay.origin.x = _eye.x
    this.sightRay.origin.y = _eye.y
    this.sightRay.origin.z = _eye.z
    this.sightRay.dir.x = _v.x
    this.sightRay.dir.y = _v.y
    this.sightRay.dir.z = _v.z
    // Stop short of the car itself, so grazing the kerb it stands on does not
    // read as cover.
    const blocked = this.physics.world.castRay(
      this.sightRay,
      Math.max(0, distance - 3),
      true,
      undefined,
      SIGHT_FILTER,
    )
    return blocked === null
  }

  private spawn(near: THREE.Vector3, viewDirection: THREE.Vector3 | null): void {
    const lane = this.network.laneNear(near, TRAFFIC_SPAWN_MIN, TRAFFIC_SPAWN_MAX, this.random)
    if (!lane) return

    const index = this.pickSilhouette()
    const silhouette = TRAFFIC_SILHOUETTES[index]
    const s = this.random() * Math.max(1, lane.length - 10)
    const position = this.network.pointOnLane(lane, s, new THREE.Vector3())
    position.y = silhouette.half.y + RIDE_HEIGHT_MARGIN

    // Never blink into existence somewhere the player is looking.
    if (
      viewDirection &&
      position.distanceTo(near) < TRAFFIC_SPAWN_VIEW_MIN &&
      this.inSight(near, position, viewDirection)
    ) {
      return
    }

    // Do not drop a car on top of one that is already there.
    for (const other of this.cars) {
      if (other.position.distanceToSquared(position) < 90) return
    }

    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, position.y, position.z),
    )
    const collider = this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(silhouette.half.x, silhouette.half.y, silhouette.half.z)
        .setDensity(0)
        .setMass(silhouette.mass)
        .setFriction(0.6)
        .setRestitution(0.2)
        // Traffic joins the prop group: props already collide with the world,
        // the player and each other, so nothing else needs its filter widened.
        .setCollisionGroups(
          (COLLISION_GROUPS.PROP << 16) |
            (COLLISION_GROUPS.WORLD | COLLISION_GROUPS.VEHICLE | COLLISION_GROUPS.PROP),
        )
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(CRASH_CONTACT_FORCE_GATE * 0.3),
      body,
    )

    const car: TrafficCar = {
      silhouette: index,
      body,
      collider,
      color: new THREE.Color(TRAFFIC_COLORS[Math.floor(this.random() * TRAFFIC_COLORS.length)]),
      lane,
      next: this.pickExit(lane),
      s,
      speed: lane.speedLimit * silhouette.speed * 0.8,
      mood: 0.82 + this.random() * 0.3,
      heading: Math.atan2(lane.direction.x, lane.direction.z),
      wrecked: false,
      wreckedAt: 0,
      crawlUntil: 0,
      position,
    }
    this.cars.push(car)
    this.byCollider.set(collider.handle, car)
  }

  private remove(index: number): void {
    const car = this.cars[index]
    this.byCollider.delete(car.collider.handle)
    this.physics.world.removeRigidBody(car.body)
    this.cars.splice(index, 1)
  }

  clear(): void {
    while (this.cars.length > 0) this.remove(this.cars.length - 1)
    for (const mesh of this.batches) mesh.count = 0
  }

  /**
   * One simulation tick. Driven by the physics clock, not by rendered frames:
   * the cars share a world with the player's car, and on a slow machine a
   * frame-driven traffic system crawls while the physics keeps real time.
   */
  step(dt: number, context: TrafficContext): void {
    this.time += dt
    const { playerPosition, viewDirection, playerVelocity, hazards } = context
    if (!this.enabled || !playerPosition) return

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i]
      const t = car.body.translation()
      car.position.set(t.x, t.y, t.z)

      const distance = car.position.distanceTo(playerPosition)
      const staleWreck = car.wrecked && this.time - car.wreckedAt > TRAFFIC_WRECK_LIFETIME
      if (distance > TRAFFIC_DESPAWN || (staleWreck && distance > 120) || car.position.y < -30) {
        this.remove(i)
        continue
      }
      if (car.wrecked) continue
      if (playerVelocity && distance < BRACE_DISTANCE && this.braceForImpact(car, playerPosition, playerVelocity)) {
        this.goDynamic(car)
        continue
      }
      if (hazards && this.hazardHit(car, hazards)) continue
      this.drive(car, dt, playerPosition)
    }

    let attempts = 0
    while (this.cars.length < TRAFFIC_DENSITY && attempts++ < 6) {
      this.spawn(playerPosition, viewDirection)
    }
  }

  private drive(car: TrafficCar, dt: number, playerPosition: THREE.Vector3): void {
    const silhouette = TRAFFIC_SILHOUETTES[car.silhouette]

    // Position along the lane comes from the body, not from integrating speed,
    // so a nudge from the player is not silently undone.
    _v.copy(car.position).sub(car.lane.start)
    car.s = _v.dot(car.lane.direction)
    const lateral = Math.abs(_v.x * car.lane.direction.z - _v.z * car.lane.direction.x)
    if (lateral > 14) {
      // Shoved clean off the road: stop pretending it is still driving.
      this.wreck(car, 0, 1, 0, 0)
      return
    }

    if (car.s >= car.lane.length) {
      car.s -= car.lane.length
      car.lane = car.next
      car.next = this.pickExit(car.lane)
    }

    const lookahead = Math.max(LOOKAHEAD_MIN, car.speed * LOOKAHEAD_FACTOR)
    let aheadLane = car.lane
    let aheadS = car.s + lookahead
    if (aheadS > car.lane.length) {
      aheadS -= car.lane.length
      aheadLane = car.next
    }
    this.network.pointOnLane(aheadLane, aheadS, _target)

    const desired = Math.atan2(_target.x - car.position.x, _target.z - car.position.z)
    let error = desired - car.heading
    while (error > Math.PI) error -= Math.PI * 2
    while (error < -Math.PI) error += Math.PI * 2
    const maxTurn = MAX_YAW_RATE * dt
    car.heading += THREE.MathUtils.clamp(error, -maxTurn, maxTurn)

    let targetSpeed = car.lane.speedLimit * silhouette.speed * car.mood
    if (this.time < car.crawlUntil) targetSpeed = Math.min(targetSpeed, CRAWL_SPEED)
    // Ease off through corners.
    targetSpeed *= THREE.MathUtils.clamp(1 - Math.abs(error) * 0.9, 0.3, 1)
    targetSpeed = Math.min(targetSpeed, this.gapSpeed(car, targetSpeed, playerPosition))

    const rate = targetSpeed > car.speed ? ACCEL : BRAKE
    car.speed = THREE.MathUtils.clamp(
      car.speed + Math.sign(targetSpeed - car.speed) * rate * dt,
      0,
      Math.max(targetSpeed, 0),
    )

    const sin = Math.sin(car.heading)
    const cos = Math.cos(car.heading)
    const y = silhouette.half.y + RIDE_HEIGHT_MARGIN
    car.body.setNextKinematicTranslation({
      x: car.position.x + sin * car.speed * dt,
      y,
      z: car.position.z + cos * car.speed * dt,
    })
    _quat.setFromAxisAngle(_up, car.heading)
    car.body.setNextKinematicRotation({ x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w })
  }

  /**
   * Speed allowed by whatever is in front — other traffic, or the player. Cars
   * braking for you is half the fun of having traffic at all.
   */
  private gapSpeed(car: TrafficCar, desired: number, playerPosition: THREE.Vector3): number {
    const sin = Math.sin(car.heading)
    const cos = Math.cos(car.heading)
    let closest = Infinity

    const consider = (x: number, z: number): void => {
      const dx = x - car.position.x
      const dz = z - car.position.z
      const along = dx * sin + dz * cos
      if (along <= 0 || along > FOLLOW_DISTANCE) return
      const across = Math.abs(dx * cos - dz * sin)
      if (across > 2.6) return
      if (along < closest) closest = along
    }

    for (const other of this.cars) {
      if (other === car) continue
      consider(other.position.x, other.position.z)
    }
    consider(playerPosition.x, playerPosition.z)

    if (closest === Infinity) return desired
    const clear = Math.max(0, closest - 7)
    return desired * THREE.MathUtils.clamp(clear / (FOLLOW_DISTANCE - 7), 0, 1)
  }

  /** Writes every live car into its silhouette's instanced batch. */
  /** Pushes the current positions into the instanced batches. Once per frame. */
  render(): void {
    const used = this.batches.map(() => 0)
    for (const car of this.cars) {
      const index = used[car.silhouette]++
      const batch = this.batches[car.silhouette]
      if (index >= batch.instanceMatrix.count) continue
      const r = car.body.rotation()
      _quat.set(r.x, r.y, r.z, r.w)
      _matrix.compose(car.position, _quat, _scale)
      batch.setMatrixAt(index, _matrix)
      this.colorAttributes[car.silhouette].setXYZ(index, car.color.r, car.color.g, car.color.b)
    }
    for (let i = 0; i < this.batches.length; i++) {
      this.batches[i].count = used[i]
      this.batches[i].instanceMatrix.needsUpdate = true
      this.colorAttributes[i].needsUpdate = true
    }
  }

  dispose(): void {
    this.unsubscribeContacts?.()
    this.unsubscribeContacts = null
    this.clear()
    for (const mesh of this.batches) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
      mesh.dispose()
    }
    this.batches.length = 0
  }
}

/** Body, cabin and four wheels, baked into one geometry. */
function buildSilhouetteGeometry(s: TrafficSilhouette): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  /**
   * Every part carries a vertex colour, which the per-instance paint multiplies.
   * White takes the paint; the dark parts stay dark whatever colour the car is,
   * so a red car does not end up with red glass and red tyres.
   */
  const push = (
    g: THREE.BufferGeometry,
    x: number,
    y: number,
    z: number,
    tint: [number, number, number],
  ): void => {
    g.translate(x, y, z)
    const count = g.getAttribute('position').count
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      colors[i * 3] = tint[0]
      colors[i * 3 + 1] = tint[1]
      colors[i * 3 + 2] = tint[2]
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    parts.push(g)
  }

  const PAINT: [number, number, number] = [1, 1, 1]
  const GLASS: [number, number, number] = [0.16, 0.18, 0.22]
  const TYRE: [number, number, number] = [0.07, 0.07, 0.08]

  push(new THREE.BoxGeometry(s.half.x * 2, s.half.y * 2, s.half.z * 2), 0, 0, 0, PAINT)

  // The cabin is a painted shell with a slightly smaller glasshouse inside it,
  // which is what reads as windows at a distance.
  const cabinWidth = s.half.x * 2 * s.cabin.scale
  const cabinHeight = s.half.y * 2 * s.cabin.height
  const cabinLength = s.half.z * 1.1
  const cabinY = s.half.y + s.half.y * s.cabin.height
  push(new THREE.BoxGeometry(cabinWidth, cabinHeight, cabinLength), 0, cabinY, s.cabin.offsetZ, PAINT)
  push(
    new THREE.BoxGeometry(cabinWidth * 1.01, cabinHeight * 0.62, cabinLength * 0.86),
    0,
    cabinY + cabinHeight * 0.1,
    s.cabin.offsetZ,
    GLASS,
  )

  const wheelRadius = Math.min(0.42, s.half.y * 0.8)
  const wheel = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.24, 10)
  wheel.rotateZ(Math.PI / 2)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      push(wheel.clone(), sx * (s.half.x - 0.05), -s.half.y, sz * s.half.z * 0.62, TYRE)
    }
  }
  wheel.dispose()

  const merged = mergeGeometries(parts, false)!
  for (const part of parts) part.dispose()
  return merged
}
