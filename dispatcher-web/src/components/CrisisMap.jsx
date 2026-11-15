import { memo, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import {
  Circle,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import { canSimulate } from '../auth/permissions.js'
import { useDashboard } from '../state/dashboardStore.js'
import {
  calculateDistanceMeters,
  calculatePathLengthMeters,
  findCrewTargetDistance,
  findNearestShelter,
  formatDistance,
} from '../utils/geo.js'
import { sanitizeUserNote } from '../utils/sanitize.js'
import { formatClockTime, formatNumber } from '../utils/time.js'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

const BAKU_CENTER = [40.4093, 49.8671]
const DEFAULT_ZOOM = 12

const ZONE_COLORS = {
  normal: { color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.1 },
  warning: { color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.16 },
  critical: { color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.22 },
}

const HAZARD_META = {
  fire: { color: '#ef4444', short: 'F' },
  collapse: { color: '#f59e0b', short: 'C' },
  flood: { color: '#38bdf8', short: 'W' },
  medical: { color: '#ec4899', short: 'M' },
}

const SHELTER_COLORS = {
  open: '#22c55e',
  filling: '#eab308',
  near_full: '#f97316',
  full: '#ef4444',
  closed: '#64748b',
}

const CREW_COLORS = {
  available: '#22c55e',
  dispatched: '#38bdf8',
  busy: '#a855f7',
}

const iconCache = new Map()

function getSosIcon(type, isPriority = false) {
  const safeType = HAZARD_META[type] ? type : 'fire'
  const key = `sos:${safeType}:${isPriority ? 'p1' : 'std'}`
  if (iconCache.has(key)) return iconCache.get(key)

  const meta = HAZARD_META[safeType]
  if (isPriority) {
    const icon = L.divIcon({
      className: 'custom-div-icon',
      iconSize: [38, 38],
      iconAnchor: [19, 19],
      popupAnchor: [0, -19],
      html: `<div class="map-sos-pin map-sos-pin-priority" style="background:${meta.color};">♿</div>`,
    })
    iconCache.set(key, icon)
    return icon
  }

  const icon = L.divIcon({
    className: 'custom-div-icon',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
    html: `<div class="map-sos-pin" style="background:${meta.color};">${meta.short}</div>`,
  })
  iconCache.set(key, icon)
  return icon
}

function getShelterIcon(status, percent, accessible = false) {
  const safeStatus = SHELTER_COLORS[status] ? status : 'open'
  const safePct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)))
  const key = `shelter:${safeStatus}:${safePct}:${accessible ? 'acc' : 'std'}`
  if (iconCache.has(key)) return iconCache.get(key)

  const color = SHELTER_COLORS[safeStatus]
  const label = safeStatus === 'closed' ? 'OFF' : `${safePct}%`
  const accTag = accessible ? '<span class="map-acc-badge">♿</span>' : ''
  const icon = L.divIcon({
    className: 'custom-div-icon',
    iconSize: [accessible ? 58 : 44, 24],
    iconAnchor: [accessible ? 29 : 22, 12],
    popupAnchor: [0, -12],
    html: `<div class="map-shelter-pin" style="border-color:${color};"><span class="map-shelter-dot" style="background:${color};"></span><span>${label}</span>${accTag}</div>`,
  })
  iconCache.set(key, icon)
  return icon
}

function getCrewIcon(status, accessibleTransport = false) {
  const safeStatus = CREW_COLORS[status] ? status : 'available'
  const key = `crew:${safeStatus}:${accessibleTransport ? 'acc' : 'std'}`
  if (iconCache.has(key)) return iconCache.get(key)

  const color = CREW_COLORS[safeStatus]
  const symbol = accessibleTransport ? '★♿' : '★'
  const width = accessibleTransport ? 36 : 26
  const icon = L.divIcon({
    className: 'custom-div-icon',
    iconSize: [width, 26],
    iconAnchor: [width / 2, 13],
    popupAnchor: [0, -13],
    html: `<div class="map-crew-pin" style="width:${width}px; border-color:${color}; color:${color};">${symbol}</div>`,
  })
  iconCache.set(key, icon)
  return icon
}

