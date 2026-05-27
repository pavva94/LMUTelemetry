# LMU Telemetry

Local-first telemetry and race-engineering tool for Le Mans Ultimate.

The app has two main modes:

- **Live Mode**: reads LMU shared memory, streams live telemetry, records sessions to SQLite, and provides live race-engineering pages.
- **CSV Analysis**: imports large MoTeC-style CSV exports and opens an offline workbook for lap comparison, engineering plots, fuel strategy, and race-engineer hints.

Mock telemetry is enabled by default, so the app can run without LMU.

## Requirements

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

Backend runs on:

```text
http://127.0.0.1:8000
```

## Live LMU Shared Memory

Install `pyLMUSharedMemory` inside the backend folder:

```cmd
cd backend
git clone https://github.com/TinyPedal/pyLMUSharedMemory.git pyLMUSharedMemory
```

Then run the backend with real LMU telemetry instead of mock data.

In **CMD**:

```cmd
cd backend
.venv\Scripts\activate
set USE_MOCK_TELEMETRY=false
python run_backend.py
```

If you cloned `pyLMUSharedMemory` somewhere else, add its parent folder to `PYTHONPATH`.

Example if it is cloned next to `backend`:

```cmd
cd backend
set PYTHONPATH=%CD%\..\pyLMUSharedMemory;%PYTHONPATH%
set USE_MOCK_TELEMETRY=false
python run_backend.py
```

PowerShell equivalent:

```powershell
cd backend
$env:PYTHONPATH="$PWD\..\pyLMUSharedMemory;$env:PYTHONPATH"
$env:USE_MOCK_TELEMETRY="false"
python run_backend.py
```

If LMU shared memory is unavailable, the backend stays running and reports that live telemetry is disconnected.

## Frontend Setup

```cmd
cd frontend
npm install
npm run dev
```

Frontend runs on:

```text
http://127.0.0.1:5173
```

If Vite chooses another port, such as `5174`, use the URL shown in the terminal.

## Live Mode

Live Mode includes:

- Live Dashboard
- Race Info
- Driving
- Circle Map
- Lap Compare
- Standings
- Field Spread
- Race History
- X-Y Plotter
- Stint Data
- Opponent Stats
- Race Control
- Settings
- Strategy Planner
- Pit Window
- Competitors
- Session Review

The backend records live telemetry while it is running. Session Review can open stored sessions later and shows:

- detected LMU sessions
- lap summaries
- fuel usage
- tyre wear and tyre temperatures
- brake temperatures
- ride heights
- driver inputs
- events and recommendations

## Automatic Session Detection

One driving run can contain multiple LMU sessions, for example:

- Practice
- Qualifying
- Race
- another Race

The backend automatically starts a new stored session when it detects:

- LMU session type change
- track change
- car change
- session clock reset
- lap counter reset

This means Practice, Qualifying, and Race are reviewable separately in Session Review.

Existing old recordings cannot always be split perfectly if they were recorded before session segmentation existed.

## CSV / MoTeC Analysis

CSV Analysis imports telemetry CSV files with two header rows:

- Row 1: channel names
- Row 2: channel units
- Row 3 onward: telemetry samples

The importer stores the CSV as an offline analysis session, builds a channel registry, groups samples by lap, and creates derived channels where possible.

The MoTeC-style workspace includes:

- CSV Import
- Lap Browser
- Compare
- Driver
- Speed / Delta
- Inputs
- Powertrain
- Brakes
- Tyre Temperatures
- Tyre Pressure / Wear
- Tyre Load / Grip
- Ride Height / Platform
- Wheel Speeds
- G-Force
- Map / GPS
- Environment
- Histograms
- X-Y Plotter
- Fuel Strategy
- Race Engineer

Large CSV files are handled by the backend instead of browser-only parsing, so files over 200 MB are practical.

## Race Engineer Layer

The Race Engineer worksheet is deterministic and rule-based in the first version. It does not call an LLM.

It analyzes:

- lap time and driving
- braking and throttle behavior
- steering smoothness
- setup health
- tyre temperatures, pressures, and wear
- brake temperatures
- ride height and platform behavior
- fuel usage
- pit/refuel sequence
- full-stint behavior

Hints include severity, confidence, affected laps, evidence, and recommended action.

## API Highlights

- `GET /api/health`
- `GET /api/session/current`
- `GET /api/sessions`
- `GET /api/session/review`
- `GET /api/session/review/{session_id}`
- `POST /api/session/current/finalize`
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

## Data Storage

Live telemetry is stored in SQLite:

```text
data/sessions/lmu_strategy.sqlite3
```

CSV/MoTeC imports are stored under:

```text
data/motec/
```

## Troubleshooting

### `bunx` is not recognized

The frontend now uses Vite directly:

```cmd
cd frontend
npm run dev
```

If your terminal still shows `bunx`, pull the latest local changes or check `frontend/package.json`.

### Windows CMD does not support `export`

Use `set`:

```cmd
set USE_MOCK_TELEMETRY=false
set PYTHONPATH=%CD%\pyLMUSharedMemory;%PYTHONPATH%
```

PowerShell uses `$env:` instead:

```powershell
$env:USE_MOCK_TELEMETRY="false"
```

### Backend starts but frontend data disappears

Restart the backend after code changes. The frontend may call API routes that only exist after the backend has restarted.

### Tyres, brakes, or ride height show `--`

Those fields depend on LMU shared-memory wheel channels. New recordings store the available wheel channels, but older sessions only contain the fields that were recorded at the time.

### SQLite cannot open database file

Make sure the backend is run from the project/backend setup and that the app can create:

```text
data/sessions/
```

The backend now creates the SQLite folder automatically when it starts.

## Development Checks

Backend syntax check:

```cmd
python -m compileall backend\app
```

Frontend build:

```cmd
cd frontend
npm run build
```
