import type { ActivitySpec } from '@/types'

/**
 * Activities are data. `game/missions/ActivitySystem.ts` drives all of them from
 * these definitions — there is no per-activity branching beyond the `kind`.
 */
export const ACTIVITIES: Record<string, ActivitySpec> = {
  delivery_docks: {
    id: 'delivery_docks',
    kind: 'delivery',
    name: 'Parts Run — Industrial',
    description: 'Get the crate to the yard before the clock runs out. Arrive intact for a bonus.',
    baseReward: 2_400,
    timeLimit: 95,
    waypoints: [[420, 1, -160]],
  },
  delivery_suburbs: {
    id: 'delivery_suburbs',
    kind: 'delivery',
    name: 'Parts Run — Suburbs',
    description: 'Cross town to the suburbs. Speed pays, so does keeping the bodywork.',
    baseReward: 2_800,
    timeLimit: 105,
    waypoints: [[-420, 1, 180]],
  },
  delivery_flats: {
    id: 'delivery_flats',
    kind: 'delivery',
    name: 'Parts Run — Dust Flats',
    description: 'Out past the highway into the dirt. Take the jumps if you dare.',
    baseReward: 3_600,
    timeLimit: 120,
    waypoints: [[40, 1, 500]],
  },

  race_downtown: {
    id: 'race_downtown',
    kind: 'race',
    name: 'Downtown Sprint',
    description: 'Four checkpoints through the grid. First across the line wins the pot.',
    baseReward: 5_000,
    timeLimit: 180,
    waypoints: [
      [88, 1, -88],
      [-88, 1, -176],
      [-176, 1, 88],
      [88, 1, 176],
      [0, 1, 0],
    ],
  },
  race_highway: {
    id: 'race_highway',
    kind: 'race',
    name: 'Ring Road Blast',
    description: 'A flat-out run down the eastern highway. Top speed matters here.',
    baseReward: 7_500,
    timeLimit: 240,
    waypoints: [
      [640, 1, -400],
      [640, 1, -100],
      [640, 1, 200],
      [400, 1, 450],
      [180, 1, 600],
    ],
  },

  trial_suburbs: {
    id: 'trial_suburbs',
    kind: 'time_trial',
    name: 'Suburb Loop Trial',
    description: 'Solo run through the suburbs. Beat the target time.',
    baseReward: 3_200,
    timeLimit: 78,
    waypoints: [
      [-500, 1, 60],
      [-340, 1, 180],
      [-500, 1, 300],
      [-420, 1, 120],
    ],
  },

  crash_arena: {
    id: 'crash_arena',
    kind: 'crash_challenge',
    name: 'Demolition Run',
    description: 'Ninety seconds in the arena. Wreck everything. Score is impact, air and flips.',
    baseReward: 1_000,
    timeLimit: 90,
    waypoints: [[-420, 1, -420]],
  },
}

export const ACTIVITY_LIST = Object.values(ACTIVITIES)

/** Delivery payouts: base + speed bonus + condition bonus. */
export const DELIVERY_SPEED_BONUS = 0.6
export const DELIVERY_CONDITION_BONUS = 0.4

/** Credits awarded per point of crash-challenge score. */
export const CRASH_SCORE_TO_CREDITS = 1.4
