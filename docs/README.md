# Urban Crisis & Crowd Evacuation Engine

Digital Challenge 2026 Azərbaycan, final. Şəhər böhranı və kütləvi təxliyə mühərriki: vətəndaş üçün ən yaxın təhlükəsiz toplanma məntəqəsi, canlı doluluq və təxliyə marşrutu; dispetçer üçün SOS, sığınacaq və briqadaların canlı paneli.

Repo: https://github.com/niknok29/Final-.git (əsas branch: `main`, inteqrasiya: `develop`)

## 1. Hissələr

| Qovluq | Nə edir | Texnologiya |
|---|---|---|
| `backend/` | REST + WebSocket API, Kritik Böhran Alqoritmi, marşrutlaşdırma, təhlükəsizlik | Python 3.12, FastAPI, SQLModel, SQLite |
| `citizen-web/` | Vətəndaş tətbiqi (Modul 1) | React, Vite, Leaflet / OpenStreetMap, i18next |
| `dispatcher-web/` | Dispetçer paneli (Modul 2) | React, Vite, Leaflet / OpenStreetMap, i18next |
| `docs/` | API kontraktı, texniki sənədlər, AI istifadəsi | Markdown |

## 2. Arxitektura

```
 Vətəndaş brauzeri (5173)                    Dispetçer brauzeri (5174)
 React + Leaflet                             React + Leaflet
   |  REST: /api/shelters, /api/route,         |  REST: /api/dashboard, /api/alerts,
   |        /api/sos, /api/safe                |        /api/sim/*, /api/auth/login
   |  WS:   /ws/citizen                        |  WS:   /ws/dispatcher?token=JWT
   +------------------------+------------------+
                            v
        +-------------------------------------------+
        |  FastAPI backend (port 8000, tək proses)  |
        |  1. SecurityMiddleware (DB-dən əvvəl):    |
        |     IP limit, ölçü limiti, SOS qəbul      |
        |     nəzarəti, təhlükəsizlik başlıqları    |
        |  2. flood.py: dublikat süzgəci, vətəndaş  |
        |     limiti, qlobal büdcə, karantin        |
        |  3. api.py / dispatch.py / sim.py         |
        |  4. alerts.py: Kritik Böhran Alqoritmi    |
        |  5. routing.py: provayder + circuit       |
        |     breaker + ehtiyat zənciri             |
        |  6. realtime.py: WebSocket hub            |
        +----------+------------------+-------------+
                   v                  v
          SQLite (SQLModel)    Marşrut provayderi (mock / OSRM)
          sos, shelters,       xəta olarsa: keş -> statik matris
          crews, roads,        -> düz xətt (Oflayn / Ehtiyat
          alerts, users        marşrut rejimi)
```

Məlumat axını: vətəndaş SOS göndərir, backend yoxlayır (limit, dublikat), yazır və dispetçerə `sos.created` WebSocket hadisəsi göndərir. Alqoritm şərti ödəyirsə `alert.created` yaranır, dispetçer bir kliklə təsdiq edir, briqada və yeni toplanma məntəqəsi aktivləşir, vətəndaşlar `reroute` və `shelter.updated` hadisələrini alır.

Tam API: `docs/API_CONTRACT.md` (bölmələr A-M). Daha ətraflı: `docs/TECHNICAL.md`.

## 3. İşə salma (lokal, Docker tələb olunmur)

Tələblər: Python 3.12, Node.js 18+, Git.

### 3.1 Backend

Windows (PowerShell):
```
cd backend
py -3.12 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000 --no-access-log --log-level warning
```
Linux / macOS:
```
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000 --no-access-log --log-level warning
```
Yoxlama: `http://127.0.0.1:8000/api/health` və Swagger: `http://127.0.0.1:8000/docs`.

Vacib: `--reload` və `--workers N` işlətməyin. WebSocket hub, keş və limitlər proses daxilindədir, ona görə **bir proses** işləməlidir. İlk açılışda baza avtomatik yaranır və seed məlumatı (12 rayon, 12 sığınacaq, 8 briqada, 10 yol) yüklənir.

