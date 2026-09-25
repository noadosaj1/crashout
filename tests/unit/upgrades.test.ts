import { describe, expect, it } from 'vitest'
import {
  MAX_UPGRADE_LEVEL,
  STOCK_UPGRADES,
  UPGRADE_LIST,
  upgradeCost,
  upgradeMultiplier,
} from '@/config/upgrades'

describe('upgrade maths', () => {
  it('leaves a stock car unmodified', () => {
    for (const upgrade of UPGRADE_LIST) {
      expect(upgradeMultiplier(upgrade.key, STOCK_UPGRADES[upgrade.key])).toBe(1)
    }
  })

  it('improves monotonically with level', () => {
    for (const upgrade of UPGRADE_LIST) {
      for (let level = 1; level <= MAX_UPGRADE_LEVEL; level++) {
        expect(upgradeMultiplier(upgrade.key, level)).toBeGreaterThan(
          upgradeMultiplier(upgrade.key, level - 1),
        )
      }
    }
  })

  it('clamps out-of-range levels instead of returning undefined', () => {
    for (const upgrade of UPGRADE_LIST) {
      expect(upgradeMultiplier(upgrade.key, -5)).toBe(1)
      expect(upgradeMultiplier(upgrade.key, 99)).toBe(
        upgradeMultiplier(upgrade.key, MAX_UPGRADE_LEVEL),
      )
    }
  })

  it('gets more expensive each level and has no price past the cap', () => {
    for (const upgrade of UPGRADE_LIST) {
      let previous = 0
      for (let level = 0; level < MAX_UPGRADE_LEVEL; level++) {
        const cost = upgradeCost(upgrade.key, level)
        expect(cost).not.toBeNull()
        expect(cost!).toBeGreaterThan(previous)
        previous = cost!
      }
      expect(upgradeCost(upgrade.key, MAX_UPGRADE_LEVEL)).toBeNull()
    }
  })

  it('keeps gains modest enough that a stock car stays competitive', () => {
    for (const upgrade of UPGRADE_LIST) {
      expect(upgradeMultiplier(upgrade.key, MAX_UPGRADE_LEVEL)).toBeLessThan(1.6)
    }
  })
})
