import { useGameStore } from '@/store/gameStore'
import '@/styles/menus.css'

interface ResultsPanelProps {
  onClose: () => void
}

export function ResultsPanel({ onClose }: ResultsPanelProps) {
  const results = useGameStore((s) => s.results)
  if (!results) return null

  return (
    <div className="overlay">
      <div className="overlay__panel" style={{ maxWidth: 420 }}>
        <div className="overlay__header">
          <h2 className="overlay__title">{results.title}</h2>
          <span className={`tag ${results.success ? 'tag--on' : 'tag--warn'}`}>
            {results.success ? 'Complete' : 'Failed'}
          </span>
        </div>

        <div className="results__reward">
          {results.reward > 0 ? `+${results.reward.toLocaleString()} ¢` : 'No payout'}
        </div>

        <div className="results__lines">
          {results.lines.map((line) => (
            <div className="results__line" key={line.label}>
              <span className="muted">{line.label}</span>
              <span>{line.value}</span>
            </div>
          ))}
        </div>

        <button className="btn btn--primary btn--block" onClick={onClose}>
          Back to driving
        </button>
      </div>
    </div>
  )
}
