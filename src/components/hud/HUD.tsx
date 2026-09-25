import { memo, useEffect, useMemo } from 'react'
import { GADGETS } from '@/config/gadgets'
import { useGameStore } from '@/store/gameStore'
import { Minimap } from './Minimap'
import '@/styles/hud.css'

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds)
  const m = Math.floor(s / 60)
  const rest = Math.floor(s % 60)
  return `${m}:${rest.toString().padStart(2, '0')}`
}

function damageColor(value: number): string {
  if (value < 0.35) return '#52e08a'
  if (value < 0.7) return '#ffb03a'
  return '#ff5a46'
}

function HUDImpl() {
  const hud = useGameStore((s) => s.hud)
  const save = useGameStore((s) => s.save)
  const session = useGameStore((s) => s.session)
  const notifications = useGameStore((s) => s.notifications)
  const expireNotifications = useGameStore((s) => s.expireNotifications)
  const showFps = useGameStore((s) => s.settings.showFps)

  // Notifications expire on a timer rather than per-frame, so the HUD does not
  // re-render just to count down.
  useEffect(() => {
    if (notifications.length === 0) return
    const id = window.setInterval(() => expireNotifications(performance.now() / 1000), 250)
    return () => window.clearInterval(id)
  }, [notifications.length, expireNotifications])

  // The engine mutates the target vector in place, so key the memo on the
  // coordinates rather than the object identity.
  const targetX = hud?.activity?.target.x ?? null
  const targetZ = hud?.activity?.target.z ?? null
  const activityTarget = useMemo(
    () => (targetX === null || targetZ === null ? null : { x: targetX, z: targetZ }),
    [targetX, targetZ],
  )

  if (!hud || !save) return null

  const gadgetSpec = hud.gadgetId ? GADGETS[hud.gadgetId] : null
  const activity = hud.activity
  const urgent = activity ? activity.timeRemaining < 15 : false

  return (
    <div className="hud">
      {hud.smokeBlind > 0.02 && (
        <div className="hud__smoke" style={{ opacity: Math.min(0.92, hud.smokeBlind) }} />
      )}

      <div className="hud__top">
        <div className="hud__wallet">
          <span className="hud__wallet-credits">{save.profile.credits.toLocaleString()} ¢</span>
          <span className="hud__wallet-level">LV {save.profile.level}</span>
        </div>

        <div className="hud__session">
          {session.code ? (
            <>
              <span className="muted">WORLD</span>
              <span className="hud__session-code">{session.code}</span>
              <span className={`tag ${session.status === 'connected' ? 'tag--on' : 'tag--warn'}`}>
                {session.status === 'connected' ? `${hud.playerCount} online` : session.status}
              </span>
            </>
          ) : (
            <span className="muted">Solo session — press Esc to invite friends</span>
          )}
        </div>
      </div>

      {showFps && (
        <div className="hud__debug">
          {hud.fps.toFixed(0)} FPS · {hud.particleCount} particles
        </div>
      )}

      <div className="hud__hints">
        <div>
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> drive
        </div>
        <div>
          <kbd>Space</kbd> handbrake · <kbd>Shift</kbd> boost
        </div>
        <div>
          <kbd>R</kbd> recover · <kbd>Q</kbd> gadget · <kbd>Esc</kbd> menu
        </div>
      </div>

      {hud.remotePlayers.length > 0 && (
        <div className="hud__players">
          <div className="hud__players-title">Nearby</div>
          {hud.remotePlayers.slice(0, 7).map((p) => (
            <div className="hud__player-row" key={p.playerId}>
              <span>{p.username}</span>
              <span>{p.distance < 1000 ? `${Math.round(p.distance)}m` : '—'}</span>
            </div>
          ))}
        </div>
      )}

      {activity && (
        <div className={`hud__activity ${urgent ? 'hud__activity--urgent' : ''}`}>
          <div className="hud__activity-name">{activity.name}</div>
          <div className="hud__activity-row">
            <span>{formatTime(activity.timeRemaining)}</span>
            {activity.kind === 'crash_challenge' ? (
              <span>{Math.round(activity.score).toLocaleString()} pts</span>
            ) : (
              <span>
                {activity.checkpoint}/{activity.totalCheckpoints}
              </span>
            )}
          </div>
          <div className="hud__activity-sub">
            {activity.kind === 'crash_challenge'
              ? 'Wreck everything'
              : `${Math.round(activity.distance)} m to checkpoint`}
          </div>
        </div>
      )}

      {hud.airtime > 0.6 && <div className="hud__airtime">AIR {hud.airtime.toFixed(1)}s</div>}

      <div className="hud__notifications">
        {notifications.map((note) => (
          <div className={`hud__note hud__note--${note.tone}`} key={note.id}>
            {note.text}
          </div>
        ))}
      </div>

      <div className="hud__bottom-left">
        <div className="hud__gauge">
          <div className="hud__speed">
            <span className="hud__speed-value">{Math.round(hud.speedKmh)}</span>
            <span className="hud__speed-unit">KM/H</span>
          </div>

          <div className="hud__bar">
            <div className="hud__bar-label">
              <span>Damage</span>
              <span>{Math.round(hud.damage * 100)}%</span>
            </div>
            <div className="hud__bar-track">
              <div
                className="hud__bar-fill"
                style={{ width: `${hud.damage * 100}%`, backgroundColor: damageColor(hud.damage) }}
              />
            </div>
          </div>

          {hud.boost > 0 && (
            <div className="hud__bar">
              <div className="hud__bar-label">
                <span>Boost</span>
                <span>{Math.round(hud.boost * 100)}%</span>
              </div>
              <div className="hud__bar-track">
                <div
                  className="hud__bar-fill"
                  style={{ width: `${hud.boost * 100}%`, backgroundColor: '#3fd8ff' }}
                />
              </div>
            </div>
          )}
        </div>

        {gadgetSpec && (
          <div className={`hud__gadget ${hud.gadgetReady ? 'hud__gadget--ready' : ''}`}>
            <span className="hud__gadget-key">Q</span>
            <div>
              <div className="hud__gadget-name">{gadgetSpec.name}</div>
              <div className="hud__gadget-status">
                {hud.gadgetReady ? 'Ready' : `${hud.gadgetCooldown.toFixed(1)}s`}
              </div>
            </div>
          </div>
        )}
      </div>

      <Minimap
        position={hud.position}
        heading={hud.heading}
        remotePlayers={hud.remotePlayers}
        target={activityTarget}
      />

      {!hud.canRecover && hud.recoverCooldown > 0 ? (
        <div className="hud__recover muted">
          <kbd>R</kbd> Recover available in {hud.recoverCooldown.toFixed(1)}s
        </div>
      ) : (
        (hud.damage > 0.5 || !hud.grounded) && (
          <div className="hud__recover">
            <kbd>R</kbd> Recover vehicle
          </div>
        )
      )}
    </div>
  )
}

export const HUD = memo(HUDImpl)
