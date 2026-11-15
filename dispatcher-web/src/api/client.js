import { can, getRolePermissions } from '../auth/permissions.js'
import i18n from '../i18n/index.js'
import { sanitizeUserNote } from '../utils/sanitize.js'
import {
  mockApproveAlert,
  mockClearSuspiciousSos,
  mockDismissAlert,
  mockGetDashboard,
  mockGetHealth,
  mockGetMe,
  mockGetRoads,
  mockLogin,
  mockSimCloseRoad,
  mockSimFlood,
  mockSimOpenRoad,
  mockSimReset,
  mockSimSetProvider,
  mockSimSetShelterOccupancy,
  mockSimSosBurst,
} from './mock.js'

const SESSION_KEY = 'dispatcher_session'
const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

let memorySession = null
let onUnauthorizedCb = null
let onForbiddenCb = null
let onRateLimitCb = null
let onPayloadTooLargeCb = null

export function setApiCallbacks({ onUnauthorized, onForbidden, onRateLimit, onPayloadTooLarge }) {
  onUnauthorizedCb = onUnauthorized || null
  onForbiddenCb = onForbidden || null
  onRateLimitCb = onRateLimit || null
  onPayloadTooLargeCb = onPayloadTooLarge || null
}

export function getStoredSession() {
  if (memorySession?.token) return memorySession
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.token) {
      memorySession = parsed
      return parsed
    }
  } catch {
    return null
  }
  return null
}

export function saveSession(session) {
  memorySession = session
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // Fallback to in-memory session if sessionStorage is unavailable
  }
}

export function clearSession() {
  memorySession = null
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // Ignore storage cleanup errors
  }
}

function withLangParam(path) {
  const lang = i18n.language || 'az'
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}lang=${encodeURIComponent(lang)}`
}

async function apiFetch(path, options = {}) {
  const session = getStoredSession()
  const method = (options.method || 'GET').toUpperCase()
  const targetPath = method === 'GET' ? withLangParam(path) : path
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  }

  if (session?.token) {
    headers.Authorization = `Bearer ${session.token}`
  }

  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 8000
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timerId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null

  let response
  try {
    response = await fetch(`${API_BASE_URL}${targetPath}`, {
      ...options,
      headers,
      signal: options.signal || controller?.signal,
    })
  } catch (networkErr) {
    if (networkErr?.name === 'AbortError') {
      const err = new Error('Request timed out')
      err.status = 504
      err.code = 'REQUEST_TIMEOUT'
      throw err
    }
    throw networkErr
  } finally {
    if (timerId) clearTimeout(timerId)
  }

  const rawRetryAfter = response.headers.get('Retry-After')
  const parsedHeaderRetry = rawRetryAfter ? Number.parseInt(rawRetryAfter, 10) : NaN

  if (response.status === 401) {
    const isLoginEndpoint = path === '/api/auth/login'
    if (!isLoginEndpoint) {
      clearSession()
      if (onUnauthorizedCb) onUnauthorizedCb()
    }
    const err = new Error('Unauthorized')
    err.status = 401
    err.code = 'UNAUTHORIZED'
    throw err
  }

  if (response.status === 403) {
    let payload = null
    try {
      payload = await response.json()
    } catch {
      // Non-JSON error body
    }
    const code = String(payload?.error?.code || payload?.code || 'FORBIDDEN')
    const message = String(
      payload?.error?.message || payload?.detail || payload?.message || 'Permission denied'
    )
    if (onForbiddenCb) onForbiddenCb({ code, message, path })
    const err = new Error(message)
    err.status = 403
    err.code = code
    throw err
  }

  if (response.status === 429) {
    let payload = null
    try {
      payload = await response.json()
    } catch {
      // Non-JSON error body
    }
    const code = String(payload?.error?.code || payload?.code || 'RATE_LIMITED')
    const message = String(
      payload?.error?.message || payload?.detail || payload?.message || 'Rate limit exceeded'
    )
    const bodyRetryRaw = payload?.retryAfter ?? payload?.error?.retryAfter
    const parsedBodyRetry = bodyRetryRaw != null ? Number.parseInt(String(bodyRetryRaw), 10) : NaN
    const retryAfter =
      Number.isFinite(parsedHeaderRetry) && parsedHeaderRetry > 0
        ? parsedHeaderRetry
        : Number.isFinite(parsedBodyRetry) && parsedBodyRetry > 0
          ? parsedBodyRetry
          : code === 'LOGIN_LOCKED'
            ? 60
            : null
    if (onRateLimitCb) onRateLimitCb({ retryAfter, code, message, path })
    const err = new Error(message)
    err.status = 429
    err.code = code
    err.retryAfter = retryAfter
    throw err
  }

  if (response.status === 413) {
    let payload = null
    try {
      payload = await response.json()
    } catch {
      // Non-JSON error body
    }
    const code = String(payload?.error?.code || payload?.code || 'PAYLOAD_TOO_LARGE')
    const message = String(
      payload?.error?.message ||
        payload?.detail ||
        payload?.message ||
        'Request body exceeds 32 KB limit'
    )
    if (onPayloadTooLargeCb) onPayloadTooLargeCb({ code, message, path })
    const err = new Error(message)
    err.status = 413
    err.code = code
    err.retryAfter = null
    throw err
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`
    let code = null
    try {
      const payload = await response.json()
      if (payload?.error) {
        if (payload.error.code) code = String(payload.error.code)
        if (payload.error.message) message = String(payload.error.message)
      } else if (payload?.detail) {
        message = String(payload.detail)
      } else if (payload?.message) {
        message = String(payload.message)
      }
    } catch {
      // Non-JSON error body
    }
    const err = new Error(message)
    err.status = response.status
    err.code = code
    err.retryAfter = Number.isFinite(parsedHeaderRetry) && parsedHeaderRetry > 0 ? parsedHeaderRetry : null
    throw err
  }

  if (response.status === 204) return null
  return response.json()
}

