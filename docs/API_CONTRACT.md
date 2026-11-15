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
4. **WS rejection:** an invalid/missing `citizenId` (must be a UUID), an invalid/expired `token`, or a role without the `dispatch` permission is answered by **accepting the connection and immediately closing it with code 1008** (policy violation). The browser therefore fires `onopen` briefly (no data is ever sent) and then `onclose` with `event.code === 1008` — NOT 1006. Clients must treat 1008 as "authentication failed": stop reconnecting and go to the login screen (dispatcher) / regenerate state (citizen). Any other close code (e.g. 1006) is a network problem → reconnect with backoff. Do not treat the brief `onopen` before a 1008 as a successful connection (wait for a first message, or ignore the open if it is followed by 1008).
5. **`route.shelter`** is the full shelter object (same as `GET /api/shelters`, incl. `capacity` and `occupancy`) — a superset of the example.
6. **`route.alternatives[].label`** is a fixed string `"Alternativ N"`; translate it client-side. When `source` is `fallback`, `alternatives` is `[]`.
7. **Validation:** `citizenId` must be a valid UUID; `type` must be one of the hazard enums; `lat`/`lng` ranges are checked; `note` max 200. Violations → **422** `{"error":{"code":"VALIDATION_ERROR",...}}`.
8. **Error codes in use:** `VALIDATION_ERROR` (422), `UNAUTHORIZED` (401, missing/invalid/expired token), `FORBIDDEN` (403), `INVALID_CREDENTIALS` (401, login), `SHELTER_NOT_FOUND` / `NOT_FOUND` (404), `RATE_LIMITED` (429 + `Retry-After`).
9. **Rate limits (per client IP, in-memory):** `POST /api/sos` 10 per minute; `POST /api/auth/login` 10 per minute (login limit is an addition).
10. **Zone `level`:** `normal` = 0 active SOS, `warning` = 1–2, `critical` = 3 or more.
11. **Dashboard `alerts`:** the 50 most recent alerts of ALL statuses, newest first (`stats.pendingAlerts` counts only the pending ones among them). `GET /api/sos` without `status` returns both active and resolved; `GET /api/alerts` without `status` returns all.
12. **Alert `message`** is localized by `?lang` (az/en/ru); `code` stays `RED_ALERT_SEND_CREW_OPEN_SHELTER` for both alert kinds.
13. **Dispatcher auth:** token lifetime 3600 s (`expiresIn`); no refresh endpoint — after expiry (401) log in again. Permissions are centralized in the backend (`dispatcher` and `admin` both may use dashboard and `/api/sim/*`).
15. **Alert engine** runs on every SOS creation and every shelter occupancy change. `SOS_CLUSTER`: >= 4 DISTINCT `citizenId`s with **active** SOS within 500 m of the newest SOS during the last 5 minutes (resolved/"safe" SOS do not count). `SHELTER_OVERLOAD`: occupancy strictly > 95 %. No new alert is created while a `pending` alert exists for the same cluster (within 500 m) or the same shelter; after approve/dismiss a new one may be raised. Alert `lat`/`lng` = cluster centroid (or the shelter position); for overload `details.windowMinutes`/`radiusMeters` keep their constant values (5/500) and `sosCount` is null.
16. **`proposal`** = nearest `available` crew + nearest closed reserve shelter, preferring ones not already proposed by another pending alert. Fields can be `null` when none exists. On approve a stale proposal is re-resolved; the response `crew`/`alert.proposal` show what was really used. `newShelter` in the approve response is `null` if no reserve shelter was left.
17. **New error codes:** `ALERT_NOT_FOUND` (404), `ALERT_NOT_PENDING` (409, approve/dismiss on a handled alert), `NO_CREW_AVAILABLE` (409, approve with no available crew), `ROAD_NOT_FOUND` (404). Sim shelter occupancy `percent` must be 0–100.
18. **`/api/sim/sos-burst`** places the SOS within 200 m of the given point (so they always form a cluster when `count >= 4`). **`/api/sim/reset`** first emits `sos.updated` (resolved) and `alert.updated` (dismissed) for everything that disappears, then restores seed data and re-emits all shelters/roads/crews; dispatchers should still call `GET /api/dashboard` afterwards.
14. **Seed data:** 12 shelters; `s9` and `s12` are reserve shelters, seeded as `closed` with 0 occupancy (alert approval opens them). `s10` starts at 100 % (`full`).

