import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { can } from '../auth/permissions.js'
import { useDashboard } from '../state/dashboardStore.js'
import { sanitizeUserNote } from '../utils/sanitize.js'

const HAZARD_TYPES = ['fire', 'collapse', 'flood', 'medical']

export function SimulationDrawer() {
  const { t } = useTranslation()
  const {
    user,
    dashboard,
    simDrawerOpen,
    simTargetCoords,
    toggleSimDrawer,
    handleSimCloseRoad,
    handleSimOpenRoad,
    handleSimShelterOccupancy,
    handleSimSosBurst,
    handleSimReset,
  } = useDashboard()

  const [selectedRoadId, setSelectedRoadId] = useState('')
  const [selectedShelterId, setSelectedShelterId] = useState('')
  const [occupancyPercent, setOccupancyPercent] = useState(96)
  const [burstType, setBurstType] = useState('fire')

  if (!can(user?.role, 'simulate') || !simDrawerOpen) {
    return null
  }

  const roads = dashboard.roads || []
  const shelters = dashboard.shelters || []

  const activeRoad = roads.find((r) => r.id === selectedRoadId) || roads[0] || null
  const activeShelter = shelters.find((s) => s.id === selectedShelterId) || shelters[0] || null

  return (
    <section className="sim-drawer" aria-label={t('sim.title')}>
      <div className="sim-drawer-header">
        <div className="sim-drawer-title">
          <span className="sim-badge">ADMIN SIM</span>
          <h3>{t('sim.title')}</h3>
        </div>
        <button
          type="button"
          className="sim-close-btn"
          onClick={() => toggleSimDrawer(false)}
        >
          {t('sim.closeDrawer')} ×
        </button>
      </div>

      <div className="sim-controls-grid">
        <div className="sim-control-card">
          <label className="sim-label" htmlFor="sim-road-select">
            {t('sim.roadSection')}
          </label>
          <select
            id="sim-road-select"
            className="sim-select"
            value={activeRoad?.id || ''}
            onChange={(e) => setSelectedRoadId(e.target.value)}
          >
            {roads.map((road) => (
              <option key={road.id} value={road.id}>
                {sanitizeUserNote(road.name, 60)} ({road.status})
              </option>
            ))}
          </select>
          <div className="sim-btn-row">
            <button
              type="button"
              className="sim-btn sim-btn-danger"
              disabled={!activeRoad}
              onClick={() => activeRoad && handleSimCloseRoad(activeRoad)}
            >
              {t('sim.closeRoad')}
            </button>
            <button
              type="button"
              className="sim-btn sim-btn-success"
              disabled={!activeRoad}
              onClick={() => activeRoad && handleSimOpenRoad(activeRoad)}
            >
              {t('sim.openRoad')}
            </button>
          </div>
        </div>

        <div className="sim-control-card">
          <label className="sim-label" htmlFor="sim-shelter-select">
            {t('sim.shelterSection')}
          </label>
          <select
            id="sim-shelter-select"
            className="sim-select"
            value={activeShelter?.id || ''}
            onChange={(e) => setSelectedShelterId(e.target.value)}
          >
            {shelters.map((shelter) => (
              <option key={shelter.id} value={shelter.id}>
                {sanitizeUserNote(shelter.name, 50)} ({shelter.percent}%)
              </option>
            ))}
          </select>
          <div className="sim-slider-row">
            <input
              type="range"
              min="0"
              max="100"
              value={occupancyPercent}
              onChange={(e) => setOccupancyPercent(Number(e.target.value))}
              aria-label={t('sim.occupancyPercent', { percent: occupancyPercent })}
            />
            <span className="sim-slider-val">{occupancyPercent}%</span>
            <button
              type="button"
              className="sim-btn sim-btn-primary"
              disabled={!activeShelter}
              onClick={() =>
                activeShelter && handleSimShelterOccupancy(activeShelter, occupancyPercent)
              }
            >
              {t('sim.setOccupancy')}
            </button>
          </div>
        </div>

        <div className="sim-control-card">
          <span className="sim-label">{t('sim.burstSection')}</span>
          <div className="sim-burst-row">
            <select
              className="sim-select"
              value={burstType}
              onChange={(e) => setBurstType(e.target.value)}
              aria-label={t('sim.hazardType')}
            >
              {HAZARD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`sos.types.${type}`)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="sim-btn sim-btn-warning"
              onClick={() =>
                handleSimSosBurst({
                  lat: simTargetCoords.lat,
                  lng: simTargetCoords.lng,
                  type: burstType,
                })
              }
            >
              {t('sim.sendBurst')}
            </button>
          </div>
          <span className="sim-coords-hint">
            {t('sim.targetCoords', {
              lat: simTargetCoords.lat.toFixed(4),
              lng: simTargetCoords.lng.toFixed(4),
            })}
          </span>
        </div>

        <div className="sim-control-card sim-reset-card">
          <span className="sim-label">{t('sim.resetSection')}</span>
          <button type="button" className="sim-btn sim-btn-ghost" onClick={handleSimReset}>
            {t('sim.resetBtn')}
          </button>
        </div>
      </div>
    </section>
  )
}
