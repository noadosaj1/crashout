import * as THREE from 'three'
import type { VehicleCustomization, VehicleSpec } from '@/types'
import { findAccent, findPaint } from '@/config/customization'
import { paintedTexture, type CarModel } from './CarModels'
import { box } from './primitives'
import type { VehicleMeshParts } from './VehicleMesh'

/**
 * How tall the visible car is relative to its collider box. The collider is the
 * chassis only — the cabin and roof sit above it, exactly as they do on the
 * procedural mesh — so a model scaled to the collider height alone looks
 * squashed.
 */
const VISUAL_HEIGHT = 1.8

/** Panels are cut at these fractions of the body's own extents. */
const BUMPER_AT = 0.86
const NOSE_AT = 0.3
const ROOF_AT = 0.62
const FLANK_AT = 0.45

type PanelKey = 'bumperFront' | 'bumperRear' | 'front' | 'rear' | 'roof' | 'left' | 'right' | 'mid'

/**
 * Builds a car out of a loaded model instead of out of boxes.
 *
 * The body arrives as one mesh, which would be a brick as far as the damage
 * model is concerned, so it gets cut into the same panels the procedural mesh
 * has: bumpers that fall off, a nose and tail that crumple, flanks that fold in
 * and a roof that caves. Cutting real geometry means a wrecked car tears along
 * those seams, which is the point.
 */
export function buildModelVehicleMesh(
  spec: VehicleSpec,
  customization: VehicleCustomization,
  model: CarModel,
): VehicleMeshParts {
  const paint = findPaint(customization.paint)
  const accent = findAccent(customization.accent)
  const paintColor = paint.color ? new THREE.Color(paint.color) : new THREE.Color(spec.visual.baseColor)
  const accentColor = accent.color ? new THREE.Color(accent.color) : new THREE.Color(spec.visual.accent)

  const hw = spec.dimensions.halfWidth
  const hh = spec.dimensions.halfHeight
  const hl = spec.dimensions.halfLength

  const bodyMaterial = new THREE.MeshStandardMaterial({
    map: paintedTexture(model, paintColor),
    metalness: 0.15,
    roughness: 0.5,
  })
  const tailMaterial = new THREE.MeshStandardMaterial({
    color: 0x3a0d0d,
    emissive: 0xff2a2a,
    emissiveIntensity: 0.2,
    roughness: 0.4,
  })
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: accentColor,
    metalness: 0.35,
    roughness: 0.55,
  })
  const flameMaterial = new THREE.MeshBasicMaterial({ color: 0x8fe3ff, transparent: true, opacity: 0 })

  // Into chassis metres, and sitting on the bottom of the collider box like the
  // procedural body does.
  const height = hh * 2 * VISUAL_HEIGHT
  const source = model.body.clone()
  source.scale((hw * 2) / model.size.x, height / model.size.y, (hl * 2) / model.size.z)
  source.translate(0, -hh + height / 2, 0)

  const root = new THREE.Group()
  const parts = splitBody(source, { hw, hh, hl, height })
  source.dispose()

  const groups: Record<PanelKey, THREE.Group> = {
    bumperFront: new THREE.Group(),
    bumperRear: new THREE.Group(),
    front: new THREE.Group(),
    rear: new THREE.Group(),
    roof: new THREE.Group(),
    left: new THREE.Group(),
    right: new THREE.Group(),
    mid: new THREE.Group(),
  }

  for (const key of Object.keys(groups) as PanelKey[]) {
    const geometry = parts[key]
    const group = groups[key]
    root.add(group)
    if (!geometry) continue

    // The flanks pivot on the edge of the car, because that is what the damage
    // model moves them along; everything else pivots on its own centre so it
    // crumples into itself.
    const origin = new THREE.Vector3()
    if (key === 'left') origin.set(-hw, 0, 0)
    else if (key === 'right') origin.set(hw, 0, 0)
    else {
      geometry.computeBoundingBox()
      geometry.boundingBox!.getCenter(origin)
    }
    geometry.translate(-origin.x, -origin.y, -origin.z)
    group.position.copy(origin)

    const mesh = new THREE.Mesh(geometry, bodyMaterial)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }

  // ------------------------------------------------------------ lights, trim
  const brakeLights = new THREE.Mesh(
    box(hw * 1.25, hh * 0.24, 0.1, 0, hh * 0.1, -hl * 0.99),
    tailMaterial,
  )
  brakeLights.castShadow = false
  root.add(brakeLights)

  const flameGeometry = new THREE.ConeGeometry(hh * 0.34, 1.1, 8)
  flameGeometry.rotateX(Math.PI / 2)
  flameGeometry.translate(0, -hh * 0.35, -hl - 0.5)
  const boostFlames = new THREE.Mesh(flameGeometry, flameMaterial)
  boostFlames.visible = false
  root.add(boostFlames)

  if (spec.visual.spoiler) {
    const wing = new THREE.Mesh(box(hw * 1.5, 0.08, 0.34, 0, hh * 1.15, -hl * 0.82), accentMaterial)
    wing.castShadow = true
    groups.rear.add(wing)
    wing.position.sub(groups.rear.position)
  }

  // ----------------------------------------------------------------- wheels
  const wheels: THREE.Object3D[] = []
  const radiusScale = spec.wheel.radius / model.wheelRadius
  const widthScale = spec.wheel.width / model.wheelWidth
  const layout: Array<[number, number, boolean]> = [
    [-spec.wheel.offsetX, spec.wheel.frontOffsetZ, true],
    [spec.wheel.offsetX, spec.wheel.frontOffsetZ, false],
    [-spec.wheel.offsetX, spec.wheel.rearOffsetZ, true],
    [spec.wheel.offsetX, spec.wheel.rearOffsetZ, false],
  ]
  const wheelGeometries: THREE.BufferGeometry[] = []
  for (const [x, z, isLeft] of layout) {
    const pivot = new THREE.Group()
    pivot.position.set(x, -hh, z)
    const geometry = (isLeft ? model.wheelRight : model.wheelLeft).clone()
    geometry.scale(widthScale, radiusScale, radiusScale)
    wheelGeometries.push(geometry)
    const wheel = new THREE.Mesh(geometry, bodyMaterial)
    wheel.castShadow = true
    pivot.add(wheel)
    root.add(pivot)
    wheels.push(pivot)
  }

  const materials = [bodyMaterial, tailMaterial, accentMaterial, flameMaterial]

  return {
    root,
    panels: {
      front: groups.front,
      rear: groups.rear,
      left: groups.left,
      right: groups.right,
      roof: groups.roof,
    },
    wheels,
    detachable: [groups.bumperFront, groups.bumperRear],
    // The models paint their windows from the same palette as the bodywork, so
    // there is no separate glass to hide when it shatters.
    glass: [],
    brakeLights,
    boostFlames,
    bodyMaterial,
    accentMaterial,
    paintColor,
    dispose: () => {
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.geometry.dispose()
      })
      for (const g of wheelGeometries) g.dispose()
      for (const m of materials) m.dispose()
    },
  }
}

