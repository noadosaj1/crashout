import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BUILDING_MODELS } from '@/config/world'

/**
 * Scenery models — buildings, houses, trees — flattened into one geometry and
 * one material each, which is what lets the world builder instance them.
 *
 * Unlike the cars, nothing here needs to come apart: a building is never
 * repainted, crumpled or driven, so the whole glTF collapses into a single
 * mesh. The geometry keeps its base at y = 0 and is centred on X and Z, so an
 * instance can be placed by its footprint.
 */
export interface WorldModel {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  /** Size in model units. One unit is a kit tile; the world scales it up. */
  size: THREE.Vector3
}

const models = new Map<string, WorldModel>()
let loading: Promise<void> | null = null

export function getWorldModel(id: string): WorldModel | null {
  return models.get(id) ?? null
}

export function preloadWorldModels(): Promise<void> {
  loading ??= load()
  return loading
}

async function load(): Promise<void> {
  const loader = new GLTFLoader()
  const base = import.meta.env.BASE_URL ?? '/'
  await Promise.all(
    BUILDING_MODELS.map(async (id) => {
      try {
        const gltf = await loader.loadAsync(`${base}models/city/${id}.glb`)
        const model = flatten(gltf.scene)
        if (model) models.set(id, model)
      } catch {
        // Missing scenery falls back to the boxes the world was built from.
      }
    }),
  )
}

function flatten(scene: THREE.Object3D): WorldModel | null {
  const parts: THREE.BufferGeometry[] = []
  let material: THREE.Material | null = null

  scene.updateMatrixWorld(true)
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    material ??= obj.material as THREE.Material
    parts.push(obj.geometry.clone().applyMatrix4(obj.matrixWorld))
  })
  if (parts.length === 0 || !material) return null

  // Merging needs matching attribute sets; the kits are uniform, but a stray
  // mesh without UVs would otherwise take the whole model down.
  const attributes = Object.keys(parts[0].attributes).sort().join(',')
  const usable = parts.filter((p) => Object.keys(p.attributes).sort().join(',') === attributes)
  const merged = usable.length === 1 ? usable[0] : mergeGeometries(usable, false)
  for (const part of parts) {
    if (part !== merged) part.dispose()
  }
  if (!merged) return null

  merged.computeBoundingBox()
  const box = merged.boundingBox!
  const size = box.getSize(new THREE.Vector3())
  const centre = box.getCenter(new THREE.Vector3())
  merged.translate(-centre.x, -box.min.y, -centre.z)

  const source = material as THREE.MeshStandardMaterial
  return {
    geometry: merged,
    // The kits ship double-sided materials, which doubles the work for
    // buildings nobody sees the inside of.
    material: new THREE.MeshStandardMaterial({
      map: source.map ?? null,
      metalness: 0,
      roughness: 0.85,
    }),
    size,
  }
}
