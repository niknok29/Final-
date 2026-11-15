# API CONTRACT — Urban Crisis & Crowd Evacuation Engine (v1)

Backend: Python FastAPI, owned by Jumshud. Frontends MUST follow this contract exactly.
If something is missing or needs to change, ask Jumshud — do NOT invent endpoints silently.

- Base URL (dev): `http://localhost:8000`  (env `VITE_API_URL`)
- WebSocket base: `ws://localhost:8000`
- CORS allowed: `http://localhost:5173` (citizen-web), `http://localhost:5174` (dispatcher-web)
- All coordinates: `lat`, `lng` as numbers (WGS84). Path/polyline arrays are `[[lat,lng],...]` (Leaflet order).
- Default map center: Baku `[40.4093, 49.8671]`, zoom 12.
- Language: send `?lang=az|en|ru` on GET requests (default `az`). Backend localizes `name` fields. Error/alert `code` fields are stable machine codes — the frontend translates its own UI text from them.
- Time: ISO 8601 UTC strings (`2026-11-15T08:30:00Z`).
- Errors: HTTP 4xx/5xx with body `{"error":{"code":"STRING","message":"human text"}}`. HTTP 429 = rate limited (show a friendly toast, retry after `Retry-After` seconds).
- Citizens are anonymous: the citizen app generates `citizenId` (uuid v4) once, stores it in localStorage, and sends it with SOS/safe calls.
- Dispatcher/admin endpoints need `Authorization: Bearer <token>` (from login).

## Enums
- Hazard `type`: `fire` | `collapse` | `flood` | `medical`   (UI az: Yanğın, Dağıntı, Su basması, Tibbi yardım)
- Shelter `kind`: `shelter` | `park` | `stadium`
- Shelter `status` (derived from occupancyPercent): `open` (<75) | `filling` (75–89) | `near_full` (90–99) | `full` (>=100) | `closed`
- SOS `status`: `active` | `resolved`
- Crew `status`: `available` | `dispatched` | `busy`
- Alert `level`: `red`; Alert `kind`: `SOS_CLUSTER` | `SHELTER_OVERLOAD`; Alert `status`: `pending` | `approved` | `dismissed`
- Reroute `reason`: `ROAD_CLOSED` | `SHELTER_NEARLY_FULL` | `SHELTER_FULL`
- Roles: `dispatcher` | `admin` (more roles may appear later — never hardcode role checks in many places; use one `permissions` helper)

---
## A. Citizen endpoints (public)

### GET /api/districts
```json
{"items":[{"id":"nasimi","name":"Nəsimi","lat":40.4093,"lng":49.8671}]}
```

### GET /api/shelters
All shelters (for map markers).
```json
{"items":[{
  "id":"s1","name":"Heydər Əliyev Parkı","kind":"park","lat":40.3950,"lng":49.8520,
  "capacity":2000,"occupancy":1500,"occupancyPercent":75.0,"status":"filling"
}]}
```

### GET /api/shelters/nearest?lat=40.41&lng=49.86&limit=3
Same item shape + `"distanceMeters": 850`, sorted by distance. Shelters with status `full`/`closed` are excluded unless nothing else exists.

### GET /api/roads
Road segments for the map overlay.
```json
{"items":[{"id":"r1","name":"Neftçilər pr.","status":"closed","path":[[40.40,49.85],[40.41,49.86]]}]}
```
`status`: `open` | `closed`.

### GET /api/route?fromLat=40.41&fromLng=49.86&shelterId=s1
Recommended evacuation route. If the requested shelter is nearly full (>=90%) or the road is closed, backend automatically picks an alternative and sets `rerouted`.
```json
{
  "shelter": {"id":"s2","name":"Bakı Olimpiya Stadionu","kind":"stadium","lat":40.4,"lng":49.9,"occupancyPercent":40.0,"status":"open"},
  "route": {"distanceMeters":2400,"durationSec":540,"path":[[40.41,49.86],[40.405,49.88],[40.4,49.9]]},
  "alternatives": [
    {"label":"Alternativ 1","distanceMeters":3100,"durationSec":700,"path":[[40.41,49.86],[40.4,49.9]]}
  ],
  "rerouted": true,
  "reason": "SHELTER_NEARLY_FULL",
  "requestedShelterId": "s1",
  "source": "provider"
}
```
- `rerouted`=false → `reason` is `null`, `requestedShelterId` equals `shelter.id`.
- `source`: `provider` (external routing API ok) | `fallback` (external API down, straight-line estimate). UI must show a small badge when `fallback`.

