import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDashboard } from '../state/dashboardStore.js'
import { sanitizeUserNote } from '../utils/sanitize.js'
import { formatClockTime, formatRelativeTime } from '../utils/time.js'
import { HazardIcon } from './HazardIcon.jsx'

const FILTER_TYPES = ['all', 'fire', 'collapse', 'flood', 'medical']

export function SosFeedPanel() {
  const { t, i18n } = useTranslation()
  const {
    dashboard,
    sosFilter,
    priorityOnlyFilter,
    recentSosIds,
    setSosFilter,
    togglePriorityOnlyFilter,
    focusMap,
  } = useDashboard()
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 15000)
    return () => clearInterval(timer)
  }, [])

  const zoneNamesById = useMemo(() => {
    const map = {}
    dashboard.zones.forEach((z) => {
      map[z.id] = z.name
    })
    return map
  }, [dashboard.zones])

  const filteredSos = dashboard.sos.filter((item) => {
    const matchesHazard = sosFilter === 'all' ? true : item.type === sosFilter
    if (!matchesHazard) return false
    if (priorityOnlyFilter) {
      return item.profile === 'special_needs' || item.priorityRank === 1
    }
    return true
  })

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

          <button
            type="button"
            aria-pressed={priorityOnlyFilter}
            className={`filter-pill filter-pill-priority ${
              priorityOnlyFilter ? 'filter-pill-priority-active' : ''
            }`}
            onClick={() => togglePriorityOnlyFilter()}
          >
            {t('sos.priorityOnly')}
          </button>
        </div>
      </div>

      <div className="panel-scroll-body sos-list">
        {filteredSos.length === 0 ? (
          <div className="empty-state">{t('sos.empty')}</div>
        ) : (
          filteredSos.map((item) => {
            const isPriority = item.profile === 'special_needs' || item.priorityRank === 1
            const isRecent = recentSosIds.includes(item.id)
            const noteText = sanitizeUserNote(item.note, 220) || t('sos.noNote')
            const zoneLabel = sanitizeUserNote(
              item.zoneName || zoneNamesById[item.zoneId] || item.zoneId || '',
              40
            )
            const timeLabel = formatRelativeTime(item.createdAt || item.ts, t, nowMs, i18n.language)
            const clockLabel = formatClockTime(item.createdAt || item.ts, i18n.language)

            return (
              <button
                key={item.id}
                type="button"
                className={`sos-card sos-card-${item.type} ${
                  isPriority ? 'sos-card-priority' : ''
                } ${isRecent ? 'sos-flash' : ''}`}
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
                  {isPriority && <span className="priority-sos-badge">{t('sos.priorityBadge')}</span>}

                  <span className={`hazard-badge hazard-${item.type}`}>
                    <HazardIcon type={item.type} size={14} />
                    <span>{t(`sos.types.${item.type}`, { defaultValue: item.type })}</span>
                  </span>

                  {zoneLabel && <span className="zone-chip">{zoneLabel}</span>}
                  <span className="sos-time" title={clockLabel}>
                    {timeLabel}
                  </span>
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
