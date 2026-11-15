import { useTranslation } from 'react-i18next'
import { useDashboard } from '../state/dashboardStore.js'

export function StatsBar() {
  const { t } = useTranslation()
  const { dashboard } = useDashboard()
  const stats = dashboard.stats

  return (
    <section className="stats-bar" aria-label="Dashboard statistics">
      <div className="stat-card stat-card-sos">
        <span className="stat-label">{t('stats.activeSos')}</span>
        <strong className="stat-value">{stats.activeSos}</strong>
      </div>

      <div className={`stat-card ${stats.pendingAlerts > 0 ? 'stat-card-alert' : ''}`}>
        <span className="stat-label">{t('stats.pendingAlerts')}</span>
        <strong className="stat-value">{stats.pendingAlerts}</strong>
      </div>

      <div className="stat-card stat-card-shelter">
        <span className="stat-label">{t('stats.shelters')}</span>
        <strong className="stat-value">
          {stats.fullShelters} <span className="stat-divider">/</span> {stats.shelters}
        </strong>
      </div>

      <div className="stat-card stat-card-crew">
        <span className="stat-label">{t('stats.crews')}</span>
        <strong className="stat-value">
          {stats.availableCrews} <span className="stat-divider">/</span> {stats.totalCrews}
        </strong>
      </div>
    </section>
  )
}
