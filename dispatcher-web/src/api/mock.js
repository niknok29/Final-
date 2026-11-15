const clone = (value) => JSON.parse(JSON.stringify(value))

function deriveShelterStatus(percent, currentStatus) {
  if (currentStatus === 'closed') return 'closed'
  if (percent >= 100) return 'full'
  if (percent >= 90) return 'near_full'
  if (percent >= 75) return 'filling'
  return 'open'
}

function sortSosItems(items) {
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
  const now = Date.now()
  const isoAgo = (seconds) => new Date(now - seconds * 1000).toISOString()

  return {
    zones: [
      {
        id: 'z-nesimi',
        name: 'Nəsimi',
        lat: 40.4112,
        lng: 49.8535,
        radius: 1350,
        level: 'critical',
        activeSos: 4,
      },
      {
        id: 'z-sebail',
        name: 'Səbail',
        lat: 40.3715,
        lng: 49.8392,
        radius: 1400,
        level: 'warning',
        activeSos: 2,
      },
      {
        id: 'z-nerimanov',
        name: 'Nərimanov',
        lat: 40.4125,
        lng: 49.8825,
        radius: 1500,
        level: 'warning',
        activeSos: 1,
      },
      {
        id: 'z-xetai',
        name: 'Xətai',
        lat: 40.3885,
        lng: 49.8985,
        radius: 1500,
        level: 'normal',
        activeSos: 0,
      },
      {
        id: 'z-yasamal',
        name: 'Yasamal',
        lat: 40.3915,
        lng: 49.8142,
        radius: 1450,
        level: 'normal',
        activeSos: 0,
      },
    ],
    sos: [
      {
        id: 'sos-106',
        citizenId: 'cit-9f1a-0106',
        type: 'medical',
        profile: 'special_needs',
        priority: 'critical',
        priorityRank: 1,
        lat: 40.4128,
        lng: 49.8512,
        zoneId: 'z-nesimi',
        zoneName: 'Nəsimi',
        note: 'Əlil arabası istifadə edən sakin binanın 3-cü mərtəbəsində təxliyə dəstəyi gözləyir.',
        status: 'active',
        createdAt: isoAgo(38),
      },
      {
        id: 'sos-105',
        citizenId: 'cit-9f1a-0105',
        type: 'fire',
        profile: 'standard',
        priority: 'normal',
        priorityRank: 2,
        lat: 40.4109,
        lng: 49.8551,
        zoneId: 'z-nesimi',
        zoneName: 'Nəsimi',
        note: '28 May küçəsində transformator yaxınlığında güclü tüstü və alov müşahidə olunur.',
        status: 'active',
        createdAt: isoAgo(95),
      },
      {
        id: 'sos-104',
        citizenId: 'cit-9f1a-0104',
        type: 'collapse',
        profile: 'standard',
        priority: 'normal',
        priorityRank: 2,
        lat: 40.4137,
        lng: 49.8539,
        zoneId: 'z-nesimi',
        zoneName: 'Nəsimi',
        note: 'Köhnə binanın giriş hissəsində konstruksiya qismən uçub, çıxış bağlanıb.',
        status: 'active',
        createdAt: isoAgo(160),
      },
      {
        id: 'sos-103',
        citizenId: 'cit-9f1a-0103',
        type: 'fire',
        profile: 'standard',
        priority: 'normal',
        priorityRank: 2,
        lat: 40.4094,
        lng: 49.8524,
        zoneId: 'z-nesimi',
        zoneName: 'Nəsimi',
        note: 'Yaxınlıqdakı təxliyə dəhlizinə qığılcım keçmə təhlükəsi var.',
        status: 'active',
        createdAt: isoAgo(215),
      },
      {
        id: 'sos-102',
        citizenId: 'cit-9f1a-0102',
        type: 'flood',
        profile: 'standard',
        priority: 'normal',
        priorityRank: 2,
        lat: 40.3738,
        lng: 49.8404,
        zoneId: 'z-sebail',
        zoneName: 'Səbail',
        note: 'Yeraltı keçiddə suyun səviyyəsi qalxır, hərəkət çətinləşib.',
        status: 'active',
        createdAt: isoAgo(390),
      },
      {
        id: 'sos-101',
        citizenId: 'cit-9f1a-0101',
        type: 'medical',
        profile: 'standard',
        priority: 'normal',
        priorityRank: 2,
        lat: 40.4148,
        lng: 49.8805,
        zoneId: 'z-nerimanov',
        zoneName: 'Nərimanov',
        note: 'Yaşlı sakin üçün təxliyə zamanı kardioloji dəstək tələb olunur.',
        status: 'active',
        createdAt: isoAgo(520),
      },
    ],
    shelters: [
      {
        id: 'sh-1',
        name: '28 May İdman Kompleksi',
        kind: 'stadium',
        zoneId: 'z-nesimi',
        zoneName: 'Nəsimi',
        lat: 40.4088,
        lng: 49.8482,
        capacity: 500,
        occupancy: 455,
        percent: 91,
        occupancyPercent: 91,
        status: 'near_full',
        accessible: true,
      },
      {
        id: 'sh-2',
        name: 'Bulvar Təxliyə Məntəqəsi',
        kind: 'park',
        zoneId: 'z-sebail',
        zoneName: 'Səbail',
        lat: 40.3694,
        lng: 49.8442,
        capacity: 400,
        occupancy: 400,
        percent: 100,
        occupancyPercent: 100,
        status: 'full',
        accessible: false,
      },
      {
        id: 'sh-3',
        name: 'Nərimanov Mədəniyyət Evi',
        kind: 'shelter',
        zoneId: 'z-nerimanov',
        zoneName: 'Nərimanov',
        lat: 40.4162,
        lng: 49.8781,
        capacity: 450,
        occupancy: 360,
        percent: 80,
        occupancyPercent: 80,
        status: 'filling',
        accessible: true,
      },
      {
        id: 'sh-4',
        name: 'Yasamal 158 saylı Məktəb',
        kind: 'shelter',
        zoneId: 'z-yasamal',
        zoneName: 'Yasamal',
        lat: 40.3902,
        lng: 49.8195,
        capacity: 350,
        occupancy: 168,
        percent: 48,
        occupancyPercent: 48,
        status: 'open',
        accessible: false,
      },
      {
        id: 'sh-5',
        name: 'Xətai Olimpiya Zalı',
        kind: 'stadium',
        zoneId: 'z-xetai',
        zoneName: 'Xətai',
        lat: 40.3911,
        lng: 49.8952,
        capacity: 600,
        occupancy: 210,
        percent: 35,
        occupancyPercent: 35,
        status: 'open',
        accessible: true,
      },
      {
        id: 'sh-6',
        name: 'Nəsimi Ehtiyat Məntəqə #2',
        kind: 'shelter',
        zoneId: 'z-nesimi',
        zoneName: 'Nəsimi',
        lat: 40.4184,
        lng: 49.8435,
        capacity: 420,
        occupancy: 0,
        percent: 0,
        occupancyPercent: 0,
        status: 'closed',
        accessible: true,
      },
      {
        id: 'sh-7',
        name: 'Səbail Ehtiyat Mərkəzi',
        kind: 'shelter',
        zoneId: 'z-sebail',
        zoneName: 'Səbail',
        lat: 40.3765,
        lng: 49.8278,
        capacity: 380,
        occupancy: 0,
        percent: 0,
        occupancyPercent: 0,
        status: 'closed',
        accessible: true,
      },
    ],
    crews: [
      {
        id: 'crew-1',
        name: 'FHN-101 (Yanğınsöndürmə)',
        lat: 40.4051,
        lng: 49.8588,
        status: 'available',
        assignedAlertId: null,
        accessibleTransport: false,
      },
      {
        id: 'crew-2',
        name: 'XRX-102 (Xüsusi Xilasetmə)',
        lat: 40.3982,
        lng: 49.8691,
        status: 'available',
        assignedAlertId: null,
        accessibleTransport: true,
      },
      {
        id: 'crew-3',
        name: 'TTY-307 (Təcili Tibbi Yardım)',
        lat: 40.3792,
        lng: 49.8462,
        status: 'dispatched',
        assignedAlertId: 'al-initial-0',
        accessibleTransport: true,
      },
      {
        id: 'crew-4',
        name: 'YMX-204 (Yol Mühafizə)',
        lat: 40.4188,
        lng: 49.8732,
        status: 'busy',
        assignedAlertId: 'al-initial-0',
        accessibleTransport: false,
      },
      {
        id: 'crew-5',
        name: 'MMQ-409 (Mülki Müdafiə)',
        lat: 40.3935,
        lng: 49.8321,
        status: 'available',
        assignedAlertId: null,
        accessibleTransport: true,
      },
    ],
    alerts: [
      {
        id: 'al-priority-1',
        level: 'red',
        kind: 'PRIORITY_SOS',
        status: 'pending',
        zoneId: 'z-nesimi',
        zoneName: 'Nəsimi',
        lat: 40.4128,
        lng: 49.8512,
        code: 'PRIORITY_SOS_DISPATCH_ACCESSIBLE_TRANSPORT',
        message: 'Prioritet SOS: Əlçatan nəqliyyatlı briqada göndər',
        details: {
          sosCount: 1,
          windowMinutes: null,
          radiusMeters: null,
          shelterId: null,
          occupancyPercent: null,
          sosId: 'sos-106',
          profile: 'special_needs',
        },
        proposal: {
          crewId: 'crew-2',
          crewName: 'XRX-102 (Xüsusi Xilasetmə)',
          newShelterId: null,
          newShelterName: null,
        },
        createdAt: isoAgo(18),
      },
      {
        id: 'al-1',
        level: 'red',
        kind: 'SOS_CLUSTER',
        status: 'pending',
        zoneId: 'z-nesimi',
        zoneName: 'Nəsimi',
        lat: 40.4117,
        lng: 49.8532,
        code: 'RED_ALERT_SEND_CREW_OPEN_SHELTER',
        message: 'Nəsimi zonasında sıx SOS klasteri aşkarlandı — təcili reaksiya tələb olunur.',
        trigger: '4 SOS / 5 dəq / 500 m',
        details: {
          sosCount: 4,
          windowMinutes: 5,
          radiusMeters: 500,
          shelterId: null,
          occupancyPercent: null,
        },
        proposal: {
          crewId: 'crew-1',
          crewName: 'FHN-101 (Yanğınsöndürmə)',
          newShelterId: 'sh-6',
          newShelterName: 'Nəsimi Ehtiyat Məntəqə #2',
        },
        createdAt: isoAgo(25),
      },
    ],
    roads: [
      {
        id: 'r1',
        name: 'Neftçilər pr.',
        status: 'closed',
        accessible: true,
        path: [
          [40.3698, 49.8362],
          [40.3724, 49.8448],
          [40.3758, 49.8542],
        ],
      },
      {
        id: 'r2',
        name: '28 May küç.',
        status: 'open',
        accessible: true,
        path: [
          [40.3788, 49.8475],
          [40.3796, 49.8542],
          [40.3812, 49.8615],
        ],
      },
      {
        id: 'r3',
        name: 'Heydər Əliyev pr.',
        status: 'open',
        accessible: true,
        path: [
          [40.3975, 49.8695],
          [40.4055, 49.8812],
          [40.4148, 49.8935],
        ],
      },
      {
        id: 'r4',
        name: 'Tbilisi pr. (keçid)',
        status: 'open',
        accessible: false,
        path: [
          [40.3925, 49.8255],
          [40.4005, 49.8212],
          [40.4092, 49.8168],
        ],
      },
    ],
  }
}

