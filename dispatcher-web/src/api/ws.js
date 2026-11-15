import { USE_MOCK } from './client.js'
import { subscribeMockEvents } from './mock.js'

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')

function buildWsUrl(token, lang = 'az') {
  const wsBase = API_BASE_URL.replace(/^http/i, 'ws')
  return `${wsBase}/ws/dispatcher?token=${encodeURIComponent(token)}&lang=${encodeURIComponent(lang)}`
}

/**
 * Connects to the dispatcher realtime stream (Mock or live WebSocket)
 * with exponential backoff reconnect, snapshot resync on reconnection,
 * and immediate logout termination on close code 1008.
 */
export function connectDispatcherWS({
  token,
  lang = 'az',
  onEvent,
  onStatusChange,
  onReconnectResync,
  onAuthFailure,
}) {
  if (USE_MOCK) {
    onStatusChange?.('live')
    const unsubscribe = subscribeMockEvents((envelope) => {
      onEvent?.(envelope)
    })
    return () => {
      unsubscribe()
    }
  }

  let closedByCaller = false
  let socket = null
  let reconnectTimer = null
  let attempt = 0
  let hasConnectedOnce = false

  function scheduleReconnect() {
    if (closedByCaller) return
    onStatusChange?.('reconnecting')
    const delayMs = Math.min(15000, 1000 * 2 ** attempt)
    attempt += 1
    reconnectTimer = setTimeout(() => {
      connect()
    }, delayMs)
  }

  function connect() {
    if (closedByCaller || !token) return

    try {
      socket = new WebSocket(buildWsUrl(token, lang))
    } catch {
      scheduleReconnect()
      return
    }

    socket.onopen = () => {
      const wasReconnect = hasConnectedOnce
      hasConnectedOnce = true
      attempt = 0
      onStatusChange?.('live')
      if (wasReconnect) {
        onReconnectResync?.()
      }
    }

    socket.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data)
        if (envelope?.type) {
          onEvent?.(envelope)
        }
      } catch {
        // Ignore malformed frames
      }
    }

    socket.onerror = () => {
      socket?.close()
    }

    socket.onclose = (event) => {
      if (closedByCaller) return
      if (event?.code === 1008) {
        closedByCaller = true
        if (reconnectTimer) {
          clearTimeout(reconnectTimer)
          reconnectTimer = null
        }
        onAuthFailure?.()
        return
      }
      scheduleReconnect()
    }
  }

  connect()

  return () => {
    closedByCaller = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      socket.close()
      socket = null
    }
  }
}