function guardMockPermission(action, path) {
  const session = getStoredSession()
  if (session && !can(session, action)) {
    const err = new Error('Forbidden')
    err.status = 403
    err.code = 'FORBIDDEN'
    if (onForbiddenCb) onForbiddenCb({ code: 'FORBIDDEN', message: err.message, path })
    throw err
  }
}

export async function login(username, password) {
  const result = USE_MOCK
    ? await mockLogin(username, password)
    : await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })

  const session = {
    token: result.token,
    role: result.role,
    username: result.username,
    permissions:
      Array.isArray(result.permissions) && result.permissions.length > 0
        ? result.permissions
        : getRolePermissions(result.role),
    expiresIn: result.expiresIn || 3600,
  }
  saveSession(session)
  return session
}

export async function getMe() {
  const session = getStoredSession()
  if (USE_MOCK) return mockGetMe(session)
  try {
    const me = await apiFetch('/api/auth/me')
    if (me && typeof me === 'object') {
      const role = me.role || session?.role
      const permissions =
        Array.isArray(me.permissions) && me.permissions.length > 0
          ? me.permissions
          : getRolePermissions(role)
      return {
        username: me.username || session?.username,
        role,
        permissions,
      }
    }
  } catch (err) {
    if (err?.status !== 404 && err?.status !== 405) {
      throw err
    }
  }
  const role = session?.role
  return {
    username: session?.username || '',
    role: role || '',
    permissions:
      Array.isArray(session?.permissions) && session.permissions.length > 0
        ? session.permissions
        : getRolePermissions(role),
  }
}

export async function getRoads() {
  if (USE_MOCK) return mockGetRoads()
  return apiFetch('/api/roads')
}

export async function getDashboard() {
  if (USE_MOCK) return mockGetDashboard()
  const [snapshot, roadsRes] = await Promise.all([
    apiFetch('/api/dashboard'),
    apiFetch('/api/roads').catch(() => ({ items: [] })),
  ])
  const roads = Array.isArray(snapshot.roads)
    ? snapshot.roads
    : Array.isArray(roadsRes?.items)
      ? roadsRes.items
      : []
  return {
    ...snapshot,
    roads,
  }
}

export const getSnapshot = getDashboard

export async function approveAlert(alertId) {
  if (USE_MOCK) {
    guardMockPermission('approve_alert', `/api/alerts/${alertId}/approve`)
    return mockApproveAlert(alertId)
  }
  return apiFetch(`/api/alerts/${encodeURIComponent(alertId)}/approve`, {
    method: 'POST',
  })
}

