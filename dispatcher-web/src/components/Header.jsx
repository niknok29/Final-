import { useTranslation } from 'react-i18next'
import { USE_MOCK } from '../api/client.js'
import { can } from '../auth/permissions.js'
import { useDashboard } from '../state/dashboardStore.js'

const LANGUAGES = ['az', 'en', 'ru']

export function Header() {
  const { t, i18n } = useTranslation()
  const {
    user,
    connectionStatus,
    healthStatus,
    routingProvider,
    routingBreaker,
    routingOffline,
    audioMuted,
    simDrawerOpen,
    toggleAudioMuted,
    toggleSimDrawer,
    handleLogout,
  } = useDashboard()

  const canSimulate = can(user?.role, 'simulate')
  const roleLabel = t(`header.roles.${user?.role}`, { defaultValue: user?.role || '' })

  const isBreakerOpen = routingBreaker === 'open'
  const isHardOutage =
    isBreakerOpen ||
    routingOffline ||
    routingProvider === 'down' ||
    routingProvider === 'http503'
  const isDegradedOrSlow =
    !isHardOutage &&
    (routingProvider === 'slow' ||
      routingProvider === 'degraded' ||
      healthStatus === 'degraded')

  const providerPillClass = isHardOutage
    ? 'status-pill-down'
    : isDegradedOrSlow
      ? 'status-pill-slow'
      : 'status-pill-up'

  const providerLabel =
    routingProvider === 'http503'
      ? t('header.routingHttp503')
      : routingProvider === 'down'
        ? t('header.routingDown')
        : routingProvider === 'slow'
          ? t('header.routingSlow')
          : routingProvider === 'degraded' || healthStatus === 'degraded'
            ? t('header.routingDegraded')
            : t('header.routingUp')

  return (
    <header className="ctrl-header">
      <div className="ctrl-header-left">
        <div className="brand-mark" aria-hidden="true">
          <span className="brand-dot" />
        </div>
        <div className="brand-text">
          <h1 className="brand-title">{t('app.shortTitle')}</h1>
          <span className="brand-subtitle">{t('app.subtitle')}</span>
        </div>
        {USE_MOCK && <span className="badge badge-mock">{t('app.mockMode')}</span>}
      </div>

      <div className="ctrl-header-right">
        <div
          className={`status-pill ${
            connectionStatus === 'live' ? 'status-pill-live' : 'status-pill-reconnecting'
          }`}
        >
          <span className="status-indicator" />
          <span>{connectionStatus === 'live' ? t('header.live') : t('header.reconnecting')}</span>
        </div>

        <div className={`status-pill ${providerPillClass}`}>
          <span className="status-label-muted">{t('header.routingLabel')}:</span>
          <strong>{providerLabel}</strong>
          <span className={`breaker-tag ${isBreakerOpen ? 'breaker-open' : 'breaker-closed'}`}>
            {isBreakerOpen ? t('header.breakerOpen') : t('header.breakerClosed')}
          </span>
        </div>

        <div className="lang-switcher" role="group" aria-label="Language">
          {LANGUAGES.map((lng) => (
            <button
              key={lng}
              type="button"
              className={`lang-btn ${i18n.language === lng ? 'lang-btn-active' : ''}`}
              onClick={() => i18n.changeLanguage(lng)}
            >
              {lng.toUpperCase()}
            </button>
          ))}
        </div>

        <button
          type="button"
          className={`icon-btn ${audioMuted ? 'icon-btn-muted' : 'icon-btn-active'}`}
          onClick={toggleAudioMuted}
          title={audioMuted ? t('header.unmuteAudio') : t('header.muteAudio')}
          aria-label={audioMuted ? t('header.unmuteAudio') : t('header.muteAudio')}
        >
          {audioMuted ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 5 6 9H2v6h4l5 4V5Z" />
              <path d="m22 9-6 6" />
              <path d="m16 9 6 6" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 5 6 9H2v6h4l5 4V5Z" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          )}
        </button>

        {canSimulate && (
          <button
            type="button"
            className={`sim-toggle-btn ${simDrawerOpen ? 'sim-toggle-btn-open' : ''}`}
            onClick={() => toggleSimDrawer()}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            <span>{t('header.simulationBtn')}</span>
          </button>
        )}

        <div className="user-pill">
          <span className="user-name">{user?.username}</span>
          <span className="user-role">({roleLabel})</span>
        </div>

        <button type="button" className="logout-btn" onClick={handleLogout}>
          {t('header.logout')}
        </button>
      </div>
    </header>
  )
}
