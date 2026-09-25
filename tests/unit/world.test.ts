import { describe, expect, it } from 'vitest'
import { SURFACE, SURFACE_GRIP, SurfaceMap } from '@/game/world/SurfaceMap'
import { ROADS, ZONES, DEFAULT_SPAWNS, LANDMARKS } from '@/config/world'
import { WORLD_BOUNDS } from '@/config/constants'
import { VEHICLE_LIST, VEHICLES, STARTER_VEHICLE_ID } from '@/config/vehicles'
import { ACTIVITY_LIST } from '@/config/activities'

describe('SurfaceMap', () => {
  it('defaults to grass and paints rectangles', () => {
    const map = new SurfaceMap()
    expect(map.kindAt(0, 0)).toBe(SURFACE.GRASS)
    map.paintRect(0, 0, 20, 20, SURFACE.ROAD)
    expect(map.kindAt(0, 0)).toBe(SURFACE.ROAD)
    expect(map.kindAt(60, 60)).toBe(SURFACE.GRASS)
  })

  it('paints along a segment, including diagonals', () => {
    const map = new SurfaceMap()
    map.paintSegment(-100, -100, 100, 100, 10, SURFACE.ROAD)
    expect(map.kindAt(0, 0)).toBe(SURFACE.ROAD)
    expect(map.kindAt(50, 50)).toBe(SURFACE.ROAD)
    expect(map.kindAt(50, -50)).toBe(SURFACE.GRASS)
  })

  it('returns grass outside the world rather than throwing', () => {
    const map = new SurfaceMap()
    expect(map.kindAt(1e6, 1e6)).toBe(SURFACE.GRASS)
    expect(map.gripAt(-1e6, 0)).toBe(SURFACE_GRIP[SURFACE.GRASS])
  })

  it('gives tarmac the most grip', () => {
    const road = SURFACE_GRIP[SURFACE.ROAD]
    for (const kind of [SURFACE.GRASS, SURFACE.DIRT, SURFACE.CONCRETE]) {
      expect(SURFACE_GRIP[kind]).toBeLessThan(road)
    }
  })
})

describe('world layout', () => {
  it('keeps every road, zone and landmark inside the boundary walls', () => {
    const inside = (v: number): boolean => Math.abs(v) < WORLD_BOUNDS - 10
    for (const road of ROADS) {
      expect(inside(road.from[0]) && inside(road.from[1])).toBe(true)
      expect(inside(road.to[0]) && inside(road.to[1])).toBe(true)
    }
    for (const zone of ZONES) {
      expect(inside(zone.center[0] + zone.half[0])).toBe(true)
      expect(inside(zone.center[1] + zone.half[1])).toBe(true)
    }
    for (const landmark of LANDMARKS) {
      expect(inside(landmark.position[0]) && inside(landmark.position[2])).toBe(true)
    }
  })

  it('spreads spawn points far enough apart that cars do not overlap', () => {
    for (let i = 0; i < DEFAULT_SPAWNS.length; i++) {
      for (let j = i + 1; j < DEFAULT_SPAWNS.length; j++) {
        const a = DEFAULT_SPAWNS[i]
        const b = DEFAULT_SPAWNS[j]
        expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeGreaterThan(6)
      }
    }
  })

  it('has at least as many spawn points as the multiplayer target', () => {
    expect(DEFAULT_SPAWNS.length).toBeGreaterThanOrEqual(8)
  })
})

describe('vehicle catalogue', () => {
  it('has exactly one free starter car', () => {
    const free = VEHICLE_LIST.filter((v) => v.price === 0)
    expect(free).toHaveLength(1)
    expect(free[0].id).toBe(STARTER_VEHICLE_ID)
  })

  it('keys every entry by its own id', () => {
    for (const [key, spec] of Object.entries(VEHICLES)) expect(spec.id).toBe(key)
  })

  it('gives every car a plausible, distinct set of stats', () => {
    for (const spec of VEHICLE_LIST) {
      expect(spec.mass).toBeGreaterThan(500)
      expect(spec.mass).toBeLessThan(4000)
      expect(spec.grip).toBeGreaterThan(0.5)
      expect(spec.crashResistance).toBeGreaterThanOrEqual(0)
      expect(spec.crashResistance).toBeLessThanOrEqual(1)
      // Wheels must sit inside the body or the car looks broken.
      expect(spec.wheel.offsetX).toBeLessThanOrEqual(spec.dimensions.halfWidth + 0.05)
      expect(Math.abs(spec.wheel.frontOffsetZ)).toBeLessThan(spec.dimensions.halfLength)
      expect(Math.abs(spec.wheel.rearOffsetZ)).toBeLessThan(spec.dimensions.halfLength)
      // Suspension must be able to lift the chassis clear of the ground.
      expect(spec.suspension.restLength).toBeGreaterThan(spec.suspension.travel)
    }
  })

  it('makes the heavy cars tougher than the light ones', () => {
    const hatch = VEHICLES.pico_hatch
    const suv = VEHICLES.tundrak_4x4
    expect(suv.mass).toBeGreaterThan(hatch.mass)
    expect(suv.crashResistance).toBeGreaterThan(hatch.crashResistance)
  })
})

describe('activity catalogue', () => {
  it('gives every activity at least one waypoint inside the world', () => {
    for (const activity of ACTIVITY_LIST) {
      expect(activity.waypoints.length).toBeGreaterThan(0)
      for (const [x, , z] of activity.waypoints) {
        expect(Math.abs(x)).toBeLessThan(WORLD_BOUNDS)
        expect(Math.abs(z)).toBeLessThan(WORLD_BOUNDS)
      }
      expect(activity.timeLimit).toBeGreaterThan(0)
    }
  })

  it('covers all four activity kinds', () => {
    const kinds = new Set(ACTIVITY_LIST.map((a) => a.kind))
    expect(kinds).toEqual(new Set(['delivery', 'race', 'time_trial', 'crash_challenge']))
  })
})
