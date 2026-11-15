import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  Circle,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import { can } from '../auth/permissions.js'
import { useDashboard } from '../state/dashboardStore.js'
import { sanitizeUserNote } from '../utils/sanitize.js'

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

function getSosIcon(type) {
  const safeType = HAZARD_META[type] ? type : 'fire'
  const key = `sos:${safeType}`
  if (iconCache.has(key)) return iconCache.get(key)

  const meta = HAZARD_META[safeType]
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

function getShelterIcon(status, percent) {
  const safeStatus = SHELTER_COLORS[status] ? status : 'open'
  const safePct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)))
  const key = `shelter:${safeStatus}:${safePct}`
  if (iconCache.has(key)) return iconCache.get(key)

  const color = SHELTER_COLORS[safeStatus]
  const label = safeStatus === 'closed' ? 'OFF' : `${safePct}%`
  const icon = L.divIcon({
    className: 'custom-div-icon',
    iconSize: [44, 24],
    iconAnchor: [22, 12],
    popupAnchor: [0, -12],
    html: `<div class="map-shelter-pin" style="border-color:${color};"><span class="map-shelter-dot" style="background:${color};"></span><span>${label}</span></div>`,
  })
  iconCache.set(key, icon)
  return icon
}

function getCrewIcon(status) {
  const safeStatus = CREW_COLORS[status] ? status : 'available'
  const key = `crew:${safeStatus}`
  if (iconCache.has(key)) return iconCache.get(key)

  const color = CREW_COLORS[safeStatus]
  const icon = L.divIcon({
    className: 'custom-div-icon',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -13],
    html: `<div class="map-crew-pin" style="border-color:${color}; color:${color};">★</div>`,
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

export function CrisisMap() {
  const { t } = useTranslation()
  const {
    user,
    dashboard,
    sosFilter,
    mapFocus,
    simTargetCoords,
    simDrawerOpen,
    setSimTargetCoords,
  } = useDashboard()

  const sosMarkerRefs = useRef({})
  const showSimTarget = can(user?.role, 'simulate') && simDrawerOpen

  const visibleSos = dashboard.sos.filter((item) =>
    sosFilter === 'all' ? true : item.type === sosFilter
  )

  const closedRoads = dashboard.roads.filter((r) => r.status === 'closed' && Array.isArray(r.path))

  return (
    <main className="panel panel-map" aria-label="Baku Crisis Map">
      <div className="map-wrapper">
        <MapContainer
          center={BAKU_CENTER}
          zoom={DEFAULT_ZOOM}
          className="crisis-leaflet-map"
          zoomControl={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapController mapFocus={mapFocus} sosMarkerRefs={sosMarkerRefs} />
          <MapClickHandler onSelectCoords={setSimTargetCoords} />

          {dashboard.zones.map((zone) => {
            const style = ZONE_COLORS[zone.level] || ZONE_COLORS.normal
            return (
              <Circle
                key={zone.id}
                center={[zone.lat, zone.lng]}
                radius={zone.radius || 1300}
                pathOptions={{
                  color: style.color,
                  fillColor: style.fillColor,
                  fillOpacity: style.fillOpacity,
                  weight: 1.5,
                }}
              >
                <Popup>
                  <div className="map-popup">
                    <strong>{sanitizeUserNote(zone.name, 60)}</strong>
                    <div>
                      {t('map.popup.activeSos')}: {zone.activeSos}
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

          {closedRoads.map((road) => (
            <Polyline
              key={road.id}
              positions={road.path}
              pathOptions={{
                color: '#ef4444',
                weight: 5,
                dashArray: '10 8',
                opacity: 0.92,
              }}
            >
              <Popup>
                <div className="map-popup">
                  <strong>{sanitizeUserNote(road.name, 80)}</strong>
                  <div>{t('map.popup.roadClosed')}</div>
                </div>
              </Popup>
            </Polyline>
          ))}

          {dashboard.shelters.map((shelter) => (
            <Marker
              key={shelter.id}
              position={[shelter.lat, shelter.lng]}
              icon={getShelterIcon(shelter.status, shelter.percent)}
            >
              <Popup>
                <div className="map-popup">
                  <strong>{sanitizeUserNote(shelter.name, 80)}</strong>
                  <div>
                    {t('map.popup.zone')}: {sanitizeUserNote(shelter.zoneName, 40)}
                  </div>
                  <div>
                    {t('map.popup.occupancy')}: {shelter.occupancy} / {shelter.capacity} (
                    {shelter.percent}%)
                  </div>
                  <div>
                    {t('map.popup.status')}:{' '}
                    {t(`rightPanel.shelterStatuses.${shelter.status}`, {
                      defaultValue: shelter.status,
                    })}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}

          {dashboard.crews.map((crew) => (
            <Marker
              key={crew.id}
              position={[crew.lat, crew.lng]}
              icon={getCrewIcon(crew.status)}
            >
              <Popup>
                <div className="map-popup">
                  <strong>{sanitizeUserNote(crew.name, 80)}</strong>
                  <div>
                    {t('map.popup.status')}:{' '}
                    {t(`rightPanel.crewStatuses.${crew.status}`, { defaultValue: crew.status })}
                  </div>
                  {crew.assignedAlertId && (
                    <div>
                      {t('map.popup.assignedAlert')}: {sanitizeUserNote(crew.assignedAlertId, 40)}
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}

          {visibleSos.map((item) => (
            <Marker
              key={item.id}
              position={[item.lat, item.lng]}
              icon={getSosIcon(item.type)}
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
                  <strong>
                    {t(`sos.types.${item.type}`, { defaultValue: item.type })} —{' '}
                    {sanitizeUserNote(item.zoneName, 40)}
                  </strong>
                  <p className="map-popup-note">
                    {sanitizeUserNote(item.note, 220) || t('sos.noNote')}
                  </p>
                  <div className="map-popup-coords">
                    {Number(item.lat).toFixed(5)}, {Number(item.lng).toFixed(5)}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}

          {showSimTarget && (
            <Marker
              position={[simTargetCoords.lat, simTargetCoords.lng]}
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
              <i className="legend-line-closed" />
              {t('map.legend.closedRoad')}
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
}