function getTargetIcon() {
  const key = 'sim-target'
  if (iconCache.has(key)) return iconCache.get(key)
  const icon = L.divIcon({
    className: 'custom-div-icon',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div class="map-target-pin">+</div>`,
  })
  iconCache.set(key, icon)
  return icon
}

function getRoadblockIcon() {
  const key = 'roadblock'
  if (iconCache.has(key)) return iconCache.get(key)
  const icon = L.divIcon({
    className: 'custom-div-icon',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -13],
    html: '<div class="map-roadblock-pin" aria-label="Blocked road">✕</div>',
  })
  iconCache.set(key, icon)
  return icon
}

function getExactLatLng(item) {
  if (!item || typeof item !== 'object') return null
  const rawLat = item.lat ?? item.location?.lat
  const rawLng = item.lng ?? item.location?.lng
  if (rawLat === null || rawLat === undefined || rawLat === '' || rawLng === null || rawLng === undefined || rawLng === '') {
    return null
  }
  const lat = Number(rawLat)
  const lng = Number(rawLng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return [lat, lng]
}

function normalizePolylinePoints(path) {
  if (!Array.isArray(path)) return []
  return path
    .map((pt) => {
      if (Array.isArray(pt) && pt.length >= 2) {
        const lat = Number(pt[0])
        const lng = Number(pt[1])
        return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null
      }
      if (pt && typeof pt === 'object') {
        return getExactLatLng(pt)
      }
      return null
    })
    .filter(Boolean)
}

function getPolylineMidpoint(path) {
  const pts = normalizePolylinePoints(path)
  if (pts.length === 0) return null
  if (pts.length === 1) return pts[0]

  let total = 0
  const segLengths = []
  for (let i = 1; i < pts.length; i += 1) {
    const segLen = calculateDistanceMeters(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) || 0
    segLengths.push(segLen)
    total += segLen
  }

  if (total <= 0) {
    const midIdx = Math.floor((pts.length - 1) / 2)
    return [
      Number(((pts[midIdx][0] + pts[midIdx + 1][0]) / 2).toFixed(5)),
      Number(((pts[midIdx][1] + pts[midIdx + 1][1]) / 2).toFixed(5)),
    ]
  }

  const half = total / 2
  let walked = 0
  for (let i = 0; i < segLengths.length; i += 1) {
    const segLen = segLengths[i]
    if (walked + segLen >= half && segLen > 0) {
      const ratio = (half - walked) / segLen
      const a = pts[i]
      const b = pts[i + 1]
      return [
        Number((a[0] + (b[0] - a[0]) * ratio).toFixed(5)),
        Number((a[1] + (b[1] - a[1]) * ratio).toFixed(5)),
      ]
    }
    walked += segLen
  }
  return pts[Math.floor(pts.length / 2)]
}

function MapController({ mapFocus, sosMarkerRefs }) {
  const map = useMap()

  useEffect(() => {
    if (!mapFocus || typeof mapFocus.lat !== 'number' || typeof mapFocus.lng !== 'number') {
      return undefined
    }

    map.flyTo([mapFocus.lat, mapFocus.lng], mapFocus.zoom || 15, {
      duration: 0.65,
    })

    if (mapFocus.sosId) {
      const openTargetPopup = () => {
        const marker = sosMarkerRefs.current[mapFocus.sosId]
        if (marker && typeof marker.openPopup === 'function') {
          marker.openPopup()
        }
      }
      const timer = setTimeout(openTargetPopup, 380)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [map, mapFocus, sosMarkerRefs])

  return null
}

function MapClickHandler({ onSelectCoords }) {
  useMapEvents({
    click(e) {
      onSelectCoords({
        lat: Number(e.latlng.lat.toFixed(5)),
        lng: Number(e.latlng.lng.toFixed(5)),
      })
    },
  })
  return null
}

const MAX_MAP_SOS = 200

export const CrisisMap = memo(function CrisisMap() {
  const { t, i18n } = useTranslation()
  const {
    user,
    dashboard,
    sosFilter,
    priorityOnlyFilter,
    mapFocus,
    activeRoute,
    routingOffline,
    routingDegraded,
    simTargetCoords,
    simDrawerOpen,
    setSimTargetCoords,
  } = useDashboard()

  const sosMarkerRefs = useRef({})
  const showSimTarget = canSimulate(user) && simDrawerOpen
  const lang = i18n.language

  const zoneNamesById = useMemo(() => {
    const map = {}
    dashboard.zones.forEach((z) => {
      map[z.id] = z.name
    })
    return map
  }, [dashboard.zones])

  const visibleSos = useMemo(
    () =>
      dashboard.sos
        .filter((item) => {
          if (!getExactLatLng(item)) return false
          const matchesHazard = sosFilter === 'all' ? true : item.type === sosFilter
          if (!matchesHazard) return false
          if (priorityOnlyFilter) {
            return item.profile === 'special_needs' || item.priorityRank === 1
          }
          return true
        })
        .slice(0, MAX_MAP_SOS),
    [dashboard.sos, sosFilter, priorityOnlyFilter]
  )

  const overlayRoads = useMemo(
    () =>
      dashboard.roads
        .map((r) => ({ ...r, cleanPath: normalizePolylinePoints(r.path) }))
        .filter((r) => r.cleanPath.length >= 2),
    [dashboard.roads]
  )

  const alertCircles = useMemo(
    () =>
      dashboard.alerts.filter(
        (alert) =>
          (alert.kind === 'SOS_CLUSTER' || alert.kind === 'PRIORITY_SOS') &&
          (alert.status === 'pending' || mapFocus?.alertId === alert.id) &&
          Boolean(getExactLatLng(alert))
      ),
    [dashboard.alerts, mapFocus?.alertId]
  )

  const renderedRoute = useMemo(() => {
    const cleanActive = normalizePolylinePoints(activeRoute?.geometry)
    if (cleanActive.length >= 2) {
      return {
        ...activeRoute,
        geometry: cleanActive,
        geometryApprox:
          typeof activeRoute.geometryApprox === 'boolean'
            ? activeRoute.geometryApprox
            : Boolean(routingOffline || routingDegraded),
      }
    }

    const focusCoords = getExactLatLng(mapFocus)
    if (focusCoords && (mapFocus?.sosId || mapFocus?.alertId)) {
      const requireAcc = mapFocus?.profile === 'special_needs'
      const nearest = findNearestShelter(
        focusCoords[0],
        focusCoords[1],
        dashboard.shelters,
        requireAcc
      )
      const shelterCoords = nearest ? getExactLatLng(nearest.shelter) : null
      if (nearest && shelterCoords) {
        return {
          geometry: [focusCoords, shelterCoords],
          geometryApprox: true,
          distanceMeters: nearest.distanceMeters,
          durationSec: Math.max(60, Math.round((nearest.distanceMeters || 0) / 1.25)),
          shelter: nearest.shelter,
          reason: null,
        }
      }
    }
    return null
  }, [activeRoute, dashboard.shelters, mapFocus, routingDegraded, routingOffline])

  return (
    <main className="panel panel-map" aria-label="Baku Crisis Map">
      <div className="map-wrapper">
        <MapContainer
          center={BAKU_CENTER}
          zoom={DEFAULT_ZOOM}
          className="crisis-leaflet-map"
          zoomControl={true}
          attributionControl={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapController mapFocus={mapFocus} sosMarkerRefs={sosMarkerRefs} />
          <MapClickHandler onSelectCoords={setSimTargetCoords} />

          {dashboard.zones.map((zone) => {
            const zoneCoords = getExactLatLng(zone)
            if (!zoneCoords) return null
            const style = ZONE_COLORS[zone.level] || ZONE_COLORS.normal
            const zoneRadius = zone.radiusMeters || 500
            return (
              <Circle
                key={zone.id}
                center={zoneCoords}
                radius={zoneRadius}
                pathOptions={{
                  color: style.color,
                  fillColor: style.fillColor,
                  fillOpacity: style.fillOpacity,
                  weight: 1.5,
                }}
              >
                <Tooltip sticky>
                  {sanitizeUserNote(zone.name, 60)} • {formatDistance(zoneRadius, lang)}
                </Tooltip>
                <Popup>
                  <div className="map-popup">
                    <strong>{sanitizeUserNote(zone.name, 60)}</strong>
                    <div>
                      {t('map.popup.radius')}: {formatDistance(zoneRadius, lang)}
                    </div>
                    <div>
                      {t('map.popup.activeSos')}: {formatNumber(zone.activeSos ?? 0, lang)}
                    </div>
                    <div>
                      {t('map.popup.level')}:{' '}
                      {t(`rightPanel.zoneLevels.${zone.level}`, { defaultValue: zone.level })}
                    </div>
                  </div>
                </Popup>
              </Circle>
            )
          })}

          {alertCircles.map((alert) => {
            const alertCoords = getExactLatLng(alert)
            if (!alertCoords) return null
            const alertRadius = alert.details?.radiusMeters || 500
            const zoneLabel = sanitizeUserNote(
              alert.zoneName || zoneNamesById[alert.zoneId] || alert.zoneId || '-',
              60
            )
            return (
              <Circle
                key={`alert-radius-${alert.id}`}
                center={alertCoords}
                radius={alertRadius}
                pathOptions={{
                  color: '#ef4444',
                  fillColor: '#ef4444',
                  fillOpacity: 0.14,
                  weight: 2,
                  dashArray: '6 4',
                }}
              >
                <Tooltip sticky permanent={mapFocus?.alertId === alert.id}>
                  {zoneLabel} • {t('map.popup.alertRadius')}: {formatDistance(alertRadius, lang)}
                </Tooltip>
                <Popup>
                  <div className="map-popup">
                    <strong>{zoneLabel}</strong>
                    <div>
                      {t('map.popup.alertRadius')}: {formatDistance(alertRadius, lang)}
                    </div>
                    {alert.message && (
                      <p className="map-popup-note">{sanitizeUserNote(alert.message, 160)}</p>
                    )}
                  </div>
                </Popup>
              </Circle>
            )
          })}

          {overlayRoads.map((road) => {
            const isClosed =
              road.status === 'closed' || road.status === 'blocked' || road.blocked === true
            const isInaccessible = road.accessible === false
            const roadLengthMeters = road.lengthMeters || calculatePathLengthMeters(road.cleanPath)
            const lengthLabel = formatDistance(roadLengthMeters, lang)
            const blockReason = sanitizeUserNote(
              road.reason || road.blockReason || t('map.popup.roadBlockedReasonDefault'),
              160
            )

            const pathOptions = isClosed
              ? {
                  color: '#ef4444',
                  weight: 5,
                  dashArray: '10 8',
                  opacity: 0.95,
                }
              : isInaccessible
                ? {
                    color: '#f59e0b',
                    weight: 4,
                    dashArray: '4 6',
                    opacity: 0.8,
                  }
                : {
                    color: '#22c55e',
                    weight: 3,
                    opacity: 0.48,
                  }

            return (
              <Polyline key={road.id} positions={road.cleanPath} pathOptions={pathOptions}>
                <Tooltip sticky>
                  {sanitizeUserNote(road.name, 60)} ({lengthLabel}) •{' '}
                  {isClosed ? t('map.popup.roadClosed') : t('map.popup.roadOpen')} •{' '}
                  {isInaccessible ? t('rightPanel.notAccessible') : t('rightPanel.accessible')}
                </Tooltip>
                <Popup>
                  <div className="map-popup">
                    <strong>{sanitizeUserNote(road.name, 80)}</strong>
                    <div>
                      {t('map.popup.roadLength')}: {lengthLabel}
                    </div>
                    <div>
                      {t('map.popup.status')}:{' '}
                      {isClosed ? t('map.popup.roadClosed') : t('map.popup.roadOpen')}
                    </div>
                    {isClosed && (
                      <div>
                        {t('map.popup.blockReason')}: {blockReason}
                      </div>
                    )}
                    <div>
                      {t('map.popup.accessible')}:{' '}
                      {isInaccessible ? t('map.popup.no') : t('map.popup.yes')}
                    </div>
                  </div>
                </Popup>
              </Polyline>
            )
          })}

          {overlayRoads.map((road) => {
            const isClosed =
              road.status === 'closed' || road.status === 'blocked' || road.blocked === true
            if (!isClosed) return null
            const blockPoint =
              getExactLatLng({
                lat: road.blockageLat ?? road.lat,
                lng: road.blockageLng ?? road.lng,
              }) || getPolylineMidpoint(road.cleanPath)
            if (!blockPoint) return null
            const roadLengthMeters = road.lengthMeters || calculatePathLengthMeters(road.cleanPath)
            const lengthLabel = formatDistance(roadLengthMeters, lang)
            const blockReason = sanitizeUserNote(
              road.reason || road.blockReason || t('map.popup.roadBlockedReasonDefault'),
              160
            )
            return (
              <Marker
                key={`roadblock-${road.id}`}
                position={blockPoint}
                icon={getRoadblockIcon()}
                zIndexOffset={450}
              >
                <Tooltip>
                  {sanitizeUserNote(road.name, 50)} — {t('map.popup.roadClosed')} ({blockReason})
                </Tooltip>
                <Popup>
                  <div className="map-popup">
                    <div className="map-popup-priority">{t('map.popup.roadClosed')}</div>
                    <strong>{sanitizeUserNote(road.name, 80)}</strong>
                    <div>
                      {t('map.popup.blockReason')}: {blockReason}
                    </div>
                    <div>
                      {t('map.popup.roadLength')}: {lengthLabel}
                    </div>
                  </div>
                </Popup>
              </Marker>
            )
          })}

          {renderedRoute && renderedRoute.geometry.length >= 2 && (
            <Polyline
              key={`active-route-${renderedRoute.geometryApprox ? 'approx' : 'exact'}`}
              positions={renderedRoute.geometry}
              pathOptions={
                renderedRoute.geometryApprox
                  ? {
                      color: '#d97706',
                      weight: 4,
                      dashArray: '8 6',
                      opacity: 0.92,
                    }
                  : {
                      color: '#0284c7',
                      weight: 5,
                      opacity: 0.92,
                    }
              }
            >
              <Tooltip sticky>
                {t('map.popup.routeTitle')} •{' '}
                {renderedRoute.geometryApprox
                  ? t('map.popup.routeApprox')
                  : t('map.popup.routeExact')}
                {renderedRoute.distanceMeters != null
                  ? ` (${formatDistance(renderedRoute.distanceMeters, lang)})`
                  : ''}
              </Tooltip>
              <Popup>
                <div className="map-popup">
                  <strong>{t('map.popup.routeTitle')}</strong>
                  <div>
                    {renderedRoute.geometryApprox
                      ? t('map.popup.routeApprox')
                      : t('map.popup.routeExact')}
                  </div>
                  {renderedRoute.shelter?.name && (
                    <div>
                      {t('map.popup.nearestShelter')}:{' '}
                      {sanitizeUserNote(renderedRoute.shelter.name, 60)}
                    </div>
                  )}
                  {renderedRoute.distanceMeters != null && (
                    <div>
                      {t('map.popup.routeDistance')}:{' '}
                      {formatDistance(renderedRoute.distanceMeters, lang)}
                    </div>
                  )}
                  {renderedRoute.durationSec != null && (
                    <div>
                      {t('map.popup.routeEta')}:{' '}
                      {Math.max(1, Math.ceil(renderedRoute.durationSec / 60))}{' '}
                      {t('map.popup.minutesShort')}
                    </div>
                  )}
                </div>
              </Popup>
            </Polyline>
          )}

          {dashboard.shelters.map((shelter) => {
            const shelterCoords = getExactLatLng(shelter)
            if (!shelterCoords) return null
            const pct = shelter.occupancyPercent ?? shelter.percent ?? 0
            return (
              <Marker
                key={shelter.id}
                position={shelterCoords}
                icon={getShelterIcon(shelter.status, pct, Boolean(shelter.accessible))}
              >
                <Popup>
                  <div className="map-popup">
                    <strong>
                      {shelter.accessible ? '♿ ' : ''}
                      {sanitizeUserNote(shelter.name, 80)}
                    </strong>
                    {(shelter.zoneName || zoneNamesById[shelter.zoneId]) && (
                      <div>
                        {t('map.popup.zone')}:{' '}
                        {sanitizeUserNote(shelter.zoneName || zoneNamesById[shelter.zoneId], 40)}
                      </div>
                    )}
                    <div>
                      {t('map.popup.occupancy')}: {formatNumber(shelter.occupancy ?? 0, lang)} /{' '}
                      {formatNumber(shelter.capacity ?? 0, lang)} ({formatNumber(Math.round(pct), lang)}
                      %)
                    </div>
                    <div>
                      {t('map.popup.status')}:{' '}
                      {t(`rightPanel.shelterStatuses.${shelter.status}`, {
                        defaultValue: shelter.status,
                      })}
                    </div>
                    <div>
                      {t('map.popup.accessible')}:{' '}
                      {shelter.accessible ? t('map.popup.yes') : t('map.popup.no')}
                    </div>
                  </div>
                </Popup>
              </Marker>
            )
          })}

          {dashboard.crews.map((crew) => {
            const crewCoords = getExactLatLng(crew)
            if (!crewCoords) return null
            const crewDist = findCrewTargetDistance(
              crew,
              dashboard.alerts,
              dashboard.sos,
              dashboard.zones
            )
            return (
              <Marker
                key={crew.id}
                position={crewCoords}
                icon={getCrewIcon(crew.status, Boolean(crew.accessibleTransport))}
              >
                <Popup>
                  <div className="map-popup">
                    <strong>
                      {crew.accessibleTransport ? '♿ ' : ''}
                      {sanitizeUserNote(crew.name, 80)}
                    </strong>
                    <div>
                      {t('map.popup.status')}:{' '}
                      {t(`rightPanel.crewStatuses.${crew.status}`, { defaultValue: crew.status })}
                    </div>
                    <div>
                      {t('map.popup.accessibleTransport')}:{' '}
                      {crew.accessibleTransport ? t('map.popup.yes') : t('map.popup.no')}
                    </div>
                    {crewDist && (
                      <div>
                        {t('map.popup.distanceToTarget')}:{' '}
                        {formatDistance(crewDist.distanceMeters, lang)}
                      </div>
                    )}
                    {crew.assignedAlertId && (
                      <div>
                        {t('map.popup.assignedAlert')}: {sanitizeUserNote(crew.assignedAlertId, 40)}
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            )
          })}

          {visibleSos.map((item) => {
            const sosCoords = getExactLatLng(item)
            if (!sosCoords) return null
            const isPriority = item.profile === 'special_needs' || item.priorityRank === 1
            const zoneLabel = sanitizeUserNote(
              item.zoneName || zoneNamesById[item.zoneId] || item.zoneId || '',
              40
            )
            const nearest = findNearestShelter(
              sosCoords[0],
              sosCoords[1],
              dashboard.shelters,
              isPriority
            )
            return (
              <Marker
                key={item.id}
                position={sosCoords}
                icon={getSosIcon(item.type, isPriority)}
                zIndexOffset={isPriority ? 600 : 0}
                ref={(el) => {
                  if (el) {
                    sosMarkerRefs.current[item.id] = el
                  } else {
                    delete sosMarkerRefs.current[item.id]
                  }
                }}
              >
                <Popup>
                  <div className="map-popup">
                    {isPriority && (
                      <div className="map-popup-priority">{t('map.popup.priorityCritical')}</div>
                    )}
                    <strong>
                      {t(`sos.types.${item.type}`, { defaultValue: item.type })}
                      {zoneLabel ? ` — ${zoneLabel}` : ''}
                    </strong>
                    <p className="map-popup-note">
                      {sanitizeUserNote(item.note, 220) || t('sos.noNote')}
                    </p>
                    {nearest && (
                      <div>
                        {t('map.popup.nearestShelter')}:{' '}
                        {sanitizeUserNote(nearest.shelter.name, 50)} (
                        {formatDistance(nearest.distanceMeters, lang)})
                      </div>
                    )}
                    {(item.createdAt || item.ts) && (
                      <div>
                        {t('map.popup.reportedAt')}:{' '}
                        {formatClockTime(item.createdAt || item.ts, lang)}
                      </div>
                    )}
                    <div className="map-popup-coords">
                      {sosCoords[0].toFixed(5)}, {sosCoords[1].toFixed(5)}
                    </div>
                  </div>
                </Popup>
              </Marker>
            )
          })}

          {showSimTarget && getExactLatLng(simTargetCoords) && (
            <Marker
              position={getExactLatLng(simTargetCoords)}
              icon={getTargetIcon()}
            />
          )}
        </MapContainer>

        <div className="map-overlay-bar">
          <div className="map-legend">
            <span className="legend-item">
              <i className="legend-dot legend-normal" />
              {t('map.legend.normal')}
            </span>
            <span className="legend-item">
              <i className="legend-dot legend-warning" />
              {t('map.legend.warning')}
            </span>
            <span className="legend-item">
              <i className="legend-dot legend-critical" />
              {t('map.legend.critical')}
            </span>
            <span className="legend-item">
              <span aria-hidden="true">♿</span>
              {t('map.legend.prioritySos')}
            </span>
            <span className="legend-item">
              <i className="legend-line-closed" />
              {t('map.legend.closedRoad')}
            </span>
            <span className="legend-item">
              <i className="legend-roadblock-badge">✕</i>
              {t('map.legend.roadblock')}
            </span>
            <span className="legend-item">
              <i className="legend-line-route-exact" />
              {t('map.legend.routeExact')}
            </span>
            <span className="legend-item">
              <i className="legend-line-route-approx" />
              {t('map.legend.routeApprox')}
            </span>
            <span className="legend-item">
              <i className="legend-square legend-shelter" />
              {t('map.legend.shelter')}
            </span>
            <span className="legend-item">
              <i className="legend-star">★</i>
              {t('map.legend.crew')}
            </span>
          </div>

          <div className="map-target-pill" title={t('map.clickHint')}>
            <span>{t('map.simTarget')}:</span>
            <code>
              {simTargetCoords.lat.toFixed(4)}, {simTargetCoords.lng.toFixed(4)}
            </code>
          </div>
        </div>
      </div>
    </main>
  )
})
