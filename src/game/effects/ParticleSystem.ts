import * as THREE from 'three'
import { enableInstanceColors } from './instancedColor'

export type ParticleKind = 'spark' | 'smoke' | 'dust' | 'glass' | 'debris'

interface Particle {
  active: boolean
  kind: ParticleKind
  life: number
  maxLife: number
  position: THREE.Vector3
  velocity: THREE.Vector3
  spin: THREE.Vector3
  rotation: THREE.Euler
  size: number
  endSize: number
  color: THREE.Color
  gravity: number
  drag: number
}

const MAX_PARTICLES = 900
/** Particles are cheap, but not free — hard cap per burst keeps big pileups smooth. */
const MAX_PER_BURST = 44

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _c = new THREE.Color()

/**
 * A single pooled, instanced particle system covering sparks, smoke, dust, glass
 * and debris. One draw call, zero per-frame allocation.
 */
export class ParticleSystem {
  readonly object: THREE.Group
  private readonly pool: Particle[] = []
  private cursor = 0
  private readonly mesh: THREE.InstancedMesh
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.MeshBasicMaterial
  private readonly colorAttr: THREE.InstancedBufferAttribute
  private liveCount = 0

  constructor() {
    this.geometry = enableInstanceColors(new THREE.BoxGeometry(1, 1, 1))
    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    })
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, MAX_PARTICLES)
    this.mesh.frustumCulled = false
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3)
    this.mesh.instanceColor = this.colorAttr
    this.mesh.count = 0

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pool.push({
        active: false,
        kind: 'spark',
        life: 0,
        maxLife: 1,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        rotation: new THREE.Euler(),
        size: 0.1,
        endSize: 0.1,
        color: new THREE.Color(),
        gravity: -9.8,
        drag: 0.2,
      })
    }

    this.object = new THREE.Group()
    this.object.add(this.mesh)
  }

  private acquire(): Particle | null {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.pool[this.cursor]
      this.cursor = (this.cursor + 1) % MAX_PARTICLES
      if (!p.active) return p
    }
    return null
  }

  /** Sparks: fast, short-lived, bright, bounce off nothing. */
  sparks(position: THREE.Vector3, normal: THREE.Vector3, intensity: number): void {
    const count = Math.min(MAX_PER_BURST, Math.round(6 + intensity * 34))
    for (let i = 0; i < count; i++) {
      const p = this.acquire()
      if (!p) return
      p.active = true
      p.kind = 'spark'
      p.maxLife = 0.18 + Math.random() * 0.34
      p.life = p.maxLife
      p.position.copy(position)
      p.velocity
        .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(4 + Math.random() * 16 * intensity)
        .addScaledVector(normal, 3 + Math.random() * 7)
      p.size = 0.06 + Math.random() * 0.09
      p.endSize = 0.01
      p.color.setHSL(0.09 + Math.random() * 0.05, 1, 0.62 + Math.random() * 0.25)
      p.gravity = -16
      p.drag = 0.6
      p.spin.set(0, 0, 0)
      p.rotation.set(0, 0, 0)
    }
  }

  /** Smoke: slow, rising, expanding, fades out. */
  smoke(position: THREE.Vector3, intensity: number, color = 0x8f959c): void {
    const count = Math.min(MAX_PER_BURST, Math.round(2 + intensity * 12))
    for (let i = 0; i < count; i++) {
      const p = this.acquire()
      if (!p) return
      p.active = true
      p.kind = 'smoke'
      p.maxLife = 0.9 + Math.random() * 1.5
      p.life = p.maxLife
      p.position.copy(position).add(
        _s.set((Math.random() - 0.5) * 1.2, Math.random() * 0.6, (Math.random() - 0.5) * 1.2),
      )
      p.velocity.set((Math.random() - 0.5) * 1.6, 1.2 + Math.random() * 2.4, (Math.random() - 0.5) * 1.6)
      p.size = 0.5 + Math.random() * 0.7
      p.endSize = p.size * (2.6 + Math.random())
      _c.setHex(color)
      p.color.copy(_c).offsetHSL(0, 0, (Math.random() - 0.5) * 0.12)
      p.gravity = 0.6
      p.drag = 1.4
      p.spin.set(0, Math.random() - 0.5, 0)
      p.rotation.set(0, Math.random() * Math.PI, 0)
    }
  }

  /** Dust kicked up by tires on loose surfaces. */
  dust(position: THREE.Vector3, velocity: THREE.Vector3, intensity: number, color: number): void {
    const count = Math.min(6, Math.round(1 + intensity * 4))
    for (let i = 0; i < count; i++) {
      const p = this.acquire()
      if (!p) return
      p.active = true
      p.kind = 'dust'
      p.maxLife = 0.4 + Math.random() * 0.7
      p.life = p.maxLife
      p.position.copy(position)
      p.velocity
        .copy(velocity)
        .multiplyScalar(-0.16)
        .add(_s.set((Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.6, (Math.random() - 0.5) * 2))
      p.size = 0.22 + Math.random() * 0.3
      p.endSize = p.size * 3
      _c.setHex(color)
      p.color.copy(_c)
      p.gravity = 0.4
      p.drag = 1.8
      p.spin.set(0, Math.random() - 0.5, 0)
      p.rotation.set(0, Math.random() * Math.PI, 0)
    }
  }

  /** Glass shards: small, glinting, gravity-bound. */
  glass(position: THREE.Vector3, intensity: number): void {
    const count = Math.min(MAX_PER_BURST, Math.round(5 + intensity * 20))
    for (let i = 0; i < count; i++) {
      const p = this.acquire()
      if (!p) return
      p.active = true
      p.kind = 'glass'
      p.maxLife = 0.8 + Math.random() * 1.1
      p.life = p.maxLife
      p.position.copy(position)
      p.velocity
        .set(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(3 + Math.random() * 9 * intensity)
      p.size = 0.05 + Math.random() * 0.07
      p.endSize = p.size
      p.color.setRGB(0.72, 0.86, 0.95)
      p.gravity = -22
      p.drag = 0.15
      p.spin.set(Math.random() * 12, Math.random() * 12, Math.random() * 12)
      p.rotation.set(Math.random(), Math.random(), Math.random())
    }
  }

  /** Chunks of bodywork thrown off in a big hit. */
  debris(position: THREE.Vector3, intensity: number, color: number): void {
    const count = Math.min(24, Math.round(2 + intensity * 14))
    for (let i = 0; i < count; i++) {
      const p = this.acquire()
      if (!p) return
      p.active = true
      p.kind = 'debris'
      p.maxLife = 1.4 + Math.random() * 1.6
      p.life = p.maxLife
      p.position.copy(position)
      p.velocity
        .set(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(3 + Math.random() * 11 * intensity)
      p.size = 0.14 + Math.random() * 0.26
      p.endSize = p.size
      _c.setHex(color)
      p.color.copy(_c)
      p.gravity = -22
      p.drag = 0.1
      p.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14)
      p.rotation.set(Math.random(), Math.random(), Math.random())
    }
  }

  update(dt: number): void {
    let index = 0
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.pool[i]
      if (!p.active) continue

      p.life -= dt
      if (p.life <= 0) {
        p.active = false
        continue
      }

      p.velocity.y += p.gravity * dt
      const dragFactor = Math.max(0, 1 - p.drag * dt)
      p.velocity.multiplyScalar(dragFactor)
      p.position.addScaledVector(p.velocity, dt)

      // Cheap ground bounce so sparks and debris skitter instead of sinking.
      if (p.position.y < 0.04 && p.velocity.y < 0) {
        p.position.y = 0.04
        p.velocity.y *= -0.35
        p.velocity.x *= 0.7
        p.velocity.z *= 0.7
        if (p.kind === 'smoke' || p.kind === 'dust') p.velocity.y = Math.abs(p.velocity.y) * 0.4
      }

      p.rotation.x += p.spin.x * dt
      p.rotation.y += p.spin.y * dt
      p.rotation.z += p.spin.z * dt

      const t = 1 - p.life / p.maxLife
      const size = p.size + (p.endSize - p.size) * t
      const fade = p.kind === 'smoke' || p.kind === 'dust' ? 1 - t : 1

      _q.setFromEuler(p.rotation)
      _s.set(size, size, p.kind === 'spark' ? size * (1 + p.velocity.length() * 0.05) : size)
      _m.compose(p.position, _q, _s)
      this.mesh.setMatrixAt(index, _m)
      _c.copy(p.color).multiplyScalar(fade)
      this.colorAttr.setXYZ(index, _c.r, _c.g, _c.b)
      index++
    }

    this.liveCount = index
    this.mesh.count = index
    if (index > 0) {
      this.mesh.instanceMatrix.needsUpdate = true
      this.colorAttr.needsUpdate = true
    }
    // Smoke needs blending; opacity here is a global dimmer for the whole system.
    this.material.opacity = 0.95
  }

  get count(): number {
    return this.liveCount
  }

  dispose(): void {
    this.mesh.dispose()
    this.geometry.dispose()
    this.material.dispose()
  }
}
