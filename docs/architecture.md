# Architecture

LMU Telemetry is a local-first FastAPI + React application for Le Mans Ultimate live telemetry, strategy modelling, native DuckDB session review, DuckDB-backed user profile summaries, and offline MoTeC-style CSV analysis.

The current runtime is a separate backend and Vite frontend for development. Telemetry collection belongs to the backend service, so live logging continues as long as the backend process remains alive.

## Runtime Components

- **Backend**: `backend/app/main.py` starts FastAPI, initializes the live SQLite database, creates one `TelemetryService`, and mounts API and WebSocket routers.
- **Telemetry service**: `backend/app/services/telemetry_service.py` owns the live loop. It polls telemetry, normalizes it, updates strategy models, logs samples, and broadcasts telemetry, strategy, and recommendation payloads.
- **Collectors**:
  - `MockTelemetryCollector` produces deterministic-ish race data for development.
  - `LMUTelemetryCollector` reads LMU shared memory through `pyLMUSharedMemory`.
- **Live storage**: SQLAlchemy models in `backend/app/db/models.py` persist sessions, telemetry samples, lap summaries, pit events, recommendations, and assumptions. Development uses `data/sessions/lmu_strategy.sqlite3`.
- **LMU DuckDB storage**: `backend/app/services/lmu_duckdb_repository.py` scans the configured LMU telemetry folder, caches session metadata/lap summaries in SQLite, and reads selected DuckDB files read-only on demand for review charts.
- **CSV/MoTeC storage**: `backend/app/services/motec_repository.py` streams CSV imports into SQLite. Development uses `data/motec/motec.sqlite3`.
- **Frontend**: `frontend/src/App.tsx` chooses pages, subscribes to WebSocket telemetry and strategy, periodically fetches live state, and loads DuckDB profile/review data through the backend API. In development it is served by Vite.

## Runtime Modes

### Development

- Backend runs on `http://127.0.0.1:8000`.
- Vite runs on `http://127.0.0.1:5173`.
- Vite proxies `/api` and `/ws` to the backend.
- Mock telemetry is allowed by default so the app can run without LMU.

### Packaged Windows App

- `backend/desktop_launcher.py` starts FastAPI on `127.0.0.1` using an available local port.
- FastAPI serves the compiled React app from `frontend/dist`, so `/api`, `/ws`, and the UI share one origin.
- The launcher opens the local app in a native WebView window and stops the backend when the window closes.
- Packaged app data is stored under `%LOCALAPPDATA%\LMUTelemetry`; the install directory is treated as read-only.
- PyInstaller bundles the launcher, backend, built frontend, config, and `pyLMUSharedMemory`; Inno Setup wraps the bundle as a normal installer.

## Main Data Flow

1. Backend startup initializes the live database.
2. `TelemetryService.start()` starts either mock or LMU shared-memory collection.
3. The service loop polls at `poll_hz`.
4. Raw shared-memory data is converted to `TelemetrySnapshot` by `normalize_lmu_snapshot`.
5. The service discards unavailable or idle/menu data by pausing and finalizing the current session.
6. Active snapshots update fuel, tyre, stint, pit-window, competitor, and recommendation models.
7. Results are attached to the snapshot and broadcast over:
   - `WS /ws/telemetry`
   - `WS /ws/strategy`
   - `WS /ws/recommendations`
8. `SessionLogger` persists samples at `log_hz` and stores each new recommendation type/priority/lap.
9. DuckDB sync scans the configured LMU telemetry folder by file signature and opens only new or changed files to refresh cached session/lap summaries.
10. Frontend pages render live state, DuckDB-backed profile/review state, or imported CSV state.

The frontend is a viewer/control surface for the backend state. It is not required for logging to continue.

## Session Rotation

The backend finalizes the active live session and starts a new session when any of these rules trigger:

- Track, session type, or player car changes.
- Session clock resets: previous game time is over `60s` and current time is more than `30s` behind it.
- Lap counter resets: previous lap is over `2` and the new lap is more than one lap lower.
- Telemetry disconnects or no player is available.
- The car is judged idle/menu/off-track for at least `15s`.

If an unfinished session with the same track, session type, and vehicle exists, the repository resumes it. This keeps live logging resilient across backend restarts during development.

## API Surface

Live and saved session APIs include:

- `GET /api/telemetry/latest`
- `GET /api/strategy/current`
- `POST /api/strategy/assumptions`
- `GET /api/competitors`
- `GET /api/recommendations/current`
- `GET /api/sessions`
- `GET /api/session/review`
- `GET /api/session/review/{session_id}`
- `GET /api/session/review/{session_id}/dashboard`
- `POST /api/session/current/finalize`

MoTeC APIs include:

- `GET /api/motec/sessions`
- `POST /api/motec/sessions/import`
- `GET /api/motec/sessions/{session_id}`
- `GET /api/motec/sessions/{session_id}/samples`

DuckDB/profile APIs include:

- `GET /api/lmu-duckdb/settings`
- `POST /api/lmu-duckdb/settings`
- `POST /api/lmu-duckdb/sync`
- `GET /api/lmu-duckdb/sessions`
- `GET /api/lmu-duckdb/sessions/{session_id}/review`
- `GET /api/profile/overview`
- `GET /api/profile/summary`
- `GET /api/profile/best-laps`
- `GET /api/profile/laps`

## Frontend Routing

`App.tsx` maps one page key to one page component. Live pages use WebSocket data plus `/api/competitors`. User Profile and Session Review use the configured DuckDB folder and cache. Strategy Planner and Session Report can use live state or load cached DuckDB sessions. MoTeC pages fetch imported session metadata and decimated samples from the backend.
