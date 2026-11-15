import i18n from '../i18n/index.js'
import {
  mockApproveAlert,
  mockDismissAlert,
  mockGetDashboard,
  mockGetHealth,
  mockGetRoads,
  mockLogin,
  mockSimCloseRoad,
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
let onRateLimitCb = null

export function setApiCallbacks({ onUnauthorized, onRateLimit }) {
  onUnauthorizedCb = onUnauthorized || null
  onRateLimitCb = onRateLimit || null
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

  if (response.status === 401 || response.status === 403) {
    const isLoginEndpoint = path === '/api/auth/login'
    if (!isLoginEndpoint) {
      clearSession()
      if (onUnauthorizedCb) onUnauthorizedCb()
    }
    const err = new Error(response.status === 401 ? 'Unauthorized' : 'Forbidden')
    err.status = response.status
    err.code = response.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN'
    throw err
  }

  if (response.status === 429) {
    const rawRetryAfter = response.headers.get('Retry-After')
    const parsedRetry = rawRetryAfter ? Number.parseInt(rawRetryAfter, 10) : NaN
    const retryAfter = Number.isFinite(parsedRetry) && parsedRetry > 0 ? parsedRetry : null
    if (onRateLimitCb) onRateLimitCb(retryAfter)
    const err = new Error('Rate limit exceeded')
    err.status = 429
    err.code = 'RATE_LIMITED'
    err.retryAfter = retryAfter
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
    throw err
  }

  if (response.status === 204) return null
  return response.json()
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
    expiresIn: result.expiresIn || 3600,
  }
  saveSession(session)
  return session
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

export async function approveAlert(alertId) {
  if (USE_MOCK) return mockApproveAlert(alertId)
  return apiFetch(`/api/alerts/${encodeURIComponent(alertId)}/approve`, {
    method: 'POST',
  })
}

export async function dismissAlert(alertId) {
  if (USE_MOCK) return mockDismissAlert(alertId)
  return apiFetch(`/api/alerts/${encodeURIComponent(alertId)}/dismiss`, {
    method: 'POST',
  })
}

export async function simCloseRoad(roadId) {
  if (USE_MOCK) return mockSimCloseRoad(roadId)
  return apiFetch(`/api/sim/roads/${encodeURIComponent(roadId)}/close`, {
    method: 'POST',
  })
}

export async function simOpenRoad(roadId) {
  if (USE_MOCK) return mockSimOpenRoad(roadId)
  return apiFetch(`/api/sim/roads/${encodeURIComponent(roadId)}/open`, {
    method: 'POST',
  })
}

export async function simSetShelterOccupancy(shelterId, percent) {
  if (USE_MOCK) return mockSimSetShelterOccupancy(shelterId, percent)
  return apiFetch(`/api/sim/shelters/${encodeURIComponent(shelterId)}/occupancy`, {
    method: 'POST',
    body: JSON.stringify({ percent }),
  })
}

export async function simSosBurst({ lat, lng, count = 4, type = 'fire' }) {
  if (USE_MOCK) return mockSimSosBurst({ lat, lng, count, type })
  return apiFetch('/api/sim/sos-burst', {
    method: 'POST',
    body: JSON.stringify({ lat, lng, count, type }),
  })
}

export async function simSetProvider(state) {
  if (USE_MOCK) return mockSimSetProvider(state)
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
  if (USE_MOCK) return mockSimReset()
  return apiFetch('/api/sim/reset', {
    method: 'POST',
  })
}

export async function getHealth() {
  if (USE_MOCK) return mockGetHealth()
  return apiFetch('/api/health')
}
