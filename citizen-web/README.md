# Citizen Web — SafeBaku

Citizen-facing React/Vite application for Digital Challenge 2026 Azerbaijan. Uses only the public REST and citizen WebSocket endpoints in `../docs/API_CONTRACT.md` (including H–J).

## Run

```powershell
npm.cmd install
Copy-Item .env.example .env
npm.cmd run dev -- --host localhost --port 5173 --strictPort
```

Open http://localhost:5173. Use `npm` instead of `npm.cmd` on shells without PowerShell's script-policy restriction.

The default configuration uses the real backend:

```dotenv
VITE_API_URL=http://localhost:8000
VITE_USE_MOCK=false
```

Start the team's existing backend on port 8000. For a separate local test environment, from `citizen-web/`:

```powershell
py -m venv .test-venv
.test-venv/Scripts/python.exe -m pip install -r ../backend/requirements.txt
New-Item -ItemType Directory -Force .test-artifacts
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:DATABASE_URL = 'sqlite:///' + (Join-Path (Get-Location) '.test-artifacts/integration.db').Replace('\','/')
$env:AUDIT_LOG = Join-Path (Get-Location) '.test-artifacts/backend-audit.log'
.test-venv/Scripts/python.exe -m uvicorn app.main:app --app-dir ../backend --host 127.0.0.1 --port 8000
```

The separate SQLite file avoids simultaneous-request conflicts seen when using the backend's shared in-memory database. The virtual environment and artifacts are ignored by Git. No backend source changes are needed. Use `localhost:5173` as the browser origin, as required by backend CORS. Restart Vite after changing environment settings.

Set `VITE_USE_MOCK=true` for standalone demo fixtures and periodic simulated shelter, road, and reroute events. Mock names follow the selected language; mock routes are explicitly labelled straight-line fallback estimates.

## Citizen features

- OpenStreetMap/Leaflet map, district picker, manual map position, and browser geolocation.
- Nearest three points, occupancy/status/accessibility markers, blocked-road overlays, recommended route and alternatives.
- AZ / EN / RU via i18next; saved language and profile; anonymous UUID v4 persisted when storage is available.
- Explicit standard/special-needs route profiles, accessible transport information, priority SOS, safe resolution, pending locks, ten-second SOS cooldown and live Retry-After countdowns.
- Live citizen updates, immediate reroute rendering, automatic route revalidation, reconnect/resync, and a terminal rejected state on close code 1008.
- Cancelled/debounced requests, stale response protection, localized failures, accessible modal and React error boundary.
- Fallback warning for successful provider-outage responses; refresh action for recovery. Straight-line estimates are not road-following navigation.
- Mobile emergency action bar and responsive 360px / desktop layout.

Coordinates initially use the labelled Baku default. Select an actual position before sending a real emergency signal. Geolocation requires browser permission and a secure context (localhost qualifies). Map labels supplied by OpenStreetMap remain the tile provider's labels.

## Validation

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Against an **isolated test backend only**:

```powershell
npm.cmd run test:integration
```

The integration suite uses documented demo dispatcher authentication and simulation endpoints exclusively in test code. It resets seed data, creates/resolves test SOS records, changes occupancies/provider state, and resets afterwards. Never run it against a shared demo or production database. No dispatcher controls or credentials are shipped in the citizen application.

Verified on 2026-11-15: nine unit tests and seven real FastAPI integration tests passed, including priority ordering, WebSocket shelter/road/reroute messages, provider recovery, and HTTP 409. Browser checks covered AZ/EN/RU, language persistence, accessible routing, inaccessible shelter disabling, SOS success/cooldown, safe resolution, provider fallback, missing accessible route, and 360px overflow/layout. A live manual reroute that exhausted reachable accessible destinations correctly showed the localized error and removed the route.

Real integration used the backend's default built-in routing provider plus its documented outage simulator. The optional external OSRM service and physical-device GPS/vibration were not validated.

Citizen audit follow-up (2026-11-15): synced `origin/develop` through section K/L, preserved all team AI log entries, and verified 11 unit tests, 9 real FastAPI integration tests, ESLint and production build. Browser checks verified AZ/EN/RU, localized section K offline notices, shelter/park/stadium icons and successful refresh/recovery without explicitly selecting a shelter. Backup cache/matrix routes now have appropriate warnings instead of being described as straight lines. Live updates no longer refetch the entire metadata snapshot, and clicking the current destination does not request it again. Local client backups and queued SOS were deferred at that checkpoint and are now implemented below.

## Final SOS and DROP 2 resilience

- Every REST operation has a five-second AbortController deadline, including response-body reads. Caller cancellation remains distinct from timeout/offline fallback.
- The single SOS queue (`safebaku.sos-queue.v1`) stores the exact payload, local record identity, attempt count and retry deadline before transmission. The initial attempt counts toward a maximum of **three actual sends**. A worker checks every ten seconds while the app is open, resumes on return/online, and never resets the budget on reload or recovery. Waiting offline or before Retry-After consumes no attempts.
- RATE_LIMITED, CITIZEN_RATE_LIMITED and SOS_FLOOD_THROTTLED have distinct AZ/EN/RU messages with a live countdown. A `duplicate: true` response is acknowledged as successful. Pending and exhausted records are never labelled delivered; permanent failures and exhausted records stay stored and visible for manual attention. Storage failures are surfaced. Successful “I'm Safe” cancels pending sends after the backend confirms safety.
- Web Locks serialize queue operations across supported tabs; a storage lease is used as a best-effort fallback. The latest fetched backend contract has **no idempotency request field**, so the local ID is not transmitted as an invented field. Exactly-once backend processing cannot be guaranteed after a lost response. The new rate codes / duplicate response are compatibility-tested with fixtures; the current backend does not emit them.
- Shelters, roads, districts and recent routes are stored in `safebaku.offline-cache.v1`. Network failures, HTTP 5xx and timeouts use available backups. Routes must match origin/profile and a compatible available cached destination; otherwise a Haversine straight-line estimate targets the nearest compatible cached shelter. No cache means no fabricated destination. A 409 or 429 is displayed, not hidden by stale data.
- Local backup routes display `client_cache` (or `straight_line` for calculated estimates), a persistent yellow localized banner and **unverified accessibility**. Cached conditions and medical-transport information are last-known data, not live availability guarantees. Estimates can cross blocked roads and are not road-following navigation. Offline base-map tiles depend on the browser's existing tile cache.
- Live GET refreshes run every ten seconds during backup mode and on browser online events. Successful recovery replaces backups and clears the offline banner; the SOS worker retains its original attempt budget.
- Development builds expose local outage controls: live/recovery, network failure, `offline=true`, HTTP 503 and six-second latency (bounded by the five-second timeout). They do not change the backend or appear in production builds.

Final validation: 28 unit tests plus 9 live FastAPI integration tests, ESLint and production build passed. Mobile browser checks at 360px verified no horizontal overflow, localized offline/client_cache notices, retained route during latency, ten-second cooldown, visible three-attempt exhaustion, and automatic delivery of an eligible queued SOS after recovery. The backend's new-code/idempotency limitations above remain external integration constraints.
