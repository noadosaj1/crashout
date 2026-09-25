import { useState } from 'react'
import { normalizeSessionCode } from '@/lib/networking/createTransport'
import { useGameStore } from '@/store/gameStore'
import '@/styles/menus.css'

interface SessionPanelProps {
  onHost: () => Promise<void>
  onJoin: (code: string) => Promise<void>
  onLeave: () => Promise<void>
  onClose: () => void
}

export function SessionPanel({ onHost, onJoin, onLeave, onClose }: SessionPanelProps) {
  const session = useGameStore((s) => s.session)
  const busy = useGameStore((s) => s.busy)
  const error = useGameStore((s) => s.error)
  const hud = useGameStore((s) => s.hud)
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)

  async function copyCode(): Promise<void> {
    if (!session.code) return
    try {
      await navigator.clipboard.writeText(session.code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard permissions denied — the code is on screen anyway.
    }
  }

  const connected = session.status === 'connected' && session.code

  return (
    <div className="overlay">
      <div className="overlay__panel" style={{ maxWidth: 560 }}>
        <div className="overlay__header">
          <h2 className="overlay__title">Play with friends</h2>
          <button className="btn btn--sm" onClick={onClose}>
            Close
          </button>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="card" style={{ marginBottom: 14 }}>
          <div className="row row--between">
            <span className="card__title" style={{ margin: 0 }}>
              {session.transportLabel || 'Networking'}
            </span>
            <span className={`tag ${session.transportRemote ? 'tag--on' : 'tag--warn'}`}>
              {session.transportRemote ? 'Internet' : 'Local only'}
            </span>
          </div>
          {session.transportNote && (
            <p className="card__subtitle" style={{ margin: '10px 0 0' }}>
              {session.transportNote}
            </p>
          )}
        </div>

        {connected ? (
          <div className="card">
            <h3 className="card__title">You are in a world</h3>
            <p className="card__subtitle">Share this code. Up to 8 drivers.</p>
            <div className="code-display">{session.code}</div>
            <div className="stack">
              <button className="btn btn--block" onClick={() => void copyCode()}>
                {copied ? 'Copied' : 'Copy join code'}
              </button>
              <div className="row row--between">
                <span className="muted">{hud?.playerCount ?? 1} driver(s) connected</span>
                <button className="btn btn--danger btn--sm" disabled={busy} onClick={() => void onLeave()}>
                  Leave world
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="card">
              <h3 className="card__title">Create a world</h3>
              <p className="card__subtitle">
                You get a six-character code. Anyone with the code lands in the same city as you.
              </p>
              <button className="btn btn--primary btn--block" disabled={busy} onClick={() => void onHost()}>
                {busy ? 'Opening…' : 'Create world'}
              </button>
            </div>

            <div className="card">
              <h3 className="card__title">Join a world</h3>
              <p className="card__subtitle">Enter a friend's code.</p>
              <div className="row">
                <input
                  className="grow"
                  value={code}
                  placeholder="X7K2QP"
                  maxLength={6}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 9,
                    border: '1px solid var(--border)',
                    background: 'rgba(8, 11, 16, 0.8)',
                    color: 'var(--text)',
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase',
                  }}
                  onChange={(e) => setCode(normalizeSessionCode(e.target.value))}
                />
                <button
                  className="btn"
                  disabled={busy || code.length !== 6}
                  onClick={() => void onJoin(code)}
                >
                  Join
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
