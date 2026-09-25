import * as THREE from 'three'

const WIDTH = 384
const HEIGHT = 96

/** Canvas-rendered name tags, cached per name so repeated joins are free. */
export class NameTagFactory {
  private readonly cache = new Map<string, THREE.Texture>()

  get(name: string): THREE.Texture {
    const key = name || 'Driver'
    const existing = this.cache.get(key)
    if (existing) return existing

    const canvas = document.createElement('canvas')
    canvas.width = WIDTH
    canvas.height = HEIGHT
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, WIDTH, HEIGHT)
      ctx.fillStyle = 'rgba(8, 10, 14, 0.72)'
      ctx.beginPath()
      ctx.roundRect(8, 18, WIDTH - 16, HEIGHT - 36, 16)
      ctx.fill()
      ctx.strokeStyle = 'rgba(122, 226, 255, 0.55)'
      ctx.lineWidth = 3
      ctx.stroke()

      ctx.font = '600 40px system-ui, -apple-system, Segoe UI, sans-serif'
      ctx.fillStyle = '#eaf6ff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(key.slice(0, 16), WIDTH / 2, HEIGHT / 2)
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    this.cache.set(key, texture)
    return texture
  }

  dispose(): void {
    for (const texture of this.cache.values()) texture.dispose()
    this.cache.clear()
  }
}
