import { describe, expect, it, vi } from 'vitest'
import { generateSessionCode, normalizeSessionCode } from '@/lib/networking/createTransport'
import { EventBus } from '@/game/core/EventBus'

// crypto.getRandomValues exists in Node 22, but be explicit about the contract.
describe('session codes', () => {
  it('produces six characters from an unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateSessionCode()
      expect(code).toHaveLength(6)
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
      // Characters people confuse when reading a code aloud.
      expect(code).not.toMatch(/[O0I1]/)
    }
  })

  it('is not obviously biased toward one character', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) for (const c of generateSessionCode()) seen.add(c)
    expect(seen.size).toBeGreaterThan(20)
  })

  it('normalises typed input the way a player would paste it', () => {
    expect(normalizeSessionCode(' x7k2qp ')).toBe('X7K2QP')
    expect(normalizeSessionCode('x7k-2qp')).toBe('X7K2QP')
    expect(normalizeSessionCode('X7K2QPEXTRA')).toBe('X7K2QP')
    expect(normalizeSessionCode('!!!')).toBe('')
  })
})

describe('EventBus', () => {
  it('delivers to every listener and stops after unsubscribe', () => {
    const bus = new EventBus<{ ping: number }>()
    const a = vi.fn()
    const b = vi.fn()
    const offA = bus.on('ping', a)
    bus.on('ping', b)

    bus.emit('ping', 1)
    expect(a).toHaveBeenCalledWith(1)
    expect(b).toHaveBeenCalledWith(1)

    offA()
    bus.emit('ping', 2)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
  })

  it('ignores events nobody listens for', () => {
    const bus = new EventBus<{ ping: number }>()
    expect(() => bus.emit('ping', 1)).not.toThrow()
  })

  it('does not deliver after clear', () => {
    const bus = new EventBus<{ ping: number }>()
    const fn = vi.fn()
    bus.on('ping', fn)
    bus.clear()
    bus.emit('ping', 1)
    expect(fn).not.toHaveBeenCalled()
  })
})
