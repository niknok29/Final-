import { useTranslation } from 'react-i18next'
import { can } from '../auth/permissions.js'
import { useDashboard } from '../state/dashboardStore.js'
import { sanitizeUserNote } from '../utils/sanitize.js'

export function RedAlertBanner() {
  const { t } = useTranslation()
  const {
    user,
    dashboard,
    busyAlertIds,
    handleApproveAlert,
    handleDismissAlert,
    focusMap,
  } = useDashboard()

  const pendingAlerts = dashboard.alerts.filter((a) => a.status === 'pending')
  if (!pendingAlerts.length) return null

  const canAct = can(user?.role, 'approve_alert') && can(user?.role, 'dismiss_alert')

  return (
    <section className="red-alert-stack" aria-label={t('alerts.redAlert')}>
      {pendingAlerts.map((alert, idx) => {
        const isBusy = busyAlertIds.includes(alert.id)
        const crewName = sanitizeUserNote(alert.proposal?.crewName || '-', 80)
        const shelterName = sanitizeUserNote(alert.proposal?.openShelterName || '-', 80)

        return (
          <div key={alert.id} className="red-alert-banner" role="alert">
            <div
              className="red-alert-info"
              onClick={() => {
                if (typeof alert.lat === 'number' && typeof alert.lng === 'number') {
                  focusMap({ lat: alert.lat, lng: alert.lng, zoom: 14, alertId: alert.id })
                }
              }}
            >
              <div className="red-alert-top">
                <span className="red-alert-tag">
                  <span className="pulse-dot" />
                  {t('alerts.redAlert')}
                </span>
                {pendingAlerts.length > 1 && (
                  <span className="red-alert-index">
                    {idx + 1} / {pendingAlerts.length}
                  </span>
                )}
                <span className="red-alert-zone">
                  {t('alerts.zone')}: <strong>{sanitizeUserNote(alert.zoneName, 60)}</strong>
                </span>
                <span className="red-alert-trigger">
                  {t('alerts.trigger')}: <strong>{sanitizeUserNote(alert.trigger, 90)}</strong>
                </span>
              </div>

              <div className="red-alert-body">
                <p className="red-alert-message">{sanitizeUserNote(alert.message, 220)}</p>
                <div className="red-alert-proposal">
                  <span className="proposal-label">{t('alerts.proposal')}:</span>
                  <span className="proposal-chip">{t('alerts.assignCrew', { crew: crewName })}</span>
                  <span className="proposal-chip">
                    {t('alerts.openShelter', { shelter: shelterName })}
                  </span>
                </div>
              </div>
            </div>

            <div className="red-alert-actions">
              {canAct ? (
                <>
                  <button
                    type="button"
                    className="btn-alert-approve"
                    disabled={isBusy}
                    onClick={() => handleApproveAlert(alert)}
                  >
                    {isBusy ? t('alerts.processing') : t('alerts.approve')}
                  </button>
                  <button
                    type="button"
                    className="btn-alert-dismiss"
                    disabled={isBusy}
                    onClick={() => handleDismissAlert(alert)}
                  >
                    {t('alerts.dismiss')}
                  </button>
                </>
              ) : (
                <span className="no-permission-hint">{t('alerts.noPermission')}</span>
              )}
            </div>
          </div>
        )
      })}
    </section>
  )
}
