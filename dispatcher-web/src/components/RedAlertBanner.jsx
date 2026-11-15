import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { canDispatch } from '../auth/permissions.js'
import { useDashboard } from '../state/dashboardStore.js'
import { sanitizeUserNote } from '../utils/sanitize.js'

function formatAlertTrigger(alert, t) {
  if (alert.trigger) return sanitizeUserNote(alert.trigger, 90)
  const d = alert.details || {}
  if (alert.kind === 'PRIORITY_SOS' || alert.code === 'PRIORITY_SOS_DISPATCH_ACCESSIBLE_TRANSPORT') {
    return t('alerts.triggerPrioritySos', { sosId: sanitizeUserNote(d.sosId || '-', 32) })
  }
  if (alert.kind === 'SHELTER_OVERLOAD' || d.occupancyPercent != null) {
    return t('alerts.triggerOverload', { percent: d.occupancyPercent ?? 96 })
  }
  if (d.sosCount != null) {
    return t('alerts.triggerCluster', {
      count: d.sosCount,
      minutes: d.windowMinutes ?? 5,
      radius: d.radiusMeters ?? 500,
    })
  }
  return '-'
}

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

  const zoneNamesById = useMemo(() => {
    const map = {}
    dashboard.zones.forEach((z) => {
      map[z.id] = z.name
    })
    return map
  }, [dashboard.zones])

  const pendingAlerts = useMemo(
    () => dashboard.alerts.filter((a) => a.status === 'pending'),
    [dashboard.alerts]
  )
  if (!pendingAlerts.length) return null

  const canAct = canDispatch(user)

  return (
    <section className="red-alert-stack" aria-label={t('alerts.redAlert')}>
      {pendingAlerts.map((alert, idx) => {
        const isBusy = busyAlertIds.includes(alert.id)
        const isPriorityAlert =
          alert.kind === 'PRIORITY_SOS' ||
          alert.code === 'PRIORITY_SOS_DISPATCH_ACCESSIBLE_TRANSPORT'

        const crewName = alert.proposal?.crewName
          ? sanitizeUserNote(alert.proposal.crewName, 80)
          : null
        const shelterName =
          alert.proposal?.newShelterName ?? alert.proposal?.openShelterName ?? null
        const cleanShelterName = shelterName ? sanitizeUserNote(shelterName, 80) : null
        const zoneLabel = sanitizeUserNote(
          alert.zoneName || zoneNamesById[alert.zoneId] || alert.zoneId || '-',
          60
        )
        const triggerText = formatAlertTrigger(alert, t)
        const messageText = sanitizeUserNote(
          alert.message || (isPriorityAlert ? t('alerts.priorityMessageFallback') : ''),
          220
        )

        return (
          <div
            key={alert.id}
            className={`red-alert-banner ${isPriorityAlert ? 'red-alert-banner-priority' : ''}`}
            role="alert"
          >
            <div
              className="red-alert-info"
              onClick={() => {
                if (typeof alert.lat === 'number' && typeof alert.lng === 'number') {
                  focusMap({
                    lat: alert.lat,
                    lng: alert.lng,
                    zoom: 15,
                    alertId: alert.id,
                    sosId: alert.details?.sosId || undefined,
                  })
                }
              }}
            >
              <div className="red-alert-top">
                <span
                  className={`red-alert-tag ${
                    isPriorityAlert ? 'red-alert-tag-priority' : ''
                  }`}
                >
                  <span className="pulse-dot" />
                  {isPriorityAlert ? t('alerts.prioritySosAlert') : t('alerts.redAlert')}
                </span>
                {pendingAlerts.length > 1 && (
                  <span className="red-alert-index">
                    {idx + 1} / {pendingAlerts.length}
                  </span>
                )}
                <span className="red-alert-zone">
                  {t('alerts.zone')}: <strong>{zoneLabel}</strong>
                </span>
                <span className="red-alert-trigger">
                  {t('alerts.trigger')}: <strong>{triggerText}</strong>
                </span>
              </div>

              <div className="red-alert-body">
                <p className="red-alert-message">{messageText}</p>
                <div className="red-alert-proposal">
                  <span className="proposal-label">{t('alerts.proposal')}:</span>
                  {crewName ? (
                    <span className="proposal-chip">
                      {t('alerts.assignCrew', { crew: crewName })}
                      {isPriorityAlert && (
                        <span className="proposal-acc-tag">
                          {' '}
                          · {t('alerts.accessibleTransportBadge')}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="proposal-chip proposal-chip-warn">
                      {t('alerts.noCrewProposed')}
                    </span>
                  )}
                  {cleanShelterName && (
                    <span className="proposal-chip">
                      {t('alerts.openShelter', { shelter: cleanShelterName })}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="red-alert-actions">
              {!canAct && <span className="no-permission-hint">{t('alerts.noPermission')}</span>}
              <button
                type="button"
                className="btn-alert-approve"
                disabled={!canAct || isBusy}
                title={!canAct ? t('alerts.noPermissionTooltip') : t('alerts.approve')}
                onClick={() => canAct && handleApproveAlert(alert)}
              >
                {isBusy ? t('alerts.processing') : t('alerts.approve')}
              </button>
              <button
                type="button"
                className="btn-alert-dismiss"
                disabled={!canAct || isBusy}
                title={!canAct ? t('alerts.noPermissionTooltip') : t('alerts.dismiss')}
                onClick={() => canAct && handleDismissAlert(alert)}
              >
                {t('alerts.dismiss')}
              </button>
            </div>
          </div>
        )
      })}
    </section>
  )
}
