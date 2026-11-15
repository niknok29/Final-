import { useCallback, useEffect, useReducer, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  approveAlert,
  clearSession,
  dismissAlert,
  getDashboard,
  getHealth,
  getStoredSession,
  login,
  setApiCallbacks,
  simCloseRoad,
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

const EMPTY_DASHBOARD = {
  stats: {
    activeSos: 0,
    prioritySos: 0,
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

function isPrioritySosItem(item) {
  return item?.profile === 'special_needs' || item?.priorityRank === 1
}

function computeStatsFromArrays({ sos, alerts, shelters, crews }) {
  const activeSosItems = sos.filter((s) => s.status !== 'resolved')
  const activeSos = activeSosItems.length
  const prioritySos = activeSosItems.filter(isPrioritySosItem).length
  const pendingAlerts = alerts.filter((a) => a.status === 'pending').length
  const fullShelters = shelters.filter((s) => {
    const pct = s.occupancyPercent ?? s.percent ?? 0
    return s.status !== 'closed' && (s.status === 'full' || s.status === 'near_full' || pct >= 90)
  }).length
  const availableCrews = crews.filter((c) => c.status === 'available').length

  return {
    activeSos,
    prioritySos,
    pendingAlerts,
    shelters: shelters.length,
    fullShelters,
    totalCrews: crews.length,
    availableCrews,
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

function createInitialState() {
  const stored = getStoredSession()
  return {
    user: stored || null,
    dashboard: EMPTY_DASHBOARD,
    loadingDashboard: Boolean(stored),
    connectionStatus: 'live',
    routingProvider: 'up',
    routingBreaker: 'closed',
    sosFilter: 'all',
    priorityOnlyFilter: false,
    recentSosIds: [],
    mapFocus: null,
    simTargetCoords: { lat: 40.4093, lng: 49.8671 },
    audioMuted: false,
    simDrawerOpen: false,
    busyAlertIds: [],
    toasts: [],
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

    case 'LOGOUT':
      return {
        ...state,
        user: null,
        dashboard: EMPTY_DASHBOARD,
        loadingDashboard: false,
        simDrawerOpen: false,
        recentSosIds: [],
        busyAlertIds: [],
      }

    case 'SET_DASHBOARD': {
      const payload = action.payload || {}
      const zones = Array.isArray(payload.zones) ? payload.zones : state.dashboard.zones
      const sos = sortSosByPriorityAndTime(
        Array.isArray(payload.sos) ? payload.sos : state.dashboard.sos
      )
      const shelters = Array.isArray(payload.shelters) ? payload.shelters : state.dashboard.shelters
      const crews = Array.isArray(payload.crews) ? payload.crews : state.dashboard.crews
      const alerts = Array.isArray(payload.alerts) ? payload.alerts : state.dashboard.alerts
      const roads = Array.isArray(payload.roads) ? payload.roads : state.dashboard.roads
      const derived = computeStatsFromArrays({ sos, alerts, shelters, crews })
      return {
        ...state,
        loadingDashboard: false,
        dashboard: {
          stats: {
            ...derived,
            ...(payload.stats || {}),
            prioritySos: payload.stats?.prioritySos ?? derived.prioritySos,
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

    case 'APPLY_WS_EVENT': {
      const { type, data } = action.payload || {}
      if (!type || !data) return state
      if (type === 'provider.updated') {
        return {
          ...state,
          routingProvider: data.state || state.routingProvider,
          routingBreaker: data.breaker || state.routingBreaker,
        }
      }
      const d = state.dashboard
      let next = d

      if (type === 'sos.created' || type === 'sos.updated') {
        const sos = sortSosByPriorityAndTime(upsertById(d.sos, data, type === 'sos.created'))
        next = { ...d, sos }
      } else if (type === 'shelter.updated') {
        next = { ...d, shelters: upsertById(d.shelters, data) }
      } else if (type === 'road.updated') {
        next = { ...d, roads: upsertById(d.roads, data) }
      } else if (type === 'crew.updated') {
        next = { ...d, crews: upsertById(d.crews, data) }
      } else if (type === 'alert.created' || type === 'alert.updated') {
        next = { ...d, alerts: upsertById(d.alerts, data, type === 'alert.created') }
      } else if (type === 'zone.updated') {
        next = { ...d, zones: upsertById(d.zones, data) }
      } else {
        return state
      }

      next.stats = computeStatsFromArrays(next)
      return {
        ...state,
        dashboard: next,
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
      next.stats = computeStatsFromArrays(next)
      return { ...state, dashboard: next }
    }

    case 'SET_CONNECTION_STATUS':
      return { ...state, connectionStatus: action.payload }

    case 'SET_HEALTH_STATUS': {
      const { routingProvider, breaker } = action.payload || {}
      const nextBreaker = breaker || state.routingBreaker
      let nextProvider = state.routingProvider
      if (routingProvider === 'up') {
        nextProvider = 'up'
      } else if (routingProvider === 'down') {
        nextProvider =
          state.routingProvider === 'slow' && nextBreaker !== 'open' ? 'slow' : 'down'
      }
      return {
        ...state,
        routingProvider: nextProvider,
        routingBreaker: nextBreaker,
      }
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

    case 'SET_MAP_FOCUS':
      return {
        ...state,
        mapFocus: { ...action.payload, seq: (state.mapFocus?.seq || 0) + 1 },
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
  const toastSeqRef = useRef(1)

  useEffect(() => {
    audioMutedRef.current = state.audioMuted
  }, [state.audioMuted])

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
      onRateLimit: (retryAfter) => {
        if (retryAfter) {
          addToast(t('toast.rateLimitRetry', { seconds: retryAfter }), 'warning')
        } else {
          addToast(t('toast.rateLimit'), 'warning')
        }
      },
    })
  }, [addToast, t])

  const loadSnapshotAndHealth = useCallback(async () => {
    try {
      const [snapshot, health] = await Promise.all([
        getDashboard(),
        getHealth().catch(() => ({ routingProvider: 'down' })),
      ])
      dispatch({ type: 'SET_DASHBOARD', payload: snapshot })
      if (health?.routingProvider || health?.breaker) {
        dispatch({ type: 'SET_HEALTH_STATUS', payload: health })
      }
    } catch {
      // Handled by api callbacks on 401/429
    }
  }, [])

  const wsLang = USE_MOCK ? 'az' : i18n.language

  useEffect(() => {
    const token = state.user?.token
    if (!token) return undefined

    loadSnapshotAndHealth()

    const healthInterval = setInterval(async () => {
      try {
        const health = await getHealth()
        if (health?.routingProvider || health?.breaker) {
          dispatch({ type: 'SET_HEALTH_STATUS', payload: health })
        }
      } catch {
        dispatch({
          type: 'SET_HEALTH_STATUS',
          payload: { routingProvider: 'down', breaker: 'open' },
        })
      }
    }, 20000)

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
        dispatch({ type: 'APPLY_WS_EVENT', payload: envelope })
        if (envelope.type === 'sos.created' && envelope.data?.id) {
          const id = envelope.data.id
          dispatch({ type: 'ADD_RECENT_SOS', payload: id })
          setTimeout(() => {
            dispatch({ type: 'REMOVE_RECENT_SOS', payload: id })
          }, 3500)
        }
        if (envelope.type === 'alert.created' && !audioMutedRef.current) {
          playAlertBeep()
        }
      },
    })

    return () => {
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
        } else if (err?.status !== 429 && err?.status !== 401 && err?.status !== 403) {
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
        } else if (err?.status !== 429 && err?.status !== 401 && err?.status !== 403) {
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
        } else {
          await loadSnapshotAndHealth()
        }
        addToast(t('toast.roadClosed', { road: road.name }), 'warning')
      } catch (err) {
        if (err?.status !== 429) addToast(t('toast.actionError'), 'error')
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
        if (err?.status !== 429) addToast(t('toast.actionError'), 'error')
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
        if (err?.status !== 429) addToast(t('toast.actionError'), 'error')
      }
    },
    [addToast, loadSnapshotAndHealth, t]
  )

  const handleSimSosBurst = useCallback(
    async ({ lat, lng, type = 'fire' }) => {
      try {
        await simSosBurst({ lat, lng, count: 4, type })
        dispatch({
          type: 'SET_MAP_FOCUS',
          payload: { lat, lng, zoom: 15 },
        })
        addToast(t('toast.sosBurstSent'), 'warning')
      } catch (err) {
        if (err?.status !== 429) addToast(t('toast.actionError'), 'error')
      }
    },
    [addToast, t]
  )

  const handleSimSetProvider = useCallback(
    async (nextState) => {
      try {
        await simSetProvider(nextState)
        dispatch({
          type: 'APPLY_WS_EVENT',
          payload: {
            type: 'provider.updated',
            data: {
              state: nextState,
              breaker: nextState === 'up' ? 'closed' : state.routingBreaker,
            },
          },
        })
        addToast(t('toast.providerUpdated', { state: nextState.toUpperCase() }), 'info')
      } catch (err) {
        if (err?.status !== 429) addToast(t('toast.actionError'), 'error')
      }
    },
    [addToast, state.routingBreaker, t]
  )

  const handleSimReset = useCallback(async () => {
    try {
      const result = await simReset()
      dispatch({
        type: 'APPLY_WS_EVENT',
        payload: { type: 'provider.updated', data: { state: 'up', breaker: 'closed' } },
      })
      if (result?.sos && result?.alerts) {
        dispatch({ type: 'SET_DASHBOARD', payload: result })
      } else {
        await loadSnapshotAndHealth()
      }
      addToast(t('toast.simReset'), 'success')
    } catch (err) {
      if (err?.status !== 429) addToast(t('toast.actionError'), 'error')
    }
  }, [loadSnapshotAndHealth, addToast, t])

  const value = {
    ...state,
    handleLogin,
    handleLogout,
    handleApproveAlert,
    handleDismissAlert,
    handleSimCloseRoad,
    handleSimOpenRoad,
    handleSimShelterOccupancy,
    handleSimSosBurst,
    handleSimSetProvider,
    handleSimReset,
    removeToast,
    setSosFilter: (filter) => dispatch({ type: 'SET_SOS_FILTER', payload: filter }),
    togglePriorityOnlyFilter: (val) =>
      dispatch({ type: 'TOGGLE_PRIORITY_ONLY_FILTER', payload: val }),
    focusMap: (focus) => dispatch({ type: 'SET_MAP_FOCUS', payload: focus }),
    setSimTargetCoords: (coords) => dispatch({ type: 'SET_SIM_TARGET_COORDS', payload: coords }),
    toggleAudioMuted: () => dispatch({ type: 'TOGGLE_AUDIO_MUTED' }),
    toggleSimDrawer: (open) => dispatch({ type: 'TOGGLE_SIM_DRAWER', payload: open }),
  }

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
}