---
## I. Drop 1 — Accessibility & priority SOS (additive, v1.2)
Nothing in sections A–H changes for existing calls; all new fields/params are optional or additive.

### I.1 New fields on existing objects
| object | new field | notes |
|---|---|---|
| Shelter (REST, WS, dashboard, route) | `accessible: bool` | ramps / step-free. Seed: `s5 s6 s7 s10` are `false`; reserve shelters `s9 s12` are `true` |
| Road (REST, WS) | `accessible: bool` | Seed: `r4 r7 r10` are `false` |
| Crew (REST, WS, dashboard, approve response) | `accessibleTransport: bool` | Seed: `c2 c4 c6` are `true` |
| SOS (REST, WS, dashboard, `POST /api/sos` input) | `profile`, `priority`, `priorityRank` | see I.2 |

### I.2 SOS priority
`POST /api/sos` accepts optional `"profile": "standard" | "special_needs"`.
- `special_needs` → `priority:"critical"`, `priorityRank:1`; `standard` → `priority:"normal"`, `priorityRank:2`.
- The response of `POST /api/sos` is unchanged (`id,status,createdAt`). SOS objects everywhere now carry `profile`, `priority`, `priorityRank`.
- `GET /api/sos` and `dashboard.sos` are sorted by `priorityRank` ascending, then newest first. WS `sos.created` arrives in event order (sort client-side by `priorityRank`).
- **Profile registry:** the backend remembers the last profile per `citizenId` (set by `POST /api/sos` and by `GET /api/route?citizenId=`). If `profile` is omitted, the remembered profile is used, otherwise `standard`. Send `profile` explicitly to switch back to `standard`. Invalid value → 422.

### I.3 `GET /api/route` — optional `profile=special_needs`
- Only `accessible` shelters are considered, and roads with `accessible:false` are treated as blocked (in addition to closed roads). Inaccessible roads within 250 m of the start point are ignored, so the citizen's own position never blocks every route.
- Response (all profiles) adds: `accessible` (bool: shelter is accessible AND the route avoids inaccessible roads), `transport` (`"wheelchair_medical"` for special_needs, else `"walk"`), `accessibilityNotes` (`[]` for standard; for special_needs `["RAMP","STEP_FREE"]` plus `"MEDICAL_TRANSPORT_AVAILABLE"` when an available crew has `accessibleTransport`).
- **New `reason` values** (reroute reasons, also in WS `reroute`): `SHELTER_NOT_ACCESSIBLE` (requested shelter not accessible, special_needs only) and `ROAD_NOT_ACCESSIBLE` (route crosses an inaccessible road, special_needs only).
- If no accessible shelter/route is reachable (also when the requested shelter cannot be replaced) → **HTTP 409** `{"error":{"code":"NO_ACCESSIBLE_ROUTE",...}}`.
- WS `reroute` for a special_needs citizen keeps the same constraint (payload has the same new fields). If no accessible route exists any more, **no** `reroute` is pushed (the next `GET /api/route` returns 409).
- `GET /api/shelters/nearest` is unchanged (not profile-aware).

### I.4 Alert kind `PRIORITY_SOS`
- Created immediately for every `special_needs` SOS (one alert per SOS; no duplicate for the same SOS). `kind:"PRIORITY_SOS"`, `level:"red"`, `code:"PRIORITY_SOS_DISPATCH_ACCESSIBLE_TRANSPORT"`, `lat/lng` = SOS position.
- `message` (by `?lang`): az `Prioritet SOS: Əlçatan nəqliyyatlı briqada göndər` · en `Priority SOS: Send a crew with accessible transport` · ru `Приоритетный SOS: направить бригаду с доступным транспортом`.
- `details`: `{"sosCount":1,"windowMinutes":null,"radiusMeters":null,"shelterId":null,"occupancyPercent":null,"sosId":"sos_123"}` (`sosId` is new and only present for this kind).
- `proposal`: `{"crewId","crewName","newShelterId":null,"newShelterName":null}` — nearest available crew with `accessibleTransport` (preferring one not proposed by another pending alert); `crewId`/`crewName` are `null` when none is available.
- `POST /api/alerts/{id}/approve` dispatches that crew (`status:"dispatched"`) and returns `newShelter: null`; no shelter is opened. With no accessible crew available → 409 `NO_CREW_AVAILABLE`. `dismiss` works as for other kinds. `alert.created` / `alert.updated` are emitted over `WS /ws/dispatcher`. UIs must handle `proposal.newShelterId == null`.

