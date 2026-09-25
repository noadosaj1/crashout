import type { GadgetId, OwnedVehicle, PlayerProfile, PlayerStats, VehicleCustomization } from '@/types'
import type { UpgradeKey } from '@/config/upgrades'

export interface PlayerSave {
  profile: PlayerProfile
  vehicles: OwnedVehicle[]
  gadgets: GadgetId[]
  stats: PlayerStats
}

/**
 * Everything the game needs from a backend. Two implementations exist: Supabase
 * (authoritative, server-validated) and local storage (offline play). Gameplay
 * code only ever sees this interface.
 */
export interface PersistenceAdapter {
  readonly kind: 'supabase' | 'local'
  load(): Promise<PlayerSave>
  setActiveVehicle(vehicleId: string): Promise<void>
  renameVehicle(vehicleId: string, nickname: string): Promise<void>
  purchaseVehicle(specId: string): Promise<{ save: PlayerSave; vehicleId: string }>
  purchaseUpgrade(vehicleId: string, key: UpgradeKey): Promise<PlayerSave>
  purchaseCustomization(
    vehicleId: string,
    kind: keyof VehicleCustomization,
    optionId: string,
  ): Promise<PlayerSave>
  purchaseGadget(gadgetId: GadgetId): Promise<PlayerSave>
  repairVehicle(vehicleId: string, damage: number): Promise<PlayerSave>
  /** Returns the new balance. The backend decides the amount, not the caller. */
  awardActivity(input: {
    activityId: string
    elapsedSeconds: number
    damage: number
    score: number
  }): Promise<{ credits: number; awarded: number }>
  saveStats(stats: Partial<PlayerStats>): Promise<void>
}

export class PersistenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PersistenceError'
  }
}
