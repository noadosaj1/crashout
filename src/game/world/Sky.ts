import * as THREE from 'three'

/**
 * A gradient sky dome with a soft sun disc. Cheaper than a skybox texture and it
 * matches the fog colour exactly, so the horizon never shows a seam.
 */
export function createSky(): { object: THREE.Object3D; dispose: () => void } {
  const geometry = new THREE.SphereGeometry(1600, 24, 16)
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x3f78b8) },
      horizonColor: { value: new THREE.Color(0xa9cbe4) },
      bottomColor: { value: new THREE.Color(0x6b6f68) },
      sunDirection: { value: new THREE.Vector3(150, 420, 110).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldDirection;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldDirection = normalize(worldPosition.xyz - cameraPosition);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      uniform vec3 sunDirection;
      varying vec3 vWorldDirection;

      void main() {
        vec3 dir = normalize(vWorldDirection);
        float h = dir.y;
        // Two-stage gradient: ground haze below the horizon, sky above.
        vec3 sky = mix(horizonColor, topColor, clamp(pow(max(h, 0.0), 0.55), 0.0, 1.0));
        vec3 color = mix(bottomColor, sky, smoothstep(-0.12, 0.06, h));

        float sun = max(dot(dir, normalize(sunDirection)), 0.0);
        color += vec3(1.0, 0.92, 0.76) * pow(sun, 620.0) * 1.6;
        color += vec3(1.0, 0.88, 0.7) * pow(sun, 12.0) * 0.16;

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = -1

  return {
    object: mesh,
    dispose: () => {
      geometry.dispose()
      material.dispose()
    },
  }
}
