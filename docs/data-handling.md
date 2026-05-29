# Data Handling

This app stores telemetry locally. There is no external telemetry upload in the current implementation.

## Live Telemetry Input

Live data comes from one of two collectors:

- Mock data when `USE_MOCK_TELEMETRY=true` or `dev.use_mock_telemetry` is true.
- LMU shared memory when mock mode is disabled and `pyLMUSharedMemory` is available.

`LMUTelemetryCollector` reconnects at most once every `2s` when shared memory is unavailable. Failed reads return a disconnected `TelemetrySnapshot` instead of crashing the backend.

## Normalization Rules

`normalize_lmu_snapshot` maps shared-memory objects into typed schemas:

- Speed is vector magnitude converted to km/h: `sqrt(x^2 + y^2 + z^2) * 3.6`.
- Temperatures above `170` are treated as Kelvin and converted to Celsius by subtracting `273.15`; lower values are kept as Celsius.
- Session numeric type IDs are mapped to names: Test Day, Practice, Qualifying, Warmup, Race, etc.
- Finish status IDs map to `finished`, `dnf`, or `dq`.
- Tyre average wear is the mean of available FL/FR/RL/RR wear channels.
- Tyre average temperature uses centre temperature where available, otherwise carcass temperature.
- Only the first 104 scoring vehicles are normalized into competitors.

## Feed Pause Rules

The live feed is paused and the active session finalized when:

- Telemetry is disconnected.
- No player car is present.
- Game phase contains `garage`, `menu`, `replay`, or `paused`.
- The car is outside pits and remains effectively idle for `15s`.

Idle detection is reset when speed exceeds `5 km/h`, throttle/brake/clutch exceeds `0.03`, or lap-distance progress changes by more than `0.00005`.

## Live SQLite Storage

Live telemetry is stored in `data/sessions/lmu_strategy.sqlite3`.

Tables:

- `sessions`: segment metadata such as track, session type, car, start/end game time, final position, and car count.
- `telemetry_samples`: player telemetry, tyre, brake, ride-height, environment, pit state, and basic timing fields.
- `lap_summaries`: derived lap rows built from stored samples.
- `pit_events`: pit entry/exit events.
- `recommendations`: recommendation history and assumptions used.
- `assumptions`: strategy assumptions, although live updates are held in memory by the service.

`SessionLogger` writes no faster than `log_hz`. It logs a recommendation only when the recommendation type, priority, or lap changes.

## Saved Session Review

Saved review data is rebuilt from stored samples:

- Samples are grouped by `lap_number`.
- Lap duration prefers official `last_lap_time` when a new official value appears; otherwise it uses `last.game_time - first.game_time`.
- Fuel used is `fuel_start - fuel_end` when fuel decreases during the lap.
- Fuel added is `lap.fuel_start - previous_lap.fuel_end` when positive.
- Pit laps are any lap with at least one sample where `in_pits` is true.
- Tyre wear delta is average end wear minus average start wear.
- Top speed and max RPM are maxima across samples in the lap.

Review sample payloads are decimated when there are more samples than the requested limit. The step is `ceil(total_samples / sample_limit)`.

## CSV / MoTeC Storage

Imported CSV analysis sessions are stored in `data/motec/motec.sqlite3`.

The importer requires metadata:

- `session_name`
- `track_name`
- `car_name`
- `car_class`
- `session_type`

CSV format:

- Row 1: channel names.
- Row 2: units.
- Row 3 onward: samples.

The backend streams the request body line by line, parses CSV safely with Python `csv.reader`, stores samples in batches of 5000, and stores each sample as JSON plus indexed session/lap/time columns.

## Sample Decimation

`GET /api/motec/sessions/{id}/samples` returns decimated samples:

- `max_points` is clamped between `100` and `10000`.
- Decimation step is `ceil(total / max_points)`.
- Returned rows satisfy `row_index % step = 0`.
- Returned fields include requested channels plus base channels: `Time`, `Session Elapsed Time`, `Lap Number`, and `Lap-relative time`.

