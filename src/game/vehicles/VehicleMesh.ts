import * as THREE from 'three'
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

const BOX = new THREE.BoxGeometry(1, 1, 1)
/** Cylinder laid on its side so +X is the axle. */
const WHEEL_GEO = (() => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 14)
  g.rotateZ(Math.PI / 2)
  return g
})()

function box(
  material: THREE.Material,
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(BOX, material)
  mesh.scale.set(sx, sy, sz)
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

function rimMaterial(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.3 })
}

/**
 * Builds a car out of simple boxes. Panels are separate objects so the damage
 * system can crumple them individually without touching geometry buffers.
 */
export function buildVehicleMesh(spec: VehicleSpec, customization: VehicleCustomization): VehicleMeshParts {
  const { halfWidth: hw, halfHeight: hh, halfLength: hl } = spec.dimensions
  const paint = findPaint(customization.paint)
  const accent = findAccent(customization.accent)
  const wheelStyle = findWheel(customization.wheelStyle)

  const bodyColor = paint.color ? new THREE.Color(paint.color) : new THREE.Color(spec.visual.baseColor)
  const accentColor = accent.color ? new THREE.Color(accent.color) : new THREE.Color(spec.visual.accent)

  const bodyMaterial = new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.42, roughness: 0.34 })
  const accentMaterial = new THREE.MeshStandardMaterial({ color: accentColor, metalness: 0.3, roughness: 0.6 })
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: 0x101820,
    metalness: 0.2,
    roughness: 0.08,
    transparent: true,
    opacity: 0.62,
  })
  const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.92 })
  const rim = rimMaterial(wheelStyle.rimColor)
  const lightMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff3d0,
    emissive: 0xffe9b0,
    emissiveIntensity: 1.4,
    roughness: 0.4,
  })
  const tailMaterial = new THREE.MeshStandardMaterial({
    color: 0x5a1010,
    emissive: 0xff2b1d,
    emissiveIntensity: 0.6,
    roughness: 0.5,
  })
  const flameMaterial = new THREE.MeshBasicMaterial({ color: 0x6fd4ff, transparent: true, opacity: 0 })

  const root = new THREE.Group()

  // --- Lower body, split into three crumple sections -----------------------
  const midLen = hl * 0.9
  const noseLen = hl - midLen * 0.5
  const mid = box(bodyMaterial, hw * 2, hh * 2, midLen, 0, 0, 0)
  root.add(mid)

  const front = new THREE.Group()
  front.position.z = midLen * 0.5
  const noseHeight = hh * 2 * (1 - spec.visual.noseSlope * 0.5)
  front.add(box(bodyMaterial, hw * 1.96, noseHeight, noseLen, 0, -hh * spec.visual.noseSlope * 0.5, noseLen * 0.5))
  const frontBumper = box(accentMaterial, hw * 2.02, hh * 0.5, 0.22, 0, -hh * 0.6, noseLen + 0.02)
  front.add(frontBumper)
  const headlightL = box(lightMaterial, hw * 0.5, hh * 0.32, 0.12, -hw * 0.6, hh * 0.05, noseLen - 0.02)
  const headlightR = headlightL.clone()
  headlightR.position.x = hw * 0.6
  front.add(headlightL, headlightR)
  root.add(front)

  const rear = new THREE.Group()
  rear.position.z = -midLen * 0.5
  const tailLen = hl - midLen * 0.5
  rear.add(box(bodyMaterial, hw * 1.96, hh * 2, tailLen, 0, 0, -tailLen * 0.5))
  const rearBumper = box(accentMaterial, hw * 2.02, hh * 0.5, 0.22, 0, -hh * 0.6, -tailLen - 0.02)
  rear.add(rearBumper)
  const brakeLights = box(tailMaterial, hw * 1.5, hh * 0.3, 0.1, 0, hh * 0.2, -tailLen + 0.01)
  rear.add(brakeLights)
  const boostFlames = new THREE.Mesh(BOX, flameMaterial)
  boostFlames.scale.set(hw * 0.8, hh * 0.4, 1.1)
  boostFlames.position.set(0, -hh * 0.5, -tailLen - 0.6)
  rear.add(boostFlames)
  root.add(rear)

  // --- Cabin ---------------------------------------------------------------
  const roofW = hw * 2 * spec.visual.roofScale
  const roofL = hl * 2 * spec.visual.roofScale * 0.62
  const roofH = hh * 1.5
  const roofY = hh + roofH * 0.5
  const roofZ = spec.visual.roofOffsetZ

  const roof = new THREE.Group()
  roof.position.set(0, roofY, roofZ)
  roof.add(box(bodyMaterial, roofW, roofH, roofL, 0, 0, 0))
  const windshield = box(glassMaterial, roofW * 0.94, roofH * 0.68, 0.08, 0, roofH * 0.08, roofL * 0.5)
  const backGlass = box(glassMaterial, roofW * 0.94, roofH * 0.62, 0.08, 0, roofH * 0.08, -roofL * 0.5)
  const sideGlassL = box(glassMaterial, 0.08, roofH * 0.6, roofL * 0.82, -roofW * 0.5, roofH * 0.1, 0)
  const sideGlassR = sideGlassL.clone()
  sideGlassR.position.x = roofW * 0.5
  roof.add(windshield, backGlass, sideGlassL, sideGlassR)
  root.add(roof)

  // Pickups get a bed wall instead of a long cabin.
  if (spec.category === 'pickup') {
    root.add(box(bodyMaterial, hw * 2, hh * 1.1, 0.16, 0, hh * 0.55, -hl + 0.2))
    root.add(box(bodyMaterial, 0.16, hh * 1.1, hl * 0.9, -hw + 0.08, hh * 0.55, -hl * 0.5))
    root.add(box(bodyMaterial, 0.16, hh * 1.1, hl * 0.9, hw - 0.08, hh * 0.55, -hl * 0.5))
  }

  // --- Side skirts (act as the left/right damage panels) --------------------
  const left = new THREE.Group()
  left.position.x = -hw
  left.add(box(accentMaterial, 0.12, hh * 0.7, hl * 1.5, 0, -hh * 0.55, 0))
  root.add(left)

  const right = new THREE.Group()
  right.position.x = hw
  right.add(box(accentMaterial, 0.12, hh * 0.7, hl * 1.5, 0, -hh * 0.55, 0))
  root.add(right)

  // --- Wheels --------------------------------------------------------------
  const wheels: THREE.Object3D[] = []
  const wheelPositions: Array<[number, number]> = [
    [-spec.wheel.offsetX, spec.wheel.frontOffsetZ],
    [spec.wheel.offsetX, spec.wheel.frontOffsetZ],
    [-spec.wheel.offsetX, spec.wheel.rearOffsetZ],
    [spec.wheel.offsetX, spec.wheel.rearOffsetZ],
  ]
  for (const [x, z] of wheelPositions) {
    const pivot = new THREE.Group()
    pivot.position.set(x, -hh, z)

    const tire = new THREE.Mesh(WHEEL_GEO, tireMaterial)
    tire.scale.set(spec.wheel.width, spec.wheel.radius, spec.wheel.radius)
    tire.castShadow = true
    pivot.add(tire)

    const hub = new THREE.Mesh(WHEEL_GEO, rim)
    hub.scale.set(spec.wheel.width * 1.04, spec.wheel.radius * 0.6, spec.wheel.radius * 0.6)
    pivot.add(hub)

    // Spokes read as wheel style without needing a texture.
    for (let i = 0; i < wheelStyle.spokes; i++) {
      const spoke = new THREE.Mesh(BOX, rim)
      spoke.scale.set(spec.wheel.width * 1.02, spec.wheel.radius * 1.6, 0.045)
      spoke.rotation.x = (i / wheelStyle.spokes) * Math.PI
      pivot.add(spoke)
    }
    root.add(pivot)
    wheels.push(pivot)
  }

  const geometries = [BOX, WHEEL_GEO]
  const materials = [bodyMaterial, accentMaterial, glassMaterial, tireMaterial, rim, lightMaterial, tailMaterial, flameMaterial]

  return {
    root,
    panels: { front, rear, left, right, roof },
    wheels,
    detachable: [frontBumper, rearBumper],
    glass: [windshield, backGlass, sideGlassL, sideGlassR],
    brakeLights,
    boostFlames,
    bodyMaterial,
    accentMaterial,
    dispose: () => {
      // Shared geometries are module-level singletons; only materials are per-car.
      void geometries
      for (const m of materials) m.dispose()
    },
  }
}
