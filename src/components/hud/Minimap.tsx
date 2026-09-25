import { memo, useEffect, useRef } from 'react'
import { LANDMARKS, ROADS, ZONES } from '@/config/world'
import type { RemotePlayerInfo } from '@/game/multiplayer/NetworkClient'

interface MinimapProps {
  position: [number, number, number]
  heading: number
  remotePlayers: RemotePlayerInfo[]
  target: { x: number; z: number } | null
}

const SIZE = 210
/** Metres visible across the minimap. */
const RANGE = 460

/**
 * Canvas minimap. Drawn imperatively so it can update at HUD rate without
 * re-rendering a React tree of hundreds of road segments.
 */
function MinimapImpl({ position, heading, remotePlayers, target }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio, 2)
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const [px, , pz] = position
    const scale = SIZE / RANGE
    const cx = SIZE / 2
    const cy = SIZE / 2

    ctx.clearRect(0, 0, SIZE, SIZE)
    ctx.fillStyle = '#10141c'
    ctx.fillRect(0, 0, SIZE, SIZE)

    ctx.save()
    ctx.translate(cx, cy)
    // North-up: rotating the map with the car makes roads unreadable at speed.
    ctx.scale(scale, scale)
    ctx.translate(-px, -pz)

    for (const zone of ZONES) {
      ctx.fillStyle = zone.minimapColor
      ctx.globalAlpha = 0.5
      ctx.fillRect(
        zone.center[0] - zone.half[0],
        zone.center[1] - zone.half[1],
        zone.half[0] * 2,
        zone.half[1] * 2,
      )
    }
    ctx.globalAlpha = 1

    ctx.lineCap = 'round'
    for (const road of ROADS) {
      ctx.strokeStyle = road.kind === 'highway' ? '#7f8894' : '#5b626c'
      ctx.lineWidth = road.kind === 'highway' ? 12 : road.kind === 'avenue' ? 9 : 6
      ctx.beginPath()
      ctx.moveTo(road.from[0], road.from[1])
      ctx.lineTo(road.to[0], road.to[1])
      ctx.stroke()
    }

    ctx.fillStyle = '#c9d6e2'
    for (const landmark of LANDMARKS) {
      ctx.beginPath()
      ctx.arc(landmark.position[0], landmark.position[2], 5 / scale + 3, 0, Math.PI * 2)
      ctx.fill()
    }

    if (target) {
      ctx.strokeStyle = '#3fd8ff'
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.arc(target.x, target.z, 14, 0, Math.PI * 2)
      ctx.stroke()
    }

    ctx.fillStyle = '#ff9d3a'
    for (const player of remotePlayers) {
      ctx.beginPath()
      ctx.arc(player.position[0], player.position[2], 9, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.restore()

    // Player arrow, always centred.
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(-heading)
    ctx.fillStyle = '#3fd8ff'
    ctx.beginPath()
    ctx.moveTo(0, -9)
    ctx.lineTo(6, 7)
    ctx.lineTo(0, 4)
    ctx.lineTo(-6, 7)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    ctx.strokeStyle = 'rgba(130, 168, 200, 0.25)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1)
  }, [position, heading, remotePlayers, target])

  return (
    <div className="hud__minimap">
      <canvas ref={canvasRef} style={{ width: SIZE, height: SIZE }} />
    </div>
  )
}

export const Minimap = memo(MinimapImpl)
