import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

/**
 * Bloom threshold, in linear HDR before tone mapping. Sunlit surfaces sit around
 * 1.0, so this sits just above them: only genuinely emissive things —
 * headlights, brake lights, boost flames, lit windows, the sun itself — clear it
 * and glow. Dropping it below 1 bleeds half the city and lifts every black.
 */
const BLOOM_THRESHOLD = 1.05
const BLOOM_STRENGTH = 0.5
const BLOOM_RADIUS = 0.5

/**
 * Optional post-processing chain.
 *
 * When disabled the engine renders straight to the canvas and none of this is
 * allocated, which is the fallback for machines that cannot afford it. When
 * enabled, the scene goes through a multisampled HDR target so hard-edged
 * geometry stays clean, picks up bloom on emissive surfaces, and is tone-mapped
 * in the output pass rather than by the renderer.
 */
export class PostProcessing {
  private composer: EffectComposer | null = null
  private bloom: UnrealBloomPass | null = null
  private renderTarget: THREE.WebGLRenderTarget | null = null
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private camera: THREE.Camera
  private _enabled = false
  private size = new THREE.Vector2(1, 1)

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer
    this.scene = scene
    this.camera = camera
  }

  get enabled(): boolean {
    return this._enabled
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this._enabled) return
    this._enabled = enabled
    if (enabled) this.build()
    else this.teardown()
  }

  setCamera(camera: THREE.Camera): void {
    this.camera = camera
    if (this._enabled) {
      this.teardown()
      this.build()
    }
  }

  private build(): void {
    this.renderer.getSize(this.size)
    const pixelRatio = this.renderer.getPixelRatio()

    // Half-float so bright emissives survive to the bloom pass without
    // clipping, and 4x MSAA because every edge in this game is a hard one.
    this.renderTarget = new THREE.WebGLRenderTarget(
      Math.max(1, Math.floor(this.size.x * pixelRatio)),
      Math.max(1, Math.floor(this.size.y * pixelRatio)),
      { type: THREE.HalfFloatType, samples: 4 },
    )

    const composer = new EffectComposer(this.renderer, this.renderTarget)
    composer.setPixelRatio(pixelRatio)
    composer.setSize(this.size.x, this.size.y)
    composer.addPass(new RenderPass(this.scene, this.camera))

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(this.size.x, this.size.y),
      BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    )
    composer.addPass(this.bloom)
    // Tone mapping and colour-space conversion move here once a composer is in
    // play; the renderer must not also apply them or it happens twice.
    composer.addPass(new OutputPass())

    this.composer = composer
  }

  private teardown(): void {
    this.bloom?.dispose()
    this.composer?.dispose()
    this.renderTarget?.dispose()
    this.bloom = null
    this.composer = null
    this.renderTarget = null
  }

  setSize(width: number, height: number): void {
    this.size.set(width, height)
    if (!this.composer) return
    this.composer.setPixelRatio(this.renderer.getPixelRatio())
    this.composer.setSize(width, height)
    this.bloom?.setSize(width, height)
  }

  /** Renders the frame, through the chain when enabled and directly when not. */
  render(): void {
    if (this.composer) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    this.teardown()
  }
}
