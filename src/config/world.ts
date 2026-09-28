/**
 * Declarative layout for the city. `game/world/WorldBuilder.ts` is the only
 * consumer; everything here is plain data so zones can be retuned without
 * touching engine code.
 */

export interface ZoneDef {
  id: string
  name: string
  /** Centre of the zone on the XZ plane. */
  center: [number, number]
  /** Half extents on X and Z. */
  half: [number, number]
  groundColor: number
  /** Shown in the minimap legend. */
  minimapColor: string
}

export const ZONES: ZoneDef[] = [
  { id: 'downtown', name: 'Downtown', center: [0, 0], half: [220, 220], groundColor: 0x3c3f45, minimapColor: '#4a4e57' },
  { id: 'suburbs', name: 'Suburbs', center: [-420, 120], half: [180, 260], groundColor: 0x4a5a3e, minimapColor: '#55663f' },
  { id: 'industrial', name: 'Industrial', center: [420, -140], half: [200, 220], groundColor: 0x4b4741, minimapColor: '#5a5349' },
  { id: 'offroad', name: 'Dust Flats', center: [40, 470], half: [260, 220], groundColor: 0x7a6242, minimapColor: '#8a6d46' },
  { id: 'arena', name: 'Crash Arena', center: [-420, -420], half: [190, 190], groundColor: 0x54565c, minimapColor: '#6d5a7a' },
]

export interface RoadDef {
  /** Start and end on the XZ plane. */
  from: [number, number]
  to: [number, number]
  width: number
  /** Highways are raised and get barriers. */
  kind: 'street' | 'avenue' | 'highway'
}

/** Downtown is a grid; these are generated rather than listed one by one. */
const DOWNTOWN_SPACING = 88
const DOWNTOWN_RINGS = 2

function downtownGrid(): RoadDef[] {
  const roads: RoadDef[] = []
  const extent = DOWNTOWN_SPACING * DOWNTOWN_RINGS + 44
  for (let i = -DOWNTOWN_RINGS; i <= DOWNTOWN_RINGS; i++) {
    const offset = i * DOWNTOWN_SPACING
    const kind = i === 0 ? 'avenue' : 'street'
    roads.push({ from: [offset, -extent], to: [offset, extent], width: kind === 'avenue' ? 20 : 14, kind })
    roads.push({ from: [-extent, offset], to: [extent, offset], width: kind === 'avenue' ? 20 : 14, kind })
  }
  return roads
}

export const ROADS: RoadDef[] = [
  ...downtownGrid(),
  // Arterials out of downtown to each district.
  { from: [-220, 0], to: [-420, 0], width: 20, kind: 'avenue' },
  { from: [-420, 0], to: [-420, 120], width: 18, kind: 'avenue' },
  { from: [220, 0], to: [420, 0], width: 20, kind: 'avenue' },
  { from: [420, 0], to: [420, -140], width: 18, kind: 'avenue' },
  { from: [0, 220], to: [0, 470], width: 20, kind: 'avenue' },
  { from: [-420, -140], to: [-420, -420], width: 18, kind: 'avenue' },
  { from: [-220, -140], to: [-420, -140], width: 18, kind: 'avenue' },
  // Suburb streets.
  { from: [-540, -60], to: [-300, -60], width: 11, kind: 'street' },
  { from: [-540, 60], to: [-300, 60], width: 11, kind: 'street' },
  { from: [-540, 180], to: [-300, 180], width: 11, kind: 'street' },
  { from: [-540, 300], to: [-300, 300], width: 11, kind: 'street' },
  { from: [-500, -80], to: [-500, 320], width: 11, kind: 'street' },
  { from: [-340, -80], to: [-340, 320], width: 11, kind: 'street' },
  // Industrial yards.
  { from: [260, -260], to: [580, -260], width: 16, kind: 'street' },
  { from: [260, -60], to: [580, -60], width: 16, kind: 'street' },
  { from: [300, -320], to: [300, -20], width: 16, kind: 'street' },
  { from: [540, -320], to: [540, -20], width: 16, kind: 'street' },
  // The highway: a long fast loop around the east and south of the map.
  { from: [-300, -600], to: [640, -600], width: 30, kind: 'highway' },
  { from: [640, -600], to: [640, 300], width: 30, kind: 'highway' },
  { from: [640, 300], to: [180, 620], width: 30, kind: 'highway' },
  { from: [-300, -600], to: [-640, -300], width: 30, kind: 'highway' },
  { from: [-640, -300], to: [-640, 300], width: 30, kind: 'highway' },
]

export interface LandmarkDef {
  id: string
  name: string
  position: [number, number, number]
}

export const LANDMARKS: LandmarkDef[] = [
  { id: 'spire', name: 'The Spire', position: [44, 0, 44] },
  { id: 'stack', name: 'Smokestack Row', position: [420, 0, -200] },
  { id: 'mesa', name: 'Dust Mesa', position: [40, 0, 520] },
  { id: 'arena', name: 'Crash Arena', position: [-420, 0, -420] },
  { id: 'overlook', name: 'Suburb Overlook', position: [-420, 0, 180] },
]

/**
 * Where players spawn when they join or recover with no better option.
 *
 * All of these sit in the lanes of the central avenue. They used to spread
 * sideways onto the blocks, which was harmless while a block was empty tarmac
 * with a tower somewhere on it — now that blocks are built up, a spawn a few
 * metres off the road is a spawn inside a building.
 */
export const DEFAULT_SPAWNS: Array<[number, number, number]> = [
  [6, 1.5, 104],
  [-6, 1.5, 116],
  [6, 1.5, 128],
  [-6, 1.5, 140],
  [6, 1.5, 152],
  [-6, 1.5, 164],
  [6, 1.5, 176],
  [-6, 1.5, 188],
]

/**
 * Scenery models in `public/models/city`, and how big one kit unit is in
 * metres. The kits are modular tiles about a unit across, so the scale is what
 * decides whether a block reads as a shopfront or a tower.
 */
export const BUILDING_MODELS = [
  'building-a',
  'building-b',
  'building-c',
  'building-d',
  'building-e',
  'building-f',
  'building-skyscraper-a',
  'building-skyscraper-b',
  'building-skyscraper-c',
  'building-skyscraper-d',
  'building-skyscraper-e',
  'building-type-a',
  'building-type-b',
  'building-type-c',
  'building-type-d',
  'building-type-e',
  'building-type-f',
  'tree-large',
  'tree-small',
] as const

/** Downtown mid-rises and the towers that go behind them. */
export const DOWNTOWN_MODELS = ['building-a', 'building-b', 'building-c', 'building-d', 'building-e', 'building-f']
export const TOWER_MODELS = [
  'building-skyscraper-a',
  'building-skyscraper-b',
  'building-skyscraper-c',
  'building-skyscraper-d',
  'building-skyscraper-e',
]
export const HOUSE_MODELS = [
  'building-type-a',
  'building-type-b',
  'building-type-c',
  'building-type-d',
  'building-type-e',
  'building-type-f',
]
export const TREE_MODELS = ['tree-large', 'tree-small']

/** Metres per kit unit. */
export const CITY_SCALE = 16
export const HOUSE_SCALE = 10
export const TREE_SCALE = 11
