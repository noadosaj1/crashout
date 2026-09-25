import { useMemo, useState } from 'react'
import type { OwnedVehicle, VehicleCustomization } from '@/types'
import { VEHICLE_LIST, getVehicleSpec } from '@/config/vehicles'
import { ACCENTS, PAINTS, WHEELS } from '@/config/customization'
import { MAX_UPGRADE_LEVEL, UPGRADE_LIST, upgradeCost, upgradeMultiplier } from '@/config/upgrades'
import { GADGET_LIST } from '@/config/gadgets'
import { useGameStore } from '@/store/gameStore'
import '@/styles/menus.css'

type Tab = 'garage' | 'showroom' | 'customize' | 'upgrades' | 'gadgets'

export interface GarageActions {
  selectVehicle: (vehicleId: string) => Promise<void>
  buyVehicle: (specId: string) => Promise<void>
  buyUpgrade: (vehicleId: string, key: (typeof UPGRADE_LIST)[number]['key']) => Promise<void>
  buyCustomization: (
    vehicleId: string,
    kind: keyof VehicleCustomization,
    optionId: string,
  ) => Promise<void>
  buyGadget: (gadgetId: (typeof GADGET_LIST)[number]['id']) => Promise<void>
  equipGadget: (gadgetId: (typeof GADGET_LIST)[number]['id']) => void
  renameVehicle: (vehicleId: string, name: string) => Promise<void>
  repair: () => Promise<void>
  close: () => void
  currentDamage: number
  equippedGadget: string | null
}

function statBar(value: number, max: number): string {
  return `${Math.max(4, Math.min(100, (value / max) * 100))}%`
}

