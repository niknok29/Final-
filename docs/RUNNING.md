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

### A. Standalone Mock Mode (Default)

`dispatcher-web/.env` defaults to `VITE_USE_MOCK=true`, allowing full offline testing and judging without starting the backend:

```env
VITE_API_URL=http://localhost:8000
VITE_USE_MOCK=true
```

Install dependencies and launch on port **5174**:

```bash
cd dispatcher-web
npm install
npm run dev
```

Open `http://localhost:5174` in a desktop browser (`1920x1080` or `1366x768`).

### B. Live Backend Mode

1. Start the backend server in `backend/` on port `8000` (check `backend/` README/setup once populated).
2. Start the citizen web app in `citizen-web/` on port `5173`.
3. Update `dispatcher-web/.env`:
   ```env
   VITE_API_URL=http://localhost:8000
   VITE_USE_MOCK=false
   ```
4. Restart the `dispatcher-web` dev server (`npm run dev`).

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
| Dispatcher | `dispatcher` | `dispatcher123` | View live dashboard, filter SOS feed, approve/dismiss Red Alerts |
| Admin | `admin` | `admin123` | All Dispatcher permissions + access the **Simulation Control Panel** |

---

## 5. Step-by-Step Judge Demo Script

1. **Dispatcher Login (`dispatcher / dispatcher123`):**
   - Open `http://localhost:5174`. Note the default Azerbaijani (`AZ`) control-room interface and language switcher (`AZ` / `EN` / `RU`).
   - Sign in as `dispatcher` (or click the demo account chip).
   - Observe the single-screen layout (`100vh`, zero main-page scroll): Header health badges (`Live`, `Routing: UP`), 4 Top KPI cards, active **RED ALERT** banner, Live SOS Feed (left), Baku Leaflet Map (center), and Zones/Shelters/Crews panel (right).

2. **Live SOS Stream & Map Interaction:**
   - Every ~4 seconds a new `sos.created` event arrives in the Live SOS Feed with a flash animation.
   - Filter by hazard type (`Yanğın`, `Uçqun`, `Daşqın`, `Tibbi`) and click any SOS card to fly the map directly to its coordinates and open its popup.

3. **Approve a Red Alert (`Təsdiq et`):**
   - Inspect the pulsing **RED ALERT** banner showing the cluster trigger (`4 SOS / 5 dəq / 500 m`) and recommended proposal (assigned crew + reserve shelter to open).
   - Click **"Təsdiq et"**. The map flies to the alert zone, the proposed crew changes from `available` to `dispatched`, the backup shelter opens, the alert clears, and a confirmation toast appears.
   - Wait ~15 seconds (in mock mode) to observe a second automated shelter overload Red Alert (`Toplanış məntəqəsi 96%`) with an optional audio chime (toggleable via the header mute button).

4. **Admin Simulation & Crisis Stress Test (`admin / admin123`):**
   - Log out and sign back in as `admin / admin123`.
   - Click **"Simulyasiya"** in the header to open the collapsible Simulation Drawer.
   - **Road Closure:** Select a road (e.g., `28 May küç.`) and click **Close Road** — a red dashed polyline immediately appears on the map.
   - **Shelter Overload:** Select a shelter, drag the slider to `96%`, and click **Set Occupancy** — watch the progress bar turn orange/red and generate a Red Alert.
   - **4 SOS Cluster Burst:** Click anywhere on the Baku map to set target coordinates, select a hazard type, and click **Send 4 SOS Burst** — 4 clustered SOS signals and a new Red Alert appear instantly.
   - **Reset:** Click **Reset Simulation** to return the control room to baseline.
