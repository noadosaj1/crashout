import * as THREE from 'three'
import { ROADS, type RoadDef } from '@/config/world'

export interface Lane {
  id: number
  start: THREE.Vector3
  end: THREE.Vector3
  /** Unit vector from start to end. */
  direction: THREE.Vector3
  length: number
  /** Metres per second a car should aim for here. */
  speedLimit: number
  kind: RoadDef['kind']
  /** Centreline junction this lane leaves from and arrives at. */
  startNode: number
  endNode: number
  /** Lanes leaving the junction this one arrives at. */
  exits: Lane[]
}

/** How far right of the centreline a lane sits, as a fraction of road width. */
const LANE_OFFSET = 0.25
/** Centreline points closer than this are the same junction. */
const JUNCTION_SNAP = 3
/** Sub-segments shorter than this are junction slivers, not roads. */
const MIN_SEGMENT = 6

const SPEED_LIMIT: Record<RoadDef['kind'], number> = {
  street: 12,
  avenue: 17,
  highway: 26,
}

interface Segment {
  ax: number
  az: number
  bx: number
  bz: number
  road: RoadDef
}

/**
 * Where two segments cross, as the parameter along the first. Returns null when
 * they are parallel or cross outside either segment.
 */
function crossParameter(a: Segment, b: Segment): number | null {
  const d1x = a.bx - a.ax
  const d1z = a.bz - a.az
  const d2x = b.bx - b.ax
  const d2z = b.bz - b.az
  const denom = d1x * d2z - d1z * d2x
  if (Math.abs(denom) < 1e-6) return null
  const ox = b.ax - a.ax
  const oz = b.az - a.az
  const t = (ox * d2z - oz * d2x) / denom
  const u = (ox * d1z - oz * d1x) / denom
  const eps = 1e-4
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null
  return t
}

/**
 * A directed lane graph built from the road list.
 *
 * Roads are split wherever they cross. Without that the downtown grid is a set
 * of long parallel lines whose endpoints never meet, so nearly every lane is a
 * dead end and traffic has nowhere to go at the first junction.
 *
 * Each sub-segment then becomes two lanes, one per direction, offset to the
 * right of the centreline so oncoming traffic passes correctly. Lanes link
 * through shared *centreline* junctions rather than their own offset endpoints,
 * which is what lets the two sides of a road meet at the same node.
 */
export class TrafficNetwork {
  readonly lanes: Lane[] = []
  private readonly nodeIds = new Map<string, number>()
  private readonly lanesFromNode = new Map<number, Lane[]>()

  constructor(roads: readonly RoadDef[] = ROADS) {
    const segments: Segment[] = roads.map((road) => ({
      ax: road.from[0],
      az: road.from[1],
      bx: road.to[0],
      bz: road.to[1],
      road,
    }))

    for (const segment of segments) {
      const cuts = [0, 1]
      for (const other of segments) {
        if (other === segment) continue
        const t = crossParameter(segment, other)
        if (t !== null) cuts.push(t)
      }
      cuts.sort((x, y) => x - y)

      for (let i = 0; i < cuts.length - 1; i++) {
        const t0 = cuts[i]
        const t1 = cuts[i + 1]
        if (t1 - t0 < 1e-4) continue
        this.addSegment(
          segment.ax + (segment.bx - segment.ax) * t0,
          segment.az + (segment.bz - segment.az) * t0,
          segment.ax + (segment.bx - segment.ax) * t1,
          segment.az + (segment.bz - segment.az) * t1,
          segment.road,
        )
      }
    }

    this.link()
  }

  private nodeAt(x: number, z: number): number {
    const key = `${Math.round(x / JUNCTION_SNAP)}:${Math.round(z / JUNCTION_SNAP)}`
    let id = this.nodeIds.get(key)
    if (id === undefined) {
      id = this.nodeIds.size
      this.nodeIds.set(key, id)
    }
    return id
  }

