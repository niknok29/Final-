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
  const { routingProvider, routingBreaker } = useDashboard()
  const isHardDown = routingProvider === 'down' || routingBreaker === 'open'
  const showBackupRouteBanner = isHardDown || routingProvider === 'slow'

  return (
    <div className="dashboard-shell">
      <Header />
      <StatsBar />
      {showBackupRouteBanner && (
        <div
          className={`backup-route-banner ${
            isHardDown ? 'backup-route-banner-down' : 'backup-route-banner-slow'
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="backup-route-banner-left">
            <span className="backup-route-tag">{t('header.backupModeTag')}</span>
            <span className="backup-route-text">
              {isHardDown ? t('header.backupModeNotice') : t('header.backupModeSlowNotice')}
            </span>
          </div>
          <div className="backup-route-banner-right">
            <span className="backup-route-chip">
              {routingProvider === 'down' ? 'HTTP 503' : routingProvider.toUpperCase()}
            </span>
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