### POST /api/sos   (rate limited)
Body:
```json
{"citizenId":"uuid","type":"fire","lat":40.41,"lng":49.86,"note":"optional, max 200 chars"}
```
Response 201:
```json
{"id":"sos_123","status":"active","createdAt":"2026-11-15T08:30:00Z"}
```

### POST /api/safe
Body: `{"citizenId":"uuid","lat":40.41,"lng":49.86}` (lat/lng optional)
Response: `{"citizenId":"uuid","status":"safe","updatedAt":"..."}`
(marks that citizen's active SOS signals as resolved)

---
## B. Citizen realtime
`WS /ws/citizen?citizenId=<uuid>`  — message envelope: `{"type":"...","data":{...},"ts":"..."}`

| type | data | when |
|---|---|---|
| `reroute` | same payload as GET /api/route response (+ `message` code) | a road closed or the citizen's target shelter hit 90% → UI shows banner "Marşrut dəyişdirildi" and redraws the new route |
| `shelter.updated` | one shelter object (see GET /api/shelters) | occupancy changed |
| `road.updated` | one road object | road opened/closed |

Client must auto-reconnect (exponential backoff, max 10s).

---
## C. Auth
### POST /api/auth/login
Body `{"username":"dispatcher","password":"dispatcher123"}`
Response `{"token":"<jwt>","role":"dispatcher","username":"dispatcher","expiresIn":3600}`
Demo accounts: `dispatcher / dispatcher123`, `admin / admin123`. 401 → `{"error":{"code":"INVALID_CREDENTIALS",...}}`
Store token in memory/sessionStorage only. On 401/403 → go to login screen.

---
## D. Dispatcher endpoints (Bearer token)

### GET /api/dashboard
Single snapshot for first paint.
```json
{
  "stats":{"activeSos":7,"pendingAlerts":1,"shelters":12,"fullShelters":1,"availableCrews":4,"totalCrews":8},
  "zones":[{"id":"nasimi","name":"Nəsimi","lat":40.4093,"lng":49.8671,"activeSos":3,"level":"critical"}],
  "sos":[{"id":"sos_123","citizenId":"uuid","type":"fire","lat":40.41,"lng":49.86,"note":"","zoneId":"nasimi","status":"active","createdAt":"..."}],
  "shelters":[ /* shelter objects as in GET /api/shelters */ ],
  "crews":[{"id":"c1","name":"Briqada-1","status":"available","lat":40.40,"lng":49.85,"assignedAlertId":null}],
  "alerts":[ /* alert objects below */ ]
}
```
Zone `level`: `normal` | `warning` | `critical`.

### Alert object
```json
{
  "id":"a1","level":"red","kind":"SOS_CLUSTER","status":"pending",
  "zoneId":"nasimi","lat":40.41,"lng":49.86,"createdAt":"...",
  "code":"RED_ALERT_SEND_CREW_OPEN_SHELTER",
  "message":"Qırmızı Həyəcan: Əlavə Xilasetmə Briqadası Göndər və Yeni Toplanış Nöqtəsi Aç",
  "details":{"sosCount":4,"windowMinutes":5,"radiusMeters":500,"shelterId":null,"occupancyPercent":null},
  "proposal":{"crewId":"c3","crewName":"Briqada-3","newShelterId":"s9","newShelterName":"Neftçi Arena (ehtiyat)"}
}
```
For `SHELTER_OVERLOAD`: `details.shelterId` and `details.occupancyPercent` (>95) are set, `sosCount` null.

### GET /api/alerts?status=pending
`{"items":[alert,...]}`

### POST /api/alerts/{id}/approve   (one-click)
Dispatches the proposed crew and opens the proposed shelter.
Response: `{"alert":{...status:"approved"},"crew":{...status:"dispatched"},"newShelter":{...}}`

### POST /api/alerts/{id}/dismiss
Response: `{"alert":{...status:"dismissed"}}`

### GET /api/sos?status=active  ·  GET /api/crews  ·  GET /api/shelters
Plain lists (`{"items":[...]}`), same shapes as above.

---
## E. Simulation endpoints (admin/dispatcher token) — for the live demo panel
- `POST /api/sim/roads/{roadId}/close` · `POST /api/sim/roads/{roadId}/open`
- `POST /api/sim/shelters/{shelterId}/occupancy` body `{"percent":96}`
- `POST /api/sim/sos-burst` body `{"lat":40.41,"lng":49.86,"count":4,"type":"fire"}` (creates N SOS from different fake citizens within 500 m)
- `POST /api/sim/reset`
All return `{"ok":true}`.

## F. Dispatcher realtime
`WS /ws/dispatcher?token=<jwt>` — envelope `{"type","data","ts"}`

| type | data |
|---|---|
| `sos.created` | sos object |
| `sos.updated` | sos object (e.g. resolved) |
| `shelter.updated` | shelter object |
| `road.updated` | road object |
| `crew.updated` | crew object |
| `alert.created` | alert object → show red banner + sound/flash |
| `alert.updated` | alert object |
| `zone.updated` | zone object |

On every reconnect, call GET /api/dashboard again to resync.

## G. Health
`GET /api/health` → `{"status":"ok","routingProvider":"up"|"down"}`

---
## MOCK MODE (so you can work before the backend is ready)
Frontends must have an API layer `src/api/` with a switch `VITE_USE_MOCK=true` that returns fixtures shaped EXACTLY like the examples above, and a fake event emitter that simulates WebSocket events every few seconds. Switching to the real backend = set `VITE_USE_MOCK=false`. Nothing else may change.

---
## H. Backend implementation notes (additions & clarifications, v1.1)
Everything above still holds. These items were unspecified or are strictly additive; frontends should rely on them.

1. **`GET /api/route` — optional `citizenId=<uuid>` query param (ADDITIVE).** When sent, the backend remembers the shelter the citizen is heading to, so it can push a `reroute` over `WS /ws/citizen`. Without it, no `reroute` push is possible for that citizen. Send it on every route request.
2. **`reroute` WS message:** `data.message` is the stable code `ROUTE_CHANGED`; `data.reason` carries the cause (`ROAD_CLOSED` | `SHELTER_NEARLY_FULL` | `SHELTER_FULL`). After a reroute the backend tracks the NEW shelter as the citizen's target.
3. **Optional `lang` on WebSockets:** `/ws/citizen?citizenId=..&lang=az|en|ru` and `/ws/dispatcher?token=..&lang=..` (default `az`) localize `name`/`message` fields in pushed payloads.
4. **WS rejection:** an invalid/missing `citizenId` (must be a UUID), an invalid/expired `token`, or a role without the `dispatch` permission closes the socket with code **1008** during the handshake (client sees a failed connection, not an `error` message).
5. **`route.shelter`** is the full shelter object (same as `GET /api/shelters`, incl. `capacity` and `occupancy`) — a superset of the example.
6. **`route.alternatives[].label`** is a fixed string `"Alternativ N"`; translate it client-side. When `source` is `fallback`, `alternatives` is `[]`.
7. **Validation:** `citizenId` must be a valid UUID; `type` must be one of the hazard enums; `lat`/`lng` ranges are checked; `note` max 200. Violations → **422** `{"error":{"code":"VALIDATION_ERROR",...}}`.
8. **Error codes in use:** `VALIDATION_ERROR` (422), `UNAUTHORIZED` (401, missing/invalid/expired token), `FORBIDDEN` (403), `INVALID_CREDENTIALS` (401, login), `SHELTER_NOT_FOUND` / `NOT_FOUND` (404), `RATE_LIMITED` (429 + `Retry-After`).
9. **Rate limits (per client IP, in-memory):** `POST /api/sos` 10 per minute; `POST /api/auth/login` 10 per minute (login limit is an addition).
10. **Zone `level`:** `normal` = 0 active SOS, `warning` = 1–2, `critical` = 3 or more.
11. **Dashboard `alerts`:** the 50 most recent alerts of ALL statuses, newest first (`stats.pendingAlerts` counts only the pending ones among them). `GET /api/sos` without `status` returns both active and resolved; `GET /api/alerts` without `status` returns all.
12. **Alert `message`** is localized by `?lang` (az/en/ru); `code` stays `RED_ALERT_SEND_CREW_OPEN_SHELTER` for both alert kinds.
13. **Dispatcher auth:** token lifetime 3600 s (`expiresIn`); no refresh endpoint — after expiry (401) log in again. Permissions are centralized in the backend (`dispatcher` and `admin` both may use dashboard and `/api/sim/*`).
14. **Seed data:** 12 shelters; `s9` and `s12` are reserve shelters, seeded as `closed` with 0 occupancy (alert approval opens them). `s10` starts at 100 % (`full`).