  private addSegment(ax: number, az: number, bx: number, bz: number, road: RoadDef): void {
    const length = Math.hypot(bx - ax, bz - az)
    if (length < MIN_SEGMENT) return

    const nodeA = this.nodeAt(ax, az)
    const nodeB = this.nodeAt(bx, bz)
    if (nodeA === nodeB) return

    const forward = new THREE.Vector3((bx - ax) / length, 0, (bz - az) / length)
    const offset = road.width * LANE_OFFSET

    for (const sign of [1, -1]) {
      const dir = forward.clone().multiplyScalar(sign)
      const laneRight = new THREE.Vector3(dir.z, 0, -dir.x).multiplyScalar(offset)
      const from = sign === 1 ? new THREE.Vector3(ax, 0, az) : new THREE.Vector3(bx, 0, bz)
      const to = sign === 1 ? new THREE.Vector3(bx, 0, bz) : new THREE.Vector3(ax, 0, az)
      this.lanes.push({
        id: this.lanes.length,
        start: from.clone().add(laneRight),
        end: to.clone().add(laneRight),
        direction: dir,
        length,
        speedLimit: SPEED_LIMIT[road.kind],
        kind: road.kind,
        startNode: sign === 1 ? nodeA : nodeB,
        endNode: sign === 1 ? nodeB : nodeA,
        exits: [],
      })
    }
  }

  private link(): void {
    for (const lane of this.lanes) {
      let list = this.lanesFromNode.get(lane.startNode)
      if (!list) {
        list = []
        this.lanesFromNode.set(lane.startNode, list)
      }
      list.push(lane)
    }

    for (const lane of this.lanes) {
      const candidates = this.lanesFromNode.get(lane.endNode) ?? []
      for (const next of candidates) {
        // Never offer a U-turn back down the lane we came from: with two lanes
        // per road that is half the graph and traffic ping-pongs on the spot.
        if (next.direction.dot(lane.direction) < -0.85) continue
        lane.exits.push(next)
      }
      // Roads that end at the map edge have nothing but the U-turn. Allowing it
      // there, and only there, is what a driver would do and stops traffic
      // piling up at every spur.
      if (lane.exits.length === 0) lane.exits.push(...candidates)
    }
  }

  /** A lane picked at random. */
  randomLane(random: () => number): Lane {
    return this.lanes[Math.floor(random() * this.lanes.length)]
  }

  /** A lane starting in an annulus around a point, for spawning near the player. */
  laneNear(
    position: THREE.Vector3,
    minDistance: number,
    maxDistance: number,
    random: () => number,
  ): Lane | null {
    // Lanes are weighted by 1/distance. There are far more lanes out at the rim
    // of the ring than near it, so picking uniformly puts nearly every car out
    // of sight; the weight cancels that growth and keeps the nearby streets
    // populated without shrinking the ring.
    const matches: Lane[] = []
    const weights: number[] = []
    let total = 0
    for (const lane of this.lanes) {
      if (lane.exits.length === 0) continue
      const d = lane.start.distanceTo(position)
      if (d < minDistance || d > maxDistance) continue
      const weight = 1 / d
      matches.push(lane)
      weights.push(weight)
      total += weight
    }
    if (matches.length === 0) return null
    let pick = random() * total
    for (let i = 0; i < matches.length; i++) {
      pick -= weights[i]
      if (pick <= 0) return matches[i]
    }
    return matches[matches.length - 1]
  }

  /** Where a car sits at `distance` along `lane`. */
  pointOnLane(lane: Lane, distance: number, target: THREE.Vector3): THREE.Vector3 {
    return target.copy(lane.start).addScaledVector(lane.direction, THREE.MathUtils.clamp(distance, 0, lane.length))
  }

  get laneCount(): number {
    return this.lanes.length
  }

  /** Lanes with no exit. A few are real spurs; a lot means the graph is broken. */
  get deadEnds(): number {
    return this.lanes.filter((l) => l.exits.length === 0).length
  }
}
