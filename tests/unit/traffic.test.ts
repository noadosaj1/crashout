import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { TrafficNetwork } from '@/game/traffic/TrafficNetwork'
import { ROADS } from '@/config/world'

describe('TrafficNetwork', () => {
  const network = new TrafficNetwork()

  it('splits roads at crossings into many more lanes than there are roads', () => {
    // The downtown grid alone turns a few long roads into a lot of blocks.
    expect(network.laneCount).toBeGreaterThan(ROADS.length * 2)
  })

  it('offsets the two directions of a road to opposite sides', () => {
    // Pick any road and find its pair of lanes by direction.
    const forward = network.lanes.find((l) => l.direction.z > 0.99)
    const back = network.lanes.find(
      (l) => l.direction.z < -0.99 && Math.abs(l.start.x - (forward?.start.x ?? 0)) < 40,
    )
    expect(forward).toBeDefined()
    expect(back).toBeDefined()
    // Opposite directions must not share a centreline, or they drive through
    // each other head-on.
    expect(Math.abs(forward!.start.x - back!.start.x)).toBeGreaterThan(0.5)
  })

  it('leaves no lane without an exit', () => {
    // Traffic that reaches a lane with nowhere to go stops there forever.
    expect(network.deadEnds).toBe(0)
  })

  it('only offers a U-turn where there is no other way out', () => {
    for (const lane of network.lanes) {
      const uTurns = lane.exits.filter((e) => e.direction.dot(lane.direction) < -0.85)
      if (uTurns.length > 0) expect(lane.exits.length).toBe(uTurns.length)
    }
  })

  it('gives highways a higher speed limit than streets', () => {
    const street = network.lanes.find((l) => l.kind === 'street')!
    const highway = network.lanes.find((l) => l.kind === 'highway')!
    expect(highway.speedLimit).toBeGreaterThan(street.speedLimit)
  })

  it('only offers lanes inside the spawn ring, and favours the near end', () => {
    const origin = new THREE.Vector3(8, 0, 120)
    let random = 0
    const next = (): number => {
      random = (random + 0.37) % 1
      return random
    }
    const picks: number[] = []
    for (let i = 0; i < 200; i++) {
      const lane = network.laneNear(origin, 55, 240, next)
      expect(lane).not.toBeNull()
      picks.push(lane!.start.distanceTo(origin))
    }
    expect(Math.min(...picks)).toBeGreaterThanOrEqual(55)
    expect(Math.max(...picks)).toBeLessThanOrEqual(240)

    // Lanes near the rim vastly outnumber the near ones, so an unweighted pick
    // would sit close to the far end. The 1/d weight has to pull it in.
    const inRing = network.lanes.filter((l) => {
      const d = l.start.distanceTo(origin)
      return l.exits.length > 0 && d >= 55 && d <= 240
    })
    const uniformMean = inRing.reduce((sum, l) => sum + l.start.distanceTo(origin), 0) / inRing.length
    const pickedMean = picks.reduce((a, b) => a + b, 0) / picks.length
    expect(pickedMean).toBeLessThan(uniformMean)
  })

  it('places points along a lane between its ends', () => {
    const lane = network.lanes[0]
    const target = new THREE.Vector3()
    network.pointOnLane(lane, 0, target)
    expect(target.distanceTo(lane.start)).toBeLessThan(0.001)
    network.pointOnLane(lane, lane.length * 2, target)
    expect(target.distanceTo(lane.end)).toBeLessThan(0.001)
  })
})
