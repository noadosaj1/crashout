import * as THREE from 'three'
import type { GadgetId, OwnedVehicle } from '@/types'
import { getVehicleSpec } from '@/config/vehicles'
import { DEFAULT_SPAWNS } from '@/config/world'
import { MS_TO_KMH, RESPAWN_FALL_Y } from '@/config/constants'
import { GADGETS } from '@/config/gadgets'
import type { NetIdentity, NetStatus, NetworkTransport } from '@/lib/networking/types'
import { PhysicsWorld, initPhysics } from '@/game/physics/PhysicsWorld'
import { InputManager } from '@/game/input/InputManager'
import { WorldBuilder, type BuiltWorld } from '@/game/world/WorldBuilder'
import { Vehicle } from '@/game/vehicles/Vehicle'
import { ChaseCamera } from '@/game/camera/ChaseCamera'
import { ParticleSystem } from '@/game/effects/ParticleSystem'
import { SkidMarks } from '@/game/effects/SkidMarks'
import { CrashSystem } from '@/game/crash/CrashSystem'
import { AudioSystem } from '@/game/audio/AudioSystem'
import { GadgetSystem } from '@/game/gadgets/GadgetSystem'
import { ActivitySystem, type ActivityResult, type ActivityRunState } from '@/game/missions/ActivitySystem'
import { NetworkClient, type RemotePlayerInfo } from '@/game/multiplayer/NetworkClient'
import { createSky } from '@/game/world/Sky'
import { gameEvents } from './GameEvents'

export interface HudSnapshot {
  speedKmh: number
  damage: number
  boost: number
  grounded: boolean
  airtime: number
  canRecover: boolean
  recoverCooldown: number
  gadgetId: GadgetId | null
  gadgetReady: boolean
  gadgetCooldown: number
  position: [number, number, number]
  heading: number
  fps: number
  particleCount: number
  smokeBlind: number
  playerCount: number
  netStatus: NetStatus
  remotePlayers: RemotePlayerInfo[]
  activity: ActivityRunState | null
}

export interface EngineCallbacks {
  onHud: (snapshot: HudSnapshot) => void
  onActivityFinished: (result: ActivityResult) => void
  onStatsDelta: (delta: { distance: number; crashes: number; biggestCrash: number }) => void
}

const HUD_INTERVAL = 1 / 12

/** Sun direction, kept high so streets between towers stay readable. */
const SUN_OFFSET = new THREE.Vector3(150, 420, 110)

/**
 * Owns the renderer, the physics world and every gameplay system, and runs the
 * frame loop. Nothing in here touches React: the UI is fed through
 * `callbacks.onHud`, sampled at 12 Hz rather than every frame.
 */
export class Engine {
  readonly physics: PhysicsWorld
  readonly scene = new THREE.Scene()
  readonly renderer: THREE.WebGLRenderer
  readonly input = new InputManager()
  readonly camera: ChaseCamera
  readonly particles = new ParticleSystem()
  readonly skidMarks = new SkidMarks()
  readonly crash = new CrashSystem()
  readonly audio = new AudioSystem()
  readonly gadgets = new GadgetSystem()
  readonly activities = new ActivitySystem()
  readonly network: NetworkClient

  readonly world: BuiltWorld

  private localVehicle: Vehicle | null = null
  private ownedVehicle: OwnedVehicle | null = null
  private equippedGadget: GadgetId | null = null
  private ownedGadgets: GadgetId[] = []

  private readonly canvas: HTMLCanvasElement
  private callbacks: EngineCallbacks | null = null
  private running = false
  private rafId = 0
  private lastTime = 0
  private hudAccumulator = 0
  private fpsSamples: number[] = []
  private netStatus: NetStatus = 'idle'
  private remotePlayers: RemotePlayerInfo[] = []
  private statDelta = { distance: 0, crashes: 0, biggestCrash: 0 }
  private paused = false
  private readonly sun: THREE.DirectionalLight
  private readonly disposers: Array<() => void> = []
  private readonly tmpVec = new THREE.Vector3()
  /** Most recent local crash, for debugging and the probe. */
  private lastCrash: { severity: number; deltaV: number; region: string } | null = null
  /** Input for the current frame, read by the fixed-step physics callback. */
  private stepInput = this.input.state

