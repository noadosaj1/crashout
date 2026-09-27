import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { VehicleCustomization, VehicleSpec } from '@/types'
import { findAccent, findPaint, findWheel } from '@/config/customization'

export interface VehicleMeshParts {
  root: THREE.Group
  /** Panels that get visibly dented. Keyed by damage region. */
  panels: {
    front: THREE.Object3D
    rear: THREE.Object3D
    left: THREE.Object3D
    right: THREE.Object3D
    roof: THREE.Object3D
  }
  wheels: THREE.Object3D[]
  /** Hidden once the matching region is wrecked. */
  detachable: THREE.Object3D[]
  glass: THREE.Mesh[]
  brakeLights: THREE.Mesh
  boostFlames: THREE.Mesh
  bodyMaterial: THREE.MeshStandardMaterial
  accentMaterial: THREE.MeshStandardMaterial
  dispose: () => void
}

/**
 * Collects box geometries per material and merges each set into one mesh.
 *
 * Detail on a car is otherwise expensive: the previous version built every
 * panel, spoke and light as its own mesh and spent about forty draw calls per
 * car. Merging means shape costs nothing but memory, so the cars can have
 * arches, pillars, mirrors and lights and still draw in fewer calls than the
 * plain boxes did.
 */
class PanelBuilder {
  private readonly byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>()

  add(geometry: THREE.BufferGeometry, material: THREE.Material): void {
    let list = this.byMaterial.get(material)
    if (!list) {
      list = []
      this.byMaterial.set(material, list)
    }
    list.push(geometry)
  }

  /** Builds one mesh per material and parents them all to `target`. */
  flush(target: THREE.Object3D, castShadow = true): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = []
    for (const [material, geometries] of this.byMaterial) {
      const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false)
      if (!merged) continue
      if (geometries.length > 1) for (const g of geometries) g.dispose()
      const mesh = new THREE.Mesh(merged, material)
      mesh.castShadow = castShadow
      mesh.receiveShadow = castShadow
      target.add(mesh)
      meshes.push(mesh)
    }
    this.byMaterial.clear()
    return meshes
  }
}

/** A box, positioned and optionally rotated, as loose geometry ready to merge. */
function box(
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
  rot?: { x?: number; y?: number; z?: number },
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz)
  if (rot?.x) g.rotateX(rot.x)
  if (rot?.y) g.rotateY(rot.y)
  if (rot?.z) g.rotateZ(rot.z)
  g.translate(x, y, z)
  return g
}

/** A wedge: a box with its top face narrowed along Z, for hoods and noses. */
function wedge(
  width: number,
  height: number,
  length: number,
  x: number,
  y: number,
  z: number,
  taper: number,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(width, height, length)
  const pos = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    // Pull the top-front corners down and in to make a sloped nose.
    if (pos.getY(i) > 0 && pos.getZ(i) > 0) {
      pos.setY(i, pos.getY(i) - height * taper)
      pos.setX(i, pos.getX(i) * (1 - taper * 0.25))
    }
  }
  pos.needsUpdate = true
  g.computeVertexNormals()
  g.translate(x, y, z)
  return g
}

function cylinder(
  radius: number,
  height: number,
  segments: number,
  axis: 'x' | 'y',
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, height, segments)
  if (axis === 'x') g.rotateZ(Math.PI / 2)
  g.translate(x, y, z)
  return g
}

/**
 * Builds a car. Panels are separate objects so the damage system can crumple
 * them individually; everything inside a panel is merged.
 */
