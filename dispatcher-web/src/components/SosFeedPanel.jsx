import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDashboard } from '../state/dashboardStore.js'
import { sanitizeUserNote } from '../utils/sanitize.js'
import { formatRelativeTime } from '../utils/time.js'
import { HazardIcon } from './HazardIcon.jsx'

const FILTER_TYPES = ['all', 'fire', 'collapse', 'flood', 'medical']

export function SosFeedPanel() {
  const { t } = useTranslation()
  const { dashboard, sosFilter, recentSosIds, setSosFilter, focusMap } = useDashboard()
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 15000)
    return () => clearInterval(timer)
  }, [])

  const filteredSos = dashboard.sos.filter((item) =>
    sosFilter === 'all' ? true : item.type === sosFilter
  )

  return (
    <aside className="panel panel-left" aria-label={t('sos.title')}>
      <div className="panel-header">
        <div className="panel-title-row">
          <h2 className="panel-title">{t('sos.title')}</h2>
          <span className="panel-count-badge">{t('sos.count', { count: filteredSos.length })}</span>
        </div>

        <div className="filter-pills" role="tablist" aria-label="SOS hazard filter">
          {FILTER_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              role="tab"
              aria-selected={sosFilter === type}
              className={`filter-pill ${
                sosFilter === type ? `filter-pill-active filter-pill-${type}` : ''
              }`}
              onClick={() => setSosFilter(type)}
            >
              {t(`sos.filters.${type}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-scroll-body sos-list">
        {filteredSos.length === 0 ? (
          <div className="empty-state">{t('sos.empty')}</div>
        ) : (
          filteredSos.map((item) => {
            const isRecent = recentSosIds.includes(item.id)
            const noteText = sanitizeUserNote(item.note, 220) || t('sos.noNote')
            const timeLabel = formatRelativeTime(item.createdAt || item.ts, t, nowMs)

            return (
              <button
                key={item.id}
                type="button"
                className={`sos-card sos-card-${item.type} ${isRecent ? 'sos-flash' : ''}`}
                onClick={() =>
                  focusMap({
                    lat: item.lat,
                    lng: item.lng,
                    zoom: 16,
                    sosId: item.id,
                  })
                }
                title={t('sos.flyHint')}
              >
                <div className="sos-card-top">
                  <span className={`hazard-badge hazard-${item.type}`}>
                    <HazardIcon type={item.type} size={14} />
                    <span>{t(`sos.types.${item.type}`, { defaultValue: item.type })}</span>
                  </span>

                  <span className="zone-chip">{sanitizeUserNote(item.zoneName, 40)}</span>
                  <span className="sos-time">{timeLabel}</span>
                </div>

                <p className="sos-note">{noteText}</p>

                <div className="sos-card-footer">
                  <span className={`sos-status sos-status-${item.status || 'active'}`}>
                    {t(`sos.status.${item.status || 'active'}`, {
                      defaultValue: item.status || 'active',
                    })}
                  </span>
                  <span className="sos-coords">
                    {Number(item.lat).toFixed(4)}, {Number(item.lng).toFixed(4)}
                  </span>
                </div>
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}
