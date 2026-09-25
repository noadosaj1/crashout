import * as THREE from 'three'

/** Shared materials. One instance each keeps draw-call state changes down. */
export function createWorldMaterials() {
  return {
    ground: new THREE.MeshStandardMaterial({ color: 0x5c6350, roughness: 0.96, metalness: 0 }),
    asphalt: new THREE.MeshStandardMaterial({ color: 0x33353b, roughness: 0.88, metalness: 0.02 }),
    highway: new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.82, metalness: 0.04 }),
    line: new THREE.MeshBasicMaterial({ color: 0xd8d2b8 }),
    curb: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.8 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x8e9398, roughness: 0.9 }),
    buildingA: new THREE.MeshStandardMaterial({ color: 0x6f7885, roughness: 0.72, metalness: 0.15 }),
    buildingB: new THREE.MeshStandardMaterial({ color: 0x58606d, roughness: 0.65, metalness: 0.25 }),
    glassFacade: new THREE.MeshStandardMaterial({
      color: 0x2b3a4a,
      roughness: 0.16,
      metalness: 0.7,
      emissive: 0x0a1520,
      emissiveIntensity: 0.4,
    }),
    house: new THREE.MeshStandardMaterial({ color: 0xc9bda6, roughness: 0.88 }),
    roofTile: new THREE.MeshStandardMaterial({ color: 0x7a4a3c, roughness: 0.9 }),
    warehouse: new THREE.MeshStandardMaterial({ color: 0x7c8288, roughness: 0.85, metalness: 0.3 }),
    container: new THREE.MeshStandardMaterial({ color: 0xb8553f, roughness: 0.75, metalness: 0.35 }),
    barrier: new THREE.MeshStandardMaterial({ color: 0xc8cdd2, roughness: 0.85 }),
    dirt: new THREE.MeshStandardMaterial({ color: 0x8a6d46, roughness: 0.99 }),
    ramp: new THREE.MeshStandardMaterial({ color: 0xd2a13a, roughness: 0.7, metalness: 0.2 }),
    prop: new THREE.MeshStandardMaterial({ color: 0xe0673a, roughness: 0.7 }),
    propCrate: new THREE.MeshStandardMaterial({ color: 0xa07c4d, roughness: 0.92 }),
    propBarrel: new THREE.MeshStandardMaterial({ color: 0x3f8f5f, roughness: 0.6, metalness: 0.4 }),
    tree: new THREE.MeshStandardMaterial({ color: 0x3f6b45, roughness: 0.95 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.95 }),
    checkpoint: new THREE.MeshBasicMaterial({ color: 0x3fd8ff, transparent: true, opacity: 0.32, side: THREE.DoubleSide }),
  }
}

export type WorldMaterials = ReturnType<typeof createWorldMaterials>

export function disposeMaterials(materials: WorldMaterials): void {
  for (const m of Object.values(materials)) m.dispose()
}