export function buildVehicleMesh(spec: VehicleSpec, customization: VehicleCustomization): VehicleMeshParts {
  const { halfWidth: hw, halfHeight: hh, halfLength: hl } = spec.dimensions
  const paint = findPaint(customization.paint)
  const accent = findAccent(customization.accent)
  const wheelStyle = findWheel(customization.wheelStyle)

  const bodyColor = paint.color ? new THREE.Color(paint.color) : new THREE.Color(spec.visual.baseColor)
  const accentColor = accent.color ? new THREE.Color(accent.color) : new THREE.Color(spec.visual.accent)

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: bodyColor,
    metalness: 0.45,
    roughness: 0.3,
    envMapIntensity: 1.1,
  })
  const accentMaterial = new THREE.MeshStandardMaterial({ color: accentColor, metalness: 0.35, roughness: 0.55 })
  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x14161a, metalness: 0.5, roughness: 0.42 })
  /** What you see through the windows. Dark, matte, and never shiny. */
  const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.92, metalness: 0 })
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: 0x0d151d,
    metalness: 0.1,
    roughness: 0.05,
    transparent: true,
    opacity: 0.68,
    envMapIntensity: 1.6,
  })
  const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x121317, roughness: 0.95, metalness: 0 })
  const rimMaterial = new THREE.MeshStandardMaterial({
    color: wheelStyle.rimColor,
    metalness: 0.92,
    roughness: 0.22,
  })
  const headlightMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff6e0,
    emissive: 0xffeec4,
    // Just over the bloom threshold, so the lamps glow rather than washing the
    // whole front of the car into a white smear.
    emissiveIntensity: 0.6,
    roughness: 0.3,
  })
  const tailMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a0d0d,
    emissive: 0xff2b1d,
    emissiveIntensity: 0.7,
    roughness: 0.45,
  })
  const flameMaterial = new THREE.MeshBasicMaterial({ color: 0x8fe3ff, transparent: true, opacity: 0 })

  const root = new THREE.Group()
  const midLen = hl * 0.9
  const noseLen = hl - midLen * 0.5
  const tailLen = hl - midLen * 0.5
  const archFlare = spec.visual.archFlare ?? 0

  // ---------------------------------------------------------------- mid body
  const mid = new PanelBuilder()
  mid.add(box(hw * 2, hh * 2, midLen, 0, 0, 0), bodyMaterial)
  // Shoulder crease: a thin darker strip down each flank breaks up the slab.
  for (const side of [-1, 1]) {
    mid.add(box(0.06, hh * 0.26, midLen * 0.98, side * hw, hh * 0.35, 0), trimMaterial)
  }
  // Wheel arches, slightly proud of the bodywork.
  for (const z of [spec.wheel.frontOffsetZ, spec.wheel.rearOffsetZ]) {
    if (Math.abs(z) > midLen * 0.5) continue
    for (const side of [-1, 1]) {
      mid.add(
        box(
          0.16,
          spec.wheel.radius * 0.7,
          spec.wheel.radius * 2.5,
          side * (hw + 0.05 + archFlare),
          -hh * 0.1,
          z,
        ),
        bodyMaterial,
      )
    }
  }
  mid.flush(root)

  // ------------------------------------------------------------------- front
  const front = new THREE.Group()
  front.position.z = midLen * 0.5
  const frontParts = new PanelBuilder()
  const noseHeight = hh * 2 * (1 - spec.visual.noseSlope * 0.45)
  frontParts.add(
    wedge(hw * 1.96, noseHeight, noseLen, 0, -hh * spec.visual.noseSlope * 0.4, noseLen * 0.5, spec.visual.noseSlope),
    bodyMaterial,
  )
  // Arches over the front wheels when they sit ahead of the mid section.
  if (spec.wheel.frontOffsetZ > midLen * 0.5) {
    for (const side of [-1, 1]) {
      frontParts.add(
        box(
          0.16,
          spec.wheel.radius * 0.7,
          spec.wheel.radius * 2.5,
          side * (hw + 0.05 + archFlare),
          -hh * 0.1,
          spec.wheel.frontOffsetZ - midLen * 0.5,
        ),
        bodyMaterial,
      )
    }
  }
  // Grille between the lights.
  frontParts.add(box(hw * 1.2, hh * 0.44, 0.1, 0, -hh * 0.18, noseLen - 0.01), trimMaterial)
  // Two lamps a side, recessed.
  for (const side of [-1, 1]) {
    frontParts.add(box(hw * 0.32, hh * 0.26, 0.1, side * hw * 0.52, hh * 0.06, noseLen - 0.02), headlightMaterial)
    frontParts.add(box(hw * 0.22, hh * 0.2, 0.1, side * hw * 0.86, hh * 0.04, noseLen - 0.04), headlightMaterial)
  }
  frontParts.flush(front)

  // Bumper stays its own mesh: it is detachable, so it must hide on its own.
  const frontBumperGeo = mergeGeometries(
    [
      box(hw * 2.04, hh * 0.46, 0.22, 0, -hh * 0.62, noseLen + 0.02),
      box(hw * 1.45, hh * 0.13, 0.2, 0, -hh * 0.9, noseLen + 0.02),
    ],
    false,
  )!
  const frontBumper = new THREE.Mesh(frontBumperGeo, accentMaterial)
  frontBumper.castShadow = true
  front.add(frontBumper)
  root.add(front)

  // -------------------------------------------------------------------- rear
  const rear = new THREE.Group()
  rear.position.z = -midLen * 0.5
  const rearParts = new PanelBuilder()
  rearParts.add(box(hw * 1.96, hh * 2, tailLen, 0, 0, -tailLen * 0.5), bodyMaterial)
  if (Math.abs(spec.wheel.rearOffsetZ) > midLen * 0.5) {
    for (const side of [-1, 1]) {
      rearParts.add(
        box(
          0.16,
          spec.wheel.radius * 0.7,
          spec.wheel.radius * 2.5,
          side * (hw + 0.05 + archFlare),
          -hh * 0.1,
          spec.wheel.rearOffsetZ + midLen * 0.5,
        ),
        bodyMaterial,
      )
    }
  }
  // Exhaust tips.
  for (const side of [-1, 1]) {
    rearParts.add(
      cylinder(0.07, 0.18, 8, 'y', side * hw * 0.55, -hh * 0.78, -tailLen - 0.06),
      trimMaterial,
    )
  }
  if (spec.visual.spoiler) {
    rearParts.add(box(hw * 1.8, 0.07, 0.34, 0, hh * 1.15, -tailLen + 0.16), accentMaterial)
    for (const side of [-1, 1]) {
      rearParts.add(box(0.08, hh * 0.6, 0.12, side * hw * 0.75, hh * 0.82, -tailLen + 0.2), accentMaterial)
    }
  }
  rearParts.flush(rear)

  const brakeLights = new THREE.Mesh(
    mergeGeometries(
      [
        box(hw * 0.62, hh * 0.24, 0.08, -hw * 0.62, hh * 0.16, -tailLen + 0.01),
        box(hw * 0.62, hh * 0.24, 0.08, hw * 0.62, hh * 0.16, -tailLen + 0.01),
        box(hw * 0.5, hh * 0.08, 0.06, 0, hh * 0.16, -tailLen + 0.01),
      ],
      false,
    )!,
    tailMaterial,
  )
  rear.add(brakeLights)

  const rearBumperGeo = mergeGeometries(
    [
      box(hw * 2.04, hh * 0.46, 0.22, 0, -hh * 0.62, -tailLen - 0.02),
      box(hw * 1.6, hh * 0.14, 0.26, 0, -hh * 0.86, -tailLen - 0.04),
    ],
    false,
  )!
  const rearBumper = new THREE.Mesh(rearBumperGeo, accentMaterial)
  rearBumper.castShadow = true
  rear.add(rearBumper)

  const boostFlames = new THREE.Mesh(new THREE.BoxGeometry(hw * 0.7, hh * 0.34, 1.0), flameMaterial)
  boostFlames.position.set(0, -hh * 0.78, -tailLen - 0.62)
  rear.add(boostFlames)
  root.add(rear)

  // ------------------------------------------------------------------- roof
  const roofW = hw * 2 * spec.visual.roofScale
  const roofL = hl * 2 * spec.visual.roofScale * 0.62
  // Cabin height follows the roof scale, so a supercar gets a low greenhouse and
  // an SUV gets a tall one. A fixed multiple made everything look like a van.
  const roofH = hh * 2 * spec.visual.roofScale * 0.85
  const roofY = hh + roofH * 0.5
  const roofZ = spec.visual.roofOffsetZ

  const roof = new THREE.Group()
  roof.position.set(0, roofY, roofZ)
  const roofParts = new PanelBuilder()
  // Solid interior shell first. Without it the greenhouse is a hole: pillars
  // and glass alone let you see daylight straight through the car.
  roofParts.add(box(roofW * 0.94, roofH * 0.94, roofL * 0.94, 0, 0, 0), cabinMaterial)
  // Tapered greenhouse: narrower at the top than at the waist.
  roofParts.add(box(roofW * 0.98, 0.12, roofL * 0.96, 0, roofH * 0.5, 0), bodyMaterial)
  // Pillars, which is what makes the glass read as windows rather than a block.
  for (const side of [-1, 1]) {
    // A-pillar, raked forward.
    roofParts.add(
      box(0.09, roofH * 1.06, 0.12, side * roofW * 0.47, 0, roofL * 0.46, { x: -0.22 }),
      bodyMaterial,
    )
    // C-pillar, raked back.
    roofParts.add(
      box(0.09, roofH * 1.06, 0.14, side * roofW * 0.47, 0, -roofL * 0.46, { x: 0.2 }),
      bodyMaterial,
    )
    // B-pillar.
    roofParts.add(box(0.07, roofH, 0.1, side * roofW * 0.5, 0, 0), trimMaterial)
    // Waist rail closing the bottom of the side windows.
    roofParts.add(box(0.1, 0.09, roofL * 0.92, side * roofW * 0.5, -roofH * 0.5, 0), bodyMaterial)
  }
  roofParts.flush(roof)

  const glassGeo = mergeGeometries(
    [
      box(roofW * 0.92, roofH * 0.8, 0.06, 0, roofH * 0.04, roofL * 0.47, { x: -0.22 }),
      box(roofW * 0.92, roofH * 0.7, 0.06, 0, roofH * 0.04, -roofL * 0.47, { x: 0.2 }),
      box(0.06, roofH * 0.62, roofL * 0.82, -roofW * 0.5, roofH * 0.06, 0),
      box(0.06, roofH * 0.62, roofL * 0.82, roofW * 0.5, roofH * 0.06, 0),
    ],
    false,
  )!
  const glass = new THREE.Mesh(glassGeo, glassMaterial)
  glass.castShadow = false
  roof.add(glass)
  root.add(roof)

  // Pickups get a bed instead of a long cabin.
  if (spec.category === 'pickup') {
    const bed = new PanelBuilder()
    bed.add(box(hw * 2, hh * 1.1, 0.16, 0, hh * 0.55, -hl + 0.2), bodyMaterial)
    for (const side of [-1, 1]) {
      bed.add(box(0.16, hh * 1.1, hl * 0.9, side * (hw - 0.08), hh * 0.55, -hl * 0.5), bodyMaterial)
    }
    bed.flush(root)
  }

  // ------------------------------------------------------------ side panels
  const sides: Record<'left' | 'right', THREE.Group> = {
    left: new THREE.Group(),
    right: new THREE.Group(),
  }
  for (const key of ['left', 'right'] as const) {
    const side = key === 'left' ? -1 : 1
    const group = sides[key]
    group.position.x = side * hw
    const parts = new PanelBuilder()
    parts.add(box(0.1, hh * 0.62, hl * 1.5, 0, -hh * 0.6, 0), accentMaterial)
    // Mirror on a stalk, up by the A-pillar.
    const mirrorZ = roofZ + roofL * 0.5
    parts.add(box(0.14, 0.05, 0.05, side * 0.08, hh * 0.72, mirrorZ), trimMaterial)
    parts.add(box(0.07, 0.13, 0.19, side * 0.17, hh * 0.76, mirrorZ), accentMaterial)
    parts.flush(group)
    root.add(group)
  }

  // ----------------------------------------------------------------- wheels
  const wheels: THREE.Object3D[] = []
  const wheelPositions: Array<[number, number]> = [
    [-spec.wheel.offsetX, spec.wheel.frontOffsetZ],
    [spec.wheel.offsetX, spec.wheel.frontOffsetZ],
    [-spec.wheel.offsetX, spec.wheel.rearOffsetZ],
    [spec.wheel.offsetX, spec.wheel.rearOffsetZ],
  ]
  const r = spec.wheel.radius
  const w = spec.wheel.width
  for (const [x, z] of wheelPositions) {
    const pivot = new THREE.Group()
    pivot.position.set(x, -hh, z)

    const tire = new THREE.Mesh(cylinder(r, w, 16, 'x', 0, 0, 0), tireMaterial)
    tire.castShadow = true
    pivot.add(tire)

    // Hub, dish and spokes all share the rim material, so they merge into one.
    const rimParts: THREE.BufferGeometry[] = [
      cylinder(r * 0.62, w * 1.02, 16, 'x', 0, 0, 0),
      cylinder(r * 0.2, w * 1.1, 10, 'x', 0, 0, 0),
    ]
    for (let i = 0; i < wheelStyle.spokes; i++) {
      const angle = (i / wheelStyle.spokes) * Math.PI
      rimParts.push(box(w * 1.0, r * 1.18, 0.05, 0, 0, 0, { x: angle }))
    }
    const rim = new THREE.Mesh(mergeGeometries(rimParts, false)!, rimMaterial)
    for (const g of rimParts) g.dispose()
    pivot.add(rim)

    root.add(pivot)
    wheels.push(pivot)
  }

  const materials = [
    bodyMaterial,
    accentMaterial,
    trimMaterial,
    cabinMaterial,
    glassMaterial,
    tireMaterial,
    rimMaterial,
    headlightMaterial,
    tailMaterial,
    flameMaterial,
  ]

  return {
    root,
    panels: { front, rear, left: sides.left, right: sides.right, roof },
    wheels,
    detachable: [frontBumper, rearBumper],
    glass: [glass],
    brakeLights,
    boostFlames,
    bodyMaterial,
    accentMaterial,
    dispose: () => {
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.geometry.dispose()
      })
      for (const m of materials) m.dispose()
    },
  }
}