### I.5 Other
- `POST /api/sim/sos-burst` creates `standard` SOS only.
- A local dev database created before Drop 1 is rebuilt automatically (demo data only) on server start.

---
## J. Routing provider outage handling (additive, v1.3)
Nothing in sections A–I changes for existing calls.

### J.1 `POST /api/sim/provider`  (Bearer token, `simulate` permission)
Body `{"state":"up"|"down"|"slow"}` → `{"ok":true,"state":"down"}` (invalid state → 422).
- `down`: every provider call fails immediately (outage).
- `slow`: the provider is slower than the 2 s timeout, so each call waits at most 2 s and then fails (latency/timeout simulation).
- `up`: normal again; also closes the circuit breaker immediately (otherwise it would stay open for its 30 s cooldown).
- While the provider fails, `GET /api/route` still answers `200` with `"source":"fallback"` (straight-line estimate, `alternatives: []`). A request waits for a failing provider **at most once and at most 2 s**, regardless of how many candidate shelters it evaluates. After 3 failing requests the circuit breaker opens (30 s) and routes are answered instantly from the fallback; after the cooldown one trial call is allowed.
- `POST /api/sim/reset` also puts the provider back to `up`.

### J.2 `GET /api/health`
`{"status":"ok","routingProvider":"up"|"down","breaker":"closed"|"open"}` — `breaker` is new. `routingProvider` is `down` when the provider is forced `down`/`slow` or the breaker is open.

### J.3 WebSocket event `provider.updated` (dispatchers only)
`{"type":"provider.updated","data":{"state":"up"|"down"|"slow","breaker":"closed"|"open"},"ts":"..."}` — sent when the forced state changes (sim endpoint) and whenever the breaker opens/closes. Citizens do not receive it; they only see `source` on route responses. Show the fallback badge when `source == "fallback"`.

### J.4 Optional real provider (server config, no API change)
Env `ROUTING_PROVIDER=osrm` uses the public OSRM demo server `router.project-osrm.org` (driving profile, up to 2 route options) with a hard 2 s limit per call; any error, timeout or bad payload goes through the same breaker + fallback logic. Default (`mock`, or unset) keeps the built-in mock provider. The demo server is for light use only. Env `MOCK_ROUTING_DOWN=1` starts the server with the provider forced `down`.

---
## K. Offline / backup route mode (additive, v1.4)
The external map/routing API can fail (HTTP 503, timeout, any error). The backend never fails because of it: routes are served from LOCAL backup data and flagged as offline. Nothing in A–J changes for existing clients.

### K.1 Provider simulation states — `POST /api/sim/provider`
`{"state":"up"|"down"|"slow"|"http503"}`. New: `http503` (the provider fails like an HTTP 503). `slow` simulates a response slower than 5 s; our own 2 s timeout fires first, so a request waits at most 2 s (once per request). Real OSRM failures (503, timeout, bad payload, any exception) take the same path. After 3 failed requests the circuit breaker opens automatically (30 s, then one trial call); `state:"up"` closes it immediately.

### K.2 `GET /api/health`
Adds `"degraded": true|false` — `true` when the provider state is not `up` or the breaker is open. Full shape: `{"status":"ok","routingProvider":"up"|"down","breaker":"closed"|"open","degraded":false}`.

### K.3 `GET /api/route` and WS `reroute` — new fields (all profiles)
| field | value |
|---|---|
| `offline` | `true` when the route comes from backup data (same condition as `source:"fallback"`, which is kept for compatibility) |
| `fallbackMode` | `null` (provider route) \| `"cache"` \| `"static_matrix"` \| `"straight_line"` |
| `notice` | `null` or `{"code":"OFFLINE_BACKUP_ROUTE_MODE","message":"<localized by ?lang>"}` — az `Oflayn / Ehtiyat marşrut rejimində işləyir`, en `Offline / backup route mode is active`, ru `Работает офлайн / в режиме резервных маршрутов` |

Backup order: **(1) cache** — the last successful route per (shelter, origin on a ~200 m grid), last 500 kept; **(2) static matrix** — a route precomputed at startup (and after seed/reset) for every district centroid × every shelter with a 1.3 detour factor on distance/duration; the entry of the origin's nearest district is used (its polyline is re-anchored at the real origin, so distance/duration are estimates); **(3) straight line** (Haversine). `alternatives` is `[]` in offline mode. Closed roads, accessibility rules (`profile=special_needs`), shelter occupancy/status and reroute logic still apply because they come from the local database. UIs should show the `notice` (badge/banner) whenever `offline` is `true`.

