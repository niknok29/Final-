# Running Guide — Urban Crisis & Crowd Evacuation Engine

This guide covers running all modules of the **Urban Crisis & Crowd Evacuation Engine** (Digital Challenge 2026 Azerbaijan), including standalone mock testing for the Dispatcher Control-Room Dashboard and full-stack live execution.

---

## 1. Prerequisites

- **Node.js** `>= 18` and **npm** `>= 9` (for `dispatcher-web/` and `citizen-web/`)
- **Python** `>= 3.11` (or the backend runtime configured in `backend/`)

---

## 2. Service Ports Overview

| Service | Directory | Default URL | Notes |
| --- | --- | --- | --- |
| Backend API & WS | `backend/` | `http://localhost:8000` (`ws://localhost:8000`) | REST API + `/ws/dispatcher` realtime stream |
| Citizen Evacuation App | `citizen-web/` | `http://localhost:5173` | Public SOS submission & evacuation routing |
| Dispatcher Control-Room | `dispatcher-web/` | `http://localhost:5174` | Control-room dashboard (configured in `vite.config.js`) |

---

## 3. Running Dispatcher Control-Room (`dispatcher-web/`)

### A. Live Backend Mode (Current Default)

`dispatcher-web/.env` is currently configured to connect to the live FastAPI backend (`VITE_USE_MOCK=false`), and the client defaults to live mode when `.env` is absent. Copy `.env.example` to create your local `.env`:

```env
VITE_API_URL=http://localhost:8000
VITE_USE_MOCK=false
```

1. **Setup & start the Python backend (`backend/`) on port `8000` (Windows PowerShell):**
   ```powershell
   cd backend
   python -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```
   Optional backend environment variables for external OSRM routing / outage simulation:
   - `ROUTING_PROVIDER=osrm` — query public OSRM routing instead of the built-in mock router (falls back cleanly via circuit breaker on failure).
   - `MOCK_ROUTING_DOWN=1` — start the backend with the routing provider forced down.
   - Verify Swagger docs at `http://localhost:8000/docs` and health at `http://localhost:8000/api/health`.
2. **(Optional) Start the citizen web app (`citizen-web/`):** port `5173`.
3. **Start the Dispatcher Control-Room (`dispatcher-web/`) on port `5174`:**
   ```bash
   cd dispatcher-web
   copy .env.example .env
   npm install
   npm run dev
   ```
   Open `http://localhost:5174` in a desktop browser (`1920x1080` or `1366x768`).

### B. Standalone Mock Mode (Offline Demo)

To run `dispatcher-web/` standalone without the Python backend, update `dispatcher-web/.env`:

```env
VITE_API_URL=http://localhost:8000
VITE_USE_MOCK=true
```

Then start `npm run dev` inside `dispatcher-web/`.

### C. Production Build & Lint Verification

```bash
cd dispatcher-web
npm run lint
npm run build
```

---

## 4. Demo Accounts

| Role | Username | Password | Capabilities |
| --- | --- | --- | --- |
| Dispatcher | `dispatcher` | `dispatcher123` | View live dashboard, filter SOS feed, approve/dismiss Red Alerts, and run Simulation controls |
| Admin | `admin` | `admin123` | Full control-room access including Simulation Control Panel |

---

## 5. Step-by-Step Judge Demo Script

1. **Dispatcher Login (`dispatcher / dispatcher123`):**
   - Open `http://localhost:5174`. Note the default Azerbaijani (`AZ`) control-room interface and language switcher (`AZ` / `EN` / `RU`).
   - Sign in as `dispatcher` (or click the demo account chip).
   - Observe the single-screen layout (`100vh`, zero main-page scroll): Header health badges (`Live`, `Routing: UP` + `breaker: closed`), 4 Top KPI cards (including `Priority SOS`), active **RED ALERT** banner, Live SOS Feed (left), Baku Leaflet Map (center), and Zones/Shelters/Crews panel (right).

2. **Live SOS Stream, Drop 1 Priority & Map Interaction:**
   - New `sos.created` events appear in the Live SOS Feed; `special_needs` requests (`Priority #1`) are pinned to the top with a red border and `♿ PRİORİTET #1` badge.
   - Filter by hazard type (`Yanğın`, `Uçqun`, `Daşqın`, `Tibbi`) or toggle `Yalnız prioritet`, and click any SOS card to fly the map directly to its coordinates and open its popup.

3. **Approve a Red Alert (`Təsdiq et`):**
   - Inspect the pulsing **RED ALERT** banner showing the cluster trigger or `PRIORITY_SOS` accessible-transport recommendation (`♿ əlçatan nəqliyyat`).
   - Click **"Təsdiq et"**. The map flies to the alert zone, the proposed crew changes from `available` to `dispatched`, any backup shelter opens (`newShelter` may be `null` for `PRIORITY_SOS`), the alert clears, and a confirmation toast appears.

4. **Simulation Control Panel & Routing Outage Test (Section J):**
   - Click **"Simulyasiya"** in the header to open the collapsible Simulation Drawer (available to both `dispatcher` and `admin`).
   - **Road Closure:** Select a road (e.g., `28 May küç.`) and click **Close Road** — a red dashed polyline immediately appears on the map.
   - **Shelter Overload:** Select a shelter, drag the slider to `96%`, and click **Set Occupancy** — watch the progress bar turn orange/red and generate a Red Alert.
   - **4 SOS Cluster Burst:** Click anywhere on the Baku map to set target coordinates, select a hazard type, and click **Send 4 SOS Burst** — 4 clustered SOS signals and a new Red Alert appear instantly.
   - **Routing Provider Outage (`Up` / `Slow` / `Down`):** Toggle **Slow** (amber `SLOW` pill) or **Down** (red `DOWN` pill). In live backend mode (`provider.updated` WS event), 3 upstream failures trip the circuit breaker (`breaker: open` badge in red) for a 30s cooldown while the backend automatically serves Haversine `"fallback"` routes.
   - **Reset:** Click **Reset Simulation** to restore baseline state (including setting the routing provider back to `UP` / `closed`).
