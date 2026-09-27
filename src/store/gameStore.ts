import { create } from 'zustand'
import type { PlayerStats } from '@/types'
import type { PlayerSave } from '@/lib/persistence/types'
import type { HudSnapshot } from '@/game/core/Engine'
import type { NetStatus } from '@/lib/networking/types'

export type Phase = 'boot' | 'auth' | 'menu' | 'loading' | 'playing'
export type Overlay = null | 'garage' | 'challenges' | 'session' | 'settings' | 'pause' | 'results'

export interface Notification {
  id: number
  text: string
  tone: 'info' | 'success' | 'warn' | 'reward'
  expiresAt: number
}

export interface ResultsPayload {
  title: string
  success: boolean
  lines: Array<{ label: string; value: string }>
  reward: number
}

export interface SessionInfo {
  code: string | null
  status: NetStatus
  transportLabel: string
  transportRemote: boolean
  transportNote?: string
  playerCount: number
}

export interface Settings {
  volume: number
  muted: boolean
  cameraShake: number
  showFps: boolean
  cameraDistance: number
  /** Bloom and multisampling. The first thing to turn off on a slow machine. */
  postProcessing: boolean
  /** AI traffic. Off gives an empty city, and a few frames back. */
  traffic: boolean
}

interface GameState {
  phase: Phase
  overlay: Overlay
  save: PlayerSave | null
  hud: HudSnapshot | null
  notifications: Notification[]
  results: ResultsPayload | null
  session: SessionInfo
  settings: Settings
  error: string | null
  busy: boolean

  setPhase: (phase: Phase) => void
  setOverlay: (overlay: Overlay) => void
  setSave: (save: PlayerSave) => void
  setHud: (hud: HudSnapshot) => void
  pushNotification: (text: string, tone: Notification['tone'], ttl?: number) => void
  expireNotifications: (now: number) => void
  setResults: (results: ResultsPayload | null) => void
  patchSession: (patch: Partial<SessionInfo>) => void
  patchSettings: (patch: Partial<Settings>) => void
  setError: (error: string | null) => void
  setBusy: (busy: boolean) => void
  patchStats: (delta: Partial<PlayerStats>) => void
}

const SETTINGS_KEY = 'crashout.settings.v1'

function loadSettings(): Settings {
  const fallback: Settings = {
    volume: 0.6,
    muted: false,
    cameraShake: 1,
    showFps: false,
    cameraDistance: 7.4,
    postProcessing: true,
    traffic: true,
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<Settings>) } : fallback
  } catch {
    return fallback
  }
}

let notificationId = 0

export const useGameStore = create<GameState>((set, get) => ({
  phase: 'boot',
  overlay: null,
  save: null,
  hud: null,
  notifications: [],
  results: null,
  session: {
    code: null,
    status: 'idle',
    transportLabel: '',
    transportRemote: false,
    playerCount: 1,
  },
  settings: loadSettings(),
  error: null,
  busy: false,

  setPhase: (phase) => set({ phase }),
  setOverlay: (overlay) => set({ overlay }),
  setSave: (save) => set({ save }),
  setHud: (hud) =>
    set((state) => ({
      hud,
      session: state.session.playerCount === hud.playerCount && state.session.status === hud.netStatus
        ? state.session
        : { ...state.session, playerCount: hud.playerCount, status: hud.netStatus },
    })),

  pushNotification: (text, tone, ttl = 3) =>
    set((state) => ({
      notifications: [
        // Cap the stack so a pileup of events cannot bury the HUD.
        ...state.notifications.slice(-4),
        { id: notificationId++, text, tone, expiresAt: performance.now() / 1000 + ttl },
      ],
    })),

  expireNotifications: (now) => {
    const remaining = get().notifications.filter((n) => n.expiresAt > now)
    if (remaining.length !== get().notifications.length) set({ notifications: remaining })
  },

  setResults: (results) => set({ results }),
  patchSession: (patch) => set((state) => ({ session: { ...state.session, ...patch } })),
  patchSettings: (patch) =>
    set((state) => {
      const settings = { ...state.settings, ...patch }
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
      } catch {
        // Not fatal — settings just will not persist.
      }
      return { settings }
    }),
  setError: (error) => set({ error }),
  setBusy: (busy) => set({ busy }),
  patchStats: (delta) =>
    set((state) => {
      if (!state.save) return {}
      return { save: { ...state.save, stats: { ...state.save.stats, ...delta } } }
    }),
}))
