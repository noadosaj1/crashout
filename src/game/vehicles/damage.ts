import type { DamageRegion, VehicleDamage } from '@/types'

export function createDamage(): VehicleDamage {
  return { body: 0, engine: 0, steering: 0, suspension: 0, tires: 0, windows: 0 }
}

export interface RegionDamage {
  front: number
  rear: number
  left: number
  right: number
  roof: number
}

export function createRegionDamage(): RegionDamage {
  return { front: 0, rear: 0, left: 0, right: 0, roof: 0 }
}

/**
 * How a hit on each region bleeds into the mechanical subsystems. A front-end
 * impact wrecks the engine; a side hit bends the steering; a landing on the roof
 * mostly just ruins the bodywork and the glass.
 */
const SUBSYSTEM_WEIGHTS: Record<DamageRegion, Partial<Record<keyof VehicleDamage, number>>> = {
  front: { body: 1.0, engine: 0.85, steering: 0.4, suspension: 0.35, windows: 0.2 },
  rear: { body: 0.9, engine: 0.15, suspension: 0.4, windows: 0.2 },
  left: { body: 0.85, steering: 0.55, suspension: 0.3, tires: 0.45, windows: 0.35 },
  right: { body: 0.85, steering: 0.55, suspension: 0.3, tires: 0.45, windows: 0.35 },
  roof: { body: 0.7, windows: 0.9, suspension: 0.2 },
}

/** Applies a normalised (0..1) impact to the damage model. Mutates in place. */
export function applyRegionDamage(
  damage: VehicleDamage,
  regions: RegionDamage,
  region: DamageRegion,
  severity: number,
): void {
  regions[region] = Math.min(1, regions[region] + severity)
  const weights = SUBSYSTEM_WEIGHTS[region]
  for (const key of Object.keys(weights) as Array<keyof VehicleDamage>) {
    const w = weights[key] ?? 0
    damage[key] = Math.min(1, damage[key] + severity * w)
  }
}

export interface DamageModifiers {
  /** Multiplier on engine drive force. */
  power: number
  /** Multiplier on max steering angle. */
  steerRange: number
  /** Constant steering offset in radians — a bent car pulls to one side. */
  steerBias: number
  /** Multiplier on lateral grip. */
  grip: number
  /** Multiplier on suspension damping. */
  damping: number
  /** Multiplier on braking force. */
  braking: number
}

/**
 * Damage is deliberately forgiving: a totalled car is slow and squirrelly but
 * still driveable, because being stranded is not fun.
 */
export function damageModifiers(damage: VehicleDamage, bias: number): DamageModifiers {
  return {
    power: 1 - damage.engine * 0.55,
    steerRange: 1 - damage.steering * 0.3,
    // Capped low on purpose: a wrecked car should pull, not be undriveable.
    steerBias: bias * damage.steering * 0.075,
    grip: 1 - damage.tires * 0.4,
    damping: 1 - damage.suspension * 0.55,
    braking: 1 - damage.body * 0.2,
  }
}

/** Overall wreckage, 0..1 — what the HUD damage bar shows. */
export function overallDamage(damage: VehicleDamage): number {
  return Math.min(
    1,
    damage.body * 0.4 + damage.engine * 0.25 + damage.steering * 0.15 + damage.suspension * 0.12 + damage.tires * 0.08,
  )
}

/** Maps a world-space impact direction (in vehicle local space) to a panel. */
export function regionFromLocalDirection(x: number, y: number, z: number): DamageRegion {
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  const az = Math.abs(z)
  if (ay > ax && ay > az && y > 0) return 'roof'
  if (az >= ax) return z > 0 ? 'front' : 'rear'
  return x > 0 ? 'right' : 'left'
}
