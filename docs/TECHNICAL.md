# Technical Reference — Urban Crisis & Crowd Evacuation Engine

## 1. Core Data Models (Contract v1.2 — Drop 1)

### Zone (`zones[]`)
| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Unique district identifier (e.g., `nasimi` / `z-nesimi`) |
| `name` | `string` | Localized display district name |
| `lat`, `lng` | `number` | District centroid coordinates |
| `radius` | `number` | Circle radius in meters for map visualization |
| `level` | `'normal' \| 'warning' \| 'critical'` | Severity classification (`0` normal, `1–2` warning, `>=3` critical) |
| `activeSos` | `number` | Count of unresolved SOS signals inside the zone |

### SOS Signal (`sos[]`)
| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Unique SOS ID |
| `citizenId` | `string` | Anonymous citizen UUID v4 |
| `type` | `'fire' \| 'collapse' \| 'flood' \| 'medical'` | Hazard category |
| `profile` | `'standard' \| 'special_needs'` | Accessibility priority profile |
| `priority` | `'normal' \| 'critical'` | Priority classification (`critical` for `special_needs`) |
| `priorityRank` | `1 \| 2` | Sort rank (`1` for `special_needs`, `2` for `standard`) |
| `lat`, `lng` | `number` | Incident WGS84 coordinates |
| `zoneId`, `zoneName` | `string` | Matched Baku district |
| `note` | `string` | Citizen/operator message (sanitized before rendering) |
| `status` | `'active' \| 'resolved'` | Response lifecycle state |
| `createdAt` | `string` | ISO-8601 UTC timestamp |

### Shelter (`shelters[]`)
| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Shelter ID |
| `name` | `string` | Localized shelter facility name |
| `kind` | `'shelter' \| 'park' \| 'stadium'` | Facility category |
| `lat`, `lng` | `number` | Facility coordinates |
| `capacity`, `occupancy` | `number` | Maximum capacity and current headcount |
| `occupancyPercent` / `percent` | `number` | Occupancy percentage (`0–100`) |
| `status` | `'open' \| 'filling' \| 'near_full' \| 'full' \| 'closed'` | Color thresholds: `<75` green (`open`), `75–89` yellow (`filling`), `90–99` orange (`near_full`), `>=100` red (`full`), or `closed` (gray reserve) |
| `accessible` | `boolean` | Step-free / ramp accessibility flag (`♿`) |

### Response Crew (`crews[]`)
| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Crew ID |
| `name` | `string` | Unit callsign and specialty |
| `lat`, `lng` | `number` | Current unit position |
| `status` | `'available' \| 'dispatched' \| 'busy'` | Readiness state |
| `assignedAlertId` | `string \| null` | Active Red Alert assignment |
| `accessibleTransport` | `boolean` | Equipped with wheelchair/medical accessible transport (`♿`) |

### Red Alert (`alerts[]`)
| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Alert ID |
| `level` | `'red'` | Alert severity level |
| `kind` | `'SOS_CLUSTER' \| 'SHELTER_OVERLOAD' \| 'PRIORITY_SOS'` | Detection trigger source |
| `status` | `'pending' \| 'approved' \| 'dismissed'` | Workflow state |
| `code` | `string` | Machine code (`RED_ALERT_SEND_CREW_OPEN_SHELTER` or `PRIORITY_SOS_DISPATCH_ACCESSIBLE_TRANSPORT`) |
| `zoneId`, `lat`, `lng` | `string \| number` | Incident focus location |
| `details` | `object` | Trigger metadata (`sosCount`, `windowMinutes`, `radiusMeters`, `shelterId`, `occupancyPercent`, `sosId`) |
| `proposal` | `object` | Recommended `crewId`/`crewName` + `newShelterId`/`newShelterName` (`null` for `PRIORITY_SOS`) |

### Road (`roads[]`)
| Field | Type | Description |
| --- | --- | --- |
| `id`, `name` | `string` | Road identifier and avenue name |
| `status` | `'open' \| 'closed'` | Closed roads render on the map as red dashed polylines |
| `accessible` | `boolean` | Indicates step-free accessible path (`false` roads render with amber warning overlays) |
| `path` | `Array<[number, number]>` | Polyline vertices (`[[lat, lng], ...]`) |

---

## 2. Drop 1 Priority SOS, Clustering & Overload Decision Engine