let state = createInitialState()
let providerState = 'up'
let breakerState = 'closed'
let sosSeq = 107
let alertSeq = 2
let autoFeedIndex = 0
const subscribers = new Set()
let sosIntervalId = null
let alertTimeoutId = null

const STREAM_SOS_TEMPLATES = [
  {
    type: 'fire',
    profile: 'standard',
    priority: 'normal',
    priorityRank: 2,
    zoneId: 'z-nesimi',
    zoneName: 'Nəsimi',
    lat: 40.4142,
    lng: 49.8574,
    note: 'Yaşayış binasının birinci mərtəbəsində tüstülənmə barədə yeni zəng daxil olub.',
  },
  {
    type: 'medical',
    profile: 'special_needs',
    priority: 'critical',
    priorityRank: 1,
    zoneId: 'z-nerimanov',
    zoneName: 'Nərimanov',
    lat: 40.4119,
    lng: 49.8834,
    note: 'Hərəkət məhdudiyyətli vətəndaş üçün xüsusi təxliyə nəqliyyatı tələb olunur.',
  },
  {
    type: 'flood',
    profile: 'standard',
    priority: 'normal',
    priorityRank: 2,
    zoneId: 'z-sebail',
    zoneName: 'Səbail',
    lat: 40.3702,
    lng: 49.8371,
    note: 'Sahil xətti boyunca su basması təhlükəsi ilə əlaqədar kömək istənilir.',
  },
  {
    type: 'collapse',
    profile: 'standard',
    priority: 'normal',
    priorityRank: 2,
    zoneId: 'z-yasamal',
    zoneName: 'Yasamal',
    lat: 40.3928,
    lng: 49.8156,
    note: 'Tikinti hasarı aşaraq piyada yolunu bağlayıb, təhlükəsizlik tələb olunur.',
  },
]

