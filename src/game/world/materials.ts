import * as THREE from 'three'

/** Shared materials. One instance each keeps draw-call state changes down. */
export function createWorldMaterials() {
  return {
    ground: new THREE.MeshStandardMaterial({ color: 0x4f5646, roughness: 0.97, metalness: 0 }),
    asphalt: new THREE.MeshStandardMaterial({ color: 0x33353b, roughness: 0.88, metalness: 0.02 }),
    highway: new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.82, metalness: 0.04 }),
    line: new THREE.MeshBasicMaterial({ color: 0xd8d2b8 }),
    curb: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.8 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x74797e, roughness: 0.94 }),
    buildingA: new THREE.MeshStandardMaterial({ color: 0x6f7885, roughness: 0.72, metalness: 0.15 }),
    buildingB: new THREE.MeshStandardMaterial({ color: 0x58606d, roughness: 0.65, metalness: 0.25 }),
    glassFacade: new THREE.MeshStandardMaterial({
      color: 0x5f7a90,
      roughness: 0.2,
      metalness: 0.5,
      emissive: 0x16232e,
      emissiveIntensity: 0.5,
    }),
    windowBand: new THREE.MeshStandardMaterial({
      color: 0x1c2833,
      roughness: 0.14,
      metalness: 0.6,
      emissive: 0x2c4152,
      emissiveIntensity: 0.55,
    }),
    house: new THREE.MeshStandardMaterial({ color: 0xc9bda6, roughness: 0.88 }),
    roofTile: new THREE.MeshStandardMaterial({ color: 0x7a4a3c, roughness: 0.9 }),
    warehouse: new THREE.MeshStandardMaterial({ color: 0x6b7178, roughness: 0.82, metalness: 0.3 }),
    container: new THREE.MeshStandardMaterial({ color: 0xb8553f, roughness: 0.75, metalness: 0.35 }),
    barrier: new THREE.MeshStandardMaterial({ color: 0xaeb4ba, roughness: 0.88 }),
    dirt: new THREE.MeshStandardMaterial({ color: 0x8a6d46, roughness: 0.99 }),
    arenaFloor: new THREE.MeshStandardMaterial({ color: 0x44474c, roughness: 0.96 }),
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
