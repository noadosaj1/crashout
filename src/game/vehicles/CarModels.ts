import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VEHICLES } from '@/config/vehicles'
import { TRAFFIC_SILHOUETTES } from '@/config/traffic'

/**
 * Loads the car models once, up front, and hands out geometry rather than
 * scene graphs.
 *
 * The models are Kenney's Car Kit (CC0). Every one of them is a handful of
 * meshes named `body` and `wheel-<front|back>-<left|right>`, sharing one
 * material and one palette texture, which is what makes them cheap to treat as
 * raw geometry: the game positions wheels from the suspension anyway, and the
 * body gets cut into panels so it can be crumpled.
 */
export interface CarModel {
  /** Body geometry, centred on its own bounding box. */
  body: THREE.BufferGeometry
  /** Size of that bounding box, in model units. */
  size: THREE.Vector3
  /** Wheel geometry per side, centred. Left and right are mirrored in the source. */
  wheelLeft: THREE.BufferGeometry
  wheelRight: THREE.BufferGeometry
  /** Nominal wheel radius and width in model units, for scaling to a spec. */
  wheelRadius: number
  wheelWidth: number
  /**
   * Where the model's own wheels sit, relative to the centred body. Traffic
   * rebuilds whole cars from this; the player's cars ignore it and put wheels
   * where the suspension says.
   */
  wheelMounts: Array<{ offset: THREE.Vector3; left: boolean }>
  /** The shared palette texture. Paint variants are derived from it. */
  texture: THREE.Texture
  /**
   * Where the bodywork samples the palette, most-used first. A repaint walks
   * these until it finds a swatch with actual colour in it: the largest share
   * of a car's surface is often a grey or a white, which tells a repaint
   * nothing about which band is the paint.
   */
  bodyUvs: Array<{ u: number; v: number }>
}

const models = new Map<string, CarModel>()
let loading: Promise<void> | null = null

export function getCarModel(id: string): CarModel | null {
  return models.get(id) ?? null
}

/**
 * Loads every model referenced by the vehicle and traffic configs. Awaited
 * during the loading screen, so mesh building stays synchronous afterwards.
 */
export function preloadCarModels(): Promise<void> {
  loading ??= load()
  return loading
}

function modelIds(): string[] {
  const ids = new Set<string>()
  for (const spec of Object.values(VEHICLES)) {
    if (spec.visual.model) ids.add(spec.visual.model)
  }
  for (const silhouette of TRAFFIC_SILHOUETTES) {
    if (silhouette.model) ids.add(silhouette.model)
  }
  return [...ids]
}

async function load(): Promise<void> {
  const loader = new GLTFLoader()
  const base = import.meta.env.BASE_URL ?? '/'
  await Promise.all(
    modelIds().map(async (id) => {
      try {
        const gltf = await loader.loadAsync(`${base}models/cars/${id}.glb`)
        const model = extract(gltf.scene)
        if (model) models.set(id, model)
      } catch {
        // A missing or broken model is not fatal: the car falls back to the
        // procedural mesh, which is always available.
      }
    }),
  )
}

/** Pulls the body and one wheel per side out of a loaded scene. */
function extract(scene: THREE.Object3D): CarModel | null {
  let body: THREE.BufferGeometry | null = null
  let wheelLeft: THREE.BufferGeometry | null = null
  let wheelRight: THREE.BufferGeometry | null = null
  let texture: THREE.Texture | null = null
  const mounts: Array<{ offset: THREE.Vector3; left: boolean }> = []

  scene.updateMatrixWorld(true)
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const material = obj.material as THREE.MeshStandardMaterial
    if (!texture && material.map) texture = material.map

    // Bake the node transform in: the game parents these to its own pivots.
    const geometry = obj.geometry.clone().applyMatrix4(obj.matrixWorld)
    geometry.computeBoundingBox()
    const name = obj.name.toLowerCase()
    if (name.includes('body')) {
      body = geometry
      return
    }
    if (!name.includes('wheel')) {
      geometry.dispose()
      return
    }
    const left = name.includes('left')
    mounts.push({ offset: geometry.boundingBox!.getCenter(new THREE.Vector3()), left })
    if (left && !wheelLeft) wheelLeft = geometry
    else if (!left && !wheelRight) wheelRight = geometry
    else geometry.dispose()
  })

  if (!body || !texture) return null

  const bodyGeometry = body as THREE.BufferGeometry
  const box = bodyGeometry.boundingBox!
  const size = box.getSize(new THREE.Vector3())
  const centre = box.getCenter(new THREE.Vector3())
  bodyGeometry.translate(-centre.x, -centre.y, -centre.z)
  for (const mount of mounts) mount.offset.sub(centre)

  const left = centreGeometry(wheelLeft)
  const right = centreGeometry(wheelRight ?? wheelLeft)
  if (!left || !right) return null

  const wheelBox = left.boundingBox!
  const wheelSize = wheelBox.getSize(new THREE.Vector3())

  return {
    body: bodyGeometry,
    bodyUvs: uvsByArea(bodyGeometry),
    size,
    wheelLeft: left,
    wheelRight: right,
    wheelRadius: Math.max(wheelSize.y, wheelSize.z) / 2,
    wheelWidth: wheelSize.x,
    wheelMounts: mounts,
    texture,
  }
}