function computeStats() {
  const activeSosItems = state.sos.filter((item) => item.status !== 'resolved')
  const activeSos = activeSosItems.length
  const prioritySos = activeSosItems.filter(
    (item) => item.profile === 'special_needs' || item.priorityRank === 1
  ).length
  const pendingAlerts = state.alerts.filter((item) => item.status === 'pending').length
  const openOrActiveShelters = state.shelters.filter((item) => item.status !== 'closed')
  const fullShelters = openOrActiveShelters.filter(
    (item) => item.status === 'full' || item.status === 'near_full' || (item.percent ?? 0) >= 90
  ).length
  const totalCrews = state.crews.length
  const availableCrews = state.crews.filter((item) => item.status === 'available').length

  return {
    activeSos,
    prioritySos,
    pendingAlerts,
    shelters: state.shelters.length,
    fullShelters,
    totalCrews,
    availableCrews,
  }
}

function emitEvent(type, data) {
  const envelope = {
    type,
    data: clone(data),
    ts: new Date().toISOString(),
  }
  subscribers.forEach((cb) => {
    try {
      cb(envelope)
    } catch {
      // Ignore subscriber handler errors so stream continues
    }
  })
}

function findNearestZone(lat, lng) {
  let nearest = state.zones[0]
  let bestDist = Infinity
  for (const z of state.zones) {
    const dLat = z.lat - lat
    const dLng = z.lng - lng
    const dist = dLat * dLat + dLng * dLng
    if (dist < bestDist) {
      bestDist = dist
      nearest = z
    }
  }
  return nearest
}

