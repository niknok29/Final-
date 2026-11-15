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
    routingProvider,
    routingBreaker,
    routingOffline,
    routingFallbackMode,
    routingNotice,
  } = useDashboard()

  const isHardOutage =
    routingOffline === true ||
    routingBreaker === 'open' ||
    routingProvider === 'down' ||
    routingProvider === 'http503' ||
    routingNotice?.code === 'OFFLINE_BACKUP_ROUTE_MODE'
  const showBackupRouteBanner =
    isHardOutage ||
    healthStatus === 'degraded' ||
    routingProvider === 'slow' ||
    routingProvider === 'degraded'
  const isSlowOnly =
    routingProvider === 'slow' &&
    routingBreaker !== 'open' &&
    !routingOffline &&
    routingNotice?.code !== 'OFFLINE_BACKUP_ROUTE_MODE'

  const stateChipLabel =
    routingProvider === 'http503'
      ? 'HTTP 503'
      : String(routingProvider || healthStatus || 'degraded').toUpperCase()

  return (
    <div className="dashboard-shell">
      <Header />
      <StatsBar />
      {showBackupRouteBanner && (
        <div
          className={`backup-route-banner ${
            isSlowOnly ? 'backup-route-banner-slow' : 'backup-route-banner-down'
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="backup-route-banner-left">
            <span className="backup-route-tag">{t('header.backupModeTag')}</span>
            <span className="backup-route-text">
              {isSlowOnly ? t('header.backupModeSlowNotice') : t('header.backupModeNotice')}
            </span>
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
