/**
 * Formats an ISO timestamp into a localized relative time label via i18next `t`.
 */
export function formatRelativeTime(isoString, t, nowMs = Date.now()) {
  if (!isoString) return t('time.justNow')
  const parsed = Date.parse(isoString)
  if (Number.isNaN(parsed)) return t('time.justNow')

  const diffSec = Math.max(0, Math.floor((nowMs - parsed) / 1000))
  if (diffSec < 10) return t('time.justNow')
  if (diffSec < 60) return t('time.secondsAgo', { count: diffSec })
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return t('time.minutesAgo', { count: diffMin })
  const diffHours = Math.floor(diffMin / 60)
  return t('time.hoursAgo', { count: diffHours })
}
