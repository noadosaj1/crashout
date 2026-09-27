import { ACTIVITY_LIST } from '@/config/activities'
import type { ActivityKind } from '@/types'
import '@/styles/menus.css'

interface ChallengesPanelProps {
  onStart: (activityId: string) => void
  onClose: () => void
  activeActivityId: string | null
  onCancel: () => void
  playerPosition: [number, number, number]
}

const KIND_LABEL: Record<ActivityKind, string> = {
  delivery: 'Delivery',
  race: 'Race',
  time_trial: 'Time Trial',
  crash_challenge: 'Crash Challenge',
}

export function ChallengesPanel({
  onStart,
  onClose,
  activeActivityId,
  onCancel,
  playerPosition,
}: ChallengesPanelProps) {
  // Nearest first. The list is long enough now that config order is no order at
  // all, and what you want is whatever you could drive to next.
  const byDistance = ACTIVITY_LIST.map((activity) => {
    const first = activity.waypoints[0]
    return {
      activity,
      distance: Math.hypot(first[0] - playerPosition[0], first[2] - playerPosition[2]),
    }
  }).sort((a, b) => a.distance - b.distance)

  return (
    <div className="overlay">
      <div className="overlay__panel" style={{ maxWidth: 700 }}>
        <div className="overlay__header">
          <h2 className="overlay__title">Challenges</h2>
          <button className="btn btn--sm" onClick={onClose}>
            Close
          </button>
        </div>

        {activeActivityId && (
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="row row--between">
              <span>A challenge is already running.</span>
              <button className="btn btn--danger btn--sm" onClick={onCancel}>
                Abandon
              </button>
            </div>
          </div>
        )}

        <div className="option-list">
          {byDistance.map(({ activity, distance }) => {
            return (
              <div className="option" key={activity.id}>
                <div>
                  <div className="option__name">
                    {activity.name}{' '}
                    <span className="tag" style={{ marginLeft: 6 }}>
                      {KIND_LABEL[activity.kind]}
                    </span>
                  </div>
                  <div className="option__desc">{activity.description}</div>
                  <div className="option__desc">
                    {activity.baseReward.toLocaleString()} ¢ base · {activity.timeLimit}s limit ·{' '}
                    {Math.round(distance)} m away
                  </div>
                </div>
                <button
                  className="btn btn--sm"
                  disabled={activeActivityId !== null}
                  onClick={() => onStart(activity.id)}
                >
                  Start
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
