import { useTranslation } from 'react-i18next'
import { useDashboard } from '../state/dashboardStore.js'
import { sanitizeUserNote } from '../utils/sanitize.js'

function getShelterBarColor(status, percent) {
  if (status === 'closed') return 'bar-closed'
  if (status === 'full' || percent >= 100) return 'bar-full'
  if (status === 'near_full' || percent >= 90) return 'bar-near-full'
  if (status === 'filling' || percent >= 75) return 'bar-filling'
  return 'bar-open'
}

export function RightStatusPanel() {
  const { t } = useTranslation()
  const { dashboard, focusMap } = useDashboard()

  const sortedShelters = dashboard.shelters
    .slice()
    .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))

  return (
    <aside className="panel panel-right" aria-label="Zones, Shelters and Crews">
      <div className="panel-scroll-body right-panel-sections">
        <section className="status-section">
          <div className="section-header">
            <h2 className="panel-title">{t('rightPanel.zonesTitle')}</h2>
            <span className="panel-count-badge">{dashboard.zones.length}</span>
          </div>
          <div className="zones-grid">
            {dashboard.zones.map((zone) => (
              <button
                key={zone.id}
                type="button"
                className="zone-row"
                onClick={() => focusMap({ lat: zone.lat, lng: zone.lng, zoom: 13 })}
              >
                <div className="zone-row-left">
                  <span className="zone-row-name">{sanitizeUserNote(zone.name, 40)}</span>
                  <span className="zone-row-sos">
                    {t('rightPanel.sosCount', { count: zone.activeSos ?? 0 })}
                  </span>
                </div>
                <span className={`level-badge level-${zone.level}`}>
                  {t(`rightPanel.zoneLevels.${zone.level}`, { defaultValue: zone.level })}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="status-section">
          <div className="section-header">
            <h2 className="panel-title">{t('rightPanel.sheltersTitle')}</h2>
            <span className="panel-count-badge">{sortedShelters.length}</span>
          </div>
          <div className="shelters-list">
            {sortedShelters.map((shelter) => {
              const pct = Math.max(0, Math.min(100, Math.round(Number(shelter.percent) || 0)))
              const barClass = getShelterBarColor(shelter.status, pct)

              return (
                <button
                  key={shelter.id}
                  type="button"
                  className="shelter-card"
                  onClick={() => focusMap({ lat: shelter.lat, lng: shelter.lng, zoom: 15 })}
                >
                  <div className="shelter-top">
                    <span className="shelter-name">{sanitizeUserNote(shelter.name, 60)}</span>
                    <span className={`shelter-status-pill shelter-status-${shelter.status}`}>
                      {t(`rightPanel.shelterStatuses.${shelter.status}`, {
                        defaultValue: shelter.status,
                      })}
                    </span>
                  </div>

                  <div className="shelter-meta">
                    <span>
                      {t('rightPanel.capacityCount', {
                        occupancy: shelter.occupancy ?? 0,
                        capacity: shelter.capacity ?? 0,
                      })}
                    </span>
                    <strong>{pct}%</strong>
                  </div>

                  <div className="progress-track" aria-hidden="true">
                    <div className={`progress-fill ${barClass}`} style={{ width: `${pct}%` }} />
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        <section className="status-section">
          <div className="section-header">
            <h2 className="panel-title">{t('rightPanel.crewsTitle')}</h2>
            <span className="panel-count-badge">{dashboard.crews.length}</span>
          </div>
          <div className="crews-list">
            {dashboard.crews.map((crew) => (
              <button
                key={crew.id}
                type="button"
                className="crew-row"
                onClick={() => focusMap({ lat: crew.lat, lng: crew.lng, zoom: 15 })}
              >
                <div className="crew-info">
                  <span className="crew-name">{sanitizeUserNote(crew.name, 60)}</span>
                  <span className="crew-assign">
                    {crew.assignedAlertId
                      ? t('rightPanel.assignedTo', {
                          id: sanitizeUserNote(crew.assignedAlertId, 30),
                        })
                      : t('rightPanel.unassigned')}
                  </span>
                </div>
                <span className={`crew-badge crew-${crew.status}`}>
                  {t(`rightPanel.crewStatuses.${crew.status}`, { defaultValue: crew.status })}
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </aside>
  )
}
