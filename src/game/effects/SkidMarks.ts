import * as THREE from 'three'
import { enableInstanceColors } from './instancedColor'

const MAX_MARKS = 1400

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)

/**
 * Ring buffer of instanced quads laid on the road where tires slip. Old marks
 * are overwritten rather than removed, so memory and draw calls stay flat.
 */
export class SkidMarks {
  readonly object: THREE.Object3D
  private readonly mesh: THREE.InstancedMesh
  private readonly geometry: THREE.PlaneGeometry
  private readonly material: THREE.MeshBasicMaterial
  private readonly alpha: Float32Array
  private readonly colorAttr: THREE.InstancedBufferAttribute
  private cursor = 0
  private used = 0
  private readonly lastPos = new Map<string, THREE.Vector3>()

  constructor() {
    this.geometry = new THREE.PlaneGeometry(1, 1)
    this.geometry.rotateX(-Math.PI / 2)
    enableInstanceColors(this.geometry)
    // White base: the per-instance colour is multiplied in, so a black base
    // would flatten every mark to pure black. Opacity stays low because marks
    // overlap heavily in a tight turn and stacked quads darken fast.
    this.material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    })
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, MAX_MARKS)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.alpha = new Float32Array(MAX_MARKS)
    this.colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_MARKS * 3), 3)
    this.mesh.instanceColor = this.colorAttr
    this.object = this.mesh
  }

  /**
   * Lays a mark between the previous sample and this one so streaks are
   * continuous even at 200 km/h.
   */
  mark(key: string, position: THREE.Vector3, width: number, intensity: number): void {
    const prev = this.lastPos.get(key)
    if (!prev) {
      this.lastPos.set(key, position.clone())
      return
    }
    const dx = position.x - prev.x
    const dz = position.z - prev.z
    const dist = Math.hypot(dx, dz)
    if (dist < 0.12) return
    if (dist > 12) {
      // Teleport or respawn: do not draw a streak across the map.
      prev.copy(position)
      return
    }

    const angle = Math.atan2(dx, dz)
    _q.setFromAxisAngle(_up, angle)
    _p.set((position.x + prev.x) / 2, 0.035, (position.z + prev.z) / 2)
    _s.set(width, 1, dist * 1.15)
    _m.compose(_p, _q, _s)

    const i = this.cursor
    this.mesh.setMatrixAt(i, _m)
    // Harder slides leave darker rubber.
    const shade = 0.34 - Math.min(1, intensity) * 0.22
    this.colorAttr.setXYZ(i, shade, shade, shade)
    this.alpha[i] = Math.min(1, intensity)
    this.cursor = (this.cursor + 1) % MAX_MARKS
    this.used = Math.min(MAX_MARKS, this.used + 1)
    this.mesh.count = this.used
    this.mesh.instanceMatrix.needsUpdate = true
    this.colorAttr.needsUpdate = true
    prev.copy(position)
  }

  /** Call when a car respawns so its next mark does not streak from the old spot. */
  breakTrail(keyPrefix: string): void {
    for (const key of this.lastPos.keys()) {
      if (key.startsWith(keyPrefix)) this.lastPos.delete(key)
    }
  }

  clear(): void {
    this.used = 0
    this.cursor = 0
    this.mesh.count = 0
    this.lastPos.clear()
  }

  dispose(): void {
    this.mesh.dispose()
    this.geometry.dispose()
    this.material.dispose()
  }
}