export async function dismissAlert(alertId) {
  if (USE_MOCK) {
    guardMockPermission('dismiss_alert', `/api/alerts/${alertId}/dismiss`)
    return mockDismissAlert(alertId)
  }
  return apiFetch(`/api/alerts/${encodeURIComponent(alertId)}/dismiss`, {
    method: 'POST',
  })
}

export async function clearSuspiciousSos() {
  if (USE_MOCK) {
    guardMockPermission('clear_suspicious', '/api/sos/suspicious/clear')
    return mockClearSuspiciousSos()
  }
  try {
    return await apiFetch('/api/sos/suspicious/clear', {
      method: 'POST',
    })
  } catch (err) {
    if (err?.status === 404 || err?.status === 405) {
      guardMockPermission('clear_suspicious', '/api/sos/suspicious/clear')
      return mockClearSuspiciousSos()
    }
    throw err
  }
}

export async function simCloseRoad(roadId) {
  if (USE_MOCK) {
    guardMockPermission('simulate', `/api/sim/roads/${roadId}/close`)
    return mockSimCloseRoad(roadId)
  }
  return apiFetch(`/api/sim/roads/${encodeURIComponent(roadId)}/close`, {
    method: 'POST',
  })
}

export async function simOpenRoad(roadId) {
  if (USE_MOCK) {
    guardMockPermission('simulate', `/api/sim/roads/${roadId}/open`)
    return mockSimOpenRoad(roadId)
  }
  return apiFetch(`/api/sim/roads/${encodeURIComponent(roadId)}/open`, {
    method: 'POST',
  })
}

export async function simSetShelterOccupancy(shelterId, percent) {
  if (USE_MOCK) {
    guardMockPermission('simulate', `/api/sim/shelters/${shelterId}/occupancy`)
    return mockSimSetShelterOccupancy(shelterId, percent)
  }
  return apiFetch(`/api/sim/shelters/${encodeURIComponent(shelterId)}/occupancy`, {
    method: 'POST',
    body: JSON.stringify({ percent }),
  })
}

export async function simSosBurst({ lat, lng, count = 4, type = 'fire', note = '' }) {
  const cleanNote = sanitizeUserNote(note, 200)
  if (USE_MOCK) {
    guardMockPermission('simulate', '/api/sim/sos-burst')
    return mockSimSosBurst({ lat, lng, count, type, note: cleanNote })
  }
  return apiFetch('/api/sim/sos-burst', {
    method: 'POST',
    body: JSON.stringify({
      lat,
      lng,
      count,
      type,
      ...(cleanNote ? { note: cleanNote } : {}),
    }),
  })
}

export async function simFlood({ count = 600 } = {}) {
  if (USE_MOCK) {
    guardMockPermission('simulate', '/api/sim/flood')
    return mockSimFlood({ count })
  }
  try {
    return await apiFetch('/api/sim/flood', {
      method: 'POST',
      body: JSON.stringify({ count }),
      timeoutMs: 12000,
    })
  } catch (err) {
    if (err?.status === 404 || err?.status === 405) {
      guardMockPermission('simulate', '/api/sim/flood')
      return mockSimFlood({ count })
    }
    throw err
  }
}

export async function simSetProvider(state) {
  if (USE_MOCK) {
    guardMockPermission('simulate', '/api/sim/provider')
    return mockSimSetProvider(state)
  }
  try {
    return await apiFetch('/api/sim/provider', {
      method: 'POST',
      body: JSON.stringify({ state }),
    })
  } catch (err) {
    if (state === 'http503' && (err?.status === 400 || err?.status === 422)) {
      const fallbackRes = await apiFetch('/api/sim/provider', {
        method: 'POST',
        body: JSON.stringify({ state: 'down' }),
      })
      return {
        ...(fallbackRes || {}),
        ok: true,
        state: 'http503',
        fallbackFromHttp503: true,
      }
    }
    throw err
  }
}

export async function simReset() {
  if (USE_MOCK) {
    guardMockPermission('simulate', '/api/sim/reset')
    return mockSimReset()
  }
  return apiFetch('/api/sim/reset', {
    method: 'POST',
  })
}

export async function getHealth() {
  if (USE_MOCK) return mockGetHealth()
  return apiFetch('/api/health')
}
