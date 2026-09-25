import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { COLLISION_GROUPS, CRASH_CONTACT_FORCE_GATE, WORLD_BOUNDS } from '@/config/constants'
import { LANDMARKS, ROADS, ZONES, type RoadDef } from '@/config/world'
import type { PhysicsWorld } from '@/game/physics/PhysicsWorld'
import { createWorldMaterials, disposeMaterials, type WorldMaterials } from './materials'
import { SURFACE, SurfaceMap } from './SurfaceMap'

/** Seeded RNG so the city is identical for every player in a session. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface InstanceBatch {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  matrices: THREE.Matrix4[]
  castShadow: boolean
  receiveShadow: boolean
}

export interface WorldProp {
  body: RAPIER.RigidBody
  mesh: THREE.Mesh
  /** Where it started, so the arena can be reset between challenge runs. */
  origin: THREE.Vector3
  originQuat: THREE.Quaternion
}

export interface BuiltWorld {
  group: THREE.Group
  surfaces: SurfaceMap
  props: WorldProp[]
  /** Colliders that belong to static world geometry, for crash classification. */
  staticColliders: Set<number>
  propColliders: Map<number, WorldProp>
  landmarks: typeof LANDMARKS
  dispose: () => void
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)
const UNIT_CYLINDER = new THREE.CylinderGeometry(0.5, 0.5, 1, 12)
const UNIT_CONE = new THREE.ConeGeometry(0.5, 1, 10)

/**
 * Builds the whole city: ground, roads, five districts, a highway ring and a
 * crash arena. Repeated static geometry goes into InstancedMeshes; every static
 * body gets one cuboid collider.
 */
export class WorldBuilder {
  private readonly batches = new Map<string, InstanceBatch>()
  private readonly group = new THREE.Group()
  private readonly materials: WorldMaterials
  private readonly surfaces = new SurfaceMap()
  private readonly props: WorldProp[] = []
  private readonly staticColliders = new Set<number>()
  private readonly propColliders = new Map<number, WorldProp>()
  private readonly rng = mulberry32(0x5eed)
  private readonly ownedGeometry: THREE.BufferGeometry[] = []

  private readonly physics: PhysicsWorld

  constructor(physics: PhysicsWorld) {
    this.physics = physics
    this.materials = createWorldMaterials()
    this.group.name = 'world'
  }

  build(): BuiltWorld {
    this.buildGround()
    this.buildZoneFloors()
    this.buildRoads()
    this.buildDowntown()
    this.buildSuburbs()
    this.buildIndustrial()
    this.buildOffroad()
    this.buildArena()
    this.buildBoundaryWalls()
    this.flushBatches()

    return {
      group: this.group,
      surfaces: this.surfaces,
      props: this.props,
      staticColliders: this.staticColliders,
      propColliders: this.propColliders,
      landmarks: LANDMARKS,
      dispose: () => this.dispose(),
    }
  }

  // ---------------------------------------------------------------- helpers

  private batch(
    key: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    castShadow = true,
    receiveShadow = true,
  ): InstanceBatch {
    let b = this.batches.get(key)
    if (!b) {
      b = { geometry, material, matrices: [], castShadow, receiveShadow }
      this.batches.set(key, b)
    }
    return b
  }

  private addInstance(
    key: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: THREE.Vector3,
    scale: THREE.Vector3,
    quaternion?: THREE.Quaternion,
    castShadow = true,
    receiveShadow = true,
  ): void {
    const m = new THREE.Matrix4()
    m.compose(position, quaternion ?? new THREE.Quaternion(), scale)
    this.batch(key, geometry, material, castShadow, receiveShadow).matrices.push(m)
  }

