export interface PaintOption {
  id: string
  name: string
  color: string
  price: number
}

export const PAINTS: PaintOption[] = [
  { id: 'stock', name: 'Factory', color: '', price: 0 },
  { id: 'ember', name: 'Ember Red', color: '#e2564a', price: 1_200 },
  { id: 'voltage', name: 'Voltage', color: '#9df02a', price: 1_200 },
  { id: 'abyss', name: 'Abyss Blue', color: '#2f4f8f', price: 1_200 },
  { id: 'cream', name: 'Bone Cream', color: '#e8e2d2', price: 1_200 },
  { id: 'tar', name: 'Tar Black', color: '#16171b', price: 1_800 },
  { id: 'sherbet', name: 'Sherbet', color: '#ff8fb1', price: 2_400 },
  { id: 'chrome', name: 'Liquid Chrome', color: '#c9d3dd', price: 6_000 },
]

export interface WheelOption {
  id: string
  name: string
  spokes: number
  rimColor: string
  price: number
}

export const WHEELS: WheelOption[] = [
  { id: 'stock', name: 'Steelie', spokes: 5, rimColor: '#8c9298', price: 0 },
  { id: 'mesh', name: 'Mesh', spokes: 8, rimColor: '#d6dade', price: 1_500 },
  { id: 'blade', name: 'Blade', spokes: 3, rimColor: '#e8b13a', price: 2_800 },
  { id: 'deep', name: 'Deep Dish', spokes: 6, rimColor: '#2b2f34', price: 3_400 },
]

export const ACCENTS: PaintOption[] = [
  { id: 'stock', name: 'Factory', color: '', price: 0 },
  { id: 'carbon', name: 'Carbon', color: '#1a1c20', price: 900 },
  { id: 'gold', name: 'Gold', color: '#e8b13a', price: 2_200 },
  { id: 'white', name: 'Gloss White', color: '#f2f4f6', price: 900 },
]

export function findPaint(id: string): PaintOption {
  return PAINTS.find((p) => p.id === id) ?? PAINTS[0]
}

export function findWheel(id: string): WheelOption {
  return WHEELS.find((w) => w.id === id) ?? WHEELS[0]
}

export function findAccent(id: string): PaintOption {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0]
}
