import { beforeEach, describe, expect, it } from 'vitest'
import { LocalPersistence } from '@/lib/persistence/LocalPersistence'
import { PersistenceError } from '@/lib/persistence/types'
import { ACTIVITIES } from '@/config/activities'
import { VEHICLES } from '@/config/vehicles'
import { upgradeCost } from '@/config/upgrades'

// jsdom is overkill for this; a tiny in-memory shim is enough.
class MemoryStorage {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  clear(): void {
    this.map.clear()
  }
}

beforeEach(() => {
  ;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage()
})

describe('starter state', () => {
  it('gives the player a free car they can drive immediately', async () => {
    const save = await new LocalPersistence().load()
    expect(save.vehicles).toHaveLength(1)
    expect(save.profile.activeVehicleId).toBe(save.vehicles[0].id)
    expect(VEHICLES[save.vehicles[0].specId].price).toBe(0)
    expect(save.gadgets).toContain('oil_slick')
  })
})

describe('purchases', () => {
  it('charges the catalogue price and adds the car', async () => {
    const p = new LocalPersistence()
    const before = await p.load()
    const spec = VEHICLES.rustbucket
    const { save } = await p.purchaseVehicle(spec.id)
    expect(save.profile.credits).toBe(before.profile.credits - spec.price)
    expect(save.vehicles.map((v) => v.specId)).toContain(spec.id)
  })

  it('refuses a car the player cannot afford', async () => {
    const p = new LocalPersistence()
    await expect(p.purchaseVehicle('aerith_x')).rejects.toBeInstanceOf(PersistenceError)
    expect((await p.load()).profile.credits).toBe(15_000)
  })

  it('refuses an unknown vehicle id', async () => {
    const p = new LocalPersistence()
    await expect(p.purchaseVehicle('not_a_car')).rejects.toBeInstanceOf(PersistenceError)
  })

  it('walks upgrade levels one at a time and stops at max', async () => {
    const p = new LocalPersistence()
    // A full brake set costs more than the starting balance, so earn first.
    for (let i = 0; i < 3; i++) {
      await p.awardActivity({ activityId: 'race_highway', elapsedSeconds: 30, damage: 0, score: 0 })
    }
    const start = await p.load()
    const id = start.vehicles[0].id

    let save = await p.purchaseUpgrade(id, 'brakes')
    expect(save.vehicles[0].upgrades.brakes).toBe(1)
    expect(save.profile.credits).toBe(start.profile.credits - upgradeCost('brakes', 0)!)

    save = await p.purchaseUpgrade(id, 'brakes')
    save = await p.purchaseUpgrade(id, 'brakes')
    expect(save.vehicles[0].upgrades.brakes).toBe(3)
    await expect(p.purchaseUpgrade(id, 'brakes')).rejects.toBeInstanceOf(PersistenceError)
  })

  it('does not charge twice for a colour already fitted', async () => {
    const p = new LocalPersistence()
    const id = (await p.load()).vehicles[0].id
    const first = await p.purchaseCustomization(id, 'paint', 'ember')
    const second = await p.purchaseCustomization(id, 'paint', 'ember')
    expect(second.profile.credits).toBe(first.profile.credits)
  })
})

describe('activity rewards', () => {
  it('pays nothing when the clock runs out', async () => {
    const p = new LocalPersistence()
    const activity = ACTIVITIES.delivery_docks
    const { awarded } = await p.awardActivity({
      activityId: activity.id,
      elapsedSeconds: activity.timeLimit + 1,
      damage: 0,
      score: 0,
    })
    expect(awarded).toBe(0)
  })

  it('pays more for a fast, undamaged run', async () => {
    const activity = ACTIVITIES.delivery_docks

    const fast = await new LocalPersistence().awardActivity({
      activityId: activity.id,
      elapsedSeconds: 10,
      damage: 0,
      score: 0,
    })
    const slow = await new LocalPersistence().awardActivity({
      activityId: activity.id,
      elapsedSeconds: activity.timeLimit - 1,
      damage: 0.9,
      score: 0,
    })

    expect(fast.awarded).toBeGreaterThan(slow.awarded)
    expect(slow.awarded).toBeGreaterThanOrEqual(activity.baseReward)
  })

  it('caps a delivery payout at twice base however good the run', async () => {
    const activity = ACTIVITIES.delivery_docks
    const { awarded } = await new LocalPersistence().awardActivity({
      activityId: activity.id,
      elapsedSeconds: 0.001,
      damage: -50,
      score: 1e9,
    })
    expect(awarded).toBeLessThanOrEqual(activity.baseReward * 2)
  })

  it('caps a crash-challenge payout however absurd the score', async () => {
    const activity = ACTIVITIES.crash_arena
    const { awarded } = await new LocalPersistence().awardActivity({
      activityId: activity.id,
      elapsedSeconds: 30,
      damage: 0,
      score: 1e12,
    })
    expect(awarded).toBeLessThanOrEqual(activity.baseReward * 30)
  })

  it('rejects an unknown activity', async () => {
    await expect(
      new LocalPersistence().awardActivity({
        activityId: 'free_money',
        elapsedSeconds: 1,
        damage: 0,
        score: 0,
      }),
    ).rejects.toBeInstanceOf(PersistenceError)
  })
})