  /** Static box: one instanced visual + one cuboid collider. */
  private staticBox(
    key: string,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    rotY = 0,
    collide = true,
  ): void {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY)
    this.addInstance(key, UNIT_BOX, material, new THREE.Vector3(x, y, z), new THREE.Vector3(sx, sy, sz), q)
    if (!collide) return
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    )
    const collider = this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
        .setFriction(0.9)
        .setRestitution(0.1)
        .setCollisionGroups((COLLISION_GROUPS.WORLD << 16) | (COLLISION_GROUPS.VEHICLE | COLLISION_GROUPS.PROP)),
      body,
    )
    this.staticColliders.add(collider.handle)
  }

  /**
   * One sloped slab. The low end is buried below ground so there is no lip to
   * slam into, and the slab rises toward local +Z after `rotY`.
   */
  private slope(x: number, z: number, width: number, length: number, height: number, rotY: number): void {
    const angle = Math.atan2(height, length)
    const slabThickness = 0.6
    const q = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -angle))
    const hyp = Math.hypot(length, height)
    const position = new THREE.Vector3(x, height * 0.5 - slabThickness * 0.35, z)

    this.addInstance(
      'ramp',
      UNIT_BOX,
      this.materials.ramp,
      position,
      new THREE.Vector3(width, slabThickness, hyp),
      q,
    )
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(position.x, position.y, position.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    )
    const collider = this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(width / 2, slabThickness / 2, hyp / 2)
        .setFriction(0.95)
        .setCollisionGroups((COLLISION_GROUPS.WORLD << 16) | (COLLISION_GROUPS.VEHICLE | COLLISION_GROUPS.PROP)),
      body,
    )
    this.staticColliders.add(collider.handle)
  }

  /**
   * A launch ramp. `rotY` is the direction it throws you.
   *
   * Single-sided ramps are only fun if you approach them from the right side —
   * from behind they are a wall. Anything a player can reach from several
   * directions gets `symmetric`, which mirrors the slope into a hump you can
   * take either way.
   */
  private ramp(
    x: number,
    z: number,
    width: number,
    length: number,
    height: number,
    rotY: number,
    symmetric = false,
  ): void {
    this.slope(x, z, width, length, height, rotY)
    if (!symmetric) return
    // Mirror about the crest: shift the back slope so both peaks coincide.
    const crestX = x + Math.sin(rotY) * length
    const crestZ = z + Math.cos(rotY) * length
    const backRot = rotY + Math.PI
    this.slope(
      crestX + Math.sin(backRot) * length,
      crestZ + Math.cos(backRot) * length,
      width,
      length,
      height,
      backRot,
    )
  }

  /** Dynamic prop: a real rigid body, so it scatters when you plough into it. */
  private dynamicProp(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    mass: number,
    shape: 'box' | 'cylinder' | 'cone',
  ): void {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.scale.set(sx, sy, sz)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)

    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0.25).setAngularDamping(0.5),
    )
    const desc =
      shape === 'box'
        ? RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
        : shape === 'cylinder'
          ? RAPIER.ColliderDesc.cylinder(sy / 2, Math.max(sx, sz) / 2)
          : RAPIER.ColliderDesc.cone(sy / 2, Math.max(sx, sz) / 2)
    desc
      .setDensity(0)
      .setMass(mass)
      .setFriction(0.7)
      .setRestitution(0.25)
      .setCollisionGroups(
        (COLLISION_GROUPS.PROP << 16) | (COLLISION_GROUPS.WORLD | COLLISION_GROUPS.VEHICLE | COLLISION_GROUPS.PROP),
      )
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(CRASH_CONTACT_FORCE_GATE * 0.25)
    const collider = this.physics.world.createCollider(desc, body)

    const prop: WorldProp = {
      body,
      mesh,
      origin: new THREE.Vector3(x, y, z),
      originQuat: new THREE.Quaternion(),
    }
    this.props.push(prop)
    this.propColliders.set(collider.handle, prop)
  }

  private flushBatches(): void {
    for (const [key, batch] of this.batches) {
      if (batch.matrices.length === 0) continue
      const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length)
      mesh.name = key
      for (let i = 0; i < batch.matrices.length; i++) mesh.setMatrixAt(i, batch.matrices[i])
      mesh.instanceMatrix.needsUpdate = true
      mesh.castShadow = batch.castShadow
      mesh.receiveShadow = batch.receiveShadow
      mesh.frustumCulled = false
      this.group.add(mesh)
    }
    this.batches.clear()
  }

  // ----------------------------------------------------------------- ground

  private buildGround(): void {
    const size = WORLD_BOUNDS * 2
    const geo = new THREE.PlaneGeometry(size, size, 1, 1)
    geo.rotateX(-Math.PI / 2)
    this.ownedGeometry.push(geo)
    const mesh = new THREE.Mesh(geo, this.materials.ground)
    mesh.receiveShadow = true
    mesh.position.y = 0
    this.group.add(mesh)

    // A thick slab rather than a plane collider: cars that clip get pushed out.
    const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -10, 0))
    const collider = this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(WORLD_BOUNDS, 10, WORLD_BOUNDS)
        .setFriction(1.0)
        .setCollisionGroups((COLLISION_GROUPS.WORLD << 16) | (COLLISION_GROUPS.VEHICLE | COLLISION_GROUPS.PROP)),
      body,
    )
    this.staticColliders.add(collider.handle)
  }

  private buildZoneFloors(): void {
    for (const zone of ZONES) {
      const geo = new THREE.PlaneGeometry(zone.half[0] * 2, zone.half[1] * 2, 1, 1)
      geo.rotateX(-Math.PI / 2)
      this.ownedGeometry.push(geo)
      const mat = new THREE.MeshStandardMaterial({ color: zone.groundColor, roughness: 0.95 })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(zone.center[0], 0.02, zone.center[1])
      mesh.receiveShadow = true
      this.group.add(mesh)

      const kind =
        zone.id === 'offroad' ? SURFACE.DIRT : zone.id === 'suburbs' ? SURFACE.GRASS : SURFACE.CONCRETE
      this.surfaces.paintRect(zone.center[0], zone.center[1], zone.half[0], zone.half[1], kind)
    }
  }

  // ------------------------------------------------------------------ roads

  private buildRoads(): void {
    for (const road of ROADS) this.buildRoad(road)
  }

  private buildRoad(road: RoadDef): void {
    const [x1, z1] = road.from
    const [x2, z2] = road.to
    const dx = x2 - x1
    const dz = z2 - z1
    const length = Math.hypot(dx, dz)
    if (length < 1) return
    const cx = (x1 + x2) / 2
    const cz = (z1 + z2) / 2
    const rot = Math.atan2(dx, dz)
    const material = road.kind === 'highway' ? this.materials.highway : this.materials.asphalt
    const y = road.kind === 'highway' ? 0.06 : 0.05

    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot)
    this.addInstance(
      `road_${road.kind}`,
      UNIT_BOX,
      material,
      new THREE.Vector3(cx, y, cz),
      new THREE.Vector3(road.width, 0.08, length),
      q,
      false,
      true,
    )
    this.surfaces.paintSegment(x1, z1, x2, z2, road.width, SURFACE.ROAD)

    // Dashed centre line.
    const dashes = Math.floor(length / 14)
    for (let i = 0; i < dashes; i++) {
      const t = (i + 0.5) / dashes
      this.addInstance(
        'road_line',
        UNIT_BOX,
        this.materials.line,
        new THREE.Vector3(x1 + dx * t, y + 0.03, z1 + dz * t),
        new THREE.Vector3(0.28, 0.02, 6),
        q,
        false,
        false,
      )
    }

    if (road.kind === 'highway') {
      // Barriers on both shoulders, built in segments so they read as continuous.
      const nx = dz / length
      const nz = -dx / length
      const offset = road.width / 2 + 0.6
      const segments = Math.max(1, Math.floor(length / 40))
      for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; i < segments; i++) {
          const t = (i + 0.5) / segments
          this.staticBox(
            'barrier',
            this.materials.barrier,
            x1 + dx * t + nx * offset * side,
            0.65,
            z1 + dz * t + nz * offset * side,
            0.7,
            1.2,
            length / segments,
            rot,
          )
        }
      }
    }
  }

  // --------------------------------------------------------------- downtown

  private buildDowntown(): void {
    const spacing = 88
    const rng = this.rng
    for (let gx = -2; gx < 2; gx++) {
      for (let gz = -2; gz < 2; gz++) {
        const cx = gx * spacing + spacing / 2
        const cz = gz * spacing + spacing / 2
        const blockHalf = spacing / 2 - 12

        // Parking lot blocks break up the skyline and give open space to play in.
        if (rng() < 0.22) {
          this.surfaces.paintRect(cx, cz, blockHalf, blockHalf, SURFACE.CONCRETE)
          this.addInstance(
            'lot',
            UNIT_BOX,
            this.materials.concrete,
            new THREE.Vector3(cx, 0.04, cz),
            new THREE.Vector3(blockHalf * 2, 0.06, blockHalf * 2),
            undefined,
            false,
            true,
          )
          for (let i = 0; i < 6; i++) {
            this.dynamicProp(
              UNIT_CONE,
              this.materials.prop,
              cx + (rng() - 0.5) * blockHalf * 1.6,
              0.4,
              cz + (rng() - 0.5) * blockHalf * 1.6,
              0.8,
              0.8,
              0.8,
              8,
              'cone',
            )
          }
          continue
        }

        // Two or three towers per block with a bit of setback.
        const towers = 2 + Math.floor(rng() * 2)
        for (let i = 0; i < towers; i++) {
          const w = 16 + rng() * 22
          const d = 16 + rng() * 22
          const h = 18 + rng() * (Math.abs(gx) + Math.abs(gz) < 2 ? 78 : 40)
          const ox = (rng() - 0.5) * (blockHalf - w / 2) * 1.4
          const oz = (rng() - 0.5) * (blockHalf - d / 2) * 1.4
          const key = rng() < 0.35 ? 'tower_glass' : rng() < 0.5 ? 'tower_a' : 'tower_b'
          const material =
            key === 'tower_glass'
              ? this.materials.glassFacade
              : key === 'tower_a'
                ? this.materials.buildingA
                : this.materials.buildingB
          this.staticBox(key, material, cx + ox, h / 2, cz + oz, w, h, d)
          // Podium lip — something to clip a mirror on.
          this.staticBox('podium', this.materials.concrete, cx + ox, 1.2, cz + oz, w + 3, 2.4, d + 3)
        }
      }
    }

    // The Spire landmark.
    this.staticBox('tower_glass', this.materials.glassFacade, 44, 70, 44, 26, 140, 26)
    this.staticBox('podium', this.materials.concrete, 44, 3, 44, 40, 6, 40)

    // Street furniture along the avenues — cheap, satisfying things to hit.
    for (let i = 0; i < 70; i++) {
      const alongX = this.rng() < 0.5
      const a = (this.rng() - 0.5) * 400
      const b = (Math.floor(this.rng() * 5) - 2) * 88 + (this.rng() < 0.5 ? 9 : -9)
      const x = alongX ? a : b
      const z = alongX ? b : a
      this.dynamicProp(UNIT_CONE, this.materials.prop, x, 0.4, z, 0.8, 0.8, 0.8, 7, 'cone')
    }
  }

  // ---------------------------------------------------------------- suburbs

  private buildSuburbs(): void {
    const rng = this.rng
    for (let row = 0; row < 4; row++) {
      const z = -60 + row * 120
      for (let i = 0; i < 9; i++) {
        const x = -530 + i * 26
        for (const side of [-1, 1]) {
          const hz = z + side * 22
          const w = 11 + rng() * 5
          const d = 10 + rng() * 4
          const h = 5 + rng() * 3
          this.staticBox('house', this.materials.house, x, h / 2, hz, w, h, d)
          // Roof: a flattened, rotated box reads as a pitched roof at speed.
          this.addInstance(
            'house_roof',
            UNIT_BOX,
            this.materials.roofTile,
            new THREE.Vector3(x, h + 1.1, hz),
            new THREE.Vector3(w + 1.2, 2.4, d + 1.2),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 4),
          )
          // Driveway.
          this.surfaces.paintRect(x, hz - side * (d / 2 + 5), 3.2, 5, SURFACE.CONCRETE)
          this.addInstance(
            'driveway',
            UNIT_BOX,
            this.materials.concrete,
            new THREE.Vector3(x, 0.05, hz - side * (d / 2 + 5)),
            new THREE.Vector3(6.4, 0.06, 10),
            undefined,
            false,
            true,
          )
          if (rng() < 0.5) {
            this.staticBox('hedge', this.materials.tree, x + w / 2 + 2, 0.9, hz, 1.2, 1.8, d, 0)
          }
        }
      }
    }
    // Trees down the verges.
    for (let i = 0; i < 90; i++) {
      const x = -545 + rng() * 250
      const z = -90 + rng() * 420
      this.addInstance(
        'trunk',
        UNIT_CYLINDER,
        this.materials.trunk,
        new THREE.Vector3(x, 1.6, z),
        new THREE.Vector3(0.6, 3.2, 0.6),
      )
      this.addInstance(
        'foliage',
        UNIT_CONE,
        this.materials.tree,
        new THREE.Vector3(x, 5, z),
        new THREE.Vector3(5, 6, 5),
      )
    }
  }

  // ------------------------------------------------------------- industrial

  private buildIndustrial(): void {
    const rng = this.rng
    this.surfaces.paintRect(420, -140, 190, 200, SURFACE.CONCRETE)

    for (let i = 0; i < 8; i++) {
      const x = 300 + (i % 4) * 82
      const z = -300 + Math.floor(i / 4) * 170
      this.staticBox('warehouse', this.materials.warehouse, x, 9, z, 58, 18, 46)
      this.staticBox('warehouse_roof', this.materials.barrier, x, 18.6, z, 60, 1.2, 48)
    }

    // Smokestack Row landmark.
    for (let i = 0; i < 3; i++) {
      const x = 420 + (i - 1) * 24
      this.addInstance(
        'stack',
        UNIT_CYLINDER,
        this.materials.concrete,
        new THREE.Vector3(x, 26, -200),
        new THREE.Vector3(9, 52, 9),
      )
      const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 26, -200))
      const collider = this.physics.world.createCollider(
        RAPIER.ColliderDesc.cylinder(26, 4.5)
          .setCollisionGroups((COLLISION_GROUPS.WORLD << 16) | (COLLISION_GROUPS.VEHICLE | COLLISION_GROUPS.PROP)),
        body,
      )
      this.staticColliders.add(collider.handle)
    }

    // Container stacks: static at the bottom, loose on top so they topple.
    for (let i = 0; i < 26; i++) {
      const x = 280 + rng() * 280
      const z = -330 + rng() * 300
      const height = 1 + Math.floor(rng() * 3)
      for (let level = 0; level < height; level++) {
        const y = 1.5 + level * 3.05
        if (level === 0) {
          this.staticBox('container', this.materials.container, x, y, z, 6.2, 3, 13, rng() * 0.2)
        } else {
          this.dynamicProp(UNIT_BOX, this.materials.container, x, y, z, 6.2, 3, 13, 900, 'box')
        }
      }
    }

    // Barrels and crates scattered across the yards.
    for (let i = 0; i < 70; i++) {
      const x = 270 + rng() * 300
      const z = -340 + rng() * 320
      if (rng() < 0.5) {
        this.dynamicProp(UNIT_CYLINDER, this.materials.propBarrel, x, 0.6, z, 1.1, 1.5, 1.1, 30, 'cylinder')
      } else {
        this.dynamicProp(UNIT_BOX, this.materials.propCrate, x, 0.7, z, 1.4, 1.4, 1.4, 45, 'box')
      }
    }
  }

  // ---------------------------------------------------------------- offroad

  private buildOffroad(): void {
    const centerX = 40
    const centerZ = 470
    const halfX = 250
    const halfZ = 210
    const cols = 56
    const rows = 48

    const positions = new Float32Array((cols + 1) * (rows + 1) * 3)
    const uvs = new Float32Array((cols + 1) * (rows + 1) * 2)
    const heightAt = (u: number, v: number): number => {
      const x = u * halfX * 2
      const z = v * halfZ * 2
      // Rolling dunes, tapered to zero at the edges so it meets the flat ground.
      const edge =
        Math.min(1, Math.min(u + 0.5, 0.5 - u) * 6) * Math.min(1, Math.min(v + 0.5, 0.5 - v) * 6)
      const h =
        Math.sin(x * 0.021) * 5.5 +
        Math.cos(z * 0.017) * 6.2 +
        Math.sin((x + z) * 0.033) * 3.1 +
        Math.cos((x - z * 0.7) * 0.011) * 7.5
      return Math.max(0, (h + 9) * Math.max(0, edge) * 0.7)
    }

    let p = 0
    let t = 0
    for (let iz = 0; iz <= rows; iz++) {
      for (let ix = 0; ix <= cols; ix++) {
        const u = ix / cols - 0.5
        const v = iz / rows - 0.5
        positions[p++] = centerX + u * halfX * 2
        positions[p++] = heightAt(u, v)
        positions[p++] = centerZ + v * halfZ * 2
        uvs[t++] = ix / cols
        uvs[t++] = iz / rows
      }
    }

    const indices = new Uint32Array(cols * rows * 6)
    let i = 0
    for (let iz = 0; iz < rows; iz++) {
      for (let ix = 0; ix < cols; ix++) {
        const a = iz * (cols + 1) + ix
        const b = a + 1
        const c = a + (cols + 1)
        const d = c + 1
        indices[i++] = a
        indices[i++] = c
        indices[i++] = b
        indices[i++] = b
        indices[i++] = c
        indices[i++] = d
      }
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geo.setIndex(new THREE.BufferAttribute(indices, 1))
    geo.computeVertexNormals()
    this.ownedGeometry.push(geo)

    const mesh = new THREE.Mesh(geo, this.materials.dirt)
    mesh.receiveShadow = true
    mesh.castShadow = false
    this.group.add(mesh)

    // The visual mesh and the collider share one vertex buffer, so what you see
    // is exactly what you drive on.
    const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    const collider = this.physics.world.createCollider(
      RAPIER.ColliderDesc.trimesh(positions, indices)
        .setFriction(0.92)
        .setCollisionGroups((COLLISION_GROUPS.WORLD << 16) | (COLLISION_GROUPS.VEHICLE | COLLISION_GROUPS.PROP)),
      body,
    )
    this.staticColliders.add(collider.handle)
    this.surfaces.paintRect(centerX, centerZ, halfX, halfZ, SURFACE.DIRT)

    // Dirt jumps along the approach. Symmetric so they are fun from any line.
    for (let j = 0; j < 5; j++) {
      this.ramp(centerX - 120 + j * 14, centerZ - 190 + j * 34, 18, 22, 3.5 + j * 0.9, Math.PI * 0.1 * j, true)
    }
    // Dust Mesa: a flat-topped plateau you can launch off.
    this.staticBox('mesa', this.materials.dirt, 40, 9, 520, 60, 18, 60)
    this.ramp(40, 476, 18, 34, 17.5, 0)
  }

  // ------------------------------------------------------------------ arena

  private buildArena(): void {
    const cx = -420
    const cz = -420
    const half = 180
    this.surfaces.paintRect(cx, cz, half, half, SURFACE.CONCRETE)
    this.addInstance(
      'arena_floor',
      UNIT_BOX,
      this.materials.concrete,
      new THREE.Vector3(cx, 0.04, cz),
      new THREE.Vector3(half * 2, 0.08, half * 2),
      undefined,
      false,
      true,
    )

    // Perimeter wall with a gap on the north side for the approach road.
    const wallH = 6
    for (let side = 0; side < 4; side++) {
      const angle = (side * Math.PI) / 2
      const ox = Math.sin(angle) * half
      const oz = Math.cos(angle) * half
      if (side === 0) {
        // Split wall to leave a 24m entrance.
        for (const s of [-1, 1]) {
          this.staticBox(
            'arena_wall',
            this.materials.barrier,
            cx + ox + s * (half / 2 + 12),
            wallH / 2,
            cz + oz,
            half - 24,
            wallH,
            3,
            angle,
          )
        }
      } else {
        this.staticBox('arena_wall', this.materials.barrier, cx + ox, wallH / 2, cz + oz, half * 2, wallH, 3, angle)
      }
    }

    // Four big launchers arranged so you can start in the middle and fire
    // yourself outward in any direction.
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2
      this.ramp(cx + Math.sin(a) * 34, cz + Math.cos(a) * 34, 22, 30, 9, a)
    }

    // Ring of humps, symmetric so they work whichever way you cross them.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      this.ramp(cx + Math.sin(a) * 118, cz + Math.cos(a) * 118, 18, 16, 4.5, a, true)
    }

    // A raised platform to land on — or miss.
    this.staticBox('arena_deck', this.materials.concrete, cx + 92, 5, cz - 92, 34, 10, 34)
    this.ramp(cx + 92, cz - 126, 20, 24, 10, 0)

    // Crash fodder: a dense field of dynamic props.
    const rng = this.rng
    for (let i = 0; i < 120; i++) {
      const a = rng() * Math.PI * 2
      const r = 20 + rng() * 150
      const x = cx + Math.sin(a) * r
      const z = cz + Math.cos(a) * r
      const roll = rng()
      if (roll < 0.35) {
        this.dynamicProp(UNIT_CYLINDER, this.materials.propBarrel, x, 0.75, z, 1.2, 1.6, 1.2, 26, 'cylinder')
      } else if (roll < 0.7) {
        this.dynamicProp(UNIT_BOX, this.materials.propCrate, x, 0.8, z, 1.6, 1.6, 1.6, 40, 'box')
      } else if (roll < 0.9) {
        this.dynamicProp(UNIT_CONE, this.materials.prop, x, 0.45, z, 0.9, 0.9, 0.9, 6, 'cone')
      } else {
        // Stacked crate towers: hitting the bottom one brings the lot down.
        for (let level = 0; level < 3; level++) {
          this.dynamicProp(UNIT_BOX, this.materials.propCrate, x, 0.8 + level * 1.65, z, 1.6, 1.6, 1.6, 40, 'box')
        }
      }
    }
  }

  private buildBoundaryWalls(): void {
    const b = WORLD_BOUNDS - 4
    const h = 14
    this.staticBox('bound', this.materials.barrier, 0, h / 2, b, b * 2, h, 4)
    this.staticBox('bound', this.materials.barrier, 0, h / 2, -b, b * 2, h, 4)
    this.staticBox('bound', this.materials.barrier, b, h / 2, 0, 4, h, b * 2)
    this.staticBox('bound', this.materials.barrier, -b, h / 2, 0, 4, h, b * 2)
  }

  private dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh) {
        if (obj instanceof THREE.InstancedMesh) obj.dispose()
      }
    })
    for (const geo of this.ownedGeometry) geo.dispose()
    disposeMaterials(this.materials)
    this.group.clear()
  }
}
