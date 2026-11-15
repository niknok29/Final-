import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDashboard } from '../state/dashboardStore.js'
import { formatNumber } from '../utils/time.js'

export const StatsBar = memo(function StatsBar() {
  const { t, i18n } = useTranslation()
  const { dashboard, flood } = useDashboard()
  const stats = dashboard.stats
  const lang = i18n.language

  const priorityCount = stats.prioritySos ?? 0
  const suspiciousCount = Math.max(flood?.suspiciousCount ?? 0, stats.suspiciousSos ?? 0)

  return (
    <section className="stats-bar" aria-label="Dashboard statistics">
      <div className="stat-card stat-card-sos">
        <span className="stat-label">{t('stats.activeSos')}</span>
        <strong className="stat-value">{formatNumber(stats.activeSos, lang)}</strong>
      </div>

      <div className={`stat-card ${priorityCount > 0 ? 'stat-card-priority' : ''}`}>
        <span className="stat-label">
          <span aria-hidden="true">♿ </span>
          {t('stats.prioritySos')}
        </span>
        <strong className="stat-value">{formatNumber(priorityCount, lang)}</strong>
      </div>

      <div className={`stat-card ${suspiciousCount > 0 ? 'stat-card-suspicious' : ''}`}>
        <span className="stat-label">{t('stats.suspiciousSos')}</span>
        <strong className="stat-value">{formatNumber(suspiciousCount, lang)}</strong>
      </div>

      <div className={`stat-card ${stats.pendingAlerts > 0 ? 'stat-card-alert' : ''}`}>
        <span className="stat-label">{t('stats.pendingAlerts')}</span>
        <strong className="stat-value">{formatNumber(stats.pendingAlerts, lang)}</strong>
      </div>

      <div className="stat-card stat-card-shelter">
        <span className="stat-label">{t('stats.shelters')}</span>
        <strong className="stat-value">
          {formatNumber(stats.fullShelters, lang)} <span className="stat-divider">/</span>{' '}
          {formatNumber(stats.shelters, lang)}
        </strong>
      </div>

      <div className="stat-card stat-card-crew">
        <span className="stat-label">{t('stats.crews')}</span>
        <strong className="stat-value">
          {formatNumber(stats.availableCrews, lang)} <span className="stat-divider">/</span>{' '}
          {formatNumber(stats.totalCrews, lang)}
        </strong>
      </div>
    </section>
  )
})
