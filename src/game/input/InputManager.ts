export interface DriveInput {
  /** -1..1, positive = accelerate. */
  throttle: number
  /** 0..1 */
  brake: number
  /** -1..1, positive = left. */
  steer: number
  handbrake: boolean
  boost: boolean
  /** Edge-triggered: true for exactly one frame. */
  recover: boolean
  gadget: boolean
  lookBack: boolean
  resetCamera: boolean
}

const EMPTY: DriveInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  boost: false,
  recover: false,
  gadget: false,
  lookBack: false,
  resetCamera: false,
}

/** Keys we own; prevents the page scrolling out from under the game. */
const CAPTURED = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyQ', 'KeyC', 'KeyV',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft',
])

/**
 * Keyboard + gamepad input. Analogue steering is smoothed here rather than in the
 * vehicle so gamepad sticks and keyboard taps feed the same shape of signal.
 */
export class InputManager {
  private keys = new Set<string>()
  private steerAxis = 0
  private edge = { recover: false, gadget: false, resetCamera: false }
  /** Gamepad button edge tracking: pads report level, we want the press. */
  private consumed = { recover: false, gadget: false }
  private enabled = true
  private gamepadIndex: number | null = null
  readonly state: DriveInput = { ...EMPTY }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return
    if (CAPTURED.has(e.code)) e.preventDefault()
    if (!this.enabled) return
    this.keys.add(e.code)
    if (e.code === 'KeyR') this.edge.recover = true
    if (e.code === 'KeyQ') this.edge.gadget = true
    if (e.code === 'KeyC') this.edge.resetCamera = true
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code)
  }

  private readonly onBlur = (): void => {
    this.keys.clear()
  }

  private readonly onGamepadConnected = (e: GamepadEvent): void => {
    this.gamepadIndex = e.gamepad.index
  }

  private readonly onGamepadDisconnected = (e: GamepadEvent): void => {
    if (this.gamepadIndex === e.gamepad.index) this.gamepadIndex = null
  }

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    window.addEventListener('gamepadconnected', this.onGamepadConnected)
    window.addEventListener('gamepaddisconnected', this.onGamepadDisconnected)
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    window.removeEventListener('gamepadconnected', this.onGamepadConnected)
    window.removeEventListener('gamepaddisconnected', this.onGamepadDisconnected)
    this.keys.clear()
  }

  /** Disabled while a menu is open so WASD does not drive the car behind the UI. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) {
      this.keys.clear()
      this.steerAxis = 0
      Object.assign(this.state, EMPTY)
    }
  }

  private held(...codes: string[]): boolean {
    for (const c of codes) if (this.keys.has(c)) return true
    return false
  }

  /** Call once per rendered frame, before physics. */
  sample(dt: number): DriveInput {
    const s = this.state
    if (!this.enabled) {
      Object.assign(s, EMPTY)
      return s
    }

    const pad = this.pollGamepad()

    let steerTarget = 0
    if (this.held('KeyA', 'ArrowLeft')) steerTarget += 1
    if (this.held('KeyD', 'ArrowRight')) steerTarget -= 1
    if (pad && Math.abs(pad.steer) > 0.08) steerTarget = -pad.steer

    // Digital keys ramp in; analogue sticks pass through nearly untouched.
    const rate = Math.abs(steerTarget) > 0.999 || steerTarget === 0 ? 7.5 : 24
    this.steerAxis += (steerTarget - this.steerAxis) * Math.min(1, rate * dt)
    if (Math.abs(this.steerAxis) < 0.002) this.steerAxis = 0
    s.steer = this.steerAxis

    const keyThrottle = this.held('KeyW', 'ArrowUp') ? 1 : 0
    const keyBrake = this.held('KeyS', 'ArrowDown') ? 1 : 0
    s.throttle = Math.max(keyThrottle, pad?.throttle ?? 0)
    s.brake = Math.max(keyBrake, pad?.brake ?? 0)
    s.handbrake = this.held('Space') || (pad?.handbrake ?? false)
    s.boost = this.held('ShiftLeft') || (pad?.boost ?? false)
    s.lookBack = this.held('KeyV') || (pad?.lookBack ?? false)

    s.recover = this.takeEdge('recover') || (pad?.recover ?? false)
    s.gadget = this.takeEdge('gadget') || (pad?.gadget ?? false)
    s.resetCamera = this.takeEdge('resetCamera')
    return s
  }

  private takeEdge(key: keyof typeof this.edge): boolean {
    if (!this.edge[key]) return false
    this.edge[key] = false
    return true
  }

  private pollGamepad(): {
    steer: number
    throttle: number
    brake: number
    handbrake: boolean
    boost: boolean
    recover: boolean
    gadget: boolean
    lookBack: boolean
  } | null {
    if (typeof navigator.getGamepads !== 'function') return null
    const pads = navigator.getGamepads()
    const pad = this.gamepadIndex !== null ? pads[this.gamepadIndex] : pads.find((p) => p?.connected)
    if (!pad) return null

    const deadzone = (v: number): number => (Math.abs(v) < 0.12 ? 0 : v)
    // Standard mapping: RT = button 7, LT = button 6, A = 0, B = 1, X = 2, LB = 4.
    const button = (i: number): number => pad.buttons[i]?.value ?? 0
    const pressed = (i: number): boolean => pad.buttons[i]?.pressed ?? false

    const recover = pressed(1) && !this.consumed.recover
    this.consumed.recover = pressed(1)
    const gadget = pressed(2) && !this.consumed.gadget
    this.consumed.gadget = pressed(2)

    return {
      steer: deadzone(pad.axes[0] ?? 0),
      throttle: button(7),
      brake: button(6),
      handbrake: pressed(0),
      boost: pressed(4) || pressed(5),
      recover,
      gadget,
      lookBack: pressed(3),
    }
  }
}
