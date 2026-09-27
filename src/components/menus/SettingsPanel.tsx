import { useGameStore } from '@/store/gameStore'
import '@/styles/menus.css'

interface SettingsPanelProps {
  onClose: () => void
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const settings = useGameStore((s) => s.settings)
  const patch = useGameStore((s) => s.patchSettings)

  return (
    <div className="overlay">
      <div className="overlay__panel" style={{ maxWidth: 460 }}>
        <div className="overlay__header">
          <h2 className="overlay__title">Settings</h2>
          <button className="btn btn--sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="stack">
          <div className="field">
            <label htmlFor="volume">Volume — {Math.round(settings.volume * 100)}%</label>
            <input
              id="volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.volume}
              onChange={(e) => patch({ volume: Number(e.target.value) })}
            />
          </div>

          <div className="field">
            <label htmlFor="shake">Camera shake — {Math.round(settings.cameraShake * 100)}%</label>
            <input
              id="shake"
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={settings.cameraShake}
              onChange={(e) => patch({ cameraShake: Number(e.target.value) })}
            />
          </div>

          <div className="field">
            <label htmlFor="distance">Camera distance — {settings.cameraDistance.toFixed(1)} m</label>
            <input
              id="distance"
              type="range"
              min={5}
              max={13}
              step={0.2}
              value={settings.cameraDistance}
              onChange={(e) => patch({ cameraDistance: Number(e.target.value) })}
            />
          </div>

          <div className="option">
            <div>
              <div className="option__name">Mute audio</div>
              <div className="option__desc">Engine, tires and impacts</div>
            </div>
            <button className="btn btn--sm" onClick={() => patch({ muted: !settings.muted })}>
              {settings.muted ? 'Unmute' : 'Mute'}
            </button>
          </div>

          <div className="option">
            <div>
              <div className="option__name">Visual effects</div>
              <div className="option__desc">Bloom and edge smoothing. Turn off if the frame rate drops.</div>
            </div>
            <button
              className="btn btn--sm"
              onClick={() => patch({ postProcessing: !settings.postProcessing })}
            >
              {settings.postProcessing ? 'On' : 'Off'}
            </button>
          </div>

          <div className="option">
            <div>
              <div className="option__name">Traffic</div>
              <div className="option__desc">Cars going about their day, for you to get in the way of.</div>
            </div>
            <button className="btn btn--sm" onClick={() => patch({ traffic: !settings.traffic })}>
              {settings.traffic ? 'On' : 'Off'}
            </button>
          </div>

          <div className="option">
            <div>
              <div className="option__name">Show performance</div>
              <div className="option__desc">Frame rate and live particle count</div>
            </div>
            <button className="btn btn--sm" onClick={() => patch({ showFps: !settings.showFps })}>
              {settings.showFps ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
