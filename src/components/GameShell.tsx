import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GadgetId, VehicleCustomization } from '@/types'
import type { UpgradeKey } from '@/config/upgrades'
import { ACTIVITIES } from '@/config/activities'
import { Engine, type HudSnapshot } from '@/game/core/Engine'
import { gameEvents } from '@/game/core/GameEvents'
import type { ActivityResult } from '@/game/missions/ActivitySystem'
import { createTransport, generateSessionCode } from '@/lib/networking/createTransport'
import { getClientId } from '@/lib/networking/clientId'
import {
  findOpenSession,
  joinSessionRecord,
  leaveSessionRecord,
  registerHostedSession,
  type SessionRecord,
} from '@/lib/supabase/sessions'
import type { NetworkTransport } from '@/lib/networking/types'
import type { PersistenceAdapter, PlayerSave } from '@/lib/persistence/types'
import { useGameStore } from '@/store/gameStore'
import { HUD } from './hud/HUD'
import { Garage } from './garage/Garage'
import { SessionPanel } from './multiplayer/SessionPanel'
import { ChatBar } from './multiplayer/ChatBar'
import { ChallengesPanel } from './menus/ChallengesPanel'
import { PauseMenu } from './menus/PauseMenu'
import { SettingsPanel } from './menus/SettingsPanel'
import { ResultsPanel } from './menus/ResultsPanel'
import '@/styles/menus.css'

interface GameShellProps {
  adapter: PersistenceAdapter
  initialSave: PlayerSave
  onQuit: () => void
}

/**
 * Bridges the imperative engine and React. The engine is created once and kept
 * in a ref — it is never React state, so no gameplay value ever triggers a
 * render. The HUD is fed a snapshot at 12 Hz.
 */