### 3.2 Vətəndaş tətbiqi
```
cd citizen-web
npm install
copy .env.example .env      (Linux: cp .env.example .env)
npm run dev -- --port 5173
```

### 3.3 Dispetçer paneli
```
cd dispatcher-web
npm install
copy .env.example .env
npm run dev -- --port 5174
```
`.env` dəyərləri: `VITE_API_URL=http://127.0.0.1:8000` və `VITE_USE_MOCK=false` (real backend). `VITE_USE_MOCK=true` backend olmadan demo rejimidir. Backend CORS yalnız 5173 və 5174 portlarına icazə verir.

### 3.4 Demo hesablar
| İstifadəçi | Parol | Rol |
|---|---|---|
| `dispatcher` | `dispatcher123` | dispetçer |
| `admin` | `admin123` | admin (simulyasiya daxil) |

Bunlar yalnız test hesablarıdır. Real mühitdə dəyişdirilməlidir.

### 3.5 Testlər
```
cd backend
pytest -q
```
Yük testi (SOS flood ssenarisi): `python tools/loadtest.py --scenario flood --base-url http://127.0.0.1:8000`

## 4. Mühit dəyişənləri (backend, hamısı könüllü)

| Dəyişən | Default | Mənası |
|---|---|---|
| `DATABASE_URL` | lokal SQLite | baza ünvanı |
| `ROUTING_PROVIDER` | `mock` | `mock` və ya `osrm` |
| `OSRM_URL` | ictimai OSRM | OSRM serveri |
| `RATE_LIMIT_GLOBAL` | 300/dəq | IP başına ümumi limit |
| `RATE_LIMIT_SOS` | 10/dəq | IP başına SOS limiti |
| `SOS_GLOBAL_PER_MIN` | 300 | qlobal SOS qəbul büdcəsi |
| `SOS_FLOOD_THRESHOLD` | 60/dəq | flood rejiminə keçid həddi |
| `SIM_ROLES` | `dispatcher,admin` | simulyasiya icazəsi olan rollar |
| `MAX_BODY_BYTES` | 32768 | sorğu ölçü limiti |
| `AUDIT_LOG` | `backend/audit.log` | audit faylı |

JWT gizli açarı da mühit dəyişəni ilə verilir (`backend/app/auth.py`). Default dəyərlə başlayanda xəbərdarlıq yazılır.

## 5. Challenge Drop-lara uyğunlaşma

| Drop | Tələb | Həll |
|---|---|---|
| 1 (12:00) | Prioritet SOS, əlçatan marşrut, AZ/EN | Profil `standard`/`special_needs`; əlçatan sığınacaq/yol/briqada bayraqları; `priority`/`priorityRank`; `409 NO_ACCESSIBLE_ROUTE`; AZ/EN i18n |
| 2 (13:00) | Xəritə/marşrut API-si çökəndə oflayn rejim | 2 san timeout, circuit breaker (3 xəta -> 30 san açıq); keş -> statik rayon-sığınacaq matrisi -> düz xətt; "Oflayn / Ehtiyat marşrut rejimində işləyir" bildirişi; `/api/health` vəziyyəti |
| 3 (14:00) | SOS flood, RBAC/JWT, <300 ms | Vətəndaş/IP/qlobal limit, dublikat süzgəci, şübhəli SOS karantini, JWT+RBAC sərtləşdirilməsi, async audit; bax `docs/API_CONTRACT.md` bölmə M |

## 6. Məlum məhdudiyyətlər
- SQLite və prosesdaxili hub bir serverlik demo üçündür. Çox serverli işləmə üçün PostgreSQL və Redis lazımdır.
- İctimai OSRM serveri SLA vermir və avtomobil profili ilə işləyir. Problem olarsa ehtiyat zənciri işə düşür.
- Test hesabları və JWT açarı yalnız demo üçündür.