### K.4 Robustness
- Any unexpected server exception returns HTTP 500 with the standard body `{"error":{"code":"INTERNAL_ERROR","message":"Internal server error"}}` (no stack trace or internals; CORS headers are still present; the details are logged server-side).
- `GET /api/route` never returns 5xx because of the routing provider.
- WebSocket handlers and broadcasts swallow and log exceptions; one broken client never affects others.

---
## L. Security & load hardening (additive, v1.5)
No endpoint, field or event from A–K is removed or renamed. New behaviour only; clients should handle the new error responses below.

### L.1 Response headers (every HTTP response, including errors)
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`. Responses under `/api/auth/*` also carry `Cache-Control: no-store`. Responses of at least 500 bytes are gzip-compressed when the client sends `Accept-Encoding: gzip` (browsers do this automatically).

### L.2 New error responses (standard error body)
| status | code | when | extra |
|---|---|---|---|
| 429 | `RATE_LIMITED` | more than `RATE_LIMIT_GLOBAL` (default **300**) requests per minute from one IP, on any endpoint | `Retry-After: <seconds>` |
| 429 | `RATE_LIMITED` | existing limits unchanged: `POST /api/sos` 10/min per IP, `POST /api/auth/login` 10/min per IP | `Retry-After` |
| 429 | `LOGIN_LOCKED` | **5 failed logins** for the same IP + username lock that pair out for **60 s**; the correct password is also refused while locked; a successful login resets the counter | `Retry-After: <seconds left>` |
| 413 | `PAYLOAD_TOO_LARGE` | request body larger than **32 KB** (declared `Content-Length` or actual chunked size) | — |

`Retry-After` is exposed to browsers via CORS. `422 VALIDATION_ERROR` is also returned for a login `username` longer than 64 or `password` longer than 256 characters. WebSocket connections are not counted by the global limit.

### L.3 SOS `note` sanitization
`POST /api/sos` still accepts `note` up to 200 characters, but the stored/broadcast value is sanitized: HTML tags (also unterminated ones) are removed, control and invisible format characters (incl. bidi overrides) are dropped, stray `<` `>` are removed, whitespace is collapsed and trimmed. So `"<b>Help</b>\u0000 me"` is stored as `"Help me"`. UIs should still render notes as plain text.

### L.4 `GET /api/health`
Adds `"state": "up"|"down"|"slow"|"http503"` — the exact provider simulation state (what `POST /api/sim/provider` last set). Full shape: `{"status":"ok","routingProvider":"up"|"down","breaker":"closed"|"open","degraded":false,"state":"up"}`. Dispatcher UIs can use it to restore the exact provider indicator after a page reload (previously `slow` and `http503` both showed as `down`).

### L.5 Caching
`GET /api/shelters`, `/api/roads` and `/api/districts` are cached in server memory for **2 s** (per `lang`) and invalidated immediately when any shelter, road or district row changes (sim endpoints, alert approve, reset, anything), so clients never see data older than the last change. Other endpoints are not cached.

### L.6 Server configuration (env, no API impact)
`JWT_SECRET` (set a random value ≥ 32 chars; the server logs a loud warning at startup while the built-in default is used), `RATE_LIMIT_GLOBAL` (300), `RATE_LIMIT_SOS` (10), `RATE_LIMIT_LOGIN` (10), `LOGIN_MAX_FAILURES` (5), `LOGIN_LOCK_SECONDS` (60), `MAX_BODY_BYTES` (32768), `CACHE_TTL` (2), `AUDIT_LOG` (default `backend/audit.log`). Rate limits and lockout are per client IP as seen by the server (behind a reverse proxy, forward the real client IP). Tokens and passwords are never logged. Role checks go only through the central `PERMISSIONS` table in `auth.py`.

### L.7 Audit log
`backend/audit.log` (git-ignored), one JSON object per line: `{"time","event","user","role","ip", ...}`. Events: `login.success`, `login.failure`, `login.locked`, `sos.create` (user = citizenId, role `citizen`, plus `sosId`), `alert.approve`, `alert.dismiss` (plus `alertId`), `sim.call` (plus `method`, `path`). For a failed login `user` is the attempted username and `role` is absent.

### L.8 Database indexes
`sos(status)`, `sos(created_at)`, `sos(citizen_id)`, `sos(status, created_at)`, `alert(status)`; created automatically at startup, also on an existing database.

### L.9 Load test
`python backend/tools/loadtest.py [--base-url http://127.0.0.1:8000] [--requests 200] [--no-sos]` fires N concurrent requests (60 % `GET /api/shelters`, 10 % `POST /api/sos`, 30 % `GET /api/route`) and prints p50/p95/max per endpoint and the status-code counts. `POST /api/sos` writes real rows (use `--no-sos` or the sim Reset afterwards); 429 counts as the limiter working, not as an error. Use `127.0.0.1`, not `localhost`, on Windows (the IPv6 fallback adds ~200 ms per new connection).

---
## M. SOS flood / spam defence & RBAC hardening (additive, v1.6)
Nothing in A–L is removed or renamed. A normal citizen never sees a difference; an attacker sees cheap 429s.

### M.1 `POST /api/sos` admission (decided BEFORE the database, in this order)
| step | result | when |
|---|---|---|
| per-IP limit | `429 RATE_LIMITED` + `Retry-After` | more than 10 SOS/min from one IP (unchanged) |
| duplicate filter | `200 {"id","status":"active","createdAt","duplicate":true}` — the EXISTING SOS, no new row, no events, no budget spent | same `citizenId` + same `type` within 60 s, or same IP + same ~50 m grid cell + same `type` within 30 s. A `special_needs` SOS is never answered with a `standard` one. "I am safe" (`POST /api/safe`) forgets the citizen's duplicates. |
| per-citizen limit | `429 CITIZEN_RATE_LIMITED` + `Retry-After` | more than 3 SOS/min with one `citizenId` |
| global budget | `429 SOS_FLOOD_THROTTLED` + `Retry-After` | more than `SOS_GLOBAL_PER_MIN` (300) admitted SOS/min. **`profile:"special_needs"` has a reserved budget and is never throttled by this step** (still bound by the per-IP / per-citizen limits). |
| accept | `201 {"id","status","createdAt"}` | otherwise — same body as before, also for quarantined SOS (the sender is never told) |

Clients should treat `200 + duplicate:true` as success (keep the returned `id`) and honour `Retry-After` on 429.

### M.2 Flood quarantine
More than `SOS_FLOOD_THRESHOLD` (60) accepted SOS in a rolling 60 s = **flood mode**. While it is on, a new SOS from a sender that is not trusted is stored with `trust:"suspicious"` and is **excluded from**: the alert engine (`SOS_CLUSTER` counts only `trust:"normal"`), `GET /api/dashboard` (`sos`, `stats.activeSos`, zone counts), `GET /api/sos` (unless `includeSuspicious=true`) and every per-item WS event (`sos.created` / `sos.updated` / `zone.updated`). **Trusted** (never quarantined): `special_needs` profile (per citizen), a request carrying a valid dispatcher/admin Bearer token (that IP is then trusted for 1 h), and the sim burst (`/api/sim/sos-burst`). Known limit: `profile` is self-declared by the citizen app, so it bypasses the global budget and quarantine; it is still capped by the per-IP and per-citizen limits.
The `sos` table gets `trust` (`normal`|`suspicious`) and `ip_hash` (salted hash, the raw IP is never stored; existing databases are migrated in place). Sos objects in API/WS payloads gain `"trust"`.

### M.3 Dispatcher visibility
* `GET /api/dashboard`: `stats.suspiciousSos` (active quarantined rows, int) and `stats.flood` = `{"active":bool,"suspiciousLastMinute":int}`. `sos` is capped at the **200** most relevant active SOS (priority first, then newest); `stats.activeSos` and zone counts are the true totals.
* `GET /api/sos?includeSuspicious=true` — also returns quarantined rows (default `false`).
* WS `sos.flood` (dispatchers): `{"type":"sos.flood","data":{"active":bool,"suspiciousCount":int,"windowSeconds":60}}`, `suspiciousCount` = SOS quarantined in the last `windowSeconds`. Coalesced: at most one event per 2 s; sent while the flood is active and once more when it ends. Under flood `zone.updated` is coalesced to at most one per zone per second (the last state is always delivered).
* `POST /api/sos/suspicious/clear` (permission `dispatch`) → `{"ok":true,"removed":n}` purges all quarantined rows.
* `POST /api/sim/flood` `{"count":600}` (1–5000, permission `simulate`) pushes N fake SOS (random citizens/IPs, ~10 % repeats, ~25 % same coordinates, ~3 % special_needs) through the REAL pipeline → `{"ok":true,"accepted":n,"duplicates":n,"throttled":n,"suspicious":n}` (`suspicious` ⊂ `accepted`). Use sim **Reset** afterwards.

### M.4 Auth / RBAC
* Tokens are HS256 only (`alg:none` and anything else is rejected) and must carry `exp`, `iat`, `sub`, `role`, `iss` (`crisis-evac-engine`) and `aud` (`crisis-dispatch`); both are validated. Tokens issued before this version are invalid: log in again.
* `PERMISSIONS`: `dispatcher` {view, dispatch}, `admin` {view, dispatch, simulate}. Env `SIM_ROLES` (default `dispatcher,admin`) lists roles that also get `simulate`, so the dispatcher UI's simulation drawer keeps working; set `SIM_ROLES=admin` to lock it down.
* `401 UNAUTHORIZED`: missing / invalid / expired / wrong iss-aud token. `403 FORBIDDEN`: valid token whose role is unknown or lacks the permission. Required: `view` for dashboard / SOS list / crews / alerts list / WS `/ws/dispatcher`; `dispatch` for alert approve/dismiss and `suspicious/clear`; `simulate` for `/api/sim/*`.
* `GET /api/auth/me` (any valid token) → `{"username","role","permissions":["dispatch","simulate","view"]}` (sorted).
* Audit log (`backend/audit.log`): new events `access.denied` (every 403, with user, role, ip, method, path, permission) and `sos.suspicious.clear`; approve/dismiss were already logged. Writes are buffered by a background thread (never block a request).

### M.5 Performance notes
`GET /api/route` results are cached 2 s per (50 m origin cell, shelterId, profile, lang); offline/backup answers are never cached and a provider state/breaker change clears the cache. Hot read endpoints (`/api/health`, `/shelters`, `/roads`, `/districts`, `/route` on a cache hit) are answered without a worker-thread hop. SQLite runs in WAL mode with a 30 s busy timeout. Quarantined SOS are written in batches (≤ 250 ms delay; every reader flushes first, so views are never stale).

### M.6 Env vars (new)
`SOS_GLOBAL_PER_MIN` (300), `SOS_CITIZEN_PER_MIN` (3), `SOS_FLOOD_THRESHOLD` (60), `SIM_ROLES` (`dispatcher,admin`), `JWT_ISSUER`, `JWT_AUDIENCE`, `IP_HASH_SALT` (random per process if unset). Existing: `RATE_LIMIT_SOS` (10), `RATE_LIMIT_GLOBAL` (300), `JWT_SECRET`, …

### M.7 Run command (production-like, ONE worker, no reload)
`uvicorn app.main:app --port 8000 --no-access-log --log-level warning`
Do not use `--reload` (it adds a file watcher and a second process) or several `--workers`: the rate limits, dedupe, quarantine and caches live in process memory, so each worker would have its own copy.

### M.8 Load test
`python tools/loadtest.py --scenario flood [--pace-seconds 3] [--procs 4] --base-url http://127.0.0.1:8000` — 600 SOS (600 random citizens, ~10 % duplicates, ~25 % same coordinates) + 200 GET shelters/route from several processes, while a dispatcher polls `GET /api/dashboard` every 200 ms. `--pace-seconds 0` (default) releases everything in the same instant (stress); `3` spreads it over 3 s. From one IP the per-IP limit rejects most SOS cheaply; start the server with `RATE_LIMIT_SOS=100000 RATE_LIMIT_GLOBAL=100000` to simulate a distributed attack that reaches the real pipeline. No third-party packages are needed.

### M.9 Alert merge and cap (v1.6.1)
A new `SOS_CLUSTER` within 1 km of an existing PENDING `SOS_CLUSTER` alert is merged into it: `details.sosCount` grows (max), `details.updatedAt` is set and `alert.updated` is emitted; no new alert is created. `GET /api/dashboard` and `GET /api/alerts` return at most the 20 newest PENDING alerts (non-pending history is unchanged); `stats.totalPending` (and `stats.pendingAlerts`) carry the real pending count.