export function Garage(actions: GarageActions) {
  const save = useGameStore((s) => s.save)
  const busy = useGameStore((s) => s.busy)
  const error = useGameStore((s) => s.error)
  const [tab, setTab] = useState<Tab>('garage')
  const [selectedId, setSelectedId] = useState<string | null>(save?.profile.activeVehicleId ?? null)
  const [renaming, setRenaming] = useState('')

  const selected: OwnedVehicle | null = useMemo(() => {
    if (!save) return null
    return save.vehicles.find((v) => v.id === selectedId) ?? save.vehicles[0] ?? null
  }, [save, selectedId])

  if (!save || !selected) return null

  const spec = getVehicleSpec(selected.specId)
  const isActive = save.profile.activeVehicleId === selected.id
  const ownedSpecIds = new Set(save.vehicles.map((v) => v.specId))

  return (
    <div className="overlay">
      <div className="overlay__panel">
        <div className="overlay__header">
          <h2 className="overlay__title">Garage</h2>
          <div className="row">
            <span className="credits">{save.profile.credits.toLocaleString()} ¢</span>
            <button className="btn btn--sm" onClick={actions.close}>
              Close
            </button>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="tabs">
          {(['garage', 'showroom', 'customize', 'upgrades', 'gadgets'] as Tab[]).map((t) => (
            <button
              key={t}
              className={`tab ${tab === t ? 'tab--active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div className="garage">
          <div className="garage__list">
            {save.vehicles.map((vehicle) => {
              const vSpec = getVehicleSpec(vehicle.specId)
              return (
                <button
                  key={vehicle.id}
                  className={`vehicle-chip ${vehicle.id === selected.id ? 'vehicle-chip--active' : ''}`}
                  onClick={() => setSelectedId(vehicle.id)}
                >
                  <span className="vehicle-chip__name">{vehicle.nickname ?? vSpec.name}</span>
                  <span className="vehicle-chip__meta">
                    {vSpec.category}
                    {save.profile.activeVehicleId === vehicle.id ? ' · active' : ''}
                  </span>
                </button>
              )
            })}
          </div>

          <div>
            <div className="row row--between" style={{ marginBottom: 6 }}>
              <div>
                <h3 className="card__title">{selected.nickname ?? spec.name}</h3>
                <p className="card__subtitle" style={{ margin: 0 }}>
                  {/* The heading already shows the spec name unless it is renamed. */}
                  {selected.nickname ? `${spec.name} · ` : ''}
                  {spec.category} · {spec.drivetrain.toUpperCase()}
                </p>
              </div>
              {!isActive && (
                <button
                  className="btn btn--primary btn--sm"
                  disabled={busy}
                  onClick={() => void actions.selectVehicle(selected.id)}
                >
                  Drive this
                </button>
              )}
            </div>

            <div className="stat-grid">
              <div className="stat">
                <div className="stat__label">Top speed</div>
                <div className="stat__value">
                  {Math.round(spec.topSpeed * upgradeMultiplier('engine', selected.upgrades.engine) * 3.6)} km/h
                </div>
                <div className="stat__bar">
                  <span style={{ width: statBar(spec.topSpeed, 95) }} />
                </div>
              </div>
              <div className="stat">
                <div className="stat__label">Acceleration</div>
                <div className="stat__value">
                  {(spec.acceleration * upgradeMultiplier('acceleration', selected.upgrades.acceleration)).toFixed(1)}
                </div>
                <div className="stat__bar">
                  <span style={{ width: statBar(spec.acceleration, 24) }} />
                </div>
              </div>
              <div className="stat">
                <div className="stat__label">Grip</div>
                <div className="stat__value">
                  {(spec.grip * upgradeMultiplier('handling', selected.upgrades.handling)).toFixed(2)}
                </div>
                <div className="stat__bar">
                  <span style={{ width: statBar(spec.grip, 1.6) }} />
                </div>
              </div>
              <div className="stat">
                <div className="stat__label">Mass</div>
                <div className="stat__value">{spec.mass} kg</div>
                <div className="stat__bar">
                  <span style={{ width: statBar(spec.mass, 2400) }} />
                </div>
              </div>
              <div className="stat">
                <div className="stat__label">Crash resistance</div>
                <div className="stat__value">
                  {Math.round(spec.crashResistance * upgradeMultiplier('durability', selected.upgrades.durability) * 100)}
                </div>
                <div className="stat__bar">
                  <span style={{ width: statBar(spec.crashResistance, 1) }} />
                </div>
              </div>
              <div className="stat">
                <div className="stat__label">Braking</div>
                <div className="stat__value">
                  {(spec.braking * upgradeMultiplier('brakes', selected.upgrades.brakes)).toFixed(0)}
                </div>
                <div className="stat__bar">
                  <span style={{ width: statBar(spec.braking, 30) }} />
                </div>
              </div>
            </div>

            {tab === 'garage' && (
              <div className="stack">
                <div className="field">
                  <label htmlFor="nickname">Nickname</label>
                  <div className="row">
                    <input
                      id="nickname"
                      className="grow"
                      value={renaming}
                      placeholder={selected.nickname ?? spec.name}
                      maxLength={32}
                      onChange={(e) => setRenaming(e.target.value)}
                    />
                    <button
                      className="btn btn--sm"
                      disabled={busy || renaming.trim().length === 0}
                      onClick={() => {
                        void actions.renameVehicle(selected.id, renaming)
                        setRenaming('')
                      }}
                    >
                      Save
                    </button>
                  </div>
                </div>

                {isActive && (
                  <div className="option">
                    <div>
                      <div className="option__name">Repair</div>
                      <div className="option__desc">
                        Current damage {Math.round(actions.currentDamage * 100)}% ·{' '}
                        {Math.round(actions.currentDamage * 2500).toLocaleString()} ¢
                      </div>
                    </div>
                    <button
                      className="btn btn--sm"
                      disabled={busy || actions.currentDamage < 0.01}
                      onClick={() => void actions.repair()}
                    >
                      Repair
                    </button>
                  </div>
                )}
              </div>
            )}

            {tab === 'showroom' && (
              <div className="option-list">
                {VEHICLE_LIST.map((candidate) => {
                  const owned = ownedSpecIds.has(candidate.id)
                  const affordable = save.profile.credits >= candidate.price
                  return (
                    <div className="option" key={candidate.id}>
                      <div>
                        <div className="option__name">{candidate.name}</div>
                        <div className="option__desc">
                          {candidate.category} · {candidate.mass} kg ·{' '}
                          {Math.round(candidate.topSpeed * 3.6)} km/h
                        </div>
                      </div>
                      <button
                        className="btn btn--sm"
                        disabled={owned || busy || !affordable}
                        onClick={() => void actions.buyVehicle(candidate.id)}
                      >
                        {owned ? 'Owned' : `${candidate.price.toLocaleString()} ¢`}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {tab === 'customize' && (
              <div className="stack">
                <div>
                  <div className="stat__label" style={{ marginBottom: 8 }}>
                    Paint
                  </div>
                  <div className="swatches" style={{ marginBottom: 20 }}>
                    {PAINTS.map((paint) => (
                      <button
                        key={paint.id}
                        title={`${paint.name} — ${paint.price.toLocaleString()} ¢`}
                        className={`swatch ${selected.customization.paint === paint.id ? 'swatch--active' : ''}`}
                        style={{
                          background:
                            paint.color || `#${spec.visual.baseColor.toString(16).padStart(6, '0')}`,
                        }}
                        disabled={busy}
                        onClick={() => void actions.buyCustomization(selected.id, 'paint', paint.id)}
                      >
                        <span className="swatch__price">
                          {paint.price === 0 ? 'free' : paint.price.toLocaleString()}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="stat__label" style={{ marginBottom: 8 }}>
                    Accent
                  </div>
                  <div className="swatches" style={{ marginBottom: 20 }}>
                    {ACCENTS.map((accent) => (
                      <button
                        key={accent.id}
                        title={`${accent.name} — ${accent.price.toLocaleString()} ¢`}
                        className={`swatch ${selected.customization.accent === accent.id ? 'swatch--active' : ''}`}
                        style={{
                          background:
                            accent.color || `#${spec.visual.accent.toString(16).padStart(6, '0')}`,
                        }}
                        disabled={busy}
                        onClick={() => void actions.buyCustomization(selected.id, 'accent', accent.id)}
                      >
                        <span className="swatch__price">
                          {accent.price === 0 ? 'free' : accent.price.toLocaleString()}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="option-list">
                  {WHEELS.map((wheel) => (
                    <div className="option" key={wheel.id}>
                      <div>
                        <div className="option__name">{wheel.name}</div>
                        <div className="option__desc">{wheel.spokes}-spoke</div>
                      </div>
                      <button
                        className="btn btn--sm"
                        disabled={busy || selected.customization.wheelStyle === wheel.id}
                        onClick={() => void actions.buyCustomization(selected.id, 'wheelStyle', wheel.id)}
                      >
                        {selected.customization.wheelStyle === wheel.id
                          ? 'Fitted'
                          : wheel.price === 0
                            ? 'Free'
                            : `${wheel.price.toLocaleString()} ¢`}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'upgrades' && (
              <div className="option-list">
                {UPGRADE_LIST.map((upgrade) => {
                  const level = selected.upgrades[upgrade.key]
                  const cost = upgradeCost(upgrade.key, level)
                  return (
                    <div className="option" key={upgrade.key}>
                      <div>
                        <div className="option__name">{upgrade.name}</div>
                        <div className="option__desc">{upgrade.description}</div>
                        <div className="pips">
                          {Array.from({ length: MAX_UPGRADE_LEVEL }, (_, i) => (
                            <span key={i} className={`pip ${i < level ? 'pip--on' : ''}`} />
                          ))}
                        </div>
                      </div>
                      <button
                        className="btn btn--sm"
                        disabled={busy || cost === null || save.profile.credits < cost}
                        onClick={() => void actions.buyUpgrade(selected.id, upgrade.key)}
                      >
                        {cost === null ? 'Max' : `${cost.toLocaleString()} ¢`}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {tab === 'gadgets' && (
              <div className="option-list">
                {GADGET_LIST.map((gadget) => {
                  const owned = save.gadgets.includes(gadget.id)
                  const equipped = actions.equippedGadget === gadget.id
                  return (
                    <div className="option" key={gadget.id}>
                      <div>
                        <div className="option__name">{gadget.name}</div>
                        <div className="option__desc">{gadget.description}</div>
                        <div className="option__desc">
                          {gadget.cooldown}s cooldown · lasts {gadget.duration}s
                        </div>
                      </div>
                      {owned ? (
                        <button
                          className="btn btn--sm"
                          disabled={equipped}
                          onClick={() => actions.equipGadget(gadget.id)}
                        >
                          {equipped ? 'Equipped' : 'Equip'}
                        </button>
                      ) : (
                        <button
                          className="btn btn--sm"
                          disabled={busy || save.profile.credits < gadget.price}
                          onClick={() => void actions.buyGadget(gadget.id)}
                        >
                          {gadget.price.toLocaleString()} ¢
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
