<h1><img src="website/imgs/lmu-telemetry-icon.png" alt="LMU Telemetry icon" width="32" height="32" align="center"> LMU Telemetry</h1>

[Official Website](https://www.pavesialessandro.com/LMUTelemetry/website/en/index.html) · [Download LMU Telemetry for Windows](https://github.com/pavva94/LMUTelemetry/releases) [![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/A3A423RK3Y)

LMU Telemetry is a local-first telemetry, race-engineering, and strategy application for Le Mans Ultimate. It combines live shared-memory data with read-only analysis of LMU's native DuckDB telemetry files, providing race control, driver coaching, strategy planning, career statistics, and professional session reports in one Windows application.

The main way to use LMU Telemetry is the ready-to-run **Windows executable**. Users do not need to install Python, Node.js, or developer tools.

## Download And Run On Windows

Download the latest version from the [LMU Telemetry download page](https://github.com/pavva94/LMUTelemetry/releases). Each release provides two ways to run the same desktop application:

- **Installer — `LMUTelemetry-Setup-<version>.exe`**: the recommended option for most users. Run the installer, then launch **LMU Telemetry** from the Start menu or optional desktop shortcut.
- **Portable — `LMUTelemetry-Windows-Portable-<version>.zip`**: extract the archive and run `LMUTelemetry.exe` directly. Nothing is installed.
- **Checksums — `SHA256SUMS-<version>.txt`**: SHA-256 hashes for verifying the installer and portable download.

### First Run

1. Download and run the installer, or extract the portable archive and open `LMUTelemetry.exe`.
2. Start Le Mans Ultimate and enter an active session.
3. LMU Telemetry connects to the game's shared memory and begins showing and recording live data.
4. To analyze existing LMU telemetry, open **User Profile**, select the folder containing the native LMU telemetry databases, and choose **Save and sync**.

The executable includes the backend, frontend, desktop window, and LMU shared-memory integration. It starts its own private local service automatically; there is no server or command line for the user to configure. Closing the desktop window stops that service cleanly and finalizes the active recording.

Visit the [official website](https://www.pavesialessandro.com/LMUTelemetry/website/en/index.html) for the product tour, feature overview, and screenshots.

LMU Telemetry stores telemetry, cached session metadata, generated reports, and settings on the local computer. It does not upload telemetry to an external service.

## Highlights

- Live race-control dashboard with timing, position, driver inputs, tyres, fuel, alerts, and nearby competitors.
- Automatic local recording and session rotation while live telemetry is active.
- Fuel-range, tyre-wear, stint, pit-window, pace, and recommendation models.
- Live lap coaching with lap-quality validation and corner-phase feedback.
- Strategy Planner using live data, recorded history, or a selected native LMU session.
- Seeded Monte Carlo strategy comparison with fuel, tyre, pit, traffic, and pace uncertainty.
- Read-only LMU DuckDB sync, career profile, personal-best validation, and detailed session review.
- GPS lap paths and aligned lap-delta comparison when the source session contains the required channels.
- Deterministic PDF performance reports in English or Italian, with configurable detail and charts.
- English and Italian interface languages.
- Local mock telemetry for development and demonstrations without a running LMU session.

![Live LMU race-control dashboard showing position, nearby drivers, driver inputs, tyre condition, and fuel strategy](website/imgs/Screenshot%202026-06-22%20162630.png)

## Application Modes

The interface is organized into three main modes.

### Live Mode

Live Mode reads LMU shared memory and updates the application through WebSockets. Its pages include:

- **Live Dashboard**: session state, position, lap timing, speed, gear, RPM, throttle, brake, steering, tyre state, fuel projections, alerts, and either nearby cars or the full grid.
- **Circle Map**: a simplified lap-progress map for traffic awareness when real circuit geometry is unavailable.
- **Lap Stats**: valid-lap comparison, pace trends, fuel use, tyre degradation, top speed, and session-wide insights.
- **Standings**: race and class order, leader gaps, relative gaps, pit state, and field spread.
- **Session History**: stint detection and comparisons of pace, fuel, tyre wear, and top speed.
- **X-Y Plotter**: configurable scatter plots for numeric live channels, including common engineering presets and summary statistics.
- **Driver Coach**: live lap validation, reference-lap comparison, corner segmentation, braking/rotation/apex/exit findings, synchronized traces, and confidence information.
- **Pit Window**: selected strategy timeline, alternative stop options, live pit-window guidance, pace evidence, model inputs, and calculation breakdowns.
- **Settings**: interface language and locally stored display preferences, plus connection, recording, strategy, and map status panels.

Live calculations update fuel consumption and range, tyre wear, stint state, competitor context, pit windows, pace evidence, and rule-based recommendations. A field remains unavailable when LMU or the shared-memory integration does not provide the required channel; the UI does not invent missing values.

### Plan Mode

Plan Mode supports both live and historical planning.

#### Strategy Planner

The planner can derive its inputs from the current live session, recorded local history, or a selected LMU DuckDB session. It supports:

- Timed-race planning with estimated race laps derived from the selected pace and service assumptions.
- Configurable tank capacity, starting fuel, finish reserve, pit loss, refuelling rate, tyre service time, tyre-wear limit, and new/used starting tyres.
- Robust pace selection and visible evidence for lap, fuel, and tyre assumptions.
- Candidate stint layouts with pit laps, fuel targets, tyre service, race-time breakdowns, and risk warnings.
- Heuristic comparison for quick planning.
- Monte Carlo comparison using 1,000, 5,000, or 10,000 seeded simulations.
- Synthetic traffic and multi-class field assumptions with configurable traffic intensity, overtaking approach, pace spread, tyre impact, fuel impact, and pit variability.
- Distribution outputs including mean, median, P5/P90, fastest probability, finish fuel, maximum tyre wear, traffic loss, and fuel/tyre risk.
- Nominal pit instructions and a representative lap-by-lap fuel, tyre, and stint trace.

The Monte Carlo model is a transparent planning tool, not a vehicle-dynamics or race-control simulator. Its probabilities are conditional on the selected session and user assumptions. See [Monte Carlo Race Simulation](docs/monte-carlo-simulation.md) for the model, equations, exclusions, and interpretation guidance.

![Pit-strategy visualization showing three stints, planned stop laps, fuel service, projected tyre life, and alternative live options](website/imgs/Screenshot%202026-06-22%20164509.png)

#### Session Report

The in-app report workspace can analyze the current recorded session or a selected native LMU session. Depending on available channels, it covers:

- Session context, data coverage, lap pace, consistency, and sector performance.
- Fuel consumption, range, stint length, and fuel-saving requirements.
- Driver inputs, speed, RPM, gear use, and track-surface indicators.
- Tyre wear, temperature, pressure, balance, and projected service needs.
- Brake temperatures, ride-height/platform behavior, and environmental trends.
- Detected events, pit-stop fuel and tyre changes, and engineering recommendations.

For imported historical sessions, the app can generate a downloadable deterministic PDF performance report. Reports support English or Italian, concise or detailed output, optional charts, driver anonymization, custom driver/team details, and notes. Previously generated reports can be downloaded, regenerated, or deleted from the application.

### Profile Mode

Profile Mode works with the folder where LMU stores native telemetry databases.

#### User Profile

- Recursively discovers supported LMU database files in the selected folder.
- Caches session metadata and lap summaries for fast repeated access.
- Shows total sessions, laps, distance, driving time, class distribution, most-used cars, and most-driven tracks.
- Tracks personal bests with validity and data-quality indicators.
- Supports history revalidation and inspection of excluded or suspicious best-lap candidates.

#### Session Review

- Opens native LMU databases read-only; source files are never modified.
- Filters sessions by track, car, class, session type, and other discovered metadata.
- Loads raw samples only when a session is selected and downsamples them for display.
- Displays available-channel coverage alongside every review.
- Reviews lap time, fuel, speed, RPM, inputs, tyres, brakes, ride height, sectors, flags, assists, GPS/G-force, and detailed tyre/brake channels when present.
- Compares selected laps using GPS paths and progress-aligned delta segments when suitable position data exists.

![Read-only LMU DuckDB session review showing metadata, available channels, lap times, fuel use, speed, RPM, and driver inputs](website/imgs/Screenshot%202026-06-22%20160910.png)

## Data Sources And Storage

### Live Shared Memory

With mock mode disabled, the backend reads LMU through `pyLMUSharedMemory`. It reconnects when shared memory is temporarily unavailable and reports a disconnected state instead of terminating.

The recorder pauses or finalizes a session when telemetry disconnects, the player is unavailable, the game enters a garage/menu/replay/paused state, or the car remains inactive outside the pits. It rotates sessions when the track, session type, or player vehicle changes, or when LMU resets its session clock or lap counter.

### Native LMU DuckDB Sessions

The app scans the configured folder recursively for supported database files. It uses file path, size, and modification time to avoid reopening unchanged files. Session metadata and lap summaries are cached locally, while raw LMU samples stay in their original databases and are queried read-only on demand.

### Local Application Data

Development data defaults to:

```text
data/sessions/lmu_strategy.sqlite3
data/performance-reports/
data/logs/
```

Packaged Windows data defaults to:

```text
%LOCALAPPDATA%\LMUTelemetry\
```

Override the data and log locations when needed:

```text
LMU_TELEMETRY_DATA_DIR=C:\path\to\data
LMU_TELEMETRY_LOG_DIR=C:\path\to\logs
```

Fresh deployments bootstrap `data/sessions/lmu_strategy.sqlite3` from the
committed compact cache at `data/seed/lmu_strategy.sqlite3`. The cached session
index and profile data are available immediately while the normal startup sync
runs in the background. Set `LMU_TELEMETRY_DUCKDB_FOLDER` to the server's
telemetry folder when it differs from the saved desktop setting.

Refresh the committed seed after syncing local telemetry:

```powershell
python backend/scripts/build_seed_cache.py
```

See [Data Handling](docs/data-handling.md) for recording frequency, session boundaries, cache behavior, and stored tables.

## Development From Source

This section is for contributors and developers. Regular users should install or run the prebuilt executable from the [download page](https://github.com/pavva94/LMUTelemetry/releases).

### Requirements

- Windows for real LMU shared-memory telemetry and packaged desktop builds.
- Python 3.11 or newer.
- Node.js 18 or newer.
- Le Mans Ultimate and `pyLMUSharedMemory` for live telemetry.
- Inno Setup 6 only when building the Windows installer.

### Backend

From the repository root:

```cmd
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python run_backend.py
```

The development backend listens on `http://127.0.0.1:8000`.

### Frontend

In another terminal:

```cmd
cd frontend
npm install
npm run dev
```

Vite normally listens on `http://127.0.0.1:5173` and proxies `/api` and `/ws` to the backend.

### Real And Mock Telemetry

Development defaults to mock telemetry through `config/default_strategy.yaml`. To use real telemetry, place `pyLMUSharedMemory` inside the backend folder:

```cmd
cd backend
git clone https://github.com/TinyPedal/pyLMUSharedMemory.git pyLMUSharedMemory
```

Then start the backend with mock mode disabled.

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

Closing only the Vite/browser frontend does not stop a separately running development backend, so collection continues until the backend process is stopped. This differs from the packaged desktop application, where the window owns the embedded backend lifecycle.

## Windows Release Builds

The release script builds and verifies three distributable artifacts:

```text
dist\LMUTelemetry-Setup-<version>.exe
dist\LMUTelemetry-Windows-Portable-<version>.zip
dist\SHA256SUMS-<version>.txt
```

From the project root:

```powershell
.\packaging\build_windows_installer.ps1 -AppVersion 0.1.0
```

Or use the command wrapper:

```cmd
packaging\build_windows_installer.cmd
```

Useful development switches include `-SkipDependencyInstall`, `-SkipFrontendTests`, `-SkipFrontendBuild`, and `-SkipSmokeTest`. A normal release build installs dependencies, runs frontend tests, compiles the frontend, bundles the Python application with PyInstaller, verifies required resources and shared-memory modules, smoke-tests the packaged app in an isolated data directory, builds the Inno Setup installer, creates the portable archive, and writes SHA-256 checksums.

The GitHub Actions release workflow performs the same Windows build for release branches, version tags, and manual runs, and can publish the artifacts to GitHub Releases.

## API Overview

The FastAPI backend exposes REST endpoints and three live WebSocket streams. Main endpoint groups are:

- `/api/telemetry`, `/api/strategy`, `/api/recommendations`, and `/api/competitors` for live state.
- `/api/session` and `/api/sessions` for locally recorded sessions and live lap analysis.
- `/api/lmu-duckdb` for settings, asynchronous sync/review jobs, session discovery, review data, and trajectories.
- `/api/profile` for career summaries, laps, personal bests, exclusions, and revalidation.
- `/api/race-simulation` for saved-session Monte Carlo jobs and the experimental full-field endurance API.
- `/api/performance-reports` for PDF generation, history, download, regeneration, and deletion.
- `/ws/telemetry`, `/ws/strategy`, and `/ws/recommendations` for live updates.

When the backend is running, its generated OpenAPI documentation is available at `/docs`.

## Documentation

- [Documentation Index](docs/README.md)
- [Architecture](docs/architecture.md): runtime components, data flow, session rotation, API surface, and frontend routing.
- [Data Handling](docs/data-handling.md): live normalization, storage, cache behavior, saved review data, and privacy.
- [Strategy Engine](docs/strategy-engine.md): live strategy model and recommendation behavior.
- [Live Strategy Calculations](docs/live-strategy-calculations.md): fuel, tyres, pace, stints, pit windows, competitors, and recommendations.
- [Strategy Time Calculation](docs/strategy-time-calculation.md): race-time and pit-service accounting.
- [Monte Carlo Race Simulation](docs/monte-carlo-simulation.md): stochastic model, parameters, risk definitions, outputs, and limitations.
- [Page And Graph Calculations](docs/page-and-graph-calculations.md): page-by-page formulas and chart derivations.
- [Internationalization](docs/i18n.md): translation resources, persistence, formatting, and validation.
- [Numerical Validation Report](docs/numerical-validation-report.md): numerical checks and model validation notes.

## Development Checks

Backend tests:

```cmd
cd backend
pytest
```

Backend syntax check:

```cmd
python -m compileall backend\app
```

Frontend tests and build:

```cmd
cd frontend
npm run test:run
npm run i18n:validate
npm run build
```

## Troubleshooting

### No Live Telemetry Is Detected

Confirm that LMU is running in an active session. For source development, verify that `USE_MOCK_TELEMETRY=false` and that `backend/pyLMUSharedMemory` exists or the module is otherwise on `PYTHONPATH`. A disconnected collector should leave the backend running and waiting to reconnect.

### Native LMU Sessions Do Not Appear

Open **User Profile**, select the folder containing LMU telemetry databases, and choose **Save and sync**. The scan is recursive. Check that the folder exists and that the current Windows user can read it.

### A Chart Or Metric Shows `--`

LMU sessions do not always contain every channel. The app exposes discovered-channel coverage and leaves unsupported values unavailable. Older recordings also contain only the fields captured by the application version that created them.

### The Packaged Application Does Not Open

The desktop shell requires the Microsoft Edge WebView2 runtime. Review `%LOCALAPPDATA%\LMUTelemetry\logs\launcher-error.log` and `backend.log` for startup details. Antivirus or Windows SmartScreen may also warn about unsigned early releases.

### SQLite Cannot Open The Database

Make sure the configured data directory is writable. Packaged builds normally use `%LOCALAPPDATA%\LMUTelemetry`; development uses the repository `data` folder unless `LMU_TELEMETRY_DATA_DIR` overrides it.

## Disclaimer

LMU Telemetry is an independent community project and is not affiliated with or endorsed by Studio 397 or Motorsport Games. Strategy outputs are estimates based on available telemetry and configured assumptions; validate them against event rules, current conditions, and in-game race control before use.
