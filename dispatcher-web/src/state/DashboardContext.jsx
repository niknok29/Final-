import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  approveAlert,
  clearSession,
  clearSuspiciousSos,
  dismissAlert,
  getDashboard,
  getHealth,
  getMe,
  getRoute,
  getStoredSession,
  login,
  normalizeRoutePayload,
  saveSession,
  setApiCallbacks,
  simCloseRoad,
  simFlood,
  simOpenRoad,
  simReset,
  simSetProvider,
  simSetShelterOccupancy,
  simSosBurst,
  USE_MOCK,
} from '../api/client.js'
import { connectDispatcherWS } from '../api/ws.js'
import { playAlertBeep } from '../utils/audio.js'
import { DashboardContext } from './dashboardStore.js'

const EMPTY_FLOOD = {
  active: false,
  suspiciousCount: 0,
  filteredCount: 0,
  accepted: 0,
  duplicates: 0,
  throttled: 0,
}

const EMPTY_DASHBOARD = {
  stats: {
    activeSos: 0,
    prioritySos: 0,
    suspiciousSos: 0,
    pendingAlerts: 0,
    shelters: 0,
    fullShelters: 0,
    totalCrews: 0,
    availableCrews: 0,
  },
  zones: [],
  sos: [],
  shelters: [],
  crews: [],
  alerts: [],
  roads: [],
}

function shouldNotifyGenericActionError(err) {
  return (
    err?.status !== 401 &&
    err?.status !== 403 &&
    err?.status !== 429 &&
    err?.status !== 413 &&
    err?.code !== 'PAYLOAD_TOO_LARGE'
  )
}

function isSuspiciousSosItem(item) {
  return Boolean(
    item && (item.suspicious === true || item.isSuspicious === true || item.status === 'suspicious')
  )
}

function isPrioritySosItem(item) {
  return item?.profile === 'special_needs' || item?.priorityRank === 1
}

function computeStatsFromArrays({ sos, alerts, shelters, crews, flood }) {
  const activeSosItems = sos.filter((s) => s.status !== 'resolved' && !isSuspiciousSosItem(s))
  const activeSos = activeSosItems.length
  const prioritySos = activeSosItems.filter(isPrioritySosItem).length
  const suspiciousFromList = sos.filter(isSuspiciousSosItem).length
  const suspiciousSos = Math.max(flood?.suspiciousCount || 0, suspiciousFromList)
  const pendingAlerts = alerts.filter((a) => a.status === 'pending').length
  const fullShelters = shelters.filter((s) => {
    const pct = s.occupancyPercent ?? s.percent ?? 0
    return s.status !== 'closed' && (s.status === 'full' || s.status === 'near_full' || pct >= 90)
  }).length
  const availableCrews = crews.filter((c) => c.status === 'available').length

  return {
    activeSos,
    prioritySos,
    suspiciousSos,
    pendingAlerts,
    shelters: shelters.length,
    fullShelters,
    totalCrews: crews.length,
    availableCrews,
  }
}

function normalizeFloodTelemetry(currentFlood = EMPTY_FLOOD, payload, sosList = []) {
  const suspiciousFromList = sosList.filter(isSuspiciousSosItem).length
  if (!payload || typeof payload !== 'object') {
    const suspiciousCount = Math.max(currentFlood.suspiciousCount || 0, suspiciousFromList)
    const filteredCount = Math.max(currentFlood.filteredCount || 0, suspiciousCount)
    return {
      ...currentFlood,
      suspiciousCount,
      filteredCount,
      active: Boolean(currentFlood.active || suspiciousCount > 0 || filteredCount > 0),
    }
  }

  const hasExplicitFloodFields =
    payload.flood !== undefined ||
    payload.stats?.flood !== undefined ||
    payload.floodActive !== undefined ||
    payload.suspiciousCount !== undefined ||
    payload.suspiciousSos !== undefined ||
    payload.filteredCount !== undefined ||
    payload.filteredSos !== undefined ||
    payload.stats?.suspiciousSos !== undefined

  if (!hasExplicitFloodFields) {
    const suspiciousCount = Math.max(currentFlood.suspiciousCount || 0, suspiciousFromList)
    const filteredCount = Math.max(currentFlood.filteredCount || 0, suspiciousCount)
    return {
      ...currentFlood,
      suspiciousCount,
      filteredCount,
      active: Boolean(currentFlood.active || suspiciousCount > 0 || filteredCount > 0),
    }
  }

  const src =
    payload.flood && typeof payload.flood === 'object'
      ? payload.flood
      : payload.stats?.flood && typeof payload.stats.flood === 'object'
        ? payload.stats.flood
        : payload
  const rawSuspicious =
    src.suspiciousCount ??
    src.suspiciousLastMinute ??
    src.suspiciousSos ??
    src.suspicious ??
    payload.stats?.suspiciousSos ??
    payload.suspiciousSos
  const rawFiltered =
    src.filteredCount ?? src.filteredSos ?? payload.filteredCount ?? payload.filteredSos
  const rawActive =
    typeof src.active === 'boolean'
      ? src.active
      : typeof payload.floodActive === 'boolean'
        ? payload.floodActive
        : null

  if (
    rawActive === false &&
    Number(rawSuspicious ?? 0) === 0 &&
    Number(rawFiltered ?? 0) === 0
  ) {
    return {
      ...EMPTY_FLOOD,
      active: suspiciousFromList > 0,
      suspiciousCount: suspiciousFromList,
      filteredCount: suspiciousFromList,
    }
  }

  const nextAccepted = src.accepted != null ? Number(src.accepted) || 0 : currentFlood.accepted || 0
  const nextDuplicates =
    src.duplicates != null ? Number(src.duplicates) || 0 : currentFlood.duplicates || 0
  const nextThrottled =
    src.throttled != null ? Number(src.throttled) || 0 : currentFlood.throttled || 0
  const nextSuspicious =
    rawSuspicious != null
      ? Math.max(Number(rawSuspicious) || 0, suspiciousFromList)
      : Math.max(currentFlood.suspiciousCount || 0, suspiciousFromList)
  const nextFiltered =
    rawFiltered != null
      ? Math.max(Number(rawFiltered) || 0, nextSuspicious)
      : Math.max(
          currentFlood.filteredCount || 0,
          nextSuspicious + nextDuplicates + nextThrottled
        )
  const nextActive =
    rawActive !== null
      ? rawActive || nextSuspicious > 0 || nextFiltered > 0
      : Boolean(currentFlood.active || nextSuspicious > 0 || nextFiltered > 0)

  return {
    active: nextActive,
    suspiciousCount: nextSuspicious,
    filteredCount: nextFiltered,
    accepted: nextAccepted,
    duplicates: nextDuplicates,
    throttled: nextThrottled,
  }
}

