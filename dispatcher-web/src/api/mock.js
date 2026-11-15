const clone = (value) => JSON.parse(JSON.stringify(value))

function deriveShelterStatus(percent, currentStatus) {
  if (currentStatus === 'closed') return 'closed'
  if (percent >= 100) return 'full'
  if (percent >= 90) return 'near_full'
  if (percent >= 75) return 'filling'
  return 'open'
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
        type: 'fire',
        lat: 40.4128,
        lng: 49.8512,
        zoneId: 'z-nesimi',
        zoneName: 'Nəsimi',
        note: '28 May küçəsində transformator yaxınlığında güclü tüstü və alov müşahidə olunur.',
        status: 'active',
        createdAt: isoAgo(38),
      },
      {
        id: 'sos-105',
        type: 'medical',
        lat: 40.4109,
        lng: 49.8551,
        zoneId: 'z-nesimi',
        zoneName: 'Nəsimi',
        note: 'Tüstü udmuş 3 nəfər təcili tibbi yardım gözləyir.',
        status: 'active',
        createdAt: isoAgo(95),
      },
      {
        id: 'sos-104',
        type: 'collapse',
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
        type: 'fire',
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
        type: 'flood',
        lat: 40.3738,
        lng: 49.8404,
        zoneId: 'z-sebail',
        zoneName: 'Səbail',
        note: 'Yeraltı keçiddə suyun səviyyəsi qalxır, hərəkət çətinləşib.',
        status: 'dispatched',
        createdAt: isoAgo(390),
      },
      {
        id: 'sos-101',
        type: 'medical',
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
        zoneId: 'z-nesimi',
        zoneName: 'Nəsimi',
        lat: 40.4088,
        lng: 49.8482,
        capacity: 500,
        occupancy: 455,
        percent: 91,
        status: 'near_full',
      },
      {
        id: 'sh-2',
        name: 'Bulvar Təxliyə Məntəqəsi',
        zoneId: 'z-sebail',
        zoneName: 'Səbail',
        lat: 40.3694,
        lng: 49.8442,
        capacity: 400,
        occupancy: 400,
        percent: 100,
        status: 'full',
      },
      {
        id: 'sh-3',
        name: 'Nərimanov Mədəniyyət Evi',
        zoneId: 'z-nerimanov',
        zoneName: 'Nərimanov',
        lat: 40.4162,
        lng: 49.8781,
        capacity: 450,
        occupancy: 360,
        percent: 80,
        status: 'filling',
      },
      {
        id: 'sh-4',
        name: 'Yasamal 158 saylı Məktəb',
        zoneId: 'z-yasamal',
        zoneName: 'Yasamal',
        lat: 40.3902,
        lng: 49.8195,
        capacity: 350,
        occupancy: 168,
        percent: 48,
        status: 'open',
      },
      {
        id: 'sh-5',
        name: 'Xətai Olimpiya Zalı',
        zoneId: 'z-xetai',
        zoneName: 'Xətai',
        lat: 40.3911,
        lng: 49.8952,
        capacity: 600,
        occupancy: 210,
        percent: 35,
        status: 'open',
      },
      {
        id: 'sh-6',
        name: 'Nəsimi Ehtiyat Məntəqə #2',
        zoneId: 'z-nesimi',
        zoneName: 'Nəsimi',
        lat: 40.4184,
        lng: 49.8435,
        capacity: 420,
        occupancy: 0,
        percent: 0,
        status: 'closed',
      },
      {
        id: 'sh-7',
        name: 'Səbail Ehtiyat Mərkəzi',
        zoneId: 'z-sebail',
        zoneName: 'Səbail',
        lat: 40.3765,
        lng: 49.8278,
        capacity: 380,
        occupancy: 0,
        percent: 0,
        status: 'closed',
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
      },
      {
        id: 'crew-2',
        name: 'XRX-102 (Xüsusi Xilasetmə)',
        lat: 40.3982,
        lng: 49.8691,
        status: 'available',
        assignedAlertId: null,
      },
      {
        id: 'crew-3',
        name: 'TTY-307 (Təcili Tibbi Yardım)',
        lat: 40.3792,
        lng: 49.8462,
        status: 'dispatched',
        assignedAlertId: 'al-initial-0',
      },
      {
        id: 'crew-4',
        name: 'YMX-204 (Yol Mühafizə)',
        lat: 40.4188,
        lng: 49.8732,
        status: 'busy',
        assignedAlertId: 'al-initial-0',
      },
      {
        id: 'crew-5',
        name: 'MMQ-409 (Mülki Müdafiə)',
        lat: 40.3935,
        lng: 49.8321,
        status: 'available',
        assignedAlertId: null,
      },
    ],
    alerts: [
      {
        id: 'al-1',
        status: 'pending',
        severity: 'red',
        type: 'sos_cluster',
        zoneId: 'z-nesimi',
        zoneName: 'Nəsimi',
        lat: 40.4117,
        lng: 49.8532,
        message: 'Nəsimi zonasında sıx SOS klasteri aşkarlandı — təcili reaksiya tələb olunur.',
        trigger: '4 SOS / 5 dəq / 500 m',
        proposal: {
          crewId: 'crew-1',
          crewName: 'FHN-101 (Yanğınsöndürmə)',
          openShelterId: 'sh-6',
          openShelterName: 'Nəsimi Ehtiyat Məntəqə #2',
        },
        createdAt: isoAgo(25),
      },
    ],
    roads: [
      {
        id: 'r1',
        name: 'Neftçilər pr.',
        status: 'closed',
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
        path: [
          [40.3975, 49.8695],
          [40.4055, 49.8812],
          [40.4148, 49.8935],
        ],
      },
      {
        id: 'r4',
        name: 'Tbilisi pr.',
        status: 'open',
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
let sosSeq = 107
let alertSeq = 2
let autoFeedIndex = 0
let subscribers = new Set()
let sosIntervalId = null
let alertTimeoutId = null

const STREAM_SOS_TEMPLATES = [
  {
    type: 'fire',
    zoneId: 'z-nesimi',
    zoneName: 'Nəsimi',
    lat: 40.4142,
    lng: 49.8574,
    note: 'Yaşayış binasının birinci mərtəbəsində tüstülənmə barədə yeni zəng daxil olub.',
  },
  {
    type: 'flood',
    zoneId: 'z-sebail',
    zoneName: 'Səbail',
    lat: 40.3702,
    lng: 49.8371,
    note: 'Sahil xətti boyunca su basması təhlükəsi ilə əlaqədar kömək istənilir.',
  },
  {
    type: 'medical',
    zoneId: 'z-nerimanov',
    zoneName: 'Nərimanov',
    lat: 40.4105,
    lng: 49.8842,
    note: 'Təxliyə nöqtəsində sıxlıq səbəbindən tibbi müdaxilə tələb olunur.',
  },
  {
    type: 'collapse',
    zoneId: 'z-yasamal',
    zoneName: 'Yasamal',
    lat: 40.3928,
    lng: 49.8156,
    note: 'Tikinti hasarı aşaraq piyada yolunu bağlayıb, təhlükəsizlik tələb olunur.',
  },
]

function computeStats() {
  const activeSos = state.sos.filter((item) => item.status !== 'resolved').length
  const pendingAlerts = state.alerts.filter((item) => item.status === 'pending').length
  const openOrActiveShelters = state.shelters.filter((item) => item.status !== 'closed')
  const fullShelters = openOrActiveShelters.filter(
    (item) => item.status === 'full' || item.status === 'near_full' || item.percent >= 90
  ).length
  const totalCrews = state.crews.length
  const availableCrews = state.crews.filter((item) => item.status === 'available').length

  return {
    activeSos,
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
  if (count >= 4) zone.level = 'critical'
  else if (count >= 2) zone.level = 'warning'
  else zone.level = 'normal'
  return zone
}

function triggerOverloadAlertIfNeeded(shelter) {
  if (shelter.percent < 90) return
  const alreadyPending = state.alerts.some(
    (a) => a.status === 'pending' && a.zoneId === shelter.zoneId && a.type === 'shelter_overload'
  )
  if (alreadyPending) return

  const availableCrew =
    state.crews.find((c) => c.status === 'available') || state.crews[0]
  const closedShelter =
    state.shelters.find((s) => s.status === 'closed' && s.id !== shelter.id) ||
    state.shelters.find((s) => s.id !== shelter.id && s.percent < 75) ||
    state.shelters[0]

  const alert = {
    id: `al-${alertSeq++}`,
    status: 'pending',
    severity: 'red',
    type: 'shelter_overload',
    zoneId: shelter.zoneId,
    zoneName: shelter.zoneName,
    lat: shelter.lat,
    lng: shelter.lng,
    message: `${shelter.name} kritik doluluq həddinə çatıb — ehtiyat məntəqə açılmalıdır.`,
    trigger: `Toplanış məntəqəsi ${shelter.percent}%`,
    proposal: {
      crewId: availableCrew?.id || null,
      crewName: availableCrew?.name || 'FHN Ehtiyat',
      openShelterId: closedShelter?.id || null,
      openShelterName: closedShelter?.name || 'Ehtiyat Məntəqə',
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
        type: tpl.type,
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
    }, 4000)
  }

  if (!alertTimeoutId) {
    alertTimeoutId = setTimeout(() => {
      const targetShelter = state.shelters.find((s) => s.id === 'sh-3') || state.shelters[2]
      if (targetShelter) {
        targetShelter.percent = 96
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
  throw err
}

export async function mockGetDashboard() {
  return clone({
    stats: computeStats(),
    zones: state.zones,
    sos: state.sos,
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
  return { status: 'ok', routingProvider: 'up' }
}

export async function mockApproveAlert(alertId) {
  const alert = state.alerts.find((a) => a.id === alertId)
  if (!alert) {
    const err = new Error('Alert not found')
    err.status = 404
    throw err
  }

  alert.status = 'approved'
  let updatedCrew = null
  let updatedShelter = null

  if (alert.proposal?.crewId) {
    const crew = state.crews.find((c) => c.id === alert.proposal.crewId)
    if (crew) {
      crew.status = 'dispatched'
      crew.assignedAlertId = alert.id
      crew.lat = Number((alert.lat + 0.0012).toFixed(5))
      crew.lng = Number((alert.lng - 0.0012).toFixed(5))
      updatedCrew = crew
    }
  }

  if (alert.proposal?.openShelterId) {
    const shelter = state.shelters.find((s) => s.id === alert.proposal.openShelterId)
    if (shelter) {
      if (shelter.status === 'closed') {
        shelter.status = deriveShelterStatus(shelter.percent, 'open')
      }
      updatedShelter = shelter
    }
  }

  emitEvent('alert.updated', alert)
  if (updatedCrew) emitEvent('crew.updated', updatedCrew)
  if (updatedShelter) emitEvent('shelter.updated', updatedShelter)

  return clone({
    alert,
    crew: updatedCrew,
    shelter: updatedShelter,
    stats: computeStats(),
  })
}

export async function mockDismissAlert(alertId) {
  const alert = state.alerts.find((a) => a.id === alertId)
  if (!alert) {
    const err = new Error('Alert not found')
    err.status = 404
    throw err
  }
  alert.status = 'dismissed'
  emitEvent('alert.updated', alert)
  return clone({ alert, stats: computeStats() })
}

export async function mockSimCloseRoad(roadId) {
  const road = state.roads.find((r) => r.id === roadId)
  if (!road) throw Object.assign(new Error('Road not found'), { status: 404 })
  road.status = 'closed'
  emitEvent('road.updated', road)
  return clone(road)
}

export async function mockSimOpenRoad(roadId) {
  const road = state.roads.find((r) => r.id === roadId)
  if (!road) throw Object.assign(new Error('Road not found'), { status: 404 })
  road.status = 'open'
  emitEvent('road.updated', road)
  return clone(road)
}

export async function mockSimSetShelterOccupancy(shelterId, percent) {
  const shelter = state.shelters.find((s) => s.id === shelterId)
  if (!shelter) throw Object.assign(new Error('Shelter not found'), { status: 404 })
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0))
  shelter.percent = clamped
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
      type,
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

  const availableCrew =
    state.crews.find((c) => c.status === 'available') || state.crews[0]
  const closedShelter =
    state.shelters.find((s) => s.status === 'closed') ||
    state.shelters.find((s) => s.percent < 75) ||
    state.shelters[0]

  const clusterAlert = {
    id: `al-${alertSeq++}`,
    status: 'pending',
    severity: 'red',
    type: 'sos_cluster',
    zoneId: zone.id,
    zoneName: zone.name,
    lat,
    lng,
    message: `${zone.name} zonasında ${count} SOS klasteri yarandı — təcili briqada göndərilməlidir.`,
    trigger: `${count} SOS / 5 dəq / 500 m`,
    proposal: {
      crewId: availableCrew?.id || null,
      crewName: availableCrew?.name || 'FHN-101',
      openShelterId: closedShelter?.id || null,
      openShelterName: closedShelter?.name || 'Ehtiyat Məntəqə',
    },
    createdAt: new Date().toISOString(),
  }
  state.alerts.unshift(clusterAlert)
  emitEvent('alert.created', clusterAlert)

  return clone({ created, alert: clusterAlert })
}

export async function mockSimReset() {
  state = createInitialState()
  sosSeq = 107
  alertSeq = 2
  autoFeedIndex = 0
  stopMockStreams()
  if (subscribers.size > 0) {
    startMockStreams()
  }
  return mockGetDashboard()
}
