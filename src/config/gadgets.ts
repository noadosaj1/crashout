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
    description: 'Dumps a slick of oil behind you. Anyone who drives through it loses traction.',
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
    description: 'A rolling cloud of smoke that blinds anyone inside it.',
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
    description: 'Drops a pad that launches whatever touches it straight up. Including you.',
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
    description: 'Shreds tires. Grip drops hard until the victim recovers their car.',
    cooldown: 16,
    duration: 30,
    price: 21_000,
    color: 0xf2c14e,
    dropDistance: 4.2,
    radius: 3.0,
  },
}

export const GADGET_LIST = Object.values(GADGETS)

export const STARTER_GADGETS: GadgetId[] = ['oil_slick']
