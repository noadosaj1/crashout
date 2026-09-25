import { WORLD_BOUNDS } from '@/config/constants'

export const SURFACE = {
  GRASS: 0,
  ROAD: 1,
  DIRT: 2,
  CONCRETE: 3,
} as const

export type SurfaceKind = (typeof SURFACE)[keyof typeof SURFACE]

/** Lateral grip multiplier per surface. Road is the reference at 1.0. */
export const SURFACE_GRIP: Record<SurfaceKind, number> = {
  [SURFACE.GRASS]: 0.72,
  [SURFACE.ROAD]: 1.0,
  [SURFACE.DIRT]: 0.78,
  [SURFACE.CONCRETE]: 0.95,
}

/** Dust/smoke colour per surface, used by the particle system. */
export const SURFACE_DUST: Record<SurfaceKind, number> = {
  [SURFACE.GRASS]: 0x6f7a4a,
  [SURFACE.ROAD]: 0x9aa0a8,
  [SURFACE.DIRT]: 0xb59a6a,
  [SURFACE.CONCRETE]: 0xb0b6bc,
}

const CELL = 4

/**
 * Coarse baked grid of what is underfoot. Built once at world-build time so the
 * per-wheel surface query is an array index rather than a geometry test.
 */
export class SurfaceMap {
  private readonly size: number
  private readonly cells: Uint8Array

  constructor() {
    this.size = Math.ceil((WORLD_BOUNDS * 2) / CELL)
    this.cells = new Uint8Array(this.size * this.size).fill(SURFACE.GRASS)
  }

  private index(x: number, z: number): number {
    const ix = Math.floor((x + WORLD_BOUNDS) / CELL)
    const iz = Math.floor((z + WORLD_BOUNDS) / CELL)
    if (ix < 0 || iz < 0 || ix >= this.size || iz >= this.size) return -1
    return iz * this.size + ix
  }

  /** Paints an axis-aligned rectangle (used for zones, lots and yards). */
  paintRect(cx: number, cz: number, halfX: number, halfZ: number, kind: SurfaceKind): void {
    const minX = Math.floor((cx - halfX + WORLD_BOUNDS) / CELL)
    const maxX = Math.ceil((cx + halfX + WORLD_BOUNDS) / CELL)
    const minZ = Math.floor((cz - halfZ + WORLD_BOUNDS) / CELL)
    const maxZ = Math.ceil((cz + halfZ + WORLD_BOUNDS) / CELL)
    for (let iz = Math.max(0, minZ); iz < Math.min(this.size, maxZ); iz++) {
      for (let ix = Math.max(0, minX); ix < Math.min(this.size, maxX); ix++) {
        this.cells[iz * this.size + ix] = kind
      }
    }
  }

  /** Paints a thick line segment (used for roads). */
  paintSegment(
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    width: number,
    kind: SurfaceKind,
  ): void {
    const length = Math.hypot(x2 - x1, z2 - z1)
    const steps = Math.max(1, Math.ceil(length / (CELL * 0.5)))
    const half = width * 0.5
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      this.paintRect(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, half, half, kind)
    }
  }

  kindAt(x: number, z: number): SurfaceKind {
    const i = this.index(x, z)
    if (i < 0) return SURFACE.GRASS
    return this.cells[i] as SurfaceKind
  }

  gripAt(x: number, z: number): number {
    return SURFACE_GRIP[this.kindAt(x, z)]
  }

  dustColorAt(x: number, z: number): number {
    return SURFACE_DUST[this.kindAt(x, z)]
  }
}