function upsertById(list, item, prepend = false) {
  if (!item?.id) return list
  const idx = list.findIndex((entry) => entry.id === item.id)
  if (idx === -1) {
    return prepend ? [item, ...list] : [...list, item]
  }
  const next = list.slice()
  next[idx] = { ...next[idx], ...item }
  return next
}

function sortSosByPriorityAndTime(items) {
  return items.slice().sort((a, b) => {
    const rankA = a.priorityRank ?? (a.profile === 'special_needs' ? 1 : 2)
    const rankB = b.priorityRank ?? (b.profile === 'special_needs' ? 1 : 2)
    if (rankA !== rankB) return rankA - rankB
    const tA = Date.parse(a.createdAt || a.ts || 0) || 0
    const tB = Date.parse(b.createdAt || b.ts || 0) || 0
    return tB - tA
  })
}

function applyProviderTelemetry(state, payload) {
  if (!payload || typeof payload !== 'object') return state
  const explicitState = ['up', 'down', 'slow', 'http503'].includes(payload.state)
    ? payload.state
    : null
  const rawProvider = explicitState || payload.routingProvider
  const rawStatus = payload.status
  const rawDegraded =
    typeof payload.degraded === 'boolean' ? payload.degraded : rawStatus === 'degraded'
  const rawBreaker = payload.breaker
  const rawOffline = payload.offline

  if (
    rawProvider === 'up' &&
    !rawDegraded &&
    rawBreaker !== 'open' &&
    !rawOffline
  ) {
    return {
      ...state,
      healthStatus: 'ok',
      routingDegraded: false,
      routingProvider: 'up',
      routingBreaker: 'closed',
      routingOffline: false,
      routingFallbackMode: null,
      routingNotice: null,
    }
  }

  const nextBreaker =
    rawBreaker === 'open' || rawBreaker === 'closed' ? rawBreaker : state.routingBreaker

  let nextProvider = state.routingProvider || 'up'
  if (explicitState) {
    nextProvider = explicitState
  } else if (rawProvider === 'http503' || rawProvider === 'slow' || rawProvider === 'degraded') {
    nextProvider = rawProvider
  } else if (rawProvider === 'down') {
    if (state.routingProvider === 'http503') {
      nextProvider = 'http503'
    } else if (state.routingProvider === 'slow' && nextBreaker !== 'open') {
      nextProvider = 'slow'
    } else {
      nextProvider = 'down'
    }
  } else if (rawDegraded) {
    nextProvider = state.routingProvider !== 'up' ? state.routingProvider : 'degraded'
  } else if (rawBreaker === 'open' && state.routingProvider === 'up') {
    nextProvider = 'down'
  }

  const nextDegraded =
    typeof payload.degraded === 'boolean'
      ? payload.degraded || nextProvider !== 'up' || nextBreaker === 'open'
      : rawStatus === 'degraded' ||
        nextProvider !== 'up' ||
        nextBreaker === 'open' ||
        Boolean(rawOffline)

  const nextOffline =
    typeof rawOffline === 'boolean'
      ? rawOffline
      : nextProvider === 'down' || nextProvider === 'http503' || nextBreaker === 'open'

  const inferredFallback =
    nextProvider === 'http503'
      ? 'static_matrix'
      : nextProvider === 'slow'
        ? 'cache'
        : nextOffline || nextDegraded
          ? 'straight_line'
          : null

  const nextFallbackMode =
    payload.fallbackMode !== undefined
      ? payload.fallbackMode
      : state.routingFallbackMode || inferredFallback

  const nextNotice =
    payload.notice !== undefined
      ? payload.notice && typeof payload.notice === 'object'
        ? payload.notice
        : null
      : { code: 'OFFLINE_BACKUP_ROUTE_MODE', message: null }

  const nextHealthStatus = nextDegraded ? 'degraded' : 'ok'

  return {
    ...state,
    healthStatus: nextHealthStatus,
    routingDegraded: nextDegraded,
    routingProvider: nextProvider,
    routingBreaker: nextBreaker,
    routingOffline: nextOffline,
    routingFallbackMode: nextFallbackMode,
    routingNotice: nextNotice,
  }
}

