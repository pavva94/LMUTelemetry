# Architecture

LMU Telemetry is a local-first FastAPI + React application for Le Mans Ultimate live telemetry, strategy modelling, saved-session review, and offline MoTeC-style CSV analysis.

## Runtime Components

- **Backend**: `backend/app/main.py` starts FastAPI, initializes the live SQLite database, creates one `TelemetryService`, and mounts API and WebSocket routers.
- **Telemetry service**: `backend/app/services/telemetry_service.py` owns the live loop. It polls telemetry, normalizes it, updates strategy models, logs samples, and broadcasts telemetry, strategy, and recommendation payloads.
- **Collectors**:
  - `MockTelemetryCollector` produces deterministic-ish race data for development.
  - `LMUTelemetryCollector` reads LMU shared memory through `pyLMUSharedMemory`.
- **Live storage**: SQLAlchemy models in `backend/app/db/models.py` persist sessions, telemetry samples, lap summaries, pit events, recommendations, and assumptions to `data/sessions/lmu_strategy.sqlite3`.
- **CSV/MoTeC storage**: `backend/app/services/motec_repository.py` streams CSV imports into `data/motec/motec.sqlite3`.
- **Frontend**: `frontend/src/App.tsx` chooses pages, subscribes to WebSocket telemetry and strategy, and periodically fetches competitor data.

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
9. Frontend pages render live state, saved review state, or imported CSV state.

## Session Rotation

The backend finalizes the active live session and starts a new session when any of these rules trigger:

- Track, session type, or player car changes.
- Session clock resets: previous game time is over `60s` and current time is more than `30s` behind it.
- Lap counter resets: previous lap is over `2` and the new lap is more than one lap lower.
- Telemetry disconnects or no player is available.
- The car is judged idle/menu/off-track for at least `15s`.

If an unfinished session with the same track, session type, and vehicle exists, the repository resumes it.

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

## Frontend Routing

`App.tsx` maps one page key to one page component. Live pages use WebSocket data plus `/api/competitors`. Review pages fetch saved session data. MoTeC pages fetch imported session metadata and decimated samples from the backend.

