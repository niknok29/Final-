import { calculateDistanceMeters, calculatePathLengthMeters } from '../utils/geo.js'

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

  const rawRoads = [
    {
      id: 'r1',
      name: 'Neftçilər prospekti',
      status: 'closed',
      accessible: true,
      path: [
        [40.3627, 49.8322],
        [40.3652, 49.8358],
        [40.3679, 49.8408],
        [40.3708, 49.8471],
        [40.3736, 49.8535],
        [40.3752, 49.8598],
      ],
    },
    {
      id: 'r2',
      name: 'Heydər Əliyev prospekti',
      status: 'open',
      accessible: true,
      path: [
        [40.3845, 49.8565],
        [40.3912, 49.8632],
        [40.3959, 49.8678],
        [40.4028, 49.8785],
        [40.4095, 49.8935],
        [40.4208, 49.9145],
      ],
    },
    {
      id: 'r3',
      name: 'Tbilisi prospekti',
      status: 'open',
      accessible: true,
      path: [
        [40.3832, 49.8295],
        [40.3895, 49.8258],
        [40.3968, 49.8215],
        [40.4038, 49.8168],
        [40.4112, 49.8118],
        [40.4165, 49.8082],
      ],
    },
    {
      id: 'r4',
      name: 'Ziya Bünyadov prospekti',
      status: 'open',
      accessible: false,
      path: [
        [40.4148, 49.8345],
        [40.4142, 49.8482],
        [40.4138, 49.8615],
        [40.4152, 49.8785],
        [40.4178, 49.896],
        [40.4208, 49.9145],
      ],
    },
    {
      id: 'r5',
      name: 'Azadlıq prospekti',
      status: 'open',
      accessible: true,
      path: [
        [40.3795, 49.8485],
        [40.3862, 49.846],
        [40.3915, 49.8442],
        [40.4015, 49.841],
        [40.4135, 49.8375],
        [40.4258, 49.8342],
      ],
    },
    {
      id: 'r6',
      name: '28 May küçəsi',
      status: 'open',
      accessible: false,
      path: [
        [40.3772, 49.8445],
        [40.3782, 49.8492],
        [40.3794, 49.854],
        [40.3806, 49.8588],
      ],
    },
  ]

  return {
    zones: [
      {
        id: 'nasimi',
        name: 'Nəsimi',
        lat: 40.4093,
        lng: 49.8671,
        radius: 500,
        radiusMeters: 500,
        level: 'critical',
        activeSos: 4,
      },
      {
        id: 'sabail',
        name: 'Səbail',
        lat: 40.3665,
        lng: 49.835,
        radius: 500,
        radiusMeters: 500,
        level: 'warning',
        activeSos: 1,
      },
      {
        id: 'narimanov',
        name: 'Nərimanov',
        lat: 40.4125,
        lng: 49.868,
        radius: 500,
        radiusMeters: 500,
        level: 'warning',
        activeSos: 1,
      },
      {
        id: 'khatai',
        name: 'Xətai',
        lat: 40.3845,
        lng: 49.882,
        radius: 500,
        radiusMeters: 500,
        level: 'normal',
        activeSos: 0,
      },
      {
        id: 'yasamal',
        name: 'Yasamal',
        lat: 40.3885,
        lng: 49.818,
        radius: 500,
        radiusMeters: 500,
        level: 'normal',
        activeSos: 0,
      },
      {
        id: 'nizami',
        name: 'Nizami',
        lat: 40.405,
        lng: 49.938,
        radius: 500,
        radiusMeters: 500,
        level: 'normal',
        activeSos: 0,
      },
      {
        id: 'sabunchu',
        name: 'Sabunçu',
        lat: 40.436,
        lng: 49.948,
        radius: 500,
        radiusMeters: 500,
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
        lat: 40.3988,
        lng: 49.8515,
        zoneId: 'nasimi',
        zoneName: 'Nəsimi',
        note: 'Əlil arabası istifadə edən sakin Tofiq Bəhramov Stadionu yaxınlığında təxliyə dəstəyi gözləyir.',
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
        lat: 40.3979,
        lng: 49.8531,
        zoneId: 'nasimi',
        zoneName: 'Nəsimi',
        note: 'Gənclik qovşağı yaxınlığında transformator binasında güclü tüstü və alov müşahidə olunur.',
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
        lat: 40.3991,
        lng: 49.8534,
        zoneId: 'nasimi',
        zoneName: 'Nəsimi',
        note: 'Yaşayış binasının giriş hissəsində konstruksiya qismən uçub, çıxış bağlanıb.',
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
        lat: 40.3971,
        lng: 49.8508,
        zoneId: 'nasimi',
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
        lat: 40.3679,
        lng: 49.8408,
        zoneId: 'sabail',
        zoneName: 'Səbail',
        note: 'Neftçilər prospektində yeraltı keçiddə suyun səviyyəsi qalxır, hərəkət çətinləşib.',
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
        lat: 40.3976,
        lng: 49.8662,
        zoneId: 'narimanov',
        zoneName: 'Nərimanov',
        note: 'Heydər Əliyev Mərkəzi yaxınlığında yaşlı sakin üçün kardioloji təxliyə dəstəyi tələb olunur.',
        status: 'active',
        createdAt: isoAgo(520),
      },
    ],
    shelters: [
      {
        id: 's1',
        name: 'Heydər Əliyev Mərkəzi / Parkı',
        kind: 'park',
        zoneId: 'narimanov',
        zoneName: 'Nərimanov',
        lat: 40.3959,
        lng: 49.8678,
        capacity: 2000,
        occupancy: 1500,
        percent: 75,
        occupancyPercent: 75,
        status: 'filling',
        accessible: true,
      },
      {
        id: 's2',
        name: 'Bakı Olimpiya Stadionu',
        kind: 'stadium',
        zoneId: 'sabunchu',
        zoneName: 'Sabunçu',
        lat: 40.4298,
        lng: 49.9197,
        capacity: 5000,
        occupancy: 2000,
        percent: 40,
        occupancyPercent: 40,
        status: 'open',
        accessible: true,
      },
      {
        id: 's3',
        name: 'Dənizkənarı Milli Park',
        kind: 'park',
        zoneId: 'sabail',
        zoneName: 'Səbail',
        lat: 40.3665,
        lng: 49.8372,
        capacity: 3000,
        occupancy: 1200,
        percent: 40,
        occupancyPercent: 40,
        status: 'open',
        accessible: true,
      },
      {
        id: 's4',
        name: 'Tofiq Bəhramov adına Respublika Stadionu',
        kind: 'stadium',
        zoneId: 'nasimi',
        zoneName: 'Nəsimi',
        lat: 40.3975,
        lng: 49.8524,
        capacity: 4000,
        occupancy: 3700,
        percent: 93,
        occupancyPercent: 93,
        status: 'near_full',
        accessible: true,
      },
      {
        id: 's5',
        name: 'Gənclik Mall / Park',
        kind: 'shelter',
        zoneId: 'narimanov',
        zoneName: 'Nərimanov',
        lat: 40.4002,
        lng: 49.8529,
        capacity: 1200,
        occupancy: 660,
        percent: 55,
        occupancyPercent: 55,
        status: 'open',
        accessible: true,
      },
      {
        id: 's6',
        name: 'Yasamal Mədəniyyət Evi',
        kind: 'shelter',
        zoneId: 'yasamal',
        zoneName: 'Yasamal',
        lat: 40.3868,
        lng: 49.8165,
        capacity: 500,
        occupancy: 480,
        percent: 96,
        occupancyPercent: 96,
        status: 'near_full',
        accessible: false,
      },
      {
        id: 's7',
        name: 'Xətai İdman Kompleksi',
        kind: 'stadium',
        zoneId: 'khatai',
        zoneName: 'Xətai',
        lat: 40.3822,
        lng: 49.8765,
        capacity: 1500,
        occupancy: 525,
        percent: 35,
        occupancyPercent: 35,
        status: 'open',
        accessible: false,
      },
      {
        id: 's9',
        name: 'Neftçi Arena (ehtiyat)',
        kind: 'stadium',
        zoneId: 'nizami',
        zoneName: 'Nizami',
        lat: 40.4008,
        lng: 49.9436,
        capacity: 3500,
        occupancy: 0,
        percent: 0,
        occupancyPercent: 0,
        status: 'closed',
        accessible: true,
      },
      {
        id: 's12',
        name: 'Səbail Rəsmi Tədbirlər Zalı (ehtiyat)',
        kind: 'shelter',
        zoneId: 'sabail',
        zoneName: 'Səbail',
        lat: 40.3642,
        lng: 49.8325,
        capacity: 800,
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
        lat: 40.3915,
        lng: 49.8442,
        status: 'available',
        assignedAlertId: null,
        accessibleTransport: false,
      },
      {
        id: 'crew-2',
        name: 'XRX-102 (Xüsusi Xilasetmə)',
        lat: 40.3959,
        lng: 49.8678,
        status: 'available',
        assignedAlertId: null,
        accessibleTransport: true,
      },
      {
        id: 'crew-3',
        name: 'TTY-307 (Təcili Tibbi Yardım)',
        lat: 40.3712,
        lng: 49.8452,
        status: 'dispatched',
        assignedAlertId: 'al-1',
        accessibleTransport: true,
      },
      {
        id: 'crew-4',
        name: 'YMX-204 (Yol Mühafizə)',
        lat: 40.4138,
        lng: 49.8615,
        status: 'busy',
        assignedAlertId: 'al-1',
        accessibleTransport: false,
      },
      {
        id: 'crew-5',
        name: 'MMQ-409 (Mülki Müdafiə)',
        lat: 40.3895,
        lng: 49.8258,
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
        zoneId: 'nasimi',
        zoneName: 'Nəsimi',
        lat: 40.3988,
        lng: 49.8515,
        code: 'PRIORITY_SOS_DISPATCH_ACCESSIBLE_TRANSPORT',
        message: 'Prioritet SOS: Əlçatan nəqliyyatlı briqada göndər',
        details: {
          sosCount: 1,
          windowMinutes: null,
          radiusMeters: 500,
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
        zoneId: 'nasimi',
        zoneName: 'Nəsimi',
        lat: 40.3982,
        lng: 49.8522,
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
          newShelterId: 's9',
          newShelterName: 'Neftçi Arena (ehtiyat)',
        },
        createdAt: isoAgo(25),
      },
    ],
    roads: rawRoads.map((road) => ({
      ...road,
      lengthMeters: calculatePathLengthMeters(road.path),
    })),
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
    zoneId: 'nasimi',
    zoneName: 'Nəsimi',
    lat: 40.3995,
    lng: 49.8505,
    note: 'Yaşayış binasının birinci mərtəbəsində tüstülənmə barədə yeni zəng daxil olub.',
  },
  {
    type: 'medical',
    profile: 'special_needs',
    priority: 'critical',
    priorityRank: 1,
    zoneId: 'narimanov',
    zoneName: 'Nərimanov',
    lat: 40.4021,
    lng: 49.8555,
    note: 'Hərəkət məhdudiyyətli vətəndaş üçün xüsusi təxliyə nəqliyyatı tələb olunur.',
  },
  {
    type: 'flood',
    profile: 'standard',
    priority: 'normal',
    priorityRank: 2,
    zoneId: 'sabail',
    zoneName: 'Səbail',
    lat: 40.3652,
    lng: 49.8358,
    note: 'Sahil xətti boyunca su basması təhlükəsi ilə əlaqədar kömək istənilir.',
  },
  {
    type: 'collapse',
    profile: 'standard',
    priority: 'normal',
    priorityRank: 2,
    zoneId: 'yasamal',
    zoneName: 'Yasamal',
    lat: 40.3881,
    lng: 49.8194,
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
    const dist = calculateDistanceMeters(lat, lng, z.lat, z.lng)
    if (dist !== null && dist < bestDist) {
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
      const targetShelter = state.shelters.find((s) => s.id === 's1') || state.shelters[0]
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
