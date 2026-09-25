import type { VehicleUpgrades } from '@/types'

export type UpgradeKey = keyof VehicleUpgrades

export const MAX_UPGRADE_LEVEL = 3

export interface UpgradeDefinition {
  key: UpgradeKey
  name: string
  description: string
  /** Multiplier applied per level, index 0 = stock. */
  multipliers: [number, number, number, number]
  /** Cost to move from level i to i+1. */
  costs: [number, number, number]
}

export const UPGRADES: Record<UpgradeKey, UpgradeDefinition> = {
  engine: {
    key: 'engine',
    name: 'Engine',
    description: 'Raises top speed.',
    multipliers: [1, 1.08, 1.17, 1.28],
    costs: [4_000, 11_000, 26_000],
  },
  acceleration: {
    key: 'acceleration',
    name: 'Acceleration',
    description: 'Harder launch out of corners.',
    multipliers: [1, 1.1, 1.22, 1.38],
    costs: [3_500, 9_500, 22_000],
  },
  brakes: {
    key: 'brakes',
    name: 'Brakes',
    description: 'Shorter stopping distance.',
    multipliers: [1, 1.12, 1.26, 1.45],
    costs: [2_500, 7_000, 16_000],
  },
  handling: {
    key: 'handling',
    name: 'Handling',
    description: 'More lateral grip and sharper steering.',
    multipliers: [1, 1.07, 1.14, 1.24],
    costs: [3_000, 8_500, 19_000],
  },
  durability: {
    key: 'durability',
    name: 'Durability',
    description: 'Takes less damage in a crash.',
    multipliers: [1, 1.15, 1.32, 1.55],
    costs: [3_000, 8_000, 18_000],
  },
}

export const UPGRADE_LIST = Object.values(UPGRADES)

export const STOCK_UPGRADES: VehicleUpgrades = {
  engine: 0,
  acceleration: 0,
  brakes: 0,
  handling: 0,
  durability: 0,
}

export function upgradeMultiplier(key: UpgradeKey, level: number): number {
  const clamped = Math.max(0, Math.min(MAX_UPGRADE_LEVEL, Math.floor(level)))
  return UPGRADES[key].multipliers[clamped]
}

export function upgradeCost(key: UpgradeKey, currentLevel: number): number | null {
  if (currentLevel >= MAX_UPGRADE_LEVEL) return null
  return UPGRADES[key].costs[currentLevel]
}
