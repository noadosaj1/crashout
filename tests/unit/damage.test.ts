import { describe, expect, it } from 'vitest'
import {
  applyRegionDamage,
  createDamage,
  createRegionDamage,
  damageModifiers,
  overallDamage,
  regionFromLocalDirection,
} from '@/game/vehicles/damage'

describe('regionFromLocalDirection', () => {
  it('maps the dominant axis to a panel', () => {
    expect(regionFromLocalDirection(0, 0, 1)).toBe('front')
    expect(regionFromLocalDirection(0, 0, -1)).toBe('rear')
    expect(regionFromLocalDirection(1, 0, 0)).toBe('right')
    expect(regionFromLocalDirection(-1, 0, 0)).toBe('left')
    expect(regionFromLocalDirection(0, 1, 0)).toBe('roof')
  })

  it('does not report a roof hit from below', () => {
    // Landing on the wheels drives the contact upward through the floor; that
    // is not roof damage.
    expect(regionFromLocalDirection(0, -1, 0)).not.toBe('roof')
  })

  it('prefers the longitudinal panel on a glancing corner hit', () => {
    expect(regionFromLocalDirection(0.6, 0, 0.8)).toBe('front')
    expect(regionFromLocalDirection(0.9, 0, 0.4)).toBe('right')
  })
})

describe('applyRegionDamage', () => {
  it('bleeds a front impact into the engine but not a rear one', () => {
    const front = createDamage()
    applyRegionDamage(front, createRegionDamage(), 'front', 0.5)

    const rear = createDamage()
    applyRegionDamage(rear, createRegionDamage(), 'rear', 0.5)

    expect(front.engine).toBeGreaterThan(rear.engine * 3)
  })

  it('bends the steering on side impacts', () => {
    const side = createDamage()
    applyRegionDamage(side, createRegionDamage(), 'left', 0.5)
    expect(side.steering).toBeGreaterThan(0.2)
  })

  it('saturates at 1 rather than overflowing', () => {
    const damage = createDamage()
    const regions = createRegionDamage()
    for (let i = 0; i < 20; i++) applyRegionDamage(damage, regions, 'front', 0.9)
    expect(damage.body).toBe(1)
    expect(regions.front).toBe(1)
    expect(overallDamage(damage)).toBeLessThanOrEqual(1)
  })
})

describe('damageModifiers', () => {
  it('leaves an undamaged car completely stock', () => {
    const mods = damageModifiers(createDamage(), 1)
    expect(mods.power).toBe(1)
    expect(mods.grip).toBe(1)
    expect(mods.steerBias).toBe(0)
  })

  it('keeps a totalled car driveable', () => {
    const wrecked = { body: 1, engine: 1, steering: 1, suspension: 1, tires: 1, windows: 1 }
    const mods = damageModifiers(wrecked, 1)
    // Being stranded is not fun: even a write-off keeps meaningful power and grip.
    expect(mods.power).toBeGreaterThan(0.4)
    expect(mods.grip).toBeGreaterThan(0.55)
    expect(mods.steerRange).toBeGreaterThan(0.6)
  })

  it('pulls the steering toward the damaged side', () => {
    const damage = createDamage()
    damage.steering = 0.5
    expect(damageModifiers(damage, 1).steerBias).toBeGreaterThan(0)
    expect(damageModifiers(damage, -1).steerBias).toBeLessThan(0)
  })
})
