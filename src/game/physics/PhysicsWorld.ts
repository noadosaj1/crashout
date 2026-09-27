import RAPIER from '@dimforge/rapier3d-compat'
import { GRAVITY, MAX_PHYSICS_STEPS, PHYSICS_DT } from '@/config/constants'

let initPromise: Promise<void> | null = null

/** Rapier's wasm must be initialised once before any physics type is constructed. */
export function initPhysics(): Promise<void> {
  initPromise ??= RAPIER.init()
  return initPromise
}

export type ContactForceHandler = (
  colliderA: number,
  colliderB: number,
  magnitude: number,
  dirX: number,
  dirY: number,
  dirZ: number,
) => void

export type IntersectionHandler = (colliderA: number, colliderB: number, started: boolean) => void

/**
 * Owns the Rapier world and the fixed-timestep accumulator. Systems never call
 * `world.step` themselves; they register step callbacks so vehicle forces are
 * applied in lockstep with the solver.
 */
export class PhysicsWorld {
  /**
   * The initialised Rapier module. Exposed so tools and tests build descriptors
   * against the same wasm instance the world was created from — importing the
   * package again gives an uninitialised copy.
   */
  readonly rapier = RAPIER
  readonly world: RAPIER.World
  private readonly eventQueue: RAPIER.EventQueue
  private accumulator = 0
  private readonly stepCallbacks: Array<(dt: number) => void> = []
  private readonly postStepCallbacks: Array<(dt: number) => void> = []
  private readonly contactHandlers: ContactForceHandler[] = []
  private intersectionHandler: IntersectionHandler | null = null
  /** Fraction of the way into the next physics step, for render interpolation. */
  alpha = 0
  /**
   * Fixed steps run since startup. Simulation time is `steps * PHYSICS_DT`,
   * which is what gameplay actually experiences — wall time diverges from it
   * whenever the frame rate drops below the step budget.
   */
  steps = 0

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 })
    this.world.timestep = PHYSICS_DT
    this.world.numSolverIterations = 6
    this.eventQueue = new RAPIER.EventQueue(true)
  }

  /** Runs before each solver step — where forces are applied. */
  onStep(cb: (dt: number) => void): () => void {
    this.stepCallbacks.push(cb)
    return () => {
      const i = this.stepCallbacks.indexOf(cb)
      if (i >= 0) this.stepCallbacks.splice(i, 1)
    }
  }

  /**
   * Runs immediately after each solver step, before events are drained. This is
   * the only place a system can see what the solver actually did to a body in
   * the same step that produced its contacts.
   */
  onPostStep(cb: (dt: number) => void): () => void {
    this.postStepCallbacks.push(cb)
    return () => {
      const i = this.postStepCallbacks.indexOf(cb)
      if (i >= 0) this.postStepCallbacks.splice(i, 1)
    }
  }

  /**
   * Contact-force events go to every registered handler. More than one system
   * cares about impacts — crashes, and traffic deciding it has been hit.
   */
  addContactHandler(handler: ContactForceHandler): () => void {
    this.contactHandlers.push(handler)
    return () => {
      const i = this.contactHandlers.indexOf(handler)
      if (i >= 0) this.contactHandlers.splice(i, 1)
    }
  }

  setIntersectionHandler(handler: IntersectionHandler | null): void {
    this.intersectionHandler = handler
  }

  /** Advances the simulation. Returns how many fixed steps actually ran. */
  advance(frameDelta: number): number {
    this.accumulator += Math.min(frameDelta, PHYSICS_DT * MAX_PHYSICS_STEPS)
    let steps = 0
    while (this.accumulator >= PHYSICS_DT && steps < MAX_PHYSICS_STEPS) {
      for (const cb of this.stepCallbacks) cb(PHYSICS_DT)
      this.world.step(this.eventQueue)
      for (const cb of this.postStepCallbacks) cb(PHYSICS_DT)
      this.drainEvents()
      this.accumulator -= PHYSICS_DT
      this.steps++
      steps++
    }
    this.alpha = this.accumulator / PHYSICS_DT
    return steps
  }

  private drainEvents(): void {
    if (this.contactHandlers.length > 0) {
      this.eventQueue.drainContactForceEvents((event) => {
        const dir = event.maxForceDirection()
        const a = event.collider1()
        const b = event.collider2()
        const magnitude = event.totalForceMagnitude()
        for (const handler of this.contactHandlers) handler(a, b, magnitude, dir.x, dir.y, dir.z)
      })
    } else {
      this.eventQueue.drainContactForceEvents(() => {})
    }

    const intersection = this.intersectionHandler
    if (intersection) {
      this.eventQueue.drainCollisionEvents((a, b, started) => intersection(a, b, started))
    } else {
      this.eventQueue.drainCollisionEvents(() => {})
    }
  }

  dispose(): void {
    this.stepCallbacks.length = 0
    this.postStepCallbacks.length = 0
    this.contactHandlers.length = 0
    this.eventQueue.free()
    this.world.free()
  }
}

export { RAPIER }
