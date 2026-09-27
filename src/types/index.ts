/** Shared domain types. Kept free of engine imports so UI and net layers can use them. */

export type VehicleCategory =
  | 'hatchback'
  | 'coupe'
  | 'muscle'
  | 'sedan'
  | 'supercar'
  | 'suv'
  | 'pickup'
  | 'beater'
  | 'van'
  | 'rally'

export type Drivetrain = 'fwd' | 'rwd' | 'awd'

/**
 * Handling numbers are deliberately arcade-y abstractions, not SI units.
 * They are tuned against each other, see `config/vehicles.ts`.
 */
export interface VehicleSpec {
  id: string
  name: string
  category: VehicleCategory
  price: number
  /** kg. Drives collision outcomes: heavy cars shove light ones. */
  mass: number
  /** Forward force scalar (N per kg-ish). Higher = snappier launch. */
  acceleration: number
  /** m/s. Arcade top speed, enforced by drive-force falloff not a hard clamp. */
  topSpeed: number
  /** Max steering angle in radians at low speed. */
  steering: number
  braking: number
  /** Lateral grip coefficient, 0..1.5. Higher = sticks, lower = slides. */
  grip: number
  drivetrain: Drivetrain
  suspension: {
    /** Ride height / max suspension extension in metres. */
    restLength: number
    stiffness: number
    damping: number
    travel: number
  }
  /** 0..1. Scales incoming damage; 1 = tank, 0 = eggshell. */
  crashResistance: number
  /** Chassis half-extents (x = half width, y = half height, z = half length). */
  dimensions: { halfWidth: number; halfHeight: number; halfLength: number }
  wheel: { radius: number; width: number; frontOffsetZ: number; rearOffsetZ: number; offsetX: number }
  /** Procedural body-shape hints used by the mesh builder. */
  visual: {
    roofScale: number
    roofOffsetZ: number
    noseSlope: number
    baseColor: number
    accent: number
    /** Rear wing. Sporty cars get one; a pickup does not. */
    spoiler?: boolean
    /** Extra ride height for the arches, so off-roaders look like off-roaders. */
    archFlare?: number
  }
  audioProfile: { idleHz: number; redlineHz: number; timbre: 'growl' | 'whine' | 'rasp' }
  boost?: { force: number; capacity: number; regen: number }
}

export interface VehicleDamage {
  body: number
  engine: number
  steering: number
  suspension: number
  tires: number
  windows: number
}

export type DamageRegion = 'front' | 'rear' | 'left' | 'right' | 'roof'

export interface VehicleCustomization {
  paint: string
  wheelStyle: string
  accent: string
}

export interface VehicleUpgrades {
  engine: number
  brakes: number
  handling: number
  acceleration: number
  durability: number
}

export interface OwnedVehicle {
  id: string
  specId: string
  nickname: string | null
  customization: VehicleCustomization
  upgrades: VehicleUpgrades
}

export interface PlayerProfile {
  id: string
  username: string
  credits: number
  level: number
  experience: number
  activeVehicleId: string | null
}

export interface PlayerStats {
  distanceDriven: number
  biggestCrash: number
  crashes: number
  racesWon: number
  deliveriesCompleted: number
  creditsEarned: number
}

export type GadgetId = 'oil_slick' | 'smoke_screen' | 'bounce_pad' | 'spike_strip' | 'thumper'

export interface GadgetSpec {
  id: GadgetId
  name: string
  description: string
  /** Seconds between activations. */
  cooldown: number
  /** Seconds the spawned hazard persists in the world. */
  duration: number
  price: number
  color: number
  /** Metres behind the vehicle where the hazard is dropped. */
  dropDistance: number
  radius: number
}

export type ActivityKind = 'delivery' | 'race' | 'time_trial' | 'crash_challenge'

export interface ActivitySpec {
  id: string
  kind: ActivityKind
  name: string
  description: string
  baseReward: number
  /** Seconds. */
  timeLimit: number
  /** World-space waypoints. Delivery uses the last one; races use all. */
  waypoints: Array<[number, number, number]>
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Quat {
  x: number
  y: number
  z: number
  w: number
}
