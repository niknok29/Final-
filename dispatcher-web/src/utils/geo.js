import { formatNumber, resolveLocale } from './time.js'

const EARTH_RADIUS_METERS = 6371000

const toRadians = (degrees) => (degrees * Math.PI) / 180

/**
 * Computes exact great-circle Haversine distance in meters between two WGS84 points.
 */
export function calculateDistanceMeters(lat1, lng1, lat2, lng2) {
  const aLat = Number(lat1)
  const aLng = Number(lng1)
  const bLat = Number(lat2)
  const bLng = Number(lng2)
  if (
    !Number.isFinite(aLat) ||
    !Number.isFinite(aLng) ||
    !Number.isFinite(bLat) ||
    !Number.isFinite(bLng)
  ) {
    return null
  }

  const dLat = toRadians(bLat - aLat)
  const dLng = toRadians(bLng - aLng)
  const sinHalfLat = Math.sin(dLat / 2)
  const sinHalfLng = Math.sin(dLng / 2)

  const h =
    sinHalfLat * sinHalfLat +
    Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * sinHalfLng * sinHalfLng

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)))
  return Math.round(EARTH_RADIUS_METERS * c)
}

/**
 * Computes total polyline segment length in meters across consecutive [lat, lng] points.
 */
export function calculatePathLengthMeters(path) {
  if (!Array.isArray(path) || path.length < 2) return 0
  let total = 0
  for (let i = 1; i < path.length; i += 1) {
    const prev = path[i - 1]
    const curr = path[i]
    if (!Array.isArray(prev) || !Array.isArray(curr)) continue
    const segment = calculateDistanceMeters(prev[0], prev[1], curr[0], curr[1])
    if (segment !== null) total += segment
  }
  return Math.round(total)
}

/**
 * Formats a distance in meters as localized meters (< 1000 m) or kilometers (>= 1000 m).
 */
export function formatDistance(meters, locale = 'az') {
  const numeric = Number(meters)
  if (!Number.isFinite(numeric)) return '-'
  const rounded = Math.max(0, Math.round(numeric))
  if (rounded < 1000) {
    return `${formatNumber(rounded, locale)} m`
  }
  const km = rounded / 1000
  try {
    const formattedKm = new Intl.NumberFormat(resolveLocale(locale), {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(km)
    return `${formattedKm} km`
  } catch {
    return `${km.toFixed(1)} km`
  }
}

/**
 * Finds the nearest viable shelter (prioritizing accessible open shelters when required).
 */
export function findNearestShelter(lat, lng, shelters = [], requireAccessible = false) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) || !shelters.length) {
    return null
  }

  const openPool = shelters.filter(
    (s) =>
      s.status !== 'closed' &&
      s.status !== 'full' &&
      (!requireAccessible || Boolean(s.accessible))
  )
  const fallbackPool = requireAccessible
    ? shelters.filter((s) => Boolean(s.accessible))
    : shelters
  const candidates = openPool.length ? openPool : fallbackPool.length ? fallbackPool : shelters

  let bestShelter = null
  let bestDistance = Infinity
  for (const shelter of candidates) {
    const dist = calculateDistanceMeters(lat, lng, shelter.lat, shelter.lng)
    if (dist !== null && dist < bestDistance) {
      bestDistance = dist
      bestShelter = shelter
    }
  }

  if (!bestShelter || !Number.isFinite(bestDistance)) return null
  return { shelter: bestShelter, distanceMeters: bestDistance }
}

/**
 * Computes distance from a response crew to its assigned alert or nearest active incident/zone.
 */
export function findCrewTargetDistance(crew, alerts = [], sos = [], zones = []) {
  if (!crew || !Number.isFinite(Number(crew.lat)) || !Number.isFinite(Number(crew.lng))) {
    return null
  }

  if (crew.assignedAlertId) {
    const assigned = alerts.find((a) => a.id === crew.assignedAlertId)
    if (assigned) {
      const dist = calculateDistanceMeters(crew.lat, crew.lng, assigned.lat, assigned.lng)
      if (dist !== null) {
        return { distanceMeters: dist, targetLabel: assigned.zoneName || assigned.id }
      }
    }
  }

  const pendingAlerts = alerts.filter((a) => a.status === 'pending')
  const activeSos = sos.filter((s) => s.status !== 'resolved')
  const pool = pendingAlerts.length ? pendingAlerts : activeSos.length ? activeSos : zones

  let bestTarget = null
  let bestDistance = Infinity
  for (const target of pool) {
    const dist = calculateDistanceMeters(crew.lat, crew.lng, target.lat, target.lng)
    if (dist !== null && dist < bestDistance) {
      bestDistance = dist
      bestTarget = target
    }
  }

  if (!bestTarget || !Number.isFinite(bestDistance)) return null
  return {
    distanceMeters: bestDistance,
    targetLabel: bestTarget.zoneName || bestTarget.name || bestTarget.id,
  }
}
