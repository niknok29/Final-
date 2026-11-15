const LOCALE_MAP = {
  az: 'az-AZ',
  en: 'en-US',
  ru: 'ru-RU',
}

export function resolveLocale(lang = 'az') {
  return LOCALE_MAP[lang] || 'az-AZ'
}

/**
 * Formats numbers according to the active UI locale.
 */
export function formatNumber(value, lang = 'az') {
  const num = Number(value)
  if (!Number.isFinite(num)) return String(value ?? '')
  try {
    return new Intl.NumberFormat(resolveLocale(lang)).format(num)
  } catch {
    return String(num)
  }
}

/**
 * Formats an ISO timestamp into HH:MM:SS according to the active UI locale.
 */
export function formatClockTime(isoString, lang = 'az') {
  if (!isoString) return ''
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(resolveLocale(lang), {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date)
  } catch {
    return date.toLocaleTimeString()
  }
}

/**
 * Formats an ISO timestamp into a localized relative time label via i18next `t`.
 */
export function formatRelativeTime(isoString, t, nowMs = Date.now(), lang = 'az') {
  if (!isoString) return t('time.justNow')
  const parsed = Date.parse(isoString)
  if (Number.isNaN(parsed)) return t('time.justNow')

  const diffSec = Math.max(0, Math.floor((nowMs - parsed) / 1000))
  if (diffSec < 10) return t('time.justNow')
  if (diffSec < 60) {
    return t('time.secondsAgo', { count: diffSec, formatted: formatNumber(diffSec, lang) })
  }
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) {
    return t('time.minutesAgo', { count: diffMin, formatted: formatNumber(diffMin, lang) })
  }
  const diffHours = Math.floor(diffMin / 60)
  return t('time.hoursAgo', { count: diffHours, formatted: formatNumber(diffHours, lang) })
}