function recalculateZone(zoneId) {
  const zone = state.zones.find((z) => z.id === zoneId)
  if (!zone) return null
  const count = state.sos.filter((s) => s.zoneId === zoneId && s.status !== 'resolved').length
  zone.activeSos = count
  if (count >= 3) zone.level = 'critical'
  else if (count >= 1) zone.level = 'warning'
  else zone.level = 'normal'
  return zone
}

function findUnproposedAvailableCrew(requireAccessible = false) {
  const proposedIds = new Set(
    state.alerts
      .filter((a) => a.status === 'pending' && a.proposal?.crewId)
      .map((a) => a.proposal.crewId)
  )
  const pool = state.crews.filter(
    (c) => c.status === 'available' && (!requireAccessible || c.accessibleTransport)
  )
  return pool.find((c) => !proposedIds.has(c.id)) || pool[0] || null
}

function createPrioritySosAlert(sosItem) {
  const exists = state.alerts.some(
    (a) => a.kind === 'PRIORITY_SOS' && a.details?.sosId === sosItem.id
  )
  if (exists) return null

  const crew = findUnproposedAvailableCrew(true)
  const alert = {
    id: `al-${alertSeq++}`,
    level: 'red',
    kind: 'PRIORITY_SOS',
    status: 'pending',
    zoneId: sosItem.zoneId,
    zoneName: sosItem.zoneName,
    lat: sosItem.lat,
    lng: sosItem.lng,
    code: 'PRIORITY_SOS_DISPATCH_ACCESSIBLE_TRANSPORT',
    message: 'Prioritet SOS: Əlçatan nəqliyyatlı briqada göndər',
    details: {
      sosCount: 1,
      windowMinutes: null,
      radiusMeters: null,
      shelterId: null,
      occupancyPercent: null,
      sosId: sosItem.id,
      profile: 'special_needs',
    },
    proposal: {
      crewId: crew?.id || null,
      crewName: crew?.name || null,
      newShelterId: null,
      newShelterName: null,
    },
    createdAt: new Date().toISOString(),
  }
  state.alerts.unshift(alert)
  emitEvent('alert.created', alert)
  return alert
}