function createInitialState() {
  const stored = getStoredSession()
  return {
    user: stored || null,
    dashboard: EMPTY_DASHBOARD,
    flood: EMPTY_FLOOD,
    loadingDashboard: Boolean(stored),
    connectionStatus: 'live',
    healthStatus: 'ok',
    routingDegraded: false,
    routingProvider: 'up',
    routingBreaker: 'closed',
    routingOffline: false,
    routingFallbackMode: null,
    routingNotice: null,
    sosFilter: 'all',
    priorityOnlyFilter: false,
    recentSosIds: [],
    mapFocus: null,
    activeRoute: null,
    simTargetCoords: { lat: 40.4093, lng: 49.8671 },
    audioMuted: false,
    simDrawerOpen: false,
    busyAlertIds: [],
    toasts: [],
  }
}

function buildFallbackRouteFromPayload(data, shelters) {
  const fromLat = Number(data?.from?.lat ?? data?.fromLat)
  const fromLng = Number(data?.from?.lng ?? data?.fromLng)
  const targetShelter =
    data?.shelter ||
    shelters.find((s) => s.id === data?.shelterId || s.id === data?.toShelterId) ||
    null
  const toLat = Number(data?.to?.lat ?? targetShelter?.lat)
  const toLng = Number(data?.to?.lng ?? targetShelter?.lng)
  if (
    !Number.isFinite(fromLat) ||
    !Number.isFinite(fromLng) ||
    !Number.isFinite(toLat) ||
    !Number.isFinite(toLng)
  ) {
    return null
  }
  return {
    geometry: [
      [fromLat, fromLng],
      [toLat, toLng],
    ],
    geometryApprox: true,
    distanceMeters: null,
    durationSec: null,
    shelter: targetShelter || null,
    from: { lat: fromLat, lng: fromLng },
    to: { lat: toLat, lng: toLng },
    reason: data?.reason || null,
    rerouted: true,
    source: 'fallback',
    offline: Boolean(data?.offline),
    fallbackMode: data?.fallbackMode || 'straight_line',
    notice: data?.notice || null,
  }
}

