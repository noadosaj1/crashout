/** Fixed physics timestep. Vehicle forces are tuned against this value. */
export const PHYSICS_DT = 1 / 60
/** Never simulate more than this many physics steps in one frame (spiral-of-death guard). */
export const MAX_PHYSICS_STEPS = 5

export const GRAVITY = -22.5

/** Network send rate for local vehicle transforms, in Hz. */
export const NET_TICK_HZ = 15
/** Remote vehicles are rendered this far in the past so interpolation always has two samples. */
export const NET_INTERPOLATION_DELAY = 0.12

export const MS_TO_KMH = 3.6

/**
 * Contact-force gate, in Newtons. A parked car already pushes its own weight
 * into the road (a 2.2t SUV is ~50 kN), and hard landings multiply that, so this
 * sits well above resting load. It only decides *whether to look* at a contact —
 * severity itself comes from the vehicle's velocity change, see below.
 */
export const CRASH_CONTACT_FORCE_GATE = 90_000
/** Velocity lost in a single physics step, in m/s, below which it is not a crash. */
export const CRASH_DELTA_V_THRESHOLD = 1.1
/** Velocity change that counts as a maximum-drama crash, for effects and scoring. */
export const CRASH_DELTA_V_REFERENCE = 17

export const RESPAWN_FALL_Y = -40

export const COLLISION_GROUPS = {
  /** Static world geometry. */
  WORLD: 0x0001,
  VEHICLE: 0x0002,
  PROP: 0x0004,
  HAZARD: 0x0008,
} as const

export const WORLD_BOUNDS = 760
