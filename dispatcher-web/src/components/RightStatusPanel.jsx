import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDashboard } from '../state/dashboardStore.js'
import { findCrewTargetDistance, formatDistance } from '../utils/geo.js'
import { sanitizeUserNote } from '../utils/sanitize.js'
import { formatNumber } from '../utils/time.js'

function getShelterBarColor(status, percent) {
  if (status === 'closed' || percent >= 90) return 'bar-full'
  if (percent >= 70) return 'bar-filling'
  return 'bar-open'
}

export const RightStatusPanel = memo(function RightStatusPanel() {
  const { t, i18n } = useTranslation()
  const { dashboard, focusMap } = useDashboard()
  const lang = i18n.language

  const sortedShelters = useMemo(
    () =>
      dashboard.shelters
        .slice()
        .sort(
          (a, b) => (b.occupancyPercent ?? b.percent ?? 0) - (a.occupancyPercent ?? a.percent ?? 0)
        ),
    [dashboard.shelters]
  )

  return (
    <aside className="panel panel-right" aria-label="Zones, Shelters and Crews">
      <div className="panel-scroll-body right-panel-sections">
        <section className="status-section">
          <div className="section-header">
            <h2 className="panel-title">{t('rightPanel.zonesTitle')}</h2>
            <span className="panel-count-badge">{formatNumber(dashboard.zones.length, lang)}</span>
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
            <span className="panel-count-badge">{formatNumber(sortedShelters.length, lang)}</span>
          </div>
          <div className="shelters-list">
            {sortedShelters.map((shelter) => {
              const rawPct = shelter.occupancyPercent ?? shelter.percent ?? 0
              const pct = Math.max(0, Math.min(100, Math.round(Number(rawPct) || 0)))
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
                    <div className="shelter-badges">
                      {shelter.accessible && (
                        <span className="acc-badge" title={t('rightPanel.accessible')}>
                          {t('rightPanel.accessible')}
                        </span>
                      )}
                      <span className={`shelter-status-pill shelter-status-${shelter.status}`}>
                        {t(`rightPanel.shelterStatuses.${shelter.status}`, {
                          defaultValue: shelter.status,
                        })}
                      </span>
                    </div>
                  </div>

                  <div className="shelter-meta">
                    <span>
                      {t('rightPanel.capacityCount', {
                        occupancy: formatNumber(shelter.occupancy ?? 0, lang),
                        capacity: formatNumber(shelter.capacity ?? 0, lang),
                      })}
                    </span>
                    <strong>{formatNumber(pct, lang)}%</strong>
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
            <span className="panel-count-badge">{formatNumber(dashboard.crews.length, lang)}</span>
          </div>
          <div className="crews-list">
            {dashboard.crews.map((crew) => {
              const crewDist = findCrewTargetDistance(
                crew,
                dashboard.alerts,
                dashboard.sos,
                dashboard.zones
              )

              return (
                <button
                  key={crew.id}
                  type="button"
                  className="crew-row"
                  onClick={() => focusMap({ lat: crew.lat, lng: crew.lng, zoom: 15 })}
                >
                  <div className="crew-info">
                    <div className="crew-name-row">
                      <span className="crew-name">{sanitizeUserNote(crew.name, 60)}</span>
                      {crew.accessibleTransport && (
                        <span className="acc-badge" title={t('rightPanel.accessibleTransport')}>
                          {t('rightPanel.accessibleTransport')}
                        </span>
                      )}
                    </div>
                    <span className="crew-assign">
                      {crew.assignedAlertId
                        ? t('rightPanel.assignedTo', {
                            id: sanitizeUserNote(crew.assignedAlertId, 30),
                          })
                        : t('rightPanel.unassigned')}
                    </span>
                    {crewDist && (
                      <span className="crew-distance">
                        {t('rightPanel.distanceToIncident', {
                          distance: formatDistance(crewDist.distanceMeters, lang),
                        })}
                      </span>
                    )}
                  </div>
                  <span className={`crew-badge crew-${crew.status}`}>
                    {t(`rightPanel.crewStatuses.${crew.status}`, { defaultValue: crew.status })}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      </div>
    </aside>
  )
})