function applyWsEventsToState(state, events) {
  if (!Array.isArray(events) || events.length === 0) return state

  let nextState = state
  let d = state.dashboard
  let flood = state.flood
  let sosMap = null
  let sosDirty = false
  let shelters = d.shelters
  let roads = d.roads
  let crews = d.crews
  let alerts = d.alerts
  let zones = d.zones
  let dashboardDirty = false
  let floodDirty = false

  for (const envelope of events) {
    const type = envelope?.type
    const data = envelope?.data
    if (!type || !data) continue

    if (type === 'provider.updated') {
      nextState = applyProviderTelemetry(nextState, data)
      continue
    }

    if (type === 'reroute' || type === 'route.updated') {
      if (
        data.offline !== undefined ||
        data.fallbackMode !== undefined ||
        data.notice !== undefined
      ) {
        nextState = applyProviderTelemetry(nextState, data)
      }
      const normalized = normalizeRoutePayload(data)
      if (normalized && normalized.geometry.length >= 2) {
        nextState = { ...nextState, activeRoute: normalized }
      } else {
        const synthesized = buildFallbackRouteFromPayload(data, shelters)
        if (synthesized) {
          nextState = { ...nextState, activeRoute: synthesized }
        }
      }
      continue
    }

    if (type === 'flood.updated' || type === 'sos.flood') {
      const currentSos = sosMap ? Array.from(sosMap.values()) : d.sos
      flood = normalizeFloodTelemetry(flood, data, currentSos)
      floodDirty = true
      continue
    }

    if (type === 'sos.suspicious_cleared') {
      if (!sosMap) {
        sosMap = new Map(d.sos.map((item) => [item.id, item]))
      }
      for (const [id, item] of sosMap.entries()) {
        if (isSuspiciousSosItem(item) || item.floodGenerated === true) {
          sosMap.delete(id)
        }
      }
      sosDirty = true
      dashboardDirty = true
      flood = { ...EMPTY_FLOOD }
      floodDirty = true
      continue
    }

    if (type === 'sos.created' || type === 'sos.updated') {
      if (data.id) {
        if (!sosMap) {
          sosMap = new Map(d.sos.map((item) => [item.id, item]))
        }
        const existing = sosMap.get(data.id)
        sosMap.set(data.id, existing ? { ...existing, ...data } : data)
        sosDirty = true
        dashboardDirty = true
      }
      if (data.flood || data.suspiciousCount != null) {
        const currentSos = sosMap ? Array.from(sosMap.values()) : d.sos
        flood = normalizeFloodTelemetry(flood, data, currentSos)
        floodDirty = true
      }
    } else if (type === 'shelter.updated') {
      shelters = upsertById(shelters, data)
      dashboardDirty = true
    } else if (type === 'road.updated') {
      const normalizedRoad = {
        ...data,
        blocked: data.blocked ?? (data.status === 'closed' || data.status === 'blocked'),
        reason:
          data.status === 'open'
            ? null
            : data.reason ?? data.blockReason ?? undefined,
      }
      if (normalizedRoad.reason === undefined) {
        delete normalizedRoad.reason
      }
      roads = upsertById(roads, normalizedRoad)
      dashboardDirty = true
    } else if (type === 'crew.updated') {
      crews = upsertById(crews, data)
      dashboardDirty = true
    } else if (type === 'alert.created' || type === 'alert.updated') {
      alerts = upsertById(alerts, data, type === 'alert.created')
      dashboardDirty = true
    } else if (type === 'zone.updated') {
      zones = upsertById(zones, data)
      dashboardDirty = true
    }
  }

  const finalSos = sosDirty
    ? sortSosByPriorityAndTime(Array.from(sosMap.values())).slice(0, 600)
    : d.sos

  if (sosDirty) {
    const suspiciousCountFromSos = finalSos.filter(isSuspiciousSosItem).length
    if (suspiciousCountFromSos > (flood?.suspiciousCount || 0)) {
      flood = {
        ...flood,
        active: true,
        suspiciousCount: suspiciousCountFromSos,
        filteredCount: Math.max(flood?.filteredCount || 0, suspiciousCountFromSos),
      }
      floodDirty = true
    }
  }

  if (!dashboardDirty && !floodDirty) {
    return nextState
  }

  const nextDashboard = {
    zones,
    sos: finalSos,
    shelters,
    crews,
    alerts,
    roads,
  }
  nextDashboard.stats = computeStatsFromArrays({ ...nextDashboard, flood })

  return {
    ...nextState,
    flood,
    dashboard: nextDashboard,
  }
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_USER':
      return {
        ...state,
        user: action.payload,
        loadingDashboard: Boolean(action.payload),
      }

    case 'UPDATE_USER_PROFILE':
      if (!state.user) return state
      return {
        ...state,
        user: {
          ...state.user,
          ...action.payload,
        },
      }

    case 'LOGOUT':
      return {
        ...state,
        user: null,
        dashboard: EMPTY_DASHBOARD,
        flood: EMPTY_FLOOD,
        loadingDashboard: false,
        simDrawerOpen: false,
        recentSosIds: [],
        busyAlertIds: [],
        activeRoute: null,
        mapFocus: null,
      }

    case 'SET_DASHBOARD': {
      const payload = action.payload || {}
      const zones = Array.isArray(payload.zones) ? payload.zones : state.dashboard.zones
      const sos = sortSosByPriorityAndTime(
        Array.isArray(payload.sos) ? payload.sos : state.dashboard.sos
      ).slice(0, 600)
      const shelters = Array.isArray(payload.shelters) ? payload.shelters : state.dashboard.shelters
      const crews = Array.isArray(payload.crews) ? payload.crews : state.dashboard.crews
      const alerts = Array.isArray(payload.alerts) ? payload.alerts : state.dashboard.alerts
      const roads = Array.isArray(payload.roads) ? payload.roads : state.dashboard.roads
      const flood = normalizeFloodTelemetry(state.flood, payload, sos)
      const derived = computeStatsFromArrays({ sos, alerts, shelters, crews, flood })
      return {
        ...state,
        loadingDashboard: false,
        flood,
        dashboard: {
          stats: {
            ...derived,
            ...(payload.stats || {}),
            prioritySos: payload.stats?.prioritySos ?? derived.prioritySos,
            suspiciousSos: Math.max(
              payload.stats?.suspiciousSos ?? 0,
              derived.suspiciousSos,
              flood.suspiciousCount
            ),
          },
          zones,
          sos,
          shelters,
          crews,
          alerts,
          roads,
        },
      }
    }

    case 'APPLY_WS_EVENT':
      return applyWsEventsToState(state, [action.payload])

    case 'APPLY_WS_BATCH':
      return applyWsEventsToState(state, action.payload)

    case 'APPLY_FLOOD_RESULT': {
      const result = action.payload || {}
      let nextFlood
      if (result.flood && typeof result.flood === 'object') {
        nextFlood = normalizeFloodTelemetry(state.flood, result, state.dashboard.sos)
      } else {
        const addedAccepted = Number(result.accepted || 0) || 0
        const addedDuplicates = Number(result.duplicates || 0) || 0
        const addedThrottled = Number(result.throttled || 0) || 0
        const addedSuspicious = Number(result.suspicious || 0) || 0
        const nextSuspicious =
          result.suspiciousCount != null
            ? Number(result.suspiciousCount) || 0
            : (state.flood.suspiciousCount || 0) + addedSuspicious
        const addedFiltered = addedDuplicates + addedThrottled + addedSuspicious
        const nextFiltered =
          result.filteredCount != null
            ? Math.max(Number(result.filteredCount) || 0, nextSuspicious)
            : (state.flood.filteredCount || 0) + addedFiltered
        nextFlood = {
          active: true,
          suspiciousCount: nextSuspicious,
          filteredCount: nextFiltered,
          accepted: (state.flood.accepted || 0) + addedAccepted,
          duplicates: (state.flood.duplicates || 0) + addedDuplicates,
          throttled: (state.flood.throttled || 0) + addedThrottled,
        }
      }
      const nextStats = {
        ...state.dashboard.stats,
        suspiciousSos: Math.max(
          nextFlood.suspiciousCount,
          state.dashboard.stats.suspiciousSos || 0
        ),
      }
      return {
        ...state,
        flood: nextFlood,
        dashboard: {
          ...state.dashboard,
          stats: nextStats,
        },
      }
    }

    case 'CLEAR_SUSPICIOUS_SOS': {
      const nextSos = state.dashboard.sos.filter(
        (item) => !isSuspiciousSosItem(item) && item.floodGenerated !== true
      )
      const nextFlood = { ...EMPTY_FLOOD }
      const nextDashboard = {
        ...state.dashboard,
        sos: nextSos,
      }
      nextDashboard.stats = computeStatsFromArrays({ ...nextDashboard, flood: nextFlood })
      return {
        ...state,
        flood: nextFlood,
        dashboard: nextDashboard,
      }
    }

    case 'APPLY_ALERT_ACTION_RESULT': {
      const { alertId, status, result } = action.payload
      const d = state.dashboard
      let alerts = d.alerts
      if (result?.alert) {
        alerts = upsertById(alerts, result.alert)
      } else {
        alerts = alerts.map((a) => (a.id === alertId ? { ...a, status } : a))
      }
      const crews = result?.crew ? upsertById(d.crews, result.crew) : d.crews
      const resolvedShelter = result?.newShelter || result?.shelter || null
      const shelters = resolvedShelter ? upsertById(d.shelters, resolvedShelter) : d.shelters
      const next = { ...d, alerts, crews, shelters }
      next.stats = computeStatsFromArrays({ ...next, flood: state.flood })
      return { ...state, dashboard: next }
    }

    case 'SET_CONNECTION_STATUS':
      return { ...state, connectionStatus: action.payload }

    case 'SET_HEALTH_STATUS': {
      const withProvider = applyProviderTelemetry(state, action.payload)
      if (
        action.payload &&
        typeof action.payload === 'object' &&
        (action.payload.flood !== undefined ||
          action.payload.floodActive !== undefined ||
          action.payload.suspiciousCount !== undefined ||
          action.payload.filteredCount !== undefined)
      ) {
        const nextFlood = normalizeFloodTelemetry(
          withProvider.flood,
          action.payload,
          withProvider.dashboard.sos
        )
        return {
          ...withProvider,
          flood: nextFlood,
          dashboard: {
            ...withProvider.dashboard,
            stats: {
              ...withProvider.dashboard.stats,
              suspiciousSos: nextFlood.suspiciousCount,
            },
          },
        }
      }
      return withProvider
    }

    case 'SET_SOS_FILTER':
      return { ...state, sosFilter: action.payload }

    case 'TOGGLE_PRIORITY_ONLY_FILTER':
      return {
        ...state,
        priorityOnlyFilter:
          typeof action.payload === 'boolean' ? action.payload : !state.priorityOnlyFilter,
      }

    case 'ADD_RECENT_SOS': {
      if (state.recentSosIds.includes(action.payload)) return state
      return { ...state, recentSosIds: [action.payload, ...state.recentSosIds].slice(0, 20) }
    }

    case 'REMOVE_RECENT_SOS':
      return {
        ...state,
        recentSosIds: state.recentSosIds.filter((id) => id !== action.payload),
      }

    case 'ADD_RECENT_SOS_BATCH': {
      const incoming = Array.isArray(action.payload) ? action.payload : []
      if (incoming.length === 0) return state
      const merged = Array.from(new Set([...incoming, ...state.recentSosIds])).slice(0, 20)
      return { ...state, recentSosIds: merged }
    }

    case 'REMOVE_RECENT_SOS_BATCH': {
      const removeSet = new Set(Array.isArray(action.payload) ? action.payload : [])
      if (removeSet.size === 0) return state
      return {
        ...state,
        recentSosIds: state.recentSosIds.filter((id) => !removeSet.has(id)),
      }
    }

    case 'SET_MAP_FOCUS':
      return {
        ...state,
        mapFocus: { ...action.payload, seq: (state.mapFocus?.seq || 0) + 1 },
      }

    case 'SET_ACTIVE_ROUTE':
      return {
        ...state,
        activeRoute: action.payload || null,
      }

    case 'SET_SIM_TARGET_COORDS':
      return { ...state, simTargetCoords: action.payload }

    case 'TOGGLE_AUDIO_MUTED':
      return { ...state, audioMuted: !state.audioMuted }

    case 'TOGGLE_SIM_DRAWER':
      return {
        ...state,
        simDrawerOpen: typeof action.payload === 'boolean' ? action.payload : !state.simDrawerOpen,
      }

    case 'SET_ALERT_BUSY': {
      const { alertId, busy } = action.payload
      const busyAlertIds = busy
        ? Array.from(new Set([...state.busyAlertIds, alertId]))
        : state.busyAlertIds.filter((id) => id !== alertId)
      return { ...state, busyAlertIds }
    }

    case 'ADD_TOAST':
      return {
        ...state,
        toasts: [action.payload, ...state.toasts].slice(0, 4),
      }

    case 'REMOVE_TOAST':
      return {
        ...state,
        toasts: state.toasts.filter((item) => item.id !== action.payload),
      }

    default:
      return state
  }
}