function triggerOverloadAlertIfNeeded(shelter) {
  if (shelter.percent < 90) return
  const alreadyPending = state.alerts.some(
    (a) =>
      a.status === 'pending' &&
      a.kind === 'SHELTER_OVERLOAD' &&
      (a.details?.shelterId === shelter.id || a.zoneId === shelter.zoneId)
  )
  if (alreadyPending) return

  const availableCrew = findUnproposedAvailableCrew(false)
  const closedShelter =
    state.shelters.find((s) => s.status === 'closed' && s.id !== shelter.id) ||
    state.shelters.find((s) => s.id !== shelter.id && s.percent < 75) ||
    null

  const alert = {
    id: `al-${alertSeq++}`,
    level: 'red',
    kind: 'SHELTER_OVERLOAD',
    status: 'pending',
    zoneId: shelter.zoneId,
    zoneName: shelter.zoneName,
    lat: shelter.lat,
    lng: shelter.lng,
    code: 'RED_ALERT_SEND_CREW_OPEN_SHELTER',
    message: `${shelter.name} kritik doluluq həddinə çatıb — ehtiyat məntəqə açılmalıdır.`,
    trigger: `Toplanış məntəqəsi ${shelter.percent}%`,
    details: {
      sosCount: null,
      windowMinutes: 5,
      radiusMeters: 500,
      shelterId: shelter.id,
      occupancyPercent: shelter.percent,
    },
    proposal: {
      crewId: availableCrew?.id || null,
      crewName: availableCrew?.name || null,
      newShelterId: closedShelter?.id || null,
      newShelterName: closedShelter?.name || null,
    },
    createdAt: new Date().toISOString(),
  }

  state.alerts.unshift(alert)
  emitEvent('alert.created', alert)
}

function startMockStreams() {
  if (!sosIntervalId) {
    sosIntervalId = setInterval(() => {
      const tpl = STREAM_SOS_TEMPLATES[autoFeedIndex % STREAM_SOS_TEMPLATES.length]
      autoFeedIndex += 1
      const jitterLat = (Math.random() - 0.5) * 0.004
      const jitterLng = (Math.random() - 0.5) * 0.004
      const newSos = {
        id: `sos-${sosSeq++}`,
        citizenId: `cit-stream-${sosSeq}`,
        type: tpl.type,
        profile: tpl.profile,
        priority: tpl.priority,
        priorityRank: tpl.priorityRank,
        lat: Number((tpl.lat + jitterLat).toFixed(5)),
        lng: Number((tpl.lng + jitterLng).toFixed(5)),
        zoneId: tpl.zoneId,
        zoneName: tpl.zoneName,
        note: tpl.note,
        status: 'active',
        createdAt: new Date().toISOString(),
      }
      state.sos.unshift(newSos)
      const updatedZone = recalculateZone(tpl.zoneId)
      emitEvent('sos.created', newSos)
      if (updatedZone) emitEvent('zone.updated', updatedZone)
      if (newSos.profile === 'special_needs') {
        createPrioritySosAlert(newSos)
      }
    }, 4000)
  }

  if (!alertTimeoutId) {
    alertTimeoutId = setTimeout(() => {
      const targetShelter = state.shelters.find((s) => s.id === 'sh-3') || state.shelters[2]
      if (targetShelter) {
        targetShelter.percent = 96
        targetShelter.occupancyPercent = 96
        targetShelter.occupancy = Math.round((targetShelter.capacity * 96) / 100)
        targetShelter.status = deriveShelterStatus(96, 'open')
        emitEvent('shelter.updated', targetShelter)
        triggerOverloadAlertIfNeeded(targetShelter)
      }
    }, 15000)
  }
}

function stopMockStreams() {
  if (sosIntervalId) {
    clearInterval(sosIntervalId)
    sosIntervalId = null
  }
  if (alertTimeoutId) {
    clearTimeout(alertTimeoutId)
    alertTimeoutId = null
  }
}

export function subscribeMockEvents(callback) {
  subscribers.add(callback)
  if (subscribers.size === 1) {
    startMockStreams()
  }
  return () => {
    subscribers.delete(callback)
    if (subscribers.size === 0) {
      stopMockStreams()
    }
  }
}

