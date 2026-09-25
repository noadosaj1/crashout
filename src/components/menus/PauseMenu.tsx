import { useGameStore } from '@/store/gameStore'
import '@/styles/menus.css'

interface PauseMenuProps {
  onResume: () => void
  onOpen: (overlay: 'garage' | 'challenges' | 'session' | 'settings') => void
  onQuit: () => void
}

export function PauseMenu({ onResume, onOpen, onQuit }: PauseMenuProps) {
  const save = useGameStore((s) => s.save)
  const stats = save?.stats

  return (
    <div className="overlay">
      <div className="overlay__panel" style={{ maxWidth: 460 }}>
        <div className="overlay__header">
          <h2 className="overlay__title">Paused</h2>
          <span className="credits">{save?.profile.credits.toLocaleString() ?? 0} ¢</span>
        </div>

        <div className="stack">
          <button className="btn btn--primary btn--block" onClick={onResume}>
            Resume
          </button>
          <button className="btn btn--block" onClick={() => onOpen('garage')}>
            Garage
          </button>
          <button className="btn btn--block" onClick={() => onOpen('challenges')}>
            Challenges
          </button>
          <button className="btn btn--block" onClick={() => onOpen('session')}>
            Friends &amp; sessions
          </button>
          <button className="btn btn--block" onClick={() => onOpen('settings')}>
            Settings
          </button>
          <button className="btn btn--ghost btn--block" onClick={onQuit}>
            Back to main menu
          </button>
        </div>

        {stats && (
          <div className="stat-grid" style={{ marginBottom: 0 }}>
            <div className="stat">
              <div className="stat__label">Distance</div>
              <div className="stat__value">{(stats.distanceDriven / 1000).toFixed(1)} km</div>
            </div>
            <div className="stat">
              <div className="stat__label">Crashes</div>
              <div className="stat__value">{stats.crashes}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Deliveries</div>
              <div className="stat__value">{stats.deliveriesCompleted}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Earned</div>
              <div className="stat__value">{stats.creditsEarned.toLocaleString()} ¢</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
