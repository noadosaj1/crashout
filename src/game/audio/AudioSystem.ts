import * as THREE from 'three'
import type { VehicleSpec } from '@/types'

/**
 * All audio is synthesised at runtime — no sample downloads, no CORS, no asset
 * pipeline. Engines are oscillator stacks whose pitch tracks speed and throttle;
 * impacts are shaped noise bursts whose brightness tracks impact magnitude.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private sfxBus: GainNode | null = null
  private engineBus: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null

  private engine: {
    osc: OscillatorNode[]
    gain: GainNode
    filter: BiquadFilterNode
  } | null = null

  private skid: { source: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null
  private wind: { source: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null

  private listenerPosition = new THREE.Vector3()
  private spec: VehicleSpec | null = null
  private muted = false
  private volume = 0.6
  /** Rate-limits impact sounds so a pileup does not clip the master bus. */
  private lastImpactAt = 0

  get initialised(): boolean {
    return this.ctx !== null
  }

  /** Must be called from a user gesture — browsers block audio otherwise. */
  async resume(): Promise<void> {
    if (!this.ctx) this.init()
    if (this.ctx?.state === 'suspended') await this.ctx.resume()
  }

  private init(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    this.ctx = ctx

    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : this.volume
    this.master.connect(ctx.destination)

    // A gentle limiter keeps multi-car pileups from distorting.
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -12
    compressor.ratio.value = 8
    compressor.attack.value = 0.003
    compressor.release.value = 0.2
    compressor.connect(this.master)

    this.sfxBus = ctx.createGain()
    this.sfxBus.gain.value = 0.9
    this.sfxBus.connect(compressor)

    this.engineBus = ctx.createGain()
    this.engineBus.gain.value = 0.34
    this.engineBus.connect(compressor)

    this.noiseBuffer = this.makeNoise(ctx, 2)
    this.startLoops(ctx)
  }

  private makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < length; i++) {
      // Slightly brown noise: less hissy than white, reads as road/tire noise.
      last = (last + Math.random() * 2 - 1) * 0.5
      data[i] = last
    }
    return buffer
  }

  private startLoops(ctx: AudioContext): void {
    if (!this.noiseBuffer || !this.sfxBus) return

    const makeLoop = (baseGain: number, filterType: BiquadFilterType, freq: number) => {
      const source = ctx.createBufferSource()
      source.buffer = this.noiseBuffer
      source.loop = true
      const filter = ctx.createBiquadFilter()
      filter.type = filterType
      filter.frequency.value = freq
      const gain = ctx.createGain()
      gain.gain.value = baseGain
      source.connect(filter).connect(gain).connect(this.sfxBus!)
      source.start()
      return { source, gain, filter }
    }

    this.skid = makeLoop(0, 'bandpass', 1800)
    this.skid.filter.Q.value = 1.6
    this.wind = makeLoop(0, 'highpass', 500)
  }

  setVehicle(spec: VehicleSpec): void {
    this.spec = spec
    if (!this.ctx || !this.engineBus) return
    this.stopEngine()

    const ctx = this.ctx
    const gain = ctx.createGain()
    gain.gain.value = 0
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 1400
    filter.Q.value = 0.8
    gain.connect(filter).connect(this.engineBus)

    // Three detuned oscillators: fundamental, an octave, and a rough harmonic.
    // The timbre profile picks the waveform mix for growl / whine / rasp.
    const shapes: OscillatorType[] =
      spec.audioProfile.timbre === 'whine'
        ? ['sawtooth', 'sawtooth', 'square']
        : spec.audioProfile.timbre === 'rasp'
          ? ['square', 'sawtooth', 'sawtooth']
          : ['sawtooth', 'square', 'triangle']

    const osc: OscillatorNode[] = []
    const ratios = [1, 2.01, 0.5]
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator()
      o.type = shapes[i]
      o.frequency.value = spec.audioProfile.idleHz * ratios[i]
      const oGain = ctx.createGain()
      oGain.gain.value = i === 0 ? 0.6 : i === 1 ? 0.25 : 0.35
      o.connect(oGain).connect(gain)
      o.start()
      osc.push(o)
    }
    this.engine = { osc, gain, filter }
  }

  private stopEngine(): void {
    if (!this.engine) return
    for (const o of this.engine.osc) {
      try {
        o.stop()
      } catch {
        // Already stopped — harmless.
      }
      o.disconnect()
    }
    this.engine.gain.disconnect()
    this.engine.filter.disconnect()
    this.engine = null
  }

  setListener(position: THREE.Vector3): void {
    this.listenerPosition.copy(position)
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.05)
    }
  }

  setVolume(volume: number): void {
    this.volume = THREE.MathUtils.clamp(volume, 0, 1)
    if (this.master && this.ctx && !this.muted) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05)
    }
  }

  /** Per-frame engine/tire/wind mix. */
  update(params: {
    speed: number
    topSpeed: number
    throttle: number
    slip: number
    grounded: boolean
    engineDamage: number
  }): void {
    const ctx = this.ctx
    if (!ctx || !this.engine || !this.spec) return
    const now = ctx.currentTime
    const profile = this.spec.audioProfile

    const speedRatio = Math.min(1.15, params.speed / Math.max(1, params.topSpeed))
    // Fake gearing: pitch ramps and drops so acceleration has shape.
    const gear = Math.min(5, Math.floor(speedRatio * 5.4))
    const withinGear = speedRatio * 5.4 - gear
    const load = 0.28 + params.throttle * 0.72
    const target = profile.idleHz + (profile.redlineHz - profile.idleHz) * (0.15 + withinGear * 0.85) * load

    const ratios = [1, 2.01, 0.5]
    for (let i = 0; i < this.engine.osc.length; i++) {
      this.engine.osc[i].frequency.setTargetAtTime(target * ratios[i], now, 0.05)
    }
    // A damaged engine sounds duller and rougher.
    this.engine.filter.frequency.setTargetAtTime(900 + speedRatio * 2600 * (1 - params.engineDamage * 0.5), now, 0.08)
    const engineGain = (0.18 + params.throttle * 0.34 + speedRatio * 0.22) * (1 - params.engineDamage * 0.25)
    this.engine.gain.gain.setTargetAtTime(engineGain, now, 0.06)

    if (this.skid) {
      const skidLevel = params.grounded ? Math.min(0.5, params.slip * 0.55) : 0
      this.skid.gain.gain.setTargetAtTime(skidLevel, now, 0.05)
      this.skid.filter.frequency.setTargetAtTime(1200 + params.slip * 2200, now, 0.08)
    }
    if (this.wind) {
      this.wind.gain.gain.setTargetAtTime(Math.min(0.22, speedRatio * speedRatio * 0.3), now, 0.1)
      this.wind.filter.frequency.setTargetAtTime(400 + speedRatio * 1800, now, 0.1)
    }
  }

  /** Impact: a noise burst plus a low thud, both scaled by severity. */
  playImpact(position: THREE.Vector3, severity: number, metallic: boolean): void {
    const ctx = this.ctx
    if (!ctx || !this.sfxBus || !this.noiseBuffer) return
    if (ctx.currentTime - this.lastImpactAt < 0.045) return
    this.lastImpactAt = ctx.currentTime

    const distance = this.listenerPosition.distanceTo(position)
    const attenuation = 1 / (1 + distance * 0.06)
    const level = Math.min(1, severity) * attenuation
    if (level < 0.015) return

    const now = ctx.currentTime

    const noise = ctx.createBufferSource()
    noise.buffer = this.noiseBuffer
    noise.playbackRate.value = 0.8 + severity * 1.2
    const bandpass = ctx.createBiquadFilter()
    bandpass.type = 'bandpass'
    bandpass.frequency.value = metallic ? 2200 + severity * 2600 : 900 + severity * 1600
    bandpass.Q.value = metallic ? 1.2 : 0.7
    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(level * 0.9, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18 + severity * 0.35)
    noise.connect(bandpass).connect(noiseGain).connect(this.sfxBus)
    noise.start(now)
    noise.stop(now + 0.7)

    const thud = ctx.createOscillator()
    thud.type = 'sine'
    thud.frequency.setValueAtTime(140 - severity * 60, now)
    thud.frequency.exponentialRampToValueAtTime(38, now + 0.22)
    const thudGain = ctx.createGain()
    thudGain.gain.setValueAtTime(level * 0.8, now)
    thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3 + severity * 0.4)
    thud.connect(thudGain).connect(this.sfxBus)
    thud.start(now)
    thud.stop(now + 0.8)

    if (severity > 0.25) this.playGlass(level * 0.6)
  }

  private playGlass(level: number): void {
    const ctx = this.ctx
    if (!ctx || !this.sfxBus || !this.noiseBuffer) return
    const now = ctx.currentTime
    const noise = ctx.createBufferSource()
    noise.buffer = this.noiseBuffer
    noise.playbackRate.value = 2.4
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 4200
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(level * 0.5, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5)
    noise.connect(hp).connect(gain).connect(this.sfxBus)
    noise.start(now + 0.02)
    noise.stop(now + 0.6)
  }

  /** Short UI blip. `pitch` shifts it for confirm vs cancel. */
  playUi(pitch = 1): void {
    const ctx = this.ctx
    if (!ctx || !this.sfxBus) return
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(520 * pitch, now)
    osc.frequency.exponentialRampToValueAtTime(760 * pitch, now + 0.08)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.12, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
    osc.connect(gain).connect(this.sfxBus)
    osc.start(now)
    osc.stop(now + 0.2)
  }

  /** Whoosh for gadget deployment. */
  playGadget(): void {
    const ctx = this.ctx
    if (!ctx || !this.sfxBus || !this.noiseBuffer) return
    const now = ctx.currentTime
    const noise = ctx.createBufferSource()
    noise.buffer = this.noiseBuffer
    noise.playbackRate.value = 1.6
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(400, now)
    filter.frequency.exponentialRampToValueAtTime(2600, now + 0.3)
    filter.Q.value = 3
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.3, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45)
    noise.connect(filter).connect(gain).connect(this.sfxBus)
    noise.start(now)
    noise.stop(now + 0.5)
  }

  /** Rising arpeggio for rewards. */
  playReward(): void {
    const ctx = this.ctx
    if (!ctx || !this.sfxBus) return
    const now = ctx.currentTime
    const notes = [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = freq
      const gain = ctx.createGain()
      const start = now + i * 0.07
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3)
      osc.connect(gain).connect(this.sfxBus!)
      osc.start(start)
      osc.stop(start + 0.35)
    })
  }

  dispose(): void {
    this.stopEngine()
    for (const loop of [this.skid, this.wind]) {
      if (!loop) continue
      try {
        loop.source.stop()
      } catch {
        // Already stopped.
      }
      loop.source.disconnect()
    }
    this.skid = null
    this.wind = null
    void this.ctx?.close()
    this.ctx = null
  }
}