1. **Priority SOS (`special_needs` / Rank 1):**
   - SOS reports with `profile: "special_needs"` receive `priority: "critical"` and `priorityRank: 1`.
   - The Dispatcher feed sorts strictly by `priorityRank` ascending first, then newest `createdAt` first, pinning Priority #1 cards to the top with a crimson left border, `♿ PRİORİTET #1` badge, and a dedicated `"Priority only"` toggle.
   - Map markers for Priority SOS render larger (`36x36`) with a pulsing highlight and `♿` symbol.
   - Every `special_needs` SOS immediately raises a `PRIORITY_SOS` alert (`PRIORITY_SOS_DISPATCH_ACCESSIBLE_TRANSPORT`) proposing an available crew with `accessibleTransport: true` and `newShelterId: null` (no reserve shelter opened).
2. **Spatial-Temporal SOS Clustering (`4 SOS / 5 min / 500 m`):**
   - Incoming active SOS reports from `>= 4` distinct citizens within `500 m` and `5 minutes` trigger a `SOS_CLUSTER` Red Alert proposing the nearest available crew and a closed reserve shelter.
3. **Shelter Overload Detection (`> 95%`):**
   - When shelter occupancy breaches threshold, a `SHELTER_OVERLOAD` Red Alert proposes crowd-control dispatch and reserve shelter activation.
4. **Human-in-the-Loop Approval:**
   - Dispatchers act via **"Təsdiq et"** (`POST /api/alerts/{id}/approve`) or **"Ləğv et"** (`POST /api/alerts/{id}/dismiss`). On `PRIORITY_SOS`, approval dispatches the accessible-transport crew while gracefully skipping shelter opening (`newShelter: null`).

---

## 3. Security, Contract Errors & Fallback Handling

- **Role-Based Access Control (`src/auth/permissions.js`):**
  - `can(role, action)` checks a declarative permission set matching `backend/app/auth.py` (both `dispatcher` and `admin` may view live telemetry, approve/dismiss alerts, and trigger `simulate` scenarios). Extending for additional roles (e.g., read-only observer) takes <5 lines.
- **Token & WebSocket `1008` Handling:**
  - JWTs and user metadata are stored exclusively in `sessionStorage` and in-memory state — never `localStorage`.
  - HTTP `401`/`403` and WebSocket close code `1008` (invalid/expired token or missing permission) immediately clear `sessionStorage`, halt reconnect loops, and redirect to `LoginPage`.
- **Conflict & Rate Limit Error Codes:**
  - `ALERT_NOT_PENDING` (`409`): displays a warning toast and triggers snapshot resync.
  - `NO_CREW_AVAILABLE` (`409`): notifies dispatchers that no eligible crew (or accessible transport unit) is free.
  - `RATE_LIMITED` (`429`): respects the `Retry-After` response header when provided, displaying a non-blocking warning toast with retry timing.
- **XSS Prevention:**
  - `dangerouslySetInnerHTML` is strictly forbidden across the codebase.
  - All user-supplied notes pass through `sanitizeUserNote()` before JSX interpolation; Leaflet `divIcon` HTML contains only internal enums, `♿` indicators, and numeric percentages.
- **Dynamic i18n (`AZ` / `EN` / `RU`):**
  - Switching language updates `<html lang="...">`, persists in `sessionStorage`, appends `?lang=` and `&lang=` to backend GET/WS requests, and formats numbers/timestamps via `Intl.NumberFormat` and `Intl.DateTimeFormat`.

---

## 4. Routing Provider Outage (HTTP 503), Circuit Breaker & Offline Backup Route Mode (Drop 2 / Sections J & K)

- **Live Backend Default & 8s Request Guard (`src/api/client.js` & `.env.example`):**
  - `USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'` ensures the dashboard defaults to the live FastAPI backend even when `.env` is absent; `.env.example` ships with `VITE_API_URL=http://localhost:8000` and `VITE_USE_MOCK=false`.
  - `apiFetch` wraps all requests in an 8-second `AbortController` timeout so simulated `>5s` upstream latency never stalls or crashes the UI.
  - `simSetProvider(state)` sends `"up" | "down" | "slow" | "http503"` to `POST /api/sim/provider` and automatically falls back from `"http503"` to `{"state": "down"}` on HTTP `400`/`422` if running against a pre-Section-K backend.
