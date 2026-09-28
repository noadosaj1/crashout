import * as THREE from 'three'

/** Geometry helpers shared by the procedural and the model-based car meshes. */

/** A box, positioned and optionally rotated, as loose geometry ready to merge. */
export function box(
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

export function cylinder(
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
