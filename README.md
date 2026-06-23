<h1><img src="website/imgs/lmu-telemetry-icon.png" alt="LMU Telemetry icon" width="32" height="32" align="center"> LMU Telemetry</h1>

LMU Telemetry is a local-first telemetry and race-engineering application for Le Mans Ultimate. It turns live shared-memory data, native LMU telemetry databases, and MoTeC-style CSV exports into race control, strategy planning, lap analysis, and post-session review tools.

The application combines a FastAPI backend with a React/Vite interface. The backend collects and records telemetry even when the frontend is closed; the frontend provides live dashboards and offline analysis workspaces.

## Contents

- [Features](#features)
  - [Live Telemetry And Race Control](#live-telemetry-and-race-control)
  - [Fuel, Tyre, Stint, And Pit Strategy](#fuel-tyre-stint-and-pit-strategy)
  - [Lap Analysis And Driver Feedback](#lap-analysis-and-driver-feedback)
  - [Competitor Timing And Traffic Awareness](#competitor-timing-and-traffic-awareness)
  - [LMU Session Review And Career Profile](#lmu-session-review-and-career-profile)
  - [MoTeC-Style CSV Analysis](#motec-style-csv-analysis)
  - [Local-First Storage And Background Recording](#local-first-storage-and-background-recording)
- [Runtime Model](#runtime-model)
- [Development Setup](#development-setup)
- [Windows Release Builds](#windows-release-builds)
- [Data Storage](#data-storage)
- [API Highlights](#api-highlights)
- [Documentation](#documentation)
- [Development Checks](#development-checks)
- [Troubleshooting](#troubleshooting)

## Features

LMU Telemetry is organized into four working modes:

- **Live Mode** for real-time telemetry, timing, competitors, lap analysis, and strategy signals.
- **Plan Mode** for strategy assumptions, pit plans, and session reports using live or cached data.
- **User Profile** for career summaries and read-only review of native LMU DuckDB sessions.
- **CSV Analysis** for offline engineering analysis of MoTeC-style exports.

### Live Telemetry And Race Control

Live Mode reads LMU shared memory and presents the current session as a race-engineering dashboard. It includes:

- Current position, lap count, lap times, race state, speed, gear, and engine speed.
- Throttle, brake, and steering inputs.
- Per-wheel tyre temperatures, wear estimates, brake data, and ride-height channels when supplied by LMU.
- Fuel state, measured consumption, estimated laps remaining, and the projected fuel requirement at the next stop.
- Current-session standings, race history, track-position views, lap comparison, and configurable X-Y telemetry plots.
- Live warnings and strategy recommendations derived from the current telemetry stream.

![Live LMU race-control dashboard showing position, nearby drivers, driver inputs, tyre condition, and fuel strategy](website/imgs/Screenshot%202026-06-22%20162630.png)

*Live race control combines timing, nearby competitors, inputs, tyre state, and fuel projections in one view.*

### Fuel, Tyre, Stint, And Pit Strategy

The strategy tools combine configurable race assumptions with current or recorded session data:

- Fuel modeling uses measured consumption to estimate remaining range and fuel required at a stop.
- Tyre modeling tracks available wear and temperature channels per wheel.
- Stint planning divides the remaining race into stops and projects fuel service and tyre life at pit entry and finish.
- Pit-window guidance compares alternative stop laps and updates against live session state.
- The Strategy Planner can use the current session or a cached LMU DuckDB session.
- Session reports summarize pace, fuel, tyres, environment, and preparation notes for a selected session.

![Pit-strategy visualization showing three stints, planned stop laps, fuel service, projected tyre life, and alternative live options](website/imgs/Screenshot%202026-06-22%20164509.png)

*The pit-strategy view lays out the selected plan by stint and keeps alternative stop options visible.*

### Lap Analysis And Driver Feedback

Lap Analysis evaluates high-frequency telemetry from valid laps and keeps the underlying traces synchronized with its findings. It provides:

- Best-valid and typical pace, consistency, and theoretical improvement summaries.
- Corner-by-corner time-loss analysis across entry, rotation, apex, and exit phases.
- Driver feedback tied to braking, steering, throttle, and minimum-speed behavior.
- Setup-oriented diagnostics based on the telemetry channels available in the recording.
- Validity and confidence indicators so incomplete or noisy samples remain visible rather than being silently treated as clean data.

![Lap-analysis report showing a session verdict, pace summary, consistency, available improvement, and corner-level time loss](website/imgs/Screenshot%202026-06-22%20164817.png)

*The session verdict highlights repeatable losses and points to the corner phase where time is being left behind.*

### Competitor Timing And Traffic Awareness

Live competitor telemetry is used to provide:

- Current-session standings and nearby-driver views.
- Driver, car, class, position, lap count, and pit-state context when available.
- Short- and medium-window pace comparisons.
- Relative deltas to nearby cars for traffic and race-context awareness.
- A circle-map view of competitor placement around the circuit.

These views depend on the competitor fields exposed by the active LMU shared-memory session.

### LMU Session Review And Career Profile

The User Profile and Session Review tools read native LMU DuckDB telemetry without modifying the source files:

- Career overview, total distance, distance by class, most-used cars, most-driven tracks, and personal best laps.
- Session discovery and metadata caching from a user-selected LMU telemetry folder.
- Lap summaries, pace, fuel use, tyres, brakes, ride heights, driver inputs, and recorded events.
- Available-channel inspection so each review reflects what the source database actually contains.
- Detailed telemetry charts loaded from raw DuckDB samples on demand and downsampled for display.

![Read-only LMU DuckDB session review showing metadata, available channels, lap times, fuel use, speed, RPM, and driver inputs](website/imgs/Screenshot%202026-06-22%20160910.png)

*Session Review keeps source metadata and channel availability alongside the engineering plots.*

### MoTeC-Style CSV Analysis

The MoTeC Workspace imports large CSV telemetry exports for offline analysis. It supports:

- Persisted session summaries and channel discovery.
- Derived channels and lap accumulation.
- Lap comparison and engineering plots.
- Fuel worksheets and strategy calculations.
- Rule-based Race Engineer findings covering driving, setup, strategy, and stint behavior.

### Local-First Storage And Background Recording

- Live telemetry is normalized, streamed to the UI, and recorded by the backend.
- Session logging continues while the frontend is closed.
- Live sessions and imported CSV summaries are stored locally.
- Native LMU DuckDB files remain in the selected telemetry folder and are opened read-only.
- Raw DuckDB telemetry is loaded only when needed for review charts.
- The local data directory can be moved with `LMU_TELEMETRY_DATA_DIR`.

## Runtime Model

Development runtime:

- Backend: `http://127.0.0.1:8000`
- Frontend dev server: `http://127.0.0.1:5173`
- Vite proxies `/api` and `/ws` to the backend

The frontend does not need to be open for live logging. Logging happens in the backend telemetry loop.

## Development Setup

### Requirements

- Python 3.11+
- Node.js 18+
- Le Mans Ultimate for live shared-memory mode
- `pyLMUSharedMemory` for real LMU telemetry

### Backend

From the project root:

```cmd
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python run_backend.py
```

The backend runs on `http://127.0.0.1:8000`.

### Frontend

```cmd
cd frontend
npm install
npm run dev
```

The frontend dev server runs on `http://127.0.0.1:5173`. If Vite chooses another port, use the URL shown in the terminal.

### Live LMU Shared Memory

For development, install or keep `pyLMUSharedMemory` inside the backend folder:

```cmd
cd backend
git clone https://github.com/TinyPedal/pyLMUSharedMemory.git pyLMUSharedMemory
```

Run the backend with real LMU telemetry instead of mock data.

CMD:

```cmd
cd backend
.venv\Scripts\activate
set USE_MOCK_TELEMETRY=false
python run_backend.py
```

PowerShell:

```powershell
cd backend
.venv\Scripts\activate
$env:USE_MOCK_TELEMETRY="false"
python run_backend.py
```

If LMU shared memory is unavailable, the backend stays running and reports that live telemetry is disconnected.

## Windows Release Builds

The Windows packaging script builds both distributable formats:

- Installer: `dist\LMUTelemetry-Setup-<version>.exe`
- Portable archive: `dist\LMUTelemetry-Windows-Portable-<version>.zip`
- Checksums: `dist\SHA256SUMS-<version>.txt`

Requirements:

- Python 3.11+ with backend dependencies installable from `backend\requirements.txt`
- Node.js 18+
- Inno Setup 6 available as `ISCC.exe` or installed in the default Program Files location

From the project root, run:

```cmd
packaging\build_windows_installer.cmd
```

PowerShell can call the script directly:

```powershell
.\packaging\build_windows_installer.ps1
```

To set the release version used in artifact names:

```powershell
.\packaging\build_windows_installer.ps1 -AppVersion 0.1.0
```

For a faster rebuild when dependencies are already installed:

```powershell
.\packaging\build_windows_installer.ps1 -SkipDependencyInstall
```

The script runs the frontend tests and build by default, packages `LMUTelemetry.exe` with PyInstaller, smoke-tests the packaged app, builds the Inno Setup installer, creates the portable zip, and writes SHA-256 checksums.

## Data Storage

Development currently stores local data under the repository:

```text
data/sessions/lmu_strategy.sqlite3
data/motec/
```

Native LMU DuckDB files stay in the user-selected LMU telemetry folder. The app stores only the configured folder path, session metadata, and lap/profile cache rows in its local SQLite database; raw DuckDB telemetry is read on demand and downsampled for review charts.

The data root can be overridden for development and diagnostics:

```text
LMU_TELEMETRY_DATA_DIR=C:\path\to\data
```

## API Highlights

- `GET /api/health`
- `GET /api/session/current`
- `GET /api/sessions`
- `GET /api/session/review`
- `GET /api/session/review/{session_id}`
- `GET /api/session/review/{session_id}/dashboard`
- `POST /api/session/current/finalize`
- `GET /api/profile/overview`
- `GET /api/profile/summary`
- `GET /api/profile/best-laps`
- `GET /api/profile/laps`
- `GET /api/lmu-duckdb/settings`
- `POST /api/lmu-duckdb/settings`
- `POST /api/lmu-duckdb/sync`
- `GET /api/lmu-duckdb/sessions`
- `GET /api/lmu-duckdb/sessions/{session_id}/review`
- `GET /api/telemetry/latest`
- `GET /api/strategy/current`
- `GET /api/competitors`
- `GET /api/recommendations/current`
- `POST /api/strategy/assumptions`
- `GET /api/motec/sessions`
- `POST /api/motec/sessions/import`
- `GET /api/motec/sessions/{session_id}`
- `GET /api/motec/sessions/{session_id}/samples`
- `WS /ws/telemetry`
- `WS /ws/strategy`
- `WS /ws/recommendations`

## Documentation

- [Architecture](docs/architecture.md): runtime components, data flow, session rotation, API surface, and frontend routing.
- [Data Handling](docs/data-handling.md): normalization, storage, caching, pause rules, saved reviews, CSV import, and sample decimation.
- [Internationalization](docs/i18n.md): translation resources, language persistence, interpolation/plurals, and validation workflow.
- [Live Strategy Calculations](docs/live-strategy-calculations.md): fuel, tyre, pace, stint, pit-window, competitor, and recommendation models.
- [MoTeC / CSV Calculations](docs/motec-csv-calculations.md): channels, derived values, lap accumulation, fuel worksheets, and Race Engineer rules.
- [Page And Graph Calculations](docs/page-and-graph-calculations.md): page-by-page formulas for live, review, race-prep, engineering, and MoTeC views.

## Development Checks

Backend syntax check:

```cmd
python -m compileall backend\app
```

Backend tests:

```cmd
cd backend
pytest
```

Frontend build:

```cmd
cd frontend
npm run build
```

Frontend tests:

```cmd
cd frontend
npm run test:run
```

## Troubleshooting

### No Live Telemetry Is Detected

Make sure LMU is running and shared memory is available. In development, make sure `USE_MOCK_TELEMETRY=false` and `pyLMUSharedMemory` is available under `backend/pyLMUSharedMemory` or on `PYTHONPATH`.

### The Frontend Loads But Data Is Stale

Restart the backend after backend code changes. The frontend may call API routes that only exist after the backend has restarted.

### Tyres, Brakes, Or Ride Height Show `--`

Those fields depend on LMU shared-memory wheel channels. New recordings store available wheel channels, but older sessions only contain the fields recorded at the time.

### SQLite Cannot Open The Database File

Make sure the app can create and write to `data/sessions/` and `data/motec/`, or set `LMU_TELEMETRY_DATA_DIR` to a writable folder.