/**
 * The UVs the body spends its surface area on, largest share first.
 *
 * Every part of these models — paint, glass, lights, tyres — samples a
 * different band of one shared palette, so ranking the bands by area is what
 * identifies the bodywork.
 */
function uvsByArea(geometry: THREE.BufferGeometry): Array<{ u: number; v: number }> {
  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  if (!uv) return []

  const area = new Map<string, { area: number; u: number; v: number }>()
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const index = geometry.index
  const count = index ? index.count : position.count
  for (let i = 0; i < count; i += 3) {
    const i0 = index ? index.getX(i) : i
    const i1 = index ? index.getX(i + 1) : i + 1
    const i2 = index ? index.getX(i + 2) : i + 2
    a.fromBufferAttribute(position, i0)
    b.fromBufferAttribute(position, i1)
    c.fromBufferAttribute(position, i2)
    const size = b.sub(a).cross(c.sub(a)).length() / 2
    const u = uv.getX(i0)
    const v = uv.getY(i0)
    const key = `${u.toFixed(3)},${v.toFixed(3)}`
    const entry = area.get(key)
    if (entry) entry.area += size
    else area.set(key, { area: size, u, v })
  }

  return [...area.values()]
    .sort((a, b) => b.area - a.area)
    .slice(0, 12)
    .map(({ u, v }) => ({ u, v }))
}

function centreGeometry(geometry: THREE.BufferGeometry | null): THREE.BufferGeometry | null {
  if (!geometry) return null
  geometry.computeBoundingBox()
  const centre = geometry.boundingBox!.getCenter(new THREE.Vector3())
  geometry.translate(-centre.x, -centre.y, -centre.z)
  geometry.computeBoundingBox()
  return geometry
}

const paintCache = new Map<string, THREE.Texture>()

/**
 * A repaint of the palette texture.
 *
 * The models colour themselves by pointing their UVs at bands of one shared
 * palette, so there is no separate body material to tint — and tinting the
 * material would drag the glass and the tyres along with the paint. Instead
 * only the band the bodywork actually samples is replaced, which leaves the
 * windows, lights and tyres exactly as the model shipped them.
 */
export function paintedTexture(model: CarModel, color: THREE.Color): THREE.Texture {
  const source = model.texture
  const key = `${source.uuid}:${color.getHexString()}`
  const cached = paintCache.get(key)
  if (cached) return cached

  const image = source.image as CanvasImageSource | undefined
  const width = (image as { width?: number } | undefined)?.width ?? 0
  const height = (image as { height?: number } | undefined)?.height ?? 0
  if (!image || !width || !height) return source

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return source
  context.drawImage(image, 0, 0)

  const data = context.getImageData(0, 0, width, height)
  const pixels = data.data
  const scratch = new THREE.Color()
  const band = { h: 0, s: 0, l: 0 }
  // Walk the bodywork's bands by area and take the first that is a colour
  // rather than a grey. glTF textures are stored top-down (flipY is false), so
  // v maps straight onto the row — flipping it here reads the mirror image of
  // the palette, which is a different colour entirely.
  let found = false
  for (const { u, v } of model.bodyUvs) {
    const px = Math.min(width - 1, Math.max(0, Math.round(u * width)))
    const row = source.flipY ? 1 - v : v
    const py = Math.min(height - 1, Math.max(0, Math.round(row * height)))
    const at = (py * width + px) * 4
    scratch.setRGB(pixels[at] / 255, pixels[at + 1] / 255, pixels[at + 2] / 255)
    scratch.getHSL(band)
    if (band.s >= 0.25) {
      found = true
      break
    }
  }

  const target = { h: 0, s: 0, l: 0 }
  color.getHSL(target)
  const hsl = { h: 0, s: 0, l: 0 }

  // A car with no coloured band at all — a white van — gets every coloured
  // pixel repainted instead. Grey stays grey either way, which is what
  // protects the glass and the tyres.
  const bandIsGrey = !found

  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue
    scratch.setRGB(pixels[i] / 255, pixels[i + 1] / 255, pixels[i + 2] / 255)
    scratch.getHSL(hsl)
    if (bandIsGrey) {
      if (hsl.s < 0.25) continue
    } else {
      // Only the bodywork's own band moves. Hue wraps, so compare the short
      // way round.
      let hueGap = Math.abs(hsl.h - band.h)
      if (hueGap > 0.5) hueGap = 1 - hueGap
      if (hueGap > 0.08 || hsl.s < 0.2) continue
    }
    // Keep the band's own shading: it is a vertical gradient, not a flat fill.
    const shade = bandIsGrey ? 1 : hsl.l / Math.max(0.001, band.l)
    scratch.setHSL(target.h, target.s * (0.7 + hsl.s * 0.3), target.l * (0.55 + shade * 0.45))
    pixels[i] = Math.round(scratch.r * 255)
    pixels[i + 1] = Math.round(scratch.g * 255)
    pixels[i + 2] = Math.round(scratch.b * 255)
  }
  context.putImageData(data, 0, 0)

  const texture = new THREE.CanvasTexture(canvas)
  texture.flipY = source.flipY
  texture.colorSpace = source.colorSpace
  texture.wrapS = source.wrapS
  texture.wrapT = source.wrapT
  paintCache.set(key, texture)
  return texture
}
