# LMU Telemetry

Local-first telemetry and race-engineering app for Le Mans Ultimate.

LMU Telemetry currently runs as a FastAPI backend plus a React/Vite frontend. The backend owns live telemetry collection, session logging, native LMU DuckDB scanning, and API/WebSocket state. The frontend is the local UI for live dashboards, DuckDB-backed profile/review pages, strategy tools, and CSV/MoTeC analysis.

## Product Modes

- **Live Mode**: reads LMU shared memory, streams live telemetry, records sessions to SQLite, and provides race-engineering pages.
- **User Profile**: summarizes the configured LMU DuckDB telemetry folder into career overview, distance by class, most used cars, most driven tracks, and best laps.
- **Session Review**: opens native LMU DuckDB sessions read-only, including lap summaries, fuel usage, tyres, brakes, ride heights, inputs, events, channel availability, and detailed telemetry charts.
- **Strategy Planner / Session Report**: can work from live data or load cached DuckDB sessions from the configured telemetry folder.
- **CSV / MoTeC Analysis**: imports large MoTeC-style CSV exports for offline lap comparison, engineering plots, fuel strategy, and rule-based Race Engineer hints.

## Runtime Model

Development runtime:

- Backend: `http://127.0.0.1:8000`
- Frontend dev server: `http://127.0.0.1:5173`
- Vite proxies `/api` and `/ws` to the backend

The frontend does not need to be open for live logging. Logging happens in the backend telemetry loop.

Packaged Windows runtime:

- Installed app: `LMU Telemetry` from the Start Menu
- Local backend/UI origin: dynamic `http://127.0.0.1:<port>`
- App-owned data: `%LOCALAPPDATA%\LMUTelemetry`
- Logs: `%LOCALAPPDATA%\LMUTelemetry\logs`
- Real LMU shared-memory mode is the packaged default. Mock telemetry is available only when the launcher is started with `--mock`.

## Requirements For Development

- Python 3.11+
- Node.js 18+
- Le Mans Ultimate for live shared-memory mode
- `pyLMUSharedMemory` for real LMU telemetry

## Backend Setup

From the project root:

```cmd
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python run_backend.py
```

The backend runs on:

```text
http://127.0.0.1:8000
```

## Frontend Setup

```cmd
cd frontend
npm install
npm run dev
```

The frontend dev server runs on:

```text
http://127.0.0.1:5173
```

If Vite chooses another port, use the URL shown in the terminal.

## Live LMU Shared Memory

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

## Windows Installer Build

The non-coder Windows release is built with PyInstaller and Inno Setup. It bundles the Python backend, `pyLMUSharedMemory`, the compiled React frontend, and the default config.

Prerequisites on the build machine:

- Python 3.11+
- Node.js 18+
- Inno Setup 6

From the project root:

```powershell
.\packaging\build_windows_installer.ps1
```

Outputs:

```text
dist\LMUTelemetry\LMUTelemetry.exe
release\LMUTelemetry-Setup-0.1.0.exe
```

For a quick PyInstaller-only build without the installer:

```powershell
.\packaging\build_windows_installer.ps1 -SkipInstaller
```

The installed app writes user data under `%LOCALAPPDATA%\LMUTelemetry`, not the install folder. Override this for diagnostics with:

```text
LMU_TELEMETRY_DATA_DIR=C:\path\to\data
LMU_TELEMETRY_LOG_DIR=C:\path\to\logs
```

## Troubleshooting

### No live telemetry is detected

Make sure LMU is running and shared memory is available. In development, make sure `USE_MOCK_TELEMETRY=false` and `pyLMUSharedMemory` is available under `backend/pyLMUSharedMemory` or on `PYTHONPATH`.

### The frontend loads but data is stale

Restart the backend after backend code changes. The frontend may call API routes that only exist after the backend has restarted.

### Tyres, brakes, or ride height show `--`

Those fields depend on LMU shared-memory wheel channels. New recordings store available wheel channels, but older sessions only contain the fields recorded at the time.

### SQLite cannot open database file

Make sure the app can create and write to `data/sessions/` and `data/motec/`, or set `LMU_TELEMETRY_DATA_DIR` to a writable folder.
