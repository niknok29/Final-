import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { canDispatch } from '../auth/permissions.js'
import { CrisisMap } from '../components/CrisisMap.jsx'
import { Header } from '../components/Header.jsx'
import { RedAlertBanner } from '../components/RedAlertBanner.jsx'
import { RightStatusPanel } from '../components/RightStatusPanel.jsx'
import { SimulationDrawer } from '../components/SimulationDrawer.jsx'
import { SosFeedPanel } from '../components/SosFeedPanel.jsx'
import { StatsBar } from '../components/StatsBar.jsx'
import { ToastContainer } from '../components/ToastContainer.jsx'
import { useDashboard } from '../state/dashboardStore.js'
import { formatNumber } from '../utils/time.js'

export function DashboardPage() {
  const { t, i18n } = useTranslation()
  const {
    user,
    flood,
    healthStatus,
    routingDegraded,
    routingProvider,
    routingBreaker,
    routingOffline,
    routingFallbackMode,
    routingNotice,
    handleClearSuspiciousSos,
  } = useDashboard()

  const [clearingFlood, setClearingFlood] = useState(false)

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

  const suspiciousCount = flood?.suspiciousCount ?? 0
  const filteredTotal = flood?.filteredCount || suspiciousCount
  const isFloodActive = Boolean(flood?.active || suspiciousCount > 0 || filteredTotal > 0)
  const canClearFlood = canDispatch(user)

  async function onClearFloodClick() {
    if (!canClearFlood || clearingFlood) return
    setClearingFlood(true)
    try {
      await handleClearSuspiciousSos()
    } finally {
      setClearingFlood(false)
    }
  }

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
      {isFloodActive && (
        <div className="sos-flood-banner" role="alert" aria-live="assertive">
          <div className="sos-flood-banner-left">
            <span className="sos-flood-tag">
              <span className="pulse-dot" />
              {t('flood.tag')}
            </span>
            <span className="sos-flood-text">
              {t('flood.bannerMessage', {
                count: filteredTotal,
                formattedCount: formatNumber(filteredTotal, i18n.language),
              })}
            </span>
          </div>
          <div className="sos-flood-banner-right">
            <span className="sos-flood-chip">
              {t('flood.suspiciousChip', { count: suspiciousCount })}
            </span>
            <button
              type="button"
              className="btn-flood-clear"
              disabled={!canClearFlood || clearingFlood}
              title={!canClearFlood ? t('alerts.noPermissionTooltip') : t('flood.clearBtn')}
              onClick={onClearFloodClick}
            >
              {clearingFlood ? t('flood.clearingBtn') : t('flood.clearBtn')}
            </button>
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
