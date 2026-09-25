import type { SupabaseClient } from '@supabase/supabase-js'
import type { GadgetId, OwnedVehicle, PlayerStats, VehicleCustomization } from '@/types'
import type { UpgradeKey } from '@/config/upgrades'
import type { Database } from '@/lib/supabase/database.types'
import { PersistenceError, type PersistenceAdapter, type PlayerSave } from './types'

type Client = SupabaseClient<Database>

/**
 * Authoritative persistence. Every credit movement goes through a SECURITY
 * DEFINER RPC that recomputes the amount server-side — see
 * supabase/migrations/0002_economy_functions.sql. Nothing here ever writes a
 * balance directly, and the column grants in 0001 mean it could not if it tried.
 */
export class SupabasePersistence implements PersistenceAdapter {
  readonly kind = 'supabase' as const
  private readonly client: Client
  private readonly userId: string

  constructor(client: Client, userId: string) {
    this.client = client
    this.userId = userId
  }

  private fail(context: string, error: { message: string } | null): never {
    throw new PersistenceError(`${context}: ${error?.message ?? 'unknown error'}`)
  }

  async load(): Promise<PlayerSave> {
    const [profileRes, vehiclesRes, upgradesRes, inventoryRes, statsRes] = await Promise.all([
      this.client.from('profiles').select('*').eq('id', this.userId).single(),
      this.client.from('player_vehicles').select('*').eq('owner_id', this.userId).order('created_at'),
      this.client.from('vehicle_upgrades').select('*'),
      this.client.from('player_inventory').select('*').eq('owner_id', this.userId),
      this.client.from('player_stats').select('*').eq('player_id', this.userId).maybeSingle(),
    ])

    if (profileRes.error) this.fail('Loading profile', profileRes.error)
    if (vehiclesRes.error) this.fail('Loading garage', vehiclesRes.error)

    const upgradeById = new Map(
      (upgradesRes.data ?? []).map((row) => [row.player_vehicle_id, row] as const),
    )

    const vehicles: OwnedVehicle[] = (vehiclesRes.data ?? []).map((row) => {
      const up = upgradeById.get(row.id)
      return {
        id: row.id,
        specId: row.spec_id,
        nickname: row.nickname,
        customization: { paint: row.paint, wheelStyle: row.wheel_style, accent: row.accent },
        upgrades: {
          engine: up?.engine ?? 0,
          brakes: up?.brakes ?? 0,
          handling: up?.handling ?? 0,
          acceleration: up?.acceleration ?? 0,
          durability: up?.durability ?? 0,
        },
      }
    })

    const p = profileRes.data
    const s = statsRes.data
    return {
      profile: {
        id: p.id,
        username: p.username,
        credits: Number(p.credits),
        level: p.level,
        experience: p.experience,
        activeVehicleId: p.active_vehicle_id ?? vehicles[0]?.id ?? null,
      },
      vehicles,
      gadgets: (inventoryRes.data ?? []).map((row) => row.gadget_id as GadgetId),
      stats: {
        distanceDriven: Number(s?.distance_driven ?? 0),
        biggestCrash: s?.biggest_crash ?? 0,
        crashes: s?.crashes ?? 0,
        racesWon: s?.races_won ?? 0,
        deliveriesCompleted: s?.deliveries_completed ?? 0,
        creditsEarned: Number(s?.credits_earned ?? 0),
      },
    }
  }

  async setActiveVehicle(vehicleId: string): Promise<void> {
    const { error } = await this.client
      .from('profiles')
      .update({ active_vehicle_id: vehicleId, updated_at: new Date().toISOString() })
      .eq('id', this.userId)
    if (error) this.fail('Setting active vehicle', error)
  }

  async renameVehicle(vehicleId: string, nickname: string): Promise<void> {
    const trimmed = nickname.trim().slice(0, 32)
    const { error } = await this.client
      .from('player_vehicles')
      .update({ nickname: trimmed || null })
      .eq('id', vehicleId)
      .eq('owner_id', this.userId)
    if (error) this.fail('Renaming vehicle', error)
  }

  async purchaseVehicle(specId: string): Promise<{ save: PlayerSave; vehicleId: string }> {
    const { data, error } = await this.client.rpc('purchase_vehicle', { p_spec_id: specId })
    if (error) this.fail('Buying vehicle', error)
    const save = await this.load()
    return { save, vehicleId: data.id }
  }

  async purchaseUpgrade(vehicleId: string, key: UpgradeKey): Promise<PlayerSave> {
    const { error } = await this.client.rpc('purchase_upgrade', { p_vehicle_id: vehicleId, p_key: key })
    if (error) this.fail('Buying upgrade', error)
    return this.load()
  }

  async purchaseCustomization(
    vehicleId: string,
    kind: keyof VehicleCustomization,
    optionId: string,
  ): Promise<PlayerSave> {
    const dbKind = kind === 'paint' ? 'paint' : kind === 'wheelStyle' ? 'wheel' : 'accent'
    const { error } = await this.client.rpc('purchase_customization', {
      p_vehicle_id: vehicleId,
      p_kind: dbKind,
      p_option_id: optionId,
    })
    if (error) this.fail('Applying customization', error)
    return this.load()
  }

  async purchaseGadget(gadgetId: GadgetId): Promise<PlayerSave> {
    const { error } = await this.client.rpc('purchase_gadget', { p_gadget_id: gadgetId })
    if (error) this.fail('Buying gadget', error)
    return this.load()
  }

  async repairVehicle(vehicleId: string, damage: number): Promise<PlayerSave> {
    const { error } = await this.client.rpc('repair_vehicle', {
      p_vehicle_id: vehicleId,
      p_damage: damage,
    })
    if (error) this.fail('Repairing vehicle', error)
    return this.load()
  }

  async awardActivity(input: {
    activityId: string
    elapsedSeconds: number
    damage: number
    score: number
  }): Promise<{ credits: number; awarded: number }> {
    const before = await this.client.from('profiles').select('credits').eq('id', this.userId).single()
    const { data, error } = await this.client.rpc('award_activity_reward', {
      p_activity_id: input.activityId,
      p_elapsed_seconds: input.elapsedSeconds,
      p_damage: input.damage,
      p_score: input.score,
    })
    if (error) this.fail('Claiming reward', error)
    const credits = Number(data)
    const previous = Number(before.data?.credits ?? credits)
    return { credits, awarded: Math.max(0, credits - previous) }
  }

  async saveStats(stats: Partial<PlayerStats>): Promise<void> {
    const payload: Record<string, unknown> = { player_id: this.userId, updated_at: new Date().toISOString() }
    if (stats.distanceDriven !== undefined) payload.distance_driven = Math.round(stats.distanceDriven)
    if (stats.crashes !== undefined) payload.crashes = stats.crashes
    if (stats.biggestCrash !== undefined) payload.biggest_crash = Math.round(stats.biggestCrash)
    // Stats are non-economic, so an upsert straight from the client is fine.
    await this.client.from('player_stats').upsert(payload as never, { onConflict: 'player_id' })
  }
}