export async function mockLogin(username, password) {
  await new Promise((r) => setTimeout(r, 180))
  if (username === 'dispatcher' && password === 'dispatcher123') {
    return {
      token: 'mock-jwt-dispatcher-2026',
      role: 'dispatcher',
      username: 'dispatcher',
      expiresIn: 3600,
    }
  }
  if (username === 'admin' && password === 'admin123') {
    return {
      token: 'mock-jwt-admin-2026',
      role: 'admin',
      username: 'admin',
      expiresIn: 3600,
    }
  }
  const err = new Error('Invalid credentials')
  err.status = 401
  err.code = 'INVALID_CREDENTIALS'
  throw err
}

export async function mockGetDashboard() {
  return clone({
    stats: computeStats(),
    zones: state.zones,
    sos: sortSosItems(state.sos),
    shelters: state.shelters,
    crews: state.crews,
    alerts: state.alerts,
    roads: state.roads,
  })
}

export async function mockGetRoads() {
  return clone({ items: state.roads })
}

export async function mockGetHealth() {
  return {
    status: 'ok',
    routingProvider: providerState === 'up' && breakerState === 'closed' ? 'up' : 'down',
    breaker: breakerState,
  }
}

export async function mockSimSetProvider(nextState) {
  if (!['up', 'down', 'slow'].includes(nextState)) {
    throw Object.assign(new Error('Invalid provider state'), {
      status: 422,
      code: 'VALIDATION_ERROR',
    })
  }
  providerState = nextState
  if (nextState === 'up') {
    breakerState = 'closed'
  }
  emitEvent('provider.updated', { state: providerState, breaker: breakerState })
  return { ok: true, state: providerState }
}

export async function mockApproveAlert(alertId) {
  const alert = state.alerts.find((a) => a.id === alertId)
  if (!alert) {
    const err = new Error('Alert not found')
    err.status = 404
    err.code = 'ALERT_NOT_FOUND'
    throw err
  }

  if (alert.status !== 'pending') {
    const err = new Error('Alert is no longer pending')
    err.status = 409
    err.code = 'ALERT_NOT_PENDING'
    throw err
  }

  const requiresAccessible = alert.kind === 'PRIORITY_SOS'
  let crew = state.crews.find((c) => c.id === alert.proposal?.crewId && c.status === 'available')
  if (!crew || (requiresAccessible && !crew.accessibleTransport)) {
    crew = findUnproposedAvailableCrew(requiresAccessible)
  }

  if (!crew) {
    const err = new Error('No available crew for dispatch')
    err.status = 409
    err.code = 'NO_CREW_AVAILABLE'
    throw err
  }

  alert.status = 'approved'
  crew.status = 'dispatched'
  crew.assignedAlertId = alert.id
  crew.lat = Number((alert.lat + 0.0012).toFixed(5))
  crew.lng = Number((alert.lng - 0.0012).toFixed(5))
  alert.proposal = {
    ...alert.proposal,
    crewId: crew.id,
    crewName: crew.name,
  }

  let openedShelter = null
  const shelterId = alert.proposal?.newShelterId ?? alert.proposal?.openShelterId ?? null
  if (shelterId) {
    const shelter = state.shelters.find((s) => s.id === shelterId)
    if (shelter) {
      if (shelter.status === 'closed') {
        shelter.status = deriveShelterStatus(shelter.percent, 'open')
      }
      openedShelter = shelter
    }
  }

  emitEvent('alert.updated', alert)
  emitEvent('crew.updated', crew)
  if (openedShelter) emitEvent('shelter.updated', openedShelter)

  return clone({
    alert,
    crew,
    newShelter: openedShelter,
    stats: computeStats(),
  })
}

export async function mockDismissAlert(alertId) {
  const alert = state.alerts.find((a) => a.id === alertId)
  if (!alert) {
    const err = new Error('Alert not found')
    err.status = 404
    err.code = 'ALERT_NOT_FOUND'
    throw err
  }
  if (alert.status !== 'pending') {
    const err = new Error('Alert is no longer pending')
    err.status = 409
    err.code = 'ALERT_NOT_PENDING'
    throw err
  }
  alert.status = 'dismissed'
  emitEvent('alert.updated', alert)
  return clone({ alert, stats: computeStats() })
}

