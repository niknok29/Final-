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
- Explicit standard/special-needs route profiles, accessible transport information, priority SOS, safe resolution, pending locks and SOS cooldown / Retry-After.
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

Citizen audit follow-up (2026-11-15): synced `origin/develop` through section K/L, preserved all team AI log entries, and verified 11 unit tests, 9 real FastAPI integration tests, ESLint and production build. Browser checks verified AZ/EN/RU, localized section K offline notices, shelter/park/stadium icons and successful refresh/recovery without explicitly selecting a shelter. Backup cache/matrix routes now have appropriate warnings instead of being described as straight lines. Live updates no longer refetch the entire metadata snapshot, and clicking the current destination does not request it again. Section K backup data remains server-provided; client localStorage route backups and queued SOS are deferred to the separate DROP 2 task.