- **Health Initialization & Live Telemetry (`GET /api/health` + `WS provider.updated`):**
  - On initial load, 20-second polling, and WebSocket reconnect (`onReconnectResync`), `getHealth()` / `provider.updated` normalize `{ status: "ok" | "degraded", routingProvider: "up" | "down" | "slow" | "http503" | "degraded", breaker: "closed" | "open", offline: boolean, fallbackMode: null | "cache" | "static_matrix" | "straight_line", notice: null | { code: "OFFLINE_BACKUP_ROUTE_MODE", message } }` defensively in `DashboardContext`.
- **Backend Circuit Breaker & Fallback Modes (`backend/app/routing.py`):**
  - Supports `MockProvider` (default) or `OsrmProvider` (`ROUTING_PROVIDER=osrm`, optional `MOCK_ROUTING_DOWN=1`).
  - `CircuitBreaker` trips on repeated failures/timeouts, falling back safely across `cache`, `static_matrix`, or Haversine `straight_line` strategies without blocking dispatchers.
- **Header Pill, Offline/Backup Route Mode Banner & Simulation Controls (`Header.jsx`, `DashboardPage.jsx`, `SimulationDrawer.jsx`):**
  - `Header.jsx` displays the severity-coded Routing Provider pill (`UP` green, `SLOW` / `DEGRADED` amber, `DOWN` / `HTTP 503` red) alongside the live circuit breaker badge (`breaker: closed` / `breaker: open`).
  - `DashboardPage.jsx` renders a localized **"Offline / backup route mode"** banner (showing active state + `fallbackMode` chip) whenever `offline === true`, `notice?.code === "OFFLINE_BACKUP_ROUTE_MODE"`, `healthStatus === "degraded"`, `routingProvider` is `"down" | "slow" | "http503" | "degraded"`, or `breaker === "open"`.
  - `SimulationDrawer.jsx` exposes **Up**, **Slow (>5s)**, **Down**, and **HTTP 503** controls wired to `POST /api/sim/provider`, and `POST /api/sim/reset` restores `up` / `closed` state.

---

## 5. Real-World Geospatial Metrics & Authentic Baku Coordinates

- **Metric Leaflet Circles (`CrisisMap.jsx`):**
  - District zones render using Leaflet's geographic `<Circle radius={zone.radiusMeters || 500} />` (measured in meters so circles scale accurately with zoom).
  - Active (`pending`) or focused Red Alerts (`SOS_CLUSTER`, `PRIORITY_SOS`) render a pulsing crimson dashed `<Circle radius={alert.details?.radiusMeters || 500} />` with tooltip/popup readout (`500 m`).
- **Exact Haversine Distance Utility (`src/utils/geo.js`):**
  - `calculateDistanceMeters(lat1, lng1, lat2, lng2)` computes spherical Earth distance in meters ($R = 6,371,000\text{ m}$).
  - `calculatePathLengthMeters(path)` sums consecutive polyline segment lengths across `[lat, lng]` waypoints for road length readouts.
  - `formatDistance(meters, locale)` renders locale-aware meters (`< 1000 m`) or tenths of kilometers (`>= 1000 m`).
  - `SosFeedPanel.jsx` (`findNearestShelter`), `RightStatusPanel.jsx` (`findCrewTargetDistance`), and `CrisisMap.jsx` popups display live Haversine distances for shelters, crews, and roads.
- **Authentic Baku Coordinates & Avenue Polylines (`src/api/mock.js`):**
  - Live backend responses (`VITE_USE_MOCK=false`) always take precedence; offline mock fixtures match real Baku landmarks (`Heydər Əliyev Mərkəzi / Parkı` `[40.3959, 49.8678]`, `Bakı Olimpiya Stadionu` `[40.4298, 49.9197]`, `Tofiq Bəhramov adına Respublika Stadionu` `[40.3975, 49.8524]`, `Neftçi Arena` `[40.4008, 49.9436]`, `Dənizkənarı Milli Park` `[40.3665, 49.8372]`, `Gənclik Mall / Park` `[40.4002, 49.8529]`).
  - Major arteries (`Neftçilər prospekti`, `Heydər Əliyev prospekti`, `Tbilisi prospekti`, `Ziya Bünyadov prospekti`, `Azadlıq prospekti`, `28 May küçəsi`) use multi-point street waypoint polylines with computed `lengthMeters`.
