import { useTranslation } from 'react-i18next'
import { CrisisMap } from '../components/CrisisMap.jsx'
import { Header } from '../components/Header.jsx'
import { RedAlertBanner } from '../components/RedAlertBanner.jsx'
import { RightStatusPanel } from '../components/RightStatusPanel.jsx'
import { SimulationDrawer } from '../components/SimulationDrawer.jsx'
import { SosFeedPanel } from '../components/SosFeedPanel.jsx'
import { StatsBar } from '../components/StatsBar.jsx'
import { ToastContainer } from '../components/ToastContainer.jsx'
import { useDashboard } from '../state/dashboardStore.js'

export function DashboardPage() {
  const { t } = useTranslation()
  const {
    healthStatus,
    routingDegraded,
    routingProvider,
    routingBreaker,
    routingOffline,
    routingFallbackMode,
    routingNotice,
  } = useDashboard()

  const isWarningActive =
    routingNotice?.code === 'OFFLINE_BACKUP_ROUTE_MODE' ||
    routingOffline === true ||
    routingDegraded === true ||
    healthStatus === 'degraded' ||
    routingProvider === 'down' ||
    routingProvider === 'slow' ||
    routingProvider === 'http503' ||
    routingProvider === 'degraded' ||
    routingBreaker === 'open'

  const noticeCode = routingNotice?.code || 'OFFLINE_BACKUP_ROUTE_MODE'
  const noticeText = t(`notices.${noticeCode}`, {
    defaultValue: t('header.backupModeNotice'),
  })

  const stateChipLabel =
    routingProvider === 'http503'
      ? 'HTTP 503'
      : String(routingProvider || (routingDegraded ? 'degraded' : healthStatus) || 'down').toUpperCase()

  return (
    <div className="dashboard-shell">
      <Header />
      <StatsBar />
      {isWarningActive && (
        <div
          className={`backup-route-banner ${
            routingBreaker === 'open' || routingProvider === 'http503'
              ? 'backup-route-banner-critical'
              : 'backup-route-banner-warning'
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="backup-route-banner-left">
            <span className="backup-route-tag">{t('header.backupModeTag')}</span>
            <span className="backup-route-text">{noticeText}</span>
          </div>
          <div className="backup-route-banner-right">
            <span className="backup-route-chip">{stateChipLabel}</span>
            {routingFallbackMode && (
              <span className="backup-route-chip">
                {t(`header.fallbackModes.${routingFallbackMode}`, {
                  defaultValue: routingFallbackMode,
                })}
              </span>
            )}
            <span className="backup-route-chip">
              {routingBreaker === 'open' ? t('header.breakerOpen') : t('header.breakerClosed')}
            </span>
          </div>
        </div>
      )}
      <RedAlertBanner />
      <div className="workspace-grid">
        <SosFeedPanel />
        <CrisisMap />
        <RightStatusPanel />
      </div>
      <SimulationDrawer />
      <ToastContainer />
    </div>
  )
}