  /** Async because Rapier's wasm has to be ready before anything is built. */
  static async create(canvas: HTMLCanvasElement): Promise<Engine> {
    await initPhysics()
    return new Engine(canvas)
  }

  private constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.renderer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1, false)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15

    this.physics = new PhysicsWorld()
    this.camera = new ChaseCamera(this.physics, (canvas.clientWidth || 16) / (canvas.clientHeight || 9))

    // --- Lighting & sky ----------------------------------------------------
    this.scene.background = new THREE.Color(0x9cc0de)
    this.scene.fog = new THREE.Fog(0x9cc0de, 320, 1250)

    // Sky/ground hemisphere does most of the fill. Downtown is full of 90m
    // towers, so without a strong ambient term the streets read as black.
    const hemisphere = new THREE.HemisphereLight(0xcfe4f5, 0x6b6558, 2.0)
    this.scene.add(hemisphere)
    this.scene.add(new THREE.AmbientLight(0xa8c4dc, 0.55))

    // A dim opposite-side fill keeps shaded faces from flattening out.
    const fill = new THREE.DirectionalLight(0x9fc0e0, 0.5)
    fill.position.set(-160, 120, -180)
    this.scene.add(fill)

    this.sun = new THREE.DirectionalLight(0xfff2dc, 2.5)
    this.sun.position.copy(SUN_OFFSET)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.camera.near = 60
    this.sun.shadow.camera.far = 900
    // Tight extent: the shadow map only has to cover what is near the player.
    const shadowExtent = 95
    this.sun.shadow.camera.left = -shadowExtent
    this.sun.shadow.camera.right = shadowExtent
    this.sun.shadow.camera.top = shadowExtent
    this.sun.shadow.camera.bottom = -shadowExtent
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.02
    this.scene.add(this.sun)
    this.scene.add(this.sun.target)

    const sky = createSky()
    this.scene.add(sky.object)
    this.disposers.push(sky.dispose)

    // --- World -------------------------------------------------------------
    const builder = new WorldBuilder(this.physics)
    this.world = builder.build()
    this.scene.add(this.world.group)
    this.scene.add(this.particles.object)
    this.scene.add(this.skidMarks.object)
    this.scene.add(this.gadgets.object)
    this.scene.add(this.activities.object)

    this.network = new NetworkClient(this.physics, this.scene)

    this.physics.setContactHandler(this.crash.onContactForce)
    this.crash.attach({
      particles: this.particles,
      camera: this.camera,
      audio: this.audio,
      world: this.world,
    })

    this.gadgets.attach({
      particles: this.particles,
      audio: this.audio,
      broadcast: ({ id, gadgetId, position, heading }) =>
        this.network.broadcastGadget(id, gadgetId, position, heading),
    })

    this.network.setCallbacks({
      onGadget: (m) => this.gadgets.spawnRemote(m.hid, m.g, m.p, m.h, m.id),
      onGadgetOff: (hid) => this.gadgets.removeRemote(hid),
      onRoster: (players) => {
        this.remotePlayers = players
      },
      onStatus: (status) => {
        this.netStatus = status
      },
      onChat: (from, text) => {
        gameEvents.emit('notify', { text: `${from}: ${text}`, tone: 'info', ttl: 5 })
      },
    })

    this.activities.onFinish = (result) => this.callbacks?.onActivityFinished(result)

    this.disposers.push(
      gameEvents.on('crash', (event) => {
        if (!event.local) return
        this.lastCrash = { severity: +event.severity.toFixed(3), deltaV: +event.deltaV.toFixed(2), region: event.region }
        this.statDelta.crashes++
        this.statDelta.biggestCrash = Math.max(this.statDelta.biggestCrash, event.deltaV)
        this.network.broadcastCrash(event.position, event.severity, event.vehicleToVehicle)
      }),
    )

    // Registered once: vehicle forces must be applied per fixed physics step,
    // not per rendered frame, or handling would depend on framerate.
    this.disposers.push(
      this.physics.onStep((stepDt) => {
        this.localVehicle?.update(stepDt, this.stepInput)
      }),
      this.physics.onPostStep(() => {
        this.localVehicle?.postStep()
      }),
    )

    this.input.attach()
  }

  setCallbacks(callbacks: EngineCallbacks): void {
    this.callbacks = callbacks
  }

  // ------------------------------------------------------------ local player

  /** Spawns or replaces the local car. Safe to call mid-session. */
  spawnLocalVehicle(owned: OwnedVehicle, spawnIndex = 0): Vehicle {
    const spec = getVehicleSpec(owned.specId)
    const spawn = DEFAULT_SPAWNS[spawnIndex % DEFAULT_SPAWNS.length]

    // Swapping cars mid-session keeps you where you were standing.
    const previousPosition = this.localVehicle?.position.clone()
    let previousHeading = Math.PI
    if (this.localVehicle) {
      this.tmpVec.set(0, 0, 1).applyQuaternion(this.localVehicle.rotation)
      previousHeading = Math.atan2(this.tmpVec.x, this.tmpVec.z)
    }

    if (this.localVehicle) {
      this.crash.unregisterVehicle(this.localVehicle)
      this.skidMarks.breakTrail(this.localVehicle.id)
      this.localVehicle.dispose(this.scene)
    }

    const vehicle = new Vehicle(this.physics, {
      id: 'local',
      spec,
      upgrades: owned.upgrades,
      customization: owned.customization,
      position: previousPosition ?? new THREE.Vector3(spawn[0], spawn[1], spawn[2]),
      heading: previousPosition ? previousHeading : Math.PI,
      isLocal: true,
    })
    vehicle.surfaceGripAt = (x, z) => this.world.surfaces.gripAt(x, z)

    this.scene.add(vehicle.object)
    this.localVehicle = vehicle
    this.ownedVehicle = owned
    this.crash.registerVehicle(vehicle)
    this.crash.setLocalVehicle(vehicle)
    this.camera.reset()
    this.audio.setVehicle(spec)

    this.network.updateAppearance({
      specId: owned.specId,
      paint: owned.customization.paint,
      wheelStyle: owned.customization.wheelStyle,
      accent: owned.customization.accent,
    })

    return vehicle
  }

  get vehicle(): Vehicle | null {
    return this.localVehicle
  }

  setOwnedGadgets(gadgets: GadgetId[]): void {
    this.ownedGadgets = gadgets
    if (!this.equippedGadget || !gadgets.includes(this.equippedGadget)) {
      this.equippedGadget = gadgets[0] ?? null
    }
  }

  equipGadget(gadgetId: GadgetId | null): void {
    if (gadgetId && !this.ownedGadgets.includes(gadgetId)) return
    this.equippedGadget = gadgetId
  }

  get gadget(): GadgetId | null {
    return this.equippedGadget
  }

  repairLocalVehicle(): void {
    this.localVehicle?.repair()
  }

  // -------------------------------------------------------------- lifecycle

  start(): void {
    if (this.running) return
    this.running = true
    this.lastTime = performance.now()
    this.rafId = requestAnimationFrame(this.frame)
    window.addEventListener('resize', this.onResize)
    this.onResize()
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.rafId)
    window.removeEventListener('resize', this.onResize)
  }

  /** Pauses simulation but keeps rendering, so menus sit over a live scene. */
  setPaused(paused: boolean): void {
    this.paused = paused
    this.input.setEnabled(!paused)
    this.audio.setMuted(paused)
  }

  private readonly onResize = (): void => {
    const width = this.canvas.clientWidth || window.innerWidth
    const height = this.canvas.clientHeight || window.innerHeight
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.renderer.setSize(width, height, false)
    this.camera.setAspect(width / Math.max(1, height))
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return
    this.rafId = requestAnimationFrame(this.frame)

    const rawDelta = (now - this.lastTime) / 1000
    this.lastTime = now
    // Clamp so an alt-tab does not teleport everything on return.
    const dt = Math.min(0.1, Math.max(0.0001, rawDelta))

    this.fpsSamples.push(1 / dt)
    if (this.fpsSamples.length > 30) this.fpsSamples.shift()

    const input = this.input.sample(dt)
    this.stepInput = input
    const vehicle = this.localVehicle

    if (!this.paused) {
      if (vehicle) {
        if (input.recover && vehicle.canRecover) this.recoverVehicle()
        if (input.gadget && this.equippedGadget) {
          if (!this.gadgets.deploy(this.equippedGadget, vehicle)) {
            gameEvents.emit('notify', { text: 'Gadget recharging', tone: 'warn', ttl: 1.2 })
          }
        }
        if (input.resetCamera) this.camera.reset()
      }

      this.physics.advance(dt)
      this.crash.resolve(dt)

      if (vehicle) {
        if (vehicle.position.y < RESPAWN_FALL_Y) this.recoverVehicle()
        this.statDelta.distance += vehicle.consumeDistance()
      }
    }

    if (vehicle) {
      vehicle.render(this.physics.alpha, dt)
      vehicle.setBrakeLights(input.brake > 0.05 || input.handbrake)
      this.camera.update(vehicle, dt, input.lookBack)
      this.updateSkids(vehicle, dt)
      this.audio.setListener(this.camera.camera.position)
      this.audio.update({
        speed: vehicle.speed,
        topSpeed: vehicle.spec.topSpeed,
        throttle: input.throttle,
        slip: Math.max(...vehicle.wheels.map((w) => w.slip)),
        grounded: vehicle.grounded,
        engineDamage: vehicle.damage.engine,
      })

      // Keep the shadow frustum centred on the player so it stays sharp.
      this.sun.position.copy(vehicle.position).add(SUN_OFFSET)
      this.sun.target.position.copy(vehicle.position)
      this.sun.target.updateMatrixWorld()

      if (!this.paused) this.activities.update(dt, vehicle)
    }

    if (!this.paused) {
      const affected = vehicle ? [vehicle] : []
      this.gadgets.update(dt, affected)
    }

    this.particles.update(dt)
    this.syncProps()
    this.network.update(dt, vehicle, this.camera.camera.position)

    this.renderer.render(this.scene, this.camera.camera)

    this.hudAccumulator += dt
    if (this.hudAccumulator >= HUD_INTERVAL) {
      this.hudAccumulator = 0
      this.publishHud()
    }
  }

  private recoverVehicle(): void {
    const vehicle = this.localVehicle
    if (!vehicle) return
    vehicle.recover()
    this.skidMarks.breakTrail(vehicle.id)
    this.camera.reset()
    gameEvents.emit('vehicle-recovered', { vehicleId: vehicle.id })
    gameEvents.emit('notify', { text: 'Vehicle recovered', tone: 'info', ttl: 1.2 })
  }

  private updateSkids(vehicle: Vehicle, dt: number): void {
    // A wheel has to be both slipping *and* carrying real load to leave rubber.
    // Without the load test the unloaded inside wheels paint the road black in
    // every ordinary corner.
    const loadFloor = vehicle.spec.mass * 2.5
    for (let i = 0; i < vehicle.wheels.length; i++) {
      const wheel = vehicle.wheels[i]
      if (!wheel.grounded || wheel.slip < 0.42 || wheel.load < loadFloor) continue
      this.skidMarks.mark(`${vehicle.id}:${i}`, wheel.contactPoint, vehicle.spec.wheel.width, wheel.slip)
      if (wheel.slip > 0.55 && Math.random() < wheel.slip * dt * 24) {
        this.tmpVec.set(0, 0, 0)
        this.particles.dust(
          wheel.contactPoint,
          this.tmpVec,
          wheel.slip,
          this.world.surfaces.dustColorAt(wheel.contactPoint.x, wheel.contactPoint.z),
        )
      }
    }
  }

  /** Copies dynamic prop transforms from Rapier into their meshes. */
  private syncProps(): void {
    for (const prop of this.world.props) {
      if (prop.body.isSleeping()) continue
      const t = prop.body.translation()
      const r = prop.body.rotation()
      prop.mesh.position.set(t.x, t.y, t.z)
      prop.mesh.quaternion.set(r.x, r.y, r.z, r.w)
    }
  }

  private publishHud(): void {
    if (!this.callbacks) return
    const vehicle = this.localVehicle
    const gadgetId = this.equippedGadget
    const fps =
      this.fpsSamples.length > 0
        ? this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length
        : 0

    const forward = vehicle ? this.tmpVec.set(0, 0, 1).applyQuaternion(vehicle.rotation) : null

    this.callbacks.onHud({
      speedKmh: vehicle ? Math.abs(vehicle.forwardSpeed) * MS_TO_KMH : 0,
      damage: vehicle?.damageLevel ?? 0,
      boost: vehicle?.boostRatio ?? 0,
      grounded: vehicle?.grounded ?? true,
      airtime: vehicle?.airtime ?? 0,
      canRecover: vehicle?.canRecover ?? false,
      recoverCooldown: vehicle?.recoverCooldownRemaining ?? 0,
      gadgetId,
      gadgetReady: gadgetId ? this.gadgets.isReady(gadgetId) : false,
      gadgetCooldown: gadgetId ? this.gadgets.cooldownRemaining(gadgetId) : 0,
      position: vehicle ? [vehicle.position.x, vehicle.position.y, vehicle.position.z] : [0, 0, 0],
      heading: forward ? Math.atan2(forward.x, forward.z) : 0,
      fps,
      particleCount: this.particles.count,
      smokeBlind: this.gadgets.smokeIntensityAt(this.camera.camera.position),
      playerCount: this.network.playerCount,
      netStatus: this.netStatus,
      remotePlayers: this.remotePlayers,
      activity: this.activities.current,
    })

    if (this.statDelta.distance > 0 || this.statDelta.crashes > 0) {
      this.callbacks.onStatsDelta({ ...this.statDelta })
      this.statDelta.distance = 0
      this.statDelta.crashes = 0
      this.statDelta.biggestCrash = 0
    }
  }

  // ------------------------------------------------------------ multiplayer

  async connectMultiplayer(
    transport: NetworkTransport,
    sessionCode: string,
    identity: NetIdentity,
  ): Promise<void> {
    const owned = this.ownedVehicle
    await this.network.connect(transport, sessionCode, identity, {
      specId: owned?.specId ?? 'pico_hatch',
      paint: owned?.customization.paint ?? 'stock',
      wheelStyle: owned?.customization.wheelStyle ?? 'stock',
      accent: owned?.customization.accent ?? 'stock',
    })
  }

  async disconnectMultiplayer(): Promise<void> {
    await this.network.disconnect()
    this.remotePlayers = []
  }

  // --------------------------------------------------------------- activity

  startActivity(activityId: string): boolean {
    const vehicle = this.localVehicle
    if (!vehicle) return false
    return this.activities.start(activityId, vehicle)
  }

  cancelActivity(): void {
    this.activities.stop(false)
  }

  /** Reads the gadget catalogue for the HUD label. */
  gadgetName(gadgetId: GadgetId): string {
    return GADGETS[gadgetId].name
  }

  /**
   * Snapshot of live engine state for debugging and automated smoke tests.
   * Exposed on `window.__CRASHOUT__` in development builds only.
   */
  probe(): Record<string, unknown> {
    const v = this.localVehicle
    return {
      fps: Number(
        (this.fpsSamples.reduce((a, b) => a + b, 0) / Math.max(1, this.fpsSamples.length)).toFixed(1),
      ),
      position: v ? [+v.position.x.toFixed(2), +v.position.y.toFixed(2), +v.position.z.toFixed(2)] : null,
      speedKmh: v ? +(v.speed * MS_TO_KMH).toFixed(1) : 0,
      forwardKmh: v ? +(v.forwardSpeed * MS_TO_KMH).toFixed(1) : 0,
      grounded: v?.grounded ?? false,
      wheelsDown: v ? v.wheels.filter((w) => w.grounded).length : 0,
      wheelLoads: v ? v.wheels.map((w) => Math.round(w.load)) : [],
      compression: v ? v.wheels.map((w) => +w.compression.toFixed(2)) : [],
      damage: v ? +v.damageLevel.toFixed(3) : 0,
      particles: this.particles.count,
      rigidBodies: this.physics.world.bodies.len(),
      colliders: this.physics.world.colliders.len(),
      players: this.network.playerCount,
      lastCrash: this.lastCrash,
    }
  }

  /** Clears the debug crash record so a test can assert on the next one. */
  clearLastCrash(): void {
    this.lastCrash = null
  }

  dispose(): void {
    this.stop()
    this.input.detach()
    for (const dispose of this.disposers) dispose()
    this.network.dispose()
    this.activities.dispose()
    this.gadgets.dispose()
    this.particles.dispose()
    this.skidMarks.dispose()
    this.audio.dispose()
    this.localVehicle?.dispose(this.scene)
    this.world.dispose()
    this.physics.dispose()
    this.renderer.dispose()
  }
}
