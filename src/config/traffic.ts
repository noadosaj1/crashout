/** Traffic content. Shapes, colours and tuning all live here. */

export interface TrafficSilhouette {
  id: string
  /** Half extents of the collider and the body box. */
  half: { x: number; y: number; z: number }
  mass: number
  /** Cabin box, as a fraction of the body. */
  cabin: { scale: number; offsetZ: number; height: number }
  /** How often this shape is picked, relative to the others. */
  weight: number
  /** Multiplier on the lane speed limit. */
  speed: number
}

export const TRAFFIC_SILHOUETTES: TrafficSilhouette[] = [
  {
    id: 'sedan',
    half: { x: 0.9, y: 0.42, z: 2.1 },
    mass: 1400,
    cabin: { scale: 0.8, offsetZ: -0.15, height: 0.62 },
    weight: 5,
    speed: 1,
  },
  {
    id: 'van',
    half: { x: 0.98, y: 0.62, z: 2.5 },
    mass: 2100,
    cabin: { scale: 0.92, offsetZ: 0.55, height: 0.5 },
    weight: 2,
    speed: 0.88,
  },
  {
    id: 'truck',
    half: { x: 1.15, y: 0.85, z: 3.6 },
    mass: 4200,
    cabin: { scale: 0.86, offsetZ: 1.9, height: 0.55 },
    weight: 1,
    speed: 0.78,
  },
]

/** Ordinary paint, deliberately duller than the player's cars. */
export const TRAFFIC_COLORS = [
  0xb9bec4, 0x8c939b, 0x5c6672, 0x2f3a46, 0xa85a4b, 0x7d4b3f, 0x3f5a72, 0x6d7a5c,
  0xc2b49a, 0x4a4f55,
]

/** How many cars are kept alive around the player. */
export const TRAFFIC_DENSITY = 34
/**
 * Spawn ring. The minimum is deliberately short — a large road network spreads
 * cars thin, and holding every car 100 m away meant you almost never met one.
 */
export const TRAFFIC_SPAWN_MIN = 55
export const TRAFFIC_SPAWN_MAX = 240
/**
 * Cars may not appear this close to a spot the player can actually see. Off to
 * the side, or behind a building, the shorter ring above applies instead — a
 * blanket ban on the whole forward cone empties the road you are driving into,
 * which is far more obvious than a distant car fading in.
 */
export const TRAFFIC_SPAWN_VIEW_MIN = 135
/** Removed beyond this, unless recently wrecked and still interesting. */
export const TRAFFIC_DESPAWN = 420
/** A wreck sticks around this long before it may be cleaned up. */
export const TRAFFIC_WRECK_LIFETIME = 25
