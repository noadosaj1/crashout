import * as THREE from 'three'

/**
 * Three defines `USE_COLOR` whenever an InstancedMesh has an `instanceColor`,
 * and the resulting shader runs `vColor.rgb *= color` using the geometry's
 * per-vertex `color` attribute. Built-in materials have no
 * `defaultAttributeValues`, so if the geometry does not supply that attribute
 * the generic value (0,0,0) is used and every instance renders black.
 *
 * Adding an all-white `color` attribute makes that multiply a no-op and lets
 * `instanceColor` come through as written.
 */
export function enableInstanceColors<T extends THREE.BufferGeometry>(geometry: T): T {
  if (geometry.getAttribute('color')) return geometry
  const count = geometry.getAttribute('position').count
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3))
  return geometry
}
