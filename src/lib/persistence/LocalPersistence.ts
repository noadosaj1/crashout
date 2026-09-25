import type { GadgetId, OwnedVehicle, PlayerStats, VehicleCustomization } from '@/types'
import { GADGETS } from '@/config/gadgets'
import { ACTIVITIES, CRASH_SCORE_TO_CREDITS, DELIVERY_CONDITION_BONUS, DELIVERY_SPEED_BONUS } from '@/config/activities'
import { STARTER_VEHICLE_ID, VEHICLES } from '@/config/vehicles'
import { MAX_UPGRADE_LEVEL, STOCK_UPGRADES, upgradeCost, type UpgradeKey } from '@/config/upgrades'
import { ACCENTS, PAINTS, WHEELS } from '@/config/customization'
import { PersistenceError, type PersistenceAdapter, type PlayerSave } from './types'

const STORAGE_KEY = 'crashout.save.v1'
const STARTING_CREDITS = 15_000

function newVehicleId(): string {
  return crypto.randomUUID()
}

function starterSave(username: string): PlayerSave {
  const vehicle: OwnedVehicle = {
    id: newVehicleId(),
    specId: STARTER_VEHICLE_ID,
    nickname: null,
    customization: { paint: 'stock', wheelStyle: 'stock', accent: 'stock' },
    upgrades: { ...STOCK_UPGRADES },
  }
  return {
    profile: {
      id: crypto.randomUUID(),
      username,
      credits: STARTING_CREDITS,
      level: 1,
      experience: 0,
      activeVehicleId: vehicle.id,
    },
    vehicles: [vehicle],
    gadgets: ['oil_slick'],
    stats: {
      distanceDriven: 0,
      biggestCrash: 0,
      crashes: 0,
      racesWon: 0,
      deliveriesCompleted: 0,
      creditsEarned: 0,
    },
  }
}

/**
 * Offline save. Used when Supabase is not configured, or when the player
 * chooses to play as a guest.
 *
 * This deliberately mirrors the *shape* of the server rules (prices come from
 * config, rewards are recomputed from the activity definition) but makes no
 * claim to be tamper-proof — it is local storage on the player's own machine.
 * Anything competitive should run against the Supabase adapter.
 */
export class LocalPersistence implements PersistenceAdapter {
  readonly kind = 'local' as const
  private save: PlayerSave

  constructor(username = 'Guest Driver') {
    this.save = this.read() ?? starterSave(username)
    this.write()
  }

