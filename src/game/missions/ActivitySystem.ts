import * as THREE from 'three'
import type { ActivitySpec } from '@/types'
import { ACTIVITIES } from '@/config/activities'
import { gameEvents } from '@/game/core/GameEvents'
import type { Vehicle } from '@/game/vehicles/Vehicle'
import type { CrashEvent } from '@/game/core/events'

export interface ActivityRunState {
  activityId: string
  name: string
  kind: ActivitySpec['kind']
  /** Index of the waypoint the player is heading for. */
  checkpoint: number
  totalCheckpoints: number
  timeRemaining: number
  elapsed: number
  /** Crash-challenge score, 0 for other kinds. */
  score: number
  /** Distance to the current objective in metres. */
  distance: number
  target: THREE.Vector3
}

export interface ActivityResult {
  activityId: string
  name: string
  kind: ActivitySpec['kind']
  success: boolean
  elapsed: number
  score: number
  damage: number
}

const MARKER_RADIUS = 9
const MARKER_HEIGHT = 14

/**
 * Drives every activity from `config/activities.ts`. Deliveries and races differ
 * only in how many waypoints they visit; the crash challenge swaps the win
 * condition for a score timer.
 */
export class ActivitySystem {
  readonly object = new THREE.Group()

  private run: ActivityRunState | null = null
  private startDamage = 0
  private marker: THREE.Mesh
  private markerGlow: THREE.Mesh
  private pillarMaterial: THREE.MeshBasicMaterial
  private unsubscribeCrash: (() => void) | null = null
  /** Set by the engine so finishing a run can pay out through persistence. */
  onFinish: ((result: ActivityResult) => void) | null = null

  constructor() {
    this.pillarMaterial = new THREE.MeshBasicMaterial({
      color: 0x3fd8ff,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const cylinder = new THREE.CylinderGeometry(MARKER_RADIUS, MARKER_RADIUS, MARKER_HEIGHT, 24, 1, true)
    this.marker = new THREE.Mesh(cylinder, this.pillarMaterial)
    this.marker.position.y = MARKER_HEIGHT / 2
    this.marker.visible = false

    const ring = new THREE.RingGeometry(MARKER_RADIUS * 0.75, MARKER_RADIUS, 28)
    ring.rotateX(-Math.PI / 2)
    this.markerGlow = new THREE.Mesh(
      ring,
      new THREE.MeshBasicMaterial({ color: 0x3fd8ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    )
    this.markerGlow.position.y = 0.12
    this.markerGlow.visible = false

    this.object.add(this.marker, this.markerGlow)
  }

  get current(): ActivityRunState | null {
    return this.run
  }

  start(activityId: string, vehicle: Vehicle): boolean {
    const spec = ACTIVITIES[activityId]
    if (!spec) return false
    this.stop(false)

    this.startDamage = vehicle.damageLevel
    this.run = {
      activityId,
      name: spec.name,
      kind: spec.kind,
      checkpoint: 0,
      totalCheckpoints: spec.waypoints.length,
      timeRemaining: spec.timeLimit,
      elapsed: 0,
      score: 0,
      distance: 0,
      target: new THREE.Vector3(...spec.waypoints[0]),
    }

    if (spec.kind === 'crash_challenge') {
      // Score runs on impacts rather than checkpoints.
      this.unsubscribeCrash = gameEvents.on('crash', (event) => this.scoreCrash(event, vehicle))
    }

    this.updateMarker()
    gameEvents.emit('activity-started', { activityId })
    gameEvents.emit('notify', { text: `${spec.name} started`, tone: 'info' })
    return true
  }

  /** Ends the run. `report` controls whether a result is emitted. */
  stop(report: boolean, success = false, vehicle?: Vehicle): void {
    const run = this.run
    this.unsubscribeCrash?.()
    this.unsubscribeCrash = null
    this.run = null
    this.marker.visible = false
    this.markerGlow.visible = false
    if (!run) return

    if (report) {
      const result: ActivityResult = {
        activityId: run.activityId,
        name: run.name,
        kind: run.kind,
        success,
        elapsed: run.elapsed,
        score: Math.round(run.score),
        damage: vehicle ? Math.max(0, vehicle.damageLevel - this.startDamage) : 0,
      }
      this.onFinish?.(result)
    } else {
      gameEvents.emit('activity-finished', { activityId: run.activityId, success: false, reward: 0 })
    }
  }

  private scoreCrash(event: CrashEvent, vehicle: Vehicle): void {
    const run = this.run
    if (!run || !event.local) return
    // Impact is the base; airtime and flips multiply it, so the fun way to play
    // is also the high-scoring way.
    const airBonus = 1 + Math.min(2.5, vehicle.lastAirtime * 1.1)
    const flipBonus = 1 + Math.min(2, vehicle.flips * 0.35)
    const pvp = event.vehicleToVehicle ? 1.8 : 1
    const points = event.severity * 220 * airBonus * flipBonus * pvp
    run.score += points
    if (points > 40) {
      gameEvents.emit('notify', {
        text: `+${Math.round(points)} ${event.vehicleToVehicle ? 'PLAYER SLAM' : 'IMPACT'}`,
        tone: 'reward',
        ttl: 1.6,
      })
    }
  }

  update(dt: number, vehicle: Vehicle): void {
    const run = this.run
    if (!run) return

    run.elapsed += dt
    run.timeRemaining -= dt
    run.distance = vehicle.position.distanceTo(run.target)

    if (run.timeRemaining <= 0) {
      // Crash challenges are timed *runs*, so running out is success.
      this.stop(true, run.kind === 'crash_challenge', vehicle)
      return
    }

    if (run.kind !== 'crash_challenge') {
      const dy = Math.abs(vehicle.position.y - run.target.y)
      if (run.distance < MARKER_RADIUS + 1.5 && dy < 12) {
        run.checkpoint++
        if (run.checkpoint >= run.totalCheckpoints) {
          this.stop(true, true, vehicle)
          return
        }
        const spec = ACTIVITIES[run.activityId]
        run.target.set(...spec.waypoints[run.checkpoint])
        this.updateMarker()
        gameEvents.emit('notify', {
          text: `Checkpoint ${run.checkpoint}/${run.totalCheckpoints}`,
          tone: 'success',
          ttl: 1.4,
        })
      }
    }

    this.animateMarker(dt)
  }

  private updateMarker(): void {
    const run = this.run
    if (!run || run.kind === 'crash_challenge') {
      this.marker.visible = false
      this.markerGlow.visible = false
      return
    }
    this.marker.position.set(run.target.x, MARKER_HEIGHT / 2, run.target.z)
    this.markerGlow.position.set(run.target.x, 0.12, run.target.z)
    this.marker.visible = true
    this.markerGlow.visible = true
  }

  private animateMarker(dt: number): void {
    if (!this.marker.visible) return
    this.marker.rotation.y += dt * 0.4
    const pulse = 0.18 + Math.sin(performance.now() * 0.004) * 0.08
    this.pillarMaterial.opacity = pulse
    this.markerGlow.scale.setScalar(1 + Math.sin(performance.now() * 0.006) * 0.06)
  }

  dispose(): void {
    this.unsubscribeCrash?.()
    this.marker.geometry.dispose()
    this.markerGlow.geometry.dispose()
    this.pillarMaterial.dispose()
    ;(this.markerGlow.material as THREE.Material).dispose()
  }
}
