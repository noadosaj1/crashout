import type { GadgetId, GadgetSpec } from '@/types'

/**
 * Gadgets are pure data. The gadget system reads these to spawn a hazard volume;
 * adding a new gadget means adding an entry here plus (optionally) a visual
 * builder in `game/gadgets/hazardVisuals.ts`.
 */
export const GADGETS: Record<GadgetId, GadgetSpec> = {
  oil_slick: {
    id: 'oil_slick',
    name: 'Oil Slick',
    description: 'Dumps a slick of oil behind you. Cars lose traction on it, and traffic slithers off line.',
    cooldown: 8,
    duration: 22,
    price: 0,
    color: 0x14131a,
    dropDistance: 3.4,
    radius: 3.2,
  },
  smoke_screen: {
    id: 'smoke_screen',
    name: 'Smoke Screen',
    description: 'A rolling cloud of smoke. Players inside it are blind, and traffic crawls until it clears.',
    cooldown: 12,
    duration: 12,
    price: 9_000,
    color: 0x9aa0a8,
    dropDistance: 4.0,
    radius: 5.5,
  },
  bounce_pad: {
    id: 'bounce_pad',
    name: 'Bounce Pad',
    description: 'Drops a pad that launches whatever touches it straight up. Including you. Including buses.',
    cooldown: 10,
    duration: 26,
    price: 14_000,
    color: 0xff4fd2,
    dropDistance: 5.0,
    radius: 2.6,
  },
  spike_strip: {
    id: 'spike_strip',
    name: 'Spike Strip',
    description: 'Shreds tires. Grip drops hard until the victim recovers, and traffic ends up sideways.',
    cooldown: 16,
    duration: 30,
    price: 21_000,
    color: 0xf2c14e,
    dropDistance: 4.2,
    radius: 3.0,
  },
  thumper: {
    id: 'thumper',
    name: 'Thumper Charge',
    description: 'A proximity charge. It does not trip anyone up — it picks them up and puts them somewhere else.',
    cooldown: 20,
    duration: 18,
    price: 28_000,
    color: 0xff5722,
    dropDistance: 4.6,
    radius: 4,
  },
}

export const GADGET_LIST = Object.values(GADGETS)

export const STARTER_GADGETS: GadgetId[] = ['oil_slick']