interface Extents {
  hw: number
  hh: number
  hl: number
  height: number
}

/** Cuts a body into panels by where each triangle sits on the car. */
function splitBody(source: THREE.BufferGeometry, e: Extents): Record<PanelKey, THREE.BufferGeometry | null> {
  const geometry = source.index ? source.toNonIndexed() : source.clone()
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const uv = geometry.getAttribute('uv')

  const buckets = new Map<PanelKey, { position: number[]; normal: number[]; uv: number[] }>()
  const push = (key: PanelKey, i: number): void => {
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { position: [], normal: [], uv: [] }
      buckets.set(key, bucket)
    }
    for (let v = 0; v < 3; v++) {
      const index = i + v
      bucket.position.push(position.getX(index), position.getY(index), position.getZ(index))
      if (normal) bucket.normal.push(normal.getX(index), normal.getY(index), normal.getZ(index))
      if (uv) bucket.uv.push(uv.getX(index), uv.getY(index))
    }
  }

  const top = -e.hh + e.height
  for (let i = 0; i < position.count; i += 3) {
    let cx = 0
    let cy = 0
    let cz = 0
    for (let v = 0; v < 3; v++) {
      cx += position.getX(i + v)
      cy += position.getY(i + v)
      cz += position.getZ(i + v)
    }
    cx /= 3
    cy /= 3
    cz /= 3

    let key: PanelKey
    if (cz > e.hl * BUMPER_AT) key = 'bumperFront'
    else if (cz < -e.hl * BUMPER_AT) key = 'bumperRear'
    else if (cy > top - e.height * (1 - ROOF_AT) && Math.abs(cz) < e.hl * 0.55) key = 'roof'
    else if (cz > e.hl * NOSE_AT) key = 'front'
    else if (cz < -e.hl * NOSE_AT) key = 'rear'
    else if (cx < -e.hw * FLANK_AT) key = 'left'
    else if (cx > e.hw * FLANK_AT) key = 'right'
    else key = 'mid'
    push(key, i)
  }
  geometry.dispose()

  const out = {} as Record<PanelKey, THREE.BufferGeometry | null>
  const keys: PanelKey[] = ['bumperFront', 'bumperRear', 'front', 'rear', 'roof', 'left', 'right', 'mid']
  for (const key of keys) {
    const bucket = buckets.get(key)
    if (!bucket) {
      out[key] = null
      continue
    }
    const part = new THREE.BufferGeometry()
    part.setAttribute('position', new THREE.Float32BufferAttribute(bucket.position, 3))
    if (bucket.normal.length) part.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.normal, 3))
    if (bucket.uv.length) part.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uv, 2))
    out[key] = part
  }
  return out
}
