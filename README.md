# LMU Race Strategy Assistant

Local-first race strategy dashboard for Le Mans Ultimate. The MVP reads telemetry, calculates fuel/stint/tyre/pit-window state, logs the session to SQLite, and streams an explainable recommendation dashboard over WebSockets.

## Requirements

- Python 3.11+
- Node.js or Bun for the Vite frontend
- Le Mans Ultimate for live shared-memory mode

Mock telemetry is enabled by default, so the app runs without LMU.

## Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # macOS/Linux
# or .venv\Scripts\activate on Windows
pip install -r requirements.txt
python run_backend.py
```

Backend runs on `http://127.0.0.1:8000`.

To attempt real LMU shared memory instead of mock telemetry:

```bash
git clone https://github.com/TinyPedal/pyLMUSharedMemory.git ../pyLMUSharedMemory
export PYTHONPATH="$PWD/../pyLMUSharedMemory:$PYTHONPATH"
USE_MOCK_TELEMETRY=false python run_backend.py
```

If LMU shared memory is unavailable, the backend stays up and returns:

```json
{ "connected": false, "message": "Le Mans Ultimate shared memory not available" }
```

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://127.0.0.1:5173`.

## API

- `GET /api/health`
- `GET /api/session/current`
- `GET /api/telemetry/latest`
- `GET /api/strategy/current`
- `GET /api/competitors`
- `GET /api/recommendations/current`
- `POST /api/strategy/assumptions`
- `GET /api/session/review`
- `WS /ws/telemetry`
- `WS /ws/strategy`
- `WS /ws/recommendations`

## What The MVP Does

- Mock collector emits realistic lap, fuel, tyre, weather, pit, and competitor data.
- LMU collector attempts to use `pyLMUSharedMemory` and normalizes raw structs.
- Strategy engine calculates fuel range, tyre life, stint limits, pit window, competitor threats, and recommendations.
- SQLite logging stores telemetry samples and recommendation events in `data/sessions/`.
- React dashboard shows live telemetry, strategy planner assumptions, pit window, competitors, and session review charts.

## Known Limitations

- Live LMU struct field names may need small mapping adjustments depending on the installed `pyLMUSharedMemory` version.
- Lap summaries and pit event persistence are detected in memory but only telemetry samples and recommendations are persisted in this first slice.
- The AI assistant is deterministic text formatting only; it does not call external APIs.

## Next Steps

- Validate real LMU field mappings against a running game session.
- Persist lap summaries and pit events.
- Add frontend unit tests.
- Add richer traffic/rejoin projection once live competitor gap quality is verified.