export function DashboardProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, null, createInitialState)
  const { t, i18n } = useTranslation()
  const audioMutedRef = useRef(state.audioMuted)
  const floodSuspiciousRef = useRef(state.flood?.suspiciousCount ?? 0)
  const toastSeqRef = useRef(1)
  const focusRouteSeqRef = useRef(0)
  const wsBatchQueueRef = useRef([])
  const wsBatchTimerRef = useRef(null)

  useEffect(() => {
    audioMutedRef.current = state.audioMuted
  }, [state.audioMuted])

  useEffect(() => {
    floodSuspiciousRef.current = state.flood?.suspiciousCount ?? 0
  }, [state.flood?.suspiciousCount])

  const addToast = useCallback((message, variant = 'info') => {
    const id = `toast-${Date.now()}-${toastSeqRef.current++}`
    dispatch({ type: 'ADD_TOAST', payload: { id, message, variant } })
    setTimeout(() => {
      dispatch({ type: 'REMOVE_TOAST', payload: id })
    }, 4500)
  }, [])

  const removeToast = useCallback((id) => {
    dispatch({ type: 'REMOVE_TOAST', payload: id })
  }, [])

  const handleLogout = useCallback(() => {
    clearSession()
    dispatch({ type: 'LOGOUT' })
  }, [])

  useEffect(() => {
    setApiCallbacks({
      onUnauthorized: () => {
        dispatch({ type: 'LOGOUT' })
      },
      onForbidden: () => {
        addToast(t('toast.forbidden'), 'error')
      },
      onRateLimit: (info) => {
        const retryAfter = typeof info === 'object' ? info?.retryAfter : info
        const code = typeof info === 'object' ? info?.code : 'RATE_LIMITED'
        if (code === 'LOGIN_LOCKED') {
          addToast(t('toast.loginLocked', { seconds: retryAfter || 60 }), 'error')
        } else if (retryAfter) {
          addToast(t('toast.rateLimitRetry', { seconds: retryAfter }), 'warning')
        } else {
          addToast(t('toast.rateLimit'), 'warning')
        }
      },
      onPayloadTooLarge: () => {
        addToast(t('toast.payloadTooLarge'), 'error')
      },
    })
  }, [addToast, t])

  const loadSnapshotAndHealth = useCallback(async () => {
    try {
      const [snapshot, health] = await Promise.all([
        getDashboard(),
        getHealth().catch(() => ({
          status: 'degraded',
          routingProvider: 'down',
          breaker: 'open',
          offline: true,
          fallbackMode: 'straight_line',
          notice: { code: 'OFFLINE_BACKUP_ROUTE_MODE', message: null },
        })),
      ])
      dispatch({ type: 'SET_DASHBOARD', payload: snapshot })
      if (health && typeof health === 'object') {
        dispatch({ type: 'SET_HEALTH_STATUS', payload: health })
      }
    } catch {
      // Handled by api callbacks on 401/403/429 or timeout
    }
  }, [])

  const wsLang = USE_MOCK ? 'az' : i18n.language

  useEffect(() => {
    const token = state.user?.token
    if (!token) return undefined

    let active = true

    getMe()
      .then((me) => {
        if (!active || !me) return
        dispatch({ type: 'UPDATE_USER_PROFILE', payload: me })
        const stored = getStoredSession()
        if (stored?.token) {
          saveSession({ ...stored, ...me })
        }
      })
      .catch(() => {
        // Handled by apiFetch callbacks on 401
      })

    loadSnapshotAndHealth()

    const healthInterval = setInterval(async () => {
      try {
        const health = await getHealth()
        if (health && typeof health === 'object') {
          dispatch({ type: 'SET_HEALTH_STATUS', payload: health })
        }
      } catch {
        dispatch({
          type: 'SET_HEALTH_STATUS',
          payload: {
            status: 'degraded',
            routingProvider: 'down',
            breaker: 'open',
            offline: true,
            fallbackMode: 'straight_line',
            notice: { code: 'OFFLINE_BACKUP_ROUTE_MODE', message: null },
          },
        })
      }
    }, 20000)

    const flushWsBatch = () => {
      wsBatchTimerRef.current = null
      const batch = wsBatchQueueRef.current
      if (!batch.length) return
      wsBatchQueueRef.current = []

      dispatch({ type: 'APPLY_WS_BATCH', payload: batch })

      const createdIds = []
      let hasAlertCreated = false
      for (const envelope of batch) {
        if (envelope?.type === 'sos.created' && envelope.data?.id && createdIds.length < 10) {
          createdIds.push(envelope.data.id)
        } else if (envelope?.type === 'alert.created') {
          hasAlertCreated = true
        }
      }

      if (createdIds.length > 0) {
        dispatch({ type: 'ADD_RECENT_SOS_BATCH', payload: createdIds })
        setTimeout(() => {
          dispatch({ type: 'REMOVE_RECENT_SOS_BATCH', payload: createdIds })
        }, 3500)
      }
      if (hasAlertCreated && !audioMutedRef.current) {
        playAlertBeep()
      }
    }

    const disconnectWs = connectDispatcherWS({
      token,
      lang: wsLang,
      onStatusChange: (status) => {
        dispatch({ type: 'SET_CONNECTION_STATUS', payload: status })
      },
      onReconnectResync: async () => {
        await loadSnapshotAndHealth()
        addToast(t('toast.reconnected'), 'success')
      },
      onAuthFailure: () => {
        clearSession()
        dispatch({ type: 'LOGOUT' })
        addToast(t('toast.wsAuthExpired'), 'error')
      },
      onEvent: (envelope) => {
        wsBatchQueueRef.current.push(envelope)
        if (!wsBatchTimerRef.current) {
          wsBatchTimerRef.current = setTimeout(flushWsBatch, 200)
        }
      },
    })

    return () => {
      active = false
      if (wsBatchTimerRef.current) {
        clearTimeout(wsBatchTimerRef.current)
        wsBatchTimerRef.current = null
      }
      wsBatchQueueRef.current = []
      clearInterval(healthInterval)
      disconnectWs()
    }
  }, [state.user?.token, wsLang, loadSnapshotAndHealth, addToast, t])

  const handleLogin = useCallback(async (username, password) => {
    const session = await login(username, password)
    dispatch({ type: 'SET_USER', payload: session })
    return session
  }, [])

  const handleApproveAlert = useCallback(
    async (alert) => {
      if (!alert?.id) return
      dispatch({ type: 'SET_ALERT_BUSY', payload: { alertId: alert.id, busy: true } })
      try {
        const result = await approveAlert(alert.id)
        dispatch({
          type: 'APPLY_ALERT_ACTION_RESULT',
          payload: { alertId: alert.id, status: 'approved', result },
        })
        if (typeof alert.lat === 'number' && typeof alert.lng === 'number') {
          dispatch({
            type: 'SET_MAP_FOCUS',
            payload: { lat: alert.lat, lng: alert.lng, zoom: 15, alertId: alert.id },
          })
        }

        const crewName =
          result?.crew?.name ||
          result?.alert?.proposal?.crewName ||
          alert.proposal?.crewName ||
          'Crew'
        const shelterName =
          result?.newShelter?.name ||
          result?.shelter?.name ||
          alert.proposal?.newShelterName ||
          alert.proposal?.openShelterName ||
          null

        if (
          alert.kind === 'PRIORITY_SOS' ||
          alert.code === 'PRIORITY_SOS_DISPATCH_ACCESSIBLE_TRANSPORT' ||
          !shelterName
        ) {
          addToast(t('toast.priorityAlertApproved', { crew: crewName }), 'success')
        } else {
          addToast(
            t('toast.alertApproved', { crew: crewName, shelter: shelterName }),
            'success'
          )
        }
      } catch (err) {
        if (err?.code === 'ALERT_NOT_PENDING') {
          addToast(t('toast.alertNotPending'), 'warning')
          await loadSnapshotAndHealth()
        } else if (err?.code === 'NO_CREW_AVAILABLE') {
          addToast(t('toast.noCrewAvailable'), 'error')
        } else if (shouldNotifyGenericActionError(err)) {
          addToast(err?.message || t('toast.actionError'), 'error')
        }
      } finally {
        dispatch({ type: 'SET_ALERT_BUSY', payload: { alertId: alert.id, busy: false } })
      }
    },
    [addToast, loadSnapshotAndHealth, t]
  )

  const handleDismissAlert = useCallback(
    async (alert) => {
      if (!alert?.id) return
      dispatch({ type: 'SET_ALERT_BUSY', payload: { alertId: alert.id, busy: true } })
      try {
        const result = await dismissAlert(alert.id)
        dispatch({
          type: 'APPLY_ALERT_ACTION_RESULT',
          payload: { alertId: alert.id, status: 'dismissed', result },
        })
        addToast(t('toast.alertDismissed'), 'info')
      } catch (err) {
        if (err?.code === 'ALERT_NOT_PENDING') {
          addToast(t('toast.alertNotPending'), 'warning')
          await loadSnapshotAndHealth()
        } else if (shouldNotifyGenericActionError(err)) {
          addToast(err?.message || t('toast.actionError'), 'error')
        }
      } finally {
        dispatch({ type: 'SET_ALERT_BUSY', payload: { alertId: alert.id, busy: false } })
      }
    },
    [addToast, loadSnapshotAndHealth, t]
  )

  const handleSimCloseRoad = useCallback(
    async (road) => {
      if (!road?.id) return
      try {
        const updated = await simCloseRoad(road.id)
        if (updated?.id) {
          dispatch({ type: 'APPLY_WS_EVENT', payload: { type: 'road.updated', data: updated } })
          const reroute = normalizeRoutePayload(updated.reroute || updated)
          if (reroute && reroute.geometry.length >= 2) {
            dispatch({ type: 'SET_ACTIVE_ROUTE', payload: reroute })
          }
        } else {
          await loadSnapshotAndHealth()
        }
        addToast(t('toast.roadClosed', { road: road.name }), 'warning')
      } catch (err) {
        if (shouldNotifyGenericActionError(err)) {
          addToast(t('toast.actionError'), 'error')
        }
      }
    },
    [addToast, loadSnapshotAndHealth, t]
  )

  const handleSimOpenRoad = useCallback(
    async (road) => {
      if (!road?.id) return
      try {
        const updated = await simOpenRoad(road.id)
        if (updated?.id) {
          dispatch({ type: 'APPLY_WS_EVENT', payload: { type: 'road.updated', data: updated } })
        } else {
          await loadSnapshotAndHealth()
        }
        addToast(t('toast.roadOpened', { road: road.name }), 'success')
      } catch (err) {
        if (shouldNotifyGenericActionError(err)) {
          addToast(t('toast.actionError'), 'error')
        }
      }
    },
    [addToast, loadSnapshotAndHealth, t]
  )

  const handleSimShelterOccupancy = useCallback(
    async (shelter, percent) => {
      if (!shelter?.id) return
      try {
        const updated = await simSetShelterOccupancy(shelter.id, percent)
        if (updated?.id) {
          dispatch({ type: 'APPLY_WS_EVENT', payload: { type: 'shelter.updated', data: updated } })
        } else {
          await loadSnapshotAndHealth()
        }
        addToast(t('toast.shelterUpdated', { shelter: shelter.name, percent }), 'info')
      } catch (err) {
        if (shouldNotifyGenericActionError(err)) {
          addToast(t('toast.actionError'), 'error')
        }
      }
    },
    [addToast, loadSnapshotAndHealth, t]
  )

  const handleSimSosBurst = useCallback(
    async ({ lat, lng, type = 'fire', note = '' }) => {
      try {
        await simSosBurst({ lat, lng, count: 4, type, note })
        dispatch({
          type: 'SET_MAP_FOCUS',
          payload: { lat, lng, zoom: 15 },
        })
        addToast(t('toast.sosBurstSent'), 'warning')
      } catch (err) {
        if (shouldNotifyGenericActionError(err)) {
          addToast(t('toast.actionError'), 'error')
        }
      }
    },
    [addToast, t]
  )

  const handleSimFlood = useCallback(
    async (count = 600) => {
      try {
        const result = await simFlood({ count })
        dispatch({ type: 'APPLY_FLOOD_RESULT', payload: result })
        addToast(
          t('toast.sosFloodResult', {
            accepted: result?.accepted ?? 0,
            duplicates: result?.duplicates ?? 0,
            throttled: result?.throttled ?? 0,
            suspicious: result?.suspicious ?? result?.suspiciousCount ?? 0,
          }),
          'warning'
        )
        return result
      } catch (err) {
        if (shouldNotifyGenericActionError(err)) {
          addToast(t('toast.actionError'), 'error')
        }
        return null
      }
    },
    [addToast, t]
  )

  const handleClearSuspiciousSos = useCallback(async () => {
    try {
      const result = await clearSuspiciousSos()
      const clearedCount = result?.removed ?? result?.cleared ?? floodSuspiciousRef.current ?? 0
      dispatch({ type: 'CLEAR_SUSPICIOUS_SOS' })
      addToast(t('toast.suspiciousCleared', { count: clearedCount }), 'success')
      return result
    } catch (err) {
      if (shouldNotifyGenericActionError(err)) {
        addToast(t('toast.actionError'), 'error')
      }
      return null
    }
  }, [addToast, t])

  const handleSimSetProvider = useCallback(
    async (nextState) => {
      try {
        const res = await simSetProvider(nextState)
        const inferredBreaker =
          nextState === 'up'
            ? 'closed'
            : nextState === 'http503' || nextState === 'down'
              ? 'open'
              : state.routingBreaker
        const inferredFallback =
          nextState === 'http503'
            ? 'static_matrix'
            : nextState === 'slow'
              ? 'cache'
              : nextState === 'down'
                ? 'straight_line'
                : null

        dispatch({
          type: 'APPLY_WS_EVENT',
          payload: {
            type: 'provider.updated',
            data: {
              ...(res && typeof res === 'object' ? res : {}),
              state: nextState,
              routingProvider: nextState,
              status: 'ok',
              degraded: nextState !== 'up',
              breaker: inferredBreaker,
              offline: nextState === 'down' || nextState === 'http503',
              fallbackMode: res?.fallbackMode ?? inferredFallback,
              notice: nextState === 'up' ? null : { code: 'OFFLINE_BACKUP_ROUTE_MODE', message: null },
            },
          },
        })
        const routeUpdate = normalizeRoutePayload(res)
        if (routeUpdate && routeUpdate.geometry.length >= 2) {
          dispatch({ type: 'SET_ACTIVE_ROUTE', payload: routeUpdate })
        }
        addToast(t('toast.providerUpdated', { state: nextState.toUpperCase() }), 'info')
      } catch (err) {
        if (shouldNotifyGenericActionError(err)) {
          addToast(t('toast.actionError'), 'error')
        }
      }
    },
    [addToast, state.routingBreaker, t]
  )

  const handleSimReset = useCallback(async () => {
    try {
      const result = await simReset()
      dispatch({ type: 'CLEAR_SUSPICIOUS_SOS' })
      dispatch({ type: 'SET_ACTIVE_ROUTE', payload: null })
      dispatch({
        type: 'APPLY_WS_EVENT',
        payload: {
          type: 'provider.updated',
          data: {
            state: 'up',
            routingProvider: 'up',
            status: 'ok',
            degraded: false,
            breaker: 'closed',
            offline: false,
            fallbackMode: null,
            notice: null,
          },
        },
      })
      if (result?.sos && result?.alerts) {
        dispatch({ type: 'SET_DASHBOARD', payload: result })
      } else {
        await loadSnapshotAndHealth()
      }
      addToast(t('toast.simReset'), 'success')
    } catch (err) {
      if (shouldNotifyGenericActionError(err)) {
        addToast(t('toast.actionError'), 'error')
      }
    }
  }, [loadSnapshotAndHealth, addToast, t])

  const setSosFilter = useCallback(
    (filter) => dispatch({ type: 'SET_SOS_FILTER', payload: filter }),
    []
  )
  const togglePriorityOnlyFilter = useCallback(
    (val) => dispatch({ type: 'TOGGLE_PRIORITY_ONLY_FILTER', payload: val }),
    []
  )
  const focusMap = useCallback((focus) => {
    dispatch({ type: 'SET_MAP_FOCUS', payload: focus })
    const lat = Number(focus?.lat)
    const lng = Number(focus?.lng)
    if (!focus?.skipRoute && Number.isFinite(lat) && Number.isFinite(lng)) {
      const seq = ++focusRouteSeqRef.current
      getRoute({
        fromLat: lat,
        fromLng: lng,
        shelterId: focus.shelterId || null,
        profile: focus.profile || 'standard',
      })
        .then((routeData) => {
          if (seq !== focusRouteSeqRef.current) return
          if (routeData && routeData.geometry.length >= 2) {
            dispatch({ type: 'SET_ACTIVE_ROUTE', payload: routeData })
          }
        })
        .catch(() => {
          // Non-fatal: map fallback handles missing route response gracefully
        })
    }
  }, [])
  const setSimTargetCoords = useCallback(
    (coords) => dispatch({ type: 'SET_SIM_TARGET_COORDS', payload: coords }),
    []
  )
  const toggleAudioMuted = useCallback(() => dispatch({ type: 'TOGGLE_AUDIO_MUTED' }), [])
  const toggleSimDrawer = useCallback(
    (open) => dispatch({ type: 'TOGGLE_SIM_DRAWER', payload: open }),
    []
  )

  const value = useMemo(
    () => ({
      ...state,
      handleLogin,
      handleLogout,
      handleApproveAlert,
      handleDismissAlert,
      handleSimCloseRoad,
      handleSimOpenRoad,
      handleSimShelterOccupancy,
      handleSimSosBurst,
      handleSimFlood,
      handleClearSuspiciousSos,
      handleSimSetProvider,
      handleSimReset,
      removeToast,
      setSosFilter,
      togglePriorityOnlyFilter,
      focusMap,
      setSimTargetCoords,
      toggleAudioMuted,
      toggleSimDrawer,
    }),
    [
      state,
      handleLogin,
      handleLogout,
      handleApproveAlert,
      handleDismissAlert,
      handleSimCloseRoad,
      handleSimOpenRoad,
      handleSimShelterOccupancy,
      handleSimSosBurst,
      handleSimFlood,
      handleClearSuspiciousSos,
      handleSimSetProvider,
      handleSimReset,
      removeToast,
      setSosFilter,
      togglePriorityOnlyFilter,
      focusMap,
      setSimTargetCoords,
      toggleAudioMuted,
      toggleSimDrawer,
    ]
  )

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
}