  private read(): PlayerSave | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as PlayerSave
      if (!parsed.profile || !Array.isArray(parsed.vehicles) || parsed.vehicles.length === 0) return null
      return parsed
    } catch {
      return null
    }
  }

  private write(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.save))
    } catch {
      // Storage full or blocked — the session still works, it just will not persist.
    }
  }

  private clone(): PlayerSave {
    return structuredClone(this.save)
  }

  private spend(amount: number, reason: string): void {
    if (this.save.profile.credits < amount) {
      throw new PersistenceError(`Not enough credits for ${reason}`)
    }
    this.save.profile.credits -= amount
  }

  private vehicle(id: string): OwnedVehicle {
    const v = this.save.vehicles.find((x) => x.id === id)
    if (!v) throw new PersistenceError('Vehicle not owned')
    return v
  }

  async load(): Promise<PlayerSave> {
    return this.clone()
  }

  async setActiveVehicle(vehicleId: string): Promise<void> {
    this.vehicle(vehicleId)
    this.save.profile.activeVehicleId = vehicleId
    this.write()
  }

  async renameVehicle(vehicleId: string, nickname: string): Promise<void> {
    const v = this.vehicle(vehicleId)
    v.nickname = nickname.trim().slice(0, 32) || null
    this.write()
  }

  async purchaseVehicle(specId: string): Promise<{ save: PlayerSave; vehicleId: string }> {
    const spec = VEHICLES[specId]
    if (!spec) throw new PersistenceError('Unknown vehicle')
    this.spend(spec.price, spec.name)
    const vehicle: OwnedVehicle = {
      id: newVehicleId(),
      specId,
      nickname: null,
      customization: { paint: 'stock', wheelStyle: 'stock', accent: 'stock' },
      upgrades: { ...STOCK_UPGRADES },
    }
    this.save.vehicles.push(vehicle)
    this.write()
    return { save: this.clone(), vehicleId: vehicle.id }
  }

  async purchaseUpgrade(vehicleId: string, key: UpgradeKey): Promise<PlayerSave> {
    const vehicle = this.vehicle(vehicleId)
    const level = vehicle.upgrades[key]
    if (level >= MAX_UPGRADE_LEVEL) throw new PersistenceError('Already maxed')
    const cost = upgradeCost(key, level)
    if (cost === null) throw new PersistenceError('Already maxed')
    this.spend(cost, key)
    vehicle.upgrades[key] = level + 1
    this.write()
    return this.clone()
  }

  async purchaseCustomization(
    vehicleId: string,
    kind: keyof VehicleCustomization,
    optionId: string,
  ): Promise<PlayerSave> {
    const vehicle = this.vehicle(vehicleId)
    const table = kind === 'paint' ? PAINTS : kind === 'wheelStyle' ? WHEELS : ACCENTS
    const option = table.find((o) => o.id === optionId)
    if (!option) throw new PersistenceError('Unknown option')
    if (vehicle.customization[kind] !== optionId) this.spend(option.price, option.name)
    vehicle.customization[kind] = optionId
    this.write()
    return this.clone()
  }

  async purchaseGadget(gadgetId: GadgetId): Promise<PlayerSave> {
    const gadget = GADGETS[gadgetId]
    if (!gadget) throw new PersistenceError('Unknown gadget')
    if (this.save.gadgets.includes(gadgetId)) throw new PersistenceError('Already owned')
    this.spend(gadget.price, gadget.name)
    this.save.gadgets.push(gadgetId)
    this.write()
    return this.clone()
  }

  async repairVehicle(vehicleId: string, damage: number): Promise<PlayerSave> {
    this.vehicle(vehicleId)
    const cost = Math.round(Math.max(0, Math.min(1, damage)) * 2500)
    if (cost > 0) this.spend(cost, 'repairs')
    this.write()
    return this.clone()
  }

  async awardActivity(input: {
    activityId: string
    elapsedSeconds: number
    damage: number
    score: number
  }): Promise<{ credits: number; awarded: number }> {
    const activity = ACTIVITIES[input.activityId]
    if (!activity) throw new PersistenceError('Unknown activity')

    let awarded = 0
    if (input.elapsedSeconds > 0 && input.elapsedSeconds <= activity.timeLimit) {
      if (activity.kind === 'crash_challenge') {
        awarded = activity.baseReward + Math.floor(Math.max(0, input.score) * CRASH_SCORE_TO_CREDITS)
        awarded = Math.min(awarded, activity.baseReward * 30)
      } else {
        const timeRatio = 1 - input.elapsedSeconds / activity.timeLimit
        awarded =
          activity.baseReward +
          Math.floor(activity.baseReward * DELIVERY_SPEED_BONUS * Math.max(0, Math.min(1, timeRatio))) +
          Math.floor(activity.baseReward * DELIVERY_CONDITION_BONUS * Math.max(0, 1 - Math.min(1, input.damage)))
        awarded = Math.min(awarded, activity.baseReward * 2)
      }
    }

    this.save.profile.credits += awarded
    this.save.stats.creditsEarned += awarded
    if (awarded > 0) {
      if (activity.kind === 'delivery') this.save.stats.deliveriesCompleted++
      if (activity.kind === 'race') this.save.stats.racesWon++
      this.save.profile.experience += Math.floor(awarded / 100)
      this.save.profile.level = 1 + Math.floor(this.save.profile.experience / 120)
    }
    this.write()
    return { credits: this.save.profile.credits, awarded }
  }

  async saveStats(stats: Partial<PlayerStats>): Promise<void> {
    Object.assign(this.save.stats, stats)
    this.write()
  }
}
