# Technical Reference — Urban Crisis & Crowd Evacuation Engine

## 1. Core Data Models

### Zone (`zones[]`)
| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Unique district identifier (e.g., `z-nesimi`) |
| `name` | `string` | Display district name (`Nəsimi`, `Səbail`, `Nərimanov`, `Xətai`, `Yasamal`) |
| `lat`, `lng` | `number` | District centroid coordinates |
| `radius` | `number` | Circle radius in meters for map visualization |
| `level` | `'normal' \| 'warning' \| 'critical'` | Severity classification driving circle tint and badge |
| `activeSos` | `number` | Count of unresolved SOS signals inside the zone |

### SOS Signal (`sos[]`)
| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Unique SOS ID |
| `type` | `'fire' \| 'collapse' \| 'flood' \| 'medical'` | Hazard category |
| `lat`, `lng` | `number` | Incident WGS84 coordinates |
| `zoneId`, `zoneName` | `string` | Matched Baku district |
| `note` | `string` | Citizen/operator message (sanitized before rendering) |
| `status` | `'active' \| 'dispatched' \| 'resolved'` | Response lifecycle state |
| `createdAt` | `string` | ISO-8601 timestamp |

### Shelter (`shelters[]`)
| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Shelter ID |
| `name` | `string` | Shelter facility name |
| `lat`, `lng` | `number` | Facility coordinates |
| `capacity`, `occupancy` | `number` | Maximum capacity and current headcount |
| `percent` | `number` | Occupancy percentage (`0–100`) |
| `status` | `'open' \| 'filling' \| 'near_full' \| 'full' \| 'closed'` | Color thresholds: `<75` green (`open`), `75–89` yellow (`filling`), `90–99` orange (`near_full`), `>=100` red (`full`), or `closed` (gray reserve) |

### Response Crew (`crews[]`)
| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Crew ID |
| `name` | `string` | Unit callsign and specialty |
| `lat`, `lng` | `number` | Current unit position |
| `status` | `'available' \| 'dispatched' \| 'busy'` | Readiness state |
| `assignedAlertId` | `string \| null` | Active Red Alert assignment |

### Red Alert (`alerts[]`)
| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Alert ID |
| `status` | `'pending' \| 'approved' \| 'dismissed'` | Workflow state |
| `type` | `'sos_cluster' \| 'shelter_overload'` | Detection trigger source |
| `zoneId`, `zoneName`, `lat`, `lng` | `string \| number` | Incident focus location |
| `trigger` | `string` | Human-readable rule summary (e.g., `4 SOS / 5 dəq / 500 m`, `Toplanış məntəqəsi 96%`) |
| `proposal` | `object` | Recommended `crewId`/`crewName` + `openShelterId`/`openShelterName` |

### Road (`roads[]`)
| Field | Type | Description |
| --- | --- | --- |
| `id`, `name` | `string` | Road identifier and avenue name |
| `status` | `'open' \| 'closed'` | Closed roads render on the map as red dashed polylines |
| `path` | `Array<[number, number]>` | Polyline vertices (`[[lat, lng], ...]`) |

---

## 2. Crisis Clustering & Overload Decision Engine

1. **Spatial-Temporal SOS Clustering (`4 SOS / 5 min / 500 m`):**
   - Incoming SOS reports are grouped by proximity (`<= 500 m`) within a rolling `5 minute` window.
   - When a cluster reaches `>= 4` active signals, the zone escalates to `critical` and emits an `alert.created` Red Alert proposing the nearest `available` crew and a `closed` reserve shelter (or lowest-occupancy open shelter) for activation.
2. **Shelter Overload Detection (`>= 90%`):**
   - When shelter occupancy hits `>= 90%` (`near_full` / `full`), a Red Alert is generated identifying the overloaded facility and proposing an alternate reserve shelter + crowd-management crew.
3. **Human-in-the-Loop Approval:**
   - Dispatchers retain authority via **"Təsdiq et"** (`POST /api/alerts/{id}/approve`) or **"Ləğv et"** (`POST /api/alerts/{id}/dismiss`). Approval atomically dispatches the crew, opens the reserve shelter, updates live stats, and flies the map to the incident.

---

## 3. Security, RBAC & Fallback Handling

- **Role-Based Access Control (`src/auth/permissions.js`):**
  - `can(role, action)` checks a declarative permission set (`dispatcher` can view and approve/dismiss alerts; `admin` adds `simulate`). Extending for additional roles takes <5 lines.
- **Token Handling:**
  - JWTs and user metadata are stored exclusively in `sessionStorage` and in-memory state — never `localStorage`. Any `401`/`403` from protected endpoints immediately clears the session and returns to `LoginPage`.
- **XSS Prevention:**
  - `dangerouslySetInnerHTML` is strictly forbidden across the codebase.
  - All user-supplied notes pass through `sanitizeUserNote()` (stripping control characters and enforcing bounds) before JSX interpolation. Leaflet `divIcon` HTML uses only internal enums and numeric percentages.
- **Routing Provider Health & Fallback:**
  - `GET /api/health` is polled every 20 seconds and on reconnect. If `routingProvider` drops to `down`, the header badge turns red (`DOWN`) to warn dispatchers while map visualization, manual crew dispatch, and road-closure overlays remain fully operational.
- **Rate Limiting (`429`):**
  - HTTP `429` responses trigger a non-blocking warning toast (`toast.rateLimit`) without tearing down the WebSocket session.