export function GameShell({ adapter, initialSave, onQuit }: GameShellProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const transportRef = useRef<NetworkTransport | null>(null)
  /** The `sessions` row for the current world, when Supabase is configured. */
  const sessionRecordRef = useRef<SessionRecord | null>(null)
  const isHostRef = useRef(false)
  const [ready, setReady] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)

  const save = useGameStore((s) => s.save)
  const overlay = useGameStore((s) => s.overlay)
  const session = useGameStore((s) => s.session)
  const settings = useGameStore((s) => s.settings)
  const setOverlay = useGameStore((s) => s.setOverlay)
  const setSave = useGameStore((s) => s.setSave)
  const setHud = useGameStore((s) => s.setHud)
  const setError = useGameStore((s) => s.setError)
  const setBusy = useGameStore((s) => s.setBusy)
  const setResults = useGameStore((s) => s.setResults)
  const patchSession = useGameStore((s) => s.patchSession)
  const pushNotification = useGameStore((s) => s.pushNotification)
  const patchStats = useGameStore((s) => s.patchStats)

  const saveRef = useRef(initialSave)
  useEffect(() => {
    if (save) saveRef.current = save
  }, [save])

  // --- Engine lifecycle ----------------------------------------------------
  useEffect(() => {
    let cancelled = false
    const canvas = canvasRef.current
    if (!canvas) return

    void (async () => {
      try {
        const engine = await Engine.create(canvas)
        if (cancelled) {
          engine.dispose()
          return
        }
        engineRef.current = engine

        engine.setCallbacks({
          onHud: (snapshot: HudSnapshot) => setHud(snapshot),
          onActivityFinished: (result) => void handleActivityFinished(result),
          onStatsDelta: (delta) => {
            const current = saveRef.current.stats
            const next = {
              distanceDriven: current.distanceDriven + delta.distance,
              crashes: current.crashes + delta.crashes,
              biggestCrash: Math.max(current.biggestCrash, delta.biggestCrash),
            }
            patchStats(next)
            saveRef.current = { ...saveRef.current, stats: { ...current, ...next } }
          },
        })

        engine.setSpawnSlotFor(getClientId())
        const activeId = initialSave.profile.activeVehicleId
        const owned = initialSave.vehicles.find((v) => v.id === activeId) ?? initialSave.vehicles[0]
        engine.spawnLocalVehicle(owned)
        engine.setOwnedGadgets(initialSave.gadgets)

        const transport = createTransport()
        transportRef.current = transport
        patchSession({
          transportLabel: transport.info.label,
          transportRemote: transport.info.remote,
          transportNote: transport.info.note,
        })

        engine.start()
        if (import.meta.env.DEV) {
          ;(window as unknown as { __CRASHOUT__?: unknown }).__CRASHOUT__ = engine
        }
        setReady(true)
      } catch (err) {
        if (!cancelled) setBootError(err instanceof Error ? err.message : 'Failed to start the game')
      }
    })()

    return () => {
      cancelled = true
      engineRef.current?.dispose()
      engineRef.current = null
    }
    // Deliberately runs once: the engine owns its own lifecycle from here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Settings → engine ---------------------------------------------------
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.audio.setVolume(settings.volume)
    engine.audio.setMuted(settings.muted || overlay !== null)
    engine.camera.settings.shakeScale = settings.cameraShake
    engine.camera.settings.distance = settings.cameraDistance
  }, [settings, overlay, ready])

  // --- Overlay ↔ pause -----------------------------------------------------
  useEffect(() => {
    engineRef.current?.setPaused(overlay !== null)
  }, [overlay, ready])

  // --- Global keys ---------------------------------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.code === 'Escape') {
        event.preventDefault()
        setOverlay(useGameStore.getState().overlay === null ? 'pause' : null)
      }
      if (event.code === 'KeyG' && useGameStore.getState().overlay === null) {
        setOverlay('garage')
      }
      if (event.code === 'Tab' && useGameStore.getState().overlay === null) {
        event.preventDefault()
        setOverlay('challenges')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOverlay])

  // --- Engine events → notifications ---------------------------------------
  useEffect(() => {
    const offNotify = gameEvents.on('notify', (event) => {
      pushNotification(event.text, event.tone, event.ttl)
    })
    const offCrash = gameEvents.on('crash', (event) => {
      if (event.local && event.severity > 0.55) {
        pushNotification(event.vehicleToVehicle ? 'BIG HIT!' : 'CRUNCH!', 'warn', 1.2)
      }
    })
    return () => {
      offNotify()
      offCrash()
    }
  }, [pushNotification])

  // Audio needs a user gesture before it will make a sound.
  useEffect(() => {
    const unlock = (): void => void engineRef.current?.audio.resume()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  // --- Persistence actions -------------------------------------------------

  const applySave = useCallback(
    (next: PlayerSave) => {
      saveRef.current = next
      setSave(next)
      engineRef.current?.setOwnedGadgets(next.gadgets)
    },
    [setSave],
  )

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true)
      setError(null)
      try {
        await fn()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      } finally {
        setBusy(false)
      }
    },
    [setBusy, setError],
  )

  const respawnActiveVehicle = useCallback(
    (next: PlayerSave) => {
      const engine = engineRef.current
      if (!engine) return
      const owned = next.vehicles.find((v) => v.id === next.profile.activeVehicleId)
      if (owned) engine.spawnLocalVehicle(owned)
    },
    [],
  )

  const handleActivityFinished = useCallback(
    async (result: ActivityResult) => {
      const engine = engineRef.current
      const spec = ACTIVITIES[result.activityId]
      let awarded = 0
      try {
        const outcome = result.success
          ? await adapter.awardActivity({
              activityId: result.activityId,
              elapsedSeconds: result.elapsed,
              damage: result.damage,
              score: result.score,
            })
          : { awarded: 0, credits: saveRef.current.profile.credits }
        awarded = outcome.awarded
        const next = await adapter.load()
        applySave(next)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not claim reward')
      }

      if (awarded > 0) engine?.audio.playReward()

      const lines = [
        { label: 'Time', value: `${result.elapsed.toFixed(1)}s / ${spec?.timeLimit ?? 0}s` },
        { label: 'Damage taken', value: `${Math.round(result.damage * 100)}%` },
      ]
      if (result.kind === 'crash_challenge') {
        lines.unshift({ label: 'Score', value: result.score.toLocaleString() })
      }

      setResults({ title: result.name, success: result.success, lines, reward: awarded })
      setOverlay('results')
    },
    [adapter, applySave, setError, setResults, setOverlay],
  )

  // --- Multiplayer ---------------------------------------------------------

  const hostSession = useCallback(async () => {
    await run(async () => {
      const engine = engineRef.current
      const transport = transportRef.current
      if (!engine || !transport) throw new Error('Game is still starting up')
      const code = generateSessionCode()
      await engine.connectMultiplayer(transport, code, {
        playerId: getClientId(),
        username: saveRef.current.profile.username,
      })
      // Best effort, and only when signed in: the world works either way.
      sessionRecordRef.current = await registerHostedSession(code, saveRef.current.profile.id)
      isHostRef.current = true
      patchSession({ code })
      pushNotification(`World ${code} is open`, 'success', 4)
    })
  }, [run, patchSession, pushNotification])

  const joinSession = useCallback(
    async (code: string) => {
      await run(async () => {
        const engine = engineRef.current
        const transport = transportRef.current
        if (!engine || !transport) throw new Error('Game is still starting up')

        // With a backend we can tell "nobody is hosting that" from "typo".
        // Without one the code is just a channel name, so we join optimistically.
        const record = transport.info.remote ? await findOpenSession(code) : null
        if (transport.info.remote && !record) {
          throw new Error(`No open world with the code ${code}`)
        }

        await engine.connectMultiplayer(transport, code, {
          playerId: getClientId(),
          username: saveRef.current.profile.username,
        })
        if (record) await joinSessionRecord(record.id, saveRef.current.profile.id)
        sessionRecordRef.current = record
        isHostRef.current = false
        patchSession({ code })
        pushNotification(`Joined world ${code}`, 'success', 4)
      })
    },
    [run, patchSession, pushNotification],
  )

  const leaveSession = useCallback(async () => {
    await run(async () => {
      await engineRef.current?.disconnectMultiplayer()
      await leaveSessionRecord(sessionRecordRef.current, saveRef.current.profile.id, isHostRef.current)
      sessionRecordRef.current = null
      isHostRef.current = false
      patchSession({ code: null, status: 'idle', playerCount: 1 })
    })
  }, [run, patchSession])

  // --- Garage actions ------------------------------------------------------

  const garageActions = useMemo(
    () => ({
      close: () => setOverlay(null),
      currentDamage: engineRef.current?.vehicle?.damageLevel ?? 0,
      equippedGadget: engineRef.current?.gadget ?? null,
      selectVehicle: (vehicleId: string) =>
        run(async () => {
          await adapter.setActiveVehicle(vehicleId)
          const next = await adapter.load()
          applySave(next)
          respawnActiveVehicle(next)
        }),
      buyVehicle: (specId: string) =>
        run(async () => {
          const { save: next } = await adapter.purchaseVehicle(specId)
          applySave(next)
          pushNotification('Vehicle purchased', 'reward', 3)
        }),
      buyUpgrade: (vehicleId: string, key: UpgradeKey) =>
        run(async () => {
          const next = await adapter.purchaseUpgrade(vehicleId, key)
          applySave(next)
          if (next.profile.activeVehicleId === vehicleId) respawnActiveVehicle(next)
        }),
      buyCustomization: (vehicleId: string, kind: keyof VehicleCustomization, optionId: string) =>
        run(async () => {
          const next = await adapter.purchaseCustomization(vehicleId, kind, optionId)
          applySave(next)
          if (next.profile.activeVehicleId === vehicleId) respawnActiveVehicle(next)
        }),
      buyGadget: (gadgetId: GadgetId) =>
        run(async () => {
          const next = await adapter.purchaseGadget(gadgetId)
          applySave(next)
          engineRef.current?.equipGadget(gadgetId)
        }),
      equipGadget: (gadgetId: GadgetId) => engineRef.current?.equipGadget(gadgetId),
      renameVehicle: (vehicleId: string, name: string) =>
        run(async () => {
          await adapter.renameVehicle(vehicleId, name)
          applySave(await adapter.load())
        }),
      repair: () =>
        run(async () => {
          const engine = engineRef.current
          const damage = engine?.vehicle?.damageLevel ?? 0
          const vehicleId = saveRef.current.profile.activeVehicleId
          if (!vehicleId) return
          const next = await adapter.repairVehicle(vehicleId, damage)
          applySave(next)
          engine?.repairLocalVehicle()
          pushNotification('Vehicle repaired', 'success', 2)
        }),
    }),
    [adapter, applySave, run, respawnActiveVehicle, setOverlay, pushNotification],
  )

  // --- Periodic stat flush -------------------------------------------------
  useEffect(() => {
    const id = window.setInterval(() => {
      void adapter.saveStats(saveRef.current.stats).catch(() => {
        // Stats are best-effort; a failed write must never interrupt play.
      })
    }, 20_000)
    return () => window.clearInterval(id)
  }, [adapter])

  const hud = useGameStore((s) => s.hud)

  return (
    <div className="app">
      <canvas ref={canvasRef} />

      {!ready && !bootError && (
        <div className="loading">
          <div>
            <div className="loading__text">Building the city…</div>
            <div className="loading__bar">
              <span />
            </div>
          </div>
        </div>
      )}

      {bootError && (
        <div className="loading">
          <div className="screen__inner">
            <div className="card">
              <h2 className="card__title">Could not start</h2>
              <p className="card__subtitle">{bootError}</p>
              <button className="btn btn--block" onClick={onQuit}>
                Back to menu
              </button>
            </div>
          </div>
        </div>
      )}

      {ready && overlay === null && <HUD />}
      {ready && overlay === null && (
        <ChatBar
          enabled={session.code !== null && session.status === 'connected'}
          onTypingChange={(typing) => engineRef.current?.input.setEnabled(!typing)}
          onSend={(text) => {
            engineRef.current?.network.sendChat(text)
            pushNotification(`${saveRef.current.profile.username}: ${text}`, 'info', 5)
          }}
        />
      )}

      {overlay === 'pause' && (
        <PauseMenu
          saveKind={adapter.kind}
          onResume={() => setOverlay(null)}
          onOpen={(next) => setOverlay(next)}
          onQuit={() => {
            void engineRef.current?.disconnectMultiplayer()
            onQuit()
          }}
        />
      )}
      {overlay === 'garage' && <Garage {...garageActions} />}
      {overlay === 'settings' && <SettingsPanel onClose={() => setOverlay('pause')} />}
      {overlay === 'session' && (
        <SessionPanel
          onHost={hostSession}
          onJoin={joinSession}
          onLeave={leaveSession}
          onClose={() => setOverlay('pause')}
        />
      )}
      {overlay === 'challenges' && (
        <ChallengesPanel
          activeActivityId={hud?.activity?.activityId ?? null}
          playerPosition={hud?.position ?? [0, 0, 0]}
          onCancel={() => engineRef.current?.cancelActivity()}
          onStart={(activityId) => {
            engineRef.current?.startActivity(activityId)
            setOverlay(null)
          }}
          onClose={() => setOverlay(null)}
        />
      )}
      {overlay === 'results' && <ResultsPanel onClose={() => setOverlay(null)} />}
    </div>
  )
}