export async function mockSimCloseRoad(roadId) {
  const road = state.roads.find((r) => r.id === roadId)
  if (!road) {
    throw Object.assign(new Error('Road not found'), { status: 404, code: 'ROAD_NOT_FOUND' })
  }
  road.status = 'closed'
  emitEvent('road.updated', road)
  return clone(road)
}

export async function mockSimOpenRoad(roadId) {
  const road = state.roads.find((r) => r.id === roadId)
  if (!road) {
    throw Object.assign(new Error('Road not found'), { status: 404, code: 'ROAD_NOT_FOUND' })
  }
  road.status = 'open'
  emitEvent('road.updated', road)
  return clone(road)
}

export async function mockSimSetShelterOccupancy(shelterId, percent) {
  const shelter = state.shelters.find((s) => s.id === shelterId)
  if (!shelter) {
    throw Object.assign(new Error('Shelter not found'), { status: 404, code: 'SHELTER_NOT_FOUND' })
  }
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0))
  shelter.percent = clamped
  shelter.occupancyPercent = clamped
  shelter.occupancy = Math.round((shelter.capacity * clamped) / 100)
  shelter.status = deriveShelterStatus(clamped, 'open')
  emitEvent('shelter.updated', shelter)
  triggerOverloadAlertIfNeeded(shelter)
  return clone(shelter)
}

export async function mockSimSosBurst({ lat, lng, count = 4, type = 'fire' }) {
  const zone = findNearestZone(lat, lng)
  const created = []
  for (let i = 0; i < count; i += 1) {
    const item = {
      id: `sos-${sosSeq++}`,
      citizenId: `cit-burst-${sosSeq}`,
      type,
      profile: 'standard',
      priority: 'normal',
      priorityRank: 2,
      lat: Number((lat + (Math.random() - 0.5) * 0.0025).toFixed(5)),
      lng: Number((lng + (Math.random() - 0.5) * 0.0025).toFixed(5)),
      zoneId: zone.id,
      zoneName: zone.name,
      note: `Simulyasiya kütləvi siqnalı #${i + 1} (${zone.name})`,
      status: 'active',
      createdAt: new Date().toISOString(),
    }
    state.sos.unshift(item)
    created.push(item)
    emitEvent('sos.created', item)
  }

  const updatedZone = recalculateZone(zone.id)
  if (updatedZone) emitEvent('zone.updated', updatedZone)

  const availableCrew = findUnproposedAvailableCrew(false)
  const closedShelter =
    state.shelters.find((s) => s.status === 'closed') ||
    state.shelters.find((s) => s.percent < 75) ||
    null

  const clusterAlert = {
    id: `al-${alertSeq++}`,
    level: 'red',
    kind: 'SOS_CLUSTER',
    status: 'pending',
    zoneId: zone.id,
    zoneName: zone.name,
    lat,
    lng,
    code: 'RED_ALERT_SEND_CREW_OPEN_SHELTER',
    message: `${zone.name} zonasında ${count} SOS klasteri yarandı — təcili briqada göndərilməlidir.`,
    trigger: `${count} SOS / 5 dəq / 500 m`,
    details: {
      sosCount: count,
      windowMinutes: 5,
      radiusMeters: 500,
      shelterId: null,
      occupancyPercent: null,
    },
    proposal: {
      crewId: availableCrew?.id || null,
      crewName: availableCrew?.name || null,
      newShelterId: closedShelter?.id || null,
      newShelterName: closedShelter?.name || null,
    },
    createdAt: new Date().toISOString(),
  }
  state.alerts.unshift(clusterAlert)
  emitEvent('alert.created', clusterAlert)

  return clone({ created, alert: clusterAlert })
}

export async function mockSimReset() {
  state.sos.forEach((s) => {
    if (s.status !== 'resolved') {
      emitEvent('sos.updated', { ...s, status: 'resolved' })
    }
  })
  state.alerts.forEach((a) => {
    if (a.status === 'pending') {
      emitEvent('alert.updated', { ...a, status: 'dismissed' })
    }
  })

  state = createInitialState()
  providerState = 'up'
  breakerState = 'closed'
  sosSeq = 107
  alertSeq = 2
  autoFeedIndex = 0
  stopMockStreams()
  emitEvent('provider.updated', { state: 'up', breaker: 'closed' })
  if (subscribers.size > 0) {
    startMockStreams()
  }
  return mockGetDashboard()
}
