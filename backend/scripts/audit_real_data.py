from __future__ import annotations

import argparse
import json
import math
import sqlite3
import statistics
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Iterable


def finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def describe(values: Iterable[Any]) -> dict[str, Any]:
    clean = [number for value in values if (number := finite(value)) is not None]
    if not clean:
        return {"count": 0, "min": None, "max": None, "mean": None, "median": None, "pstdev": None}
    return {
        "count": len(clean),
        "min": min(clean),
        "max": max(clean),
        "mean": statistics.fmean(clean),
        "median": statistics.median(clean),
        "pstdev": statistics.pstdev(clean),
    }


def table_counts(connection: sqlite3.Connection) -> dict[str, int]:
    names = [
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]
    return {name: connection.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0] for name in names}


def column_values(connection: sqlite3.Connection, table: str, column: str) -> list[Any]:
    return [row[0] for row in connection.execute(f'SELECT "{column}" FROM "{table}" WHERE "{column}" IS NOT NULL')]


def independently_valid_laps(laps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    candidates = [
        lap for lap in laps
        if (value := finite(lap.get("lap_time"))) is not None
        and 40 <= value <= 900
        and not lap.get("in_pit")
        and not lap.get("under_yellow")
        and lap.get("valid_lap") is not False
        and lap.get("timing_source") != "partial_samples"
    ]
    normal = statistics.median(float(lap["lap_time"]) for lap in candidates) if len(candidates) >= 3 else None
    return [
        lap for lap in candidates
        if normal is None or normal * 0.75 <= float(lap["lap_time"]) <= normal * 1.8
    ]


def live_audit(path: Path) -> dict[str, Any]:
    connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    counts = table_counts(connection)
    settings = dict(connection.execute("SELECT key, value FROM app_settings")) if "app_settings" in counts else {}

    sample_fields = [
        "game_time", "lap_number", "current_lap_time", "last_lap_time", "best_lap_time", "speed_kph",
        "fuel_liters", "fuel_capacity_liters", "tyre_wear_fl", "tyre_wear_fr", "tyre_wear_rl", "tyre_wear_rr",
        "tyre_pressure_fl", "tyre_pressure_fr", "tyre_pressure_rl", "tyre_pressure_rr",
        "tyre_temp_fl", "tyre_temp_fr", "tyre_temp_rl", "tyre_temp_rr",
    ]
    lap_fields = [
        "lap_time", "sector1", "sector2", "sector3", "fuel_start", "fuel_end", "fuel_used",
        "tyre_wear_start", "tyre_wear_end",
    ]
    sample_stats = {field: describe(column_values(connection, "telemetry_samples", field)) for field in sample_fields}
    lap_stats = {field: describe(column_values(connection, "lap_summaries", field)) for field in lap_fields}

    lap_quality = dict(
        connection.execute(
            """
            SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN valid_lap = 1 THEN 1 ELSE 0 END) AS valid_true,
              SUM(CASE WHEN valid_lap = 0 THEN 1 ELSE 0 END) AS valid_false,
              SUM(CASE WHEN valid_lap IS NULL THEN 1 ELSE 0 END) AS valid_unknown,
              SUM(CASE WHEN in_pit = 1 THEN 1 ELSE 0 END) AS pit_laps,
              SUM(CASE WHEN lap_time < 40 OR lap_time > 900 THEN 1 ELSE 0 END) AS implausible_lap_times,
              SUM(CASE WHEN fuel_used < 0 THEN 1 ELSE 0 END) AS negative_fuel_used,
              SUM(CASE WHEN fuel_start > fuel_end + 0.01 AND fuel_used IS NULL THEN 1 ELSE 0 END) AS unrecorded_fuel_use
            FROM lap_summaries
            """
        ).fetchone()
    )
    duplicates = [
        dict(row)
        for row in connection.execute(
            """
            SELECT session_id, lap_number, COUNT(*) AS rows
            FROM lap_summaries GROUP BY session_id, lap_number HAVING COUNT(*) > 1
            ORDER BY rows DESC, session_id, lap_number LIMIT 25
            """
        )
    ]
    fuel_anomalies = [
        dict(row)
        for row in connection.execute(
            """
            SELECT session_id, lap_number, lap_time, fuel_start, fuel_end, fuel_used, in_pit, valid_lap
            FROM lap_summaries
            WHERE fuel_used > 10 OR fuel_used < 0
            ORDER BY ABS(fuel_used) DESC LIMIT 50
            """
        )
    ]
    timestamp_order = [
        dict(row)
        for row in connection.execute(
            """
            WITH ordered AS (
              SELECT session_id, id, game_time,
                     LAG(game_time) OVER (PARTITION BY session_id ORDER BY id) AS previous_game_time
              FROM telemetry_samples WHERE game_time IS NOT NULL
            )
            SELECT session_id, COUNT(*) AS regressions
            FROM ordered WHERE previous_game_time IS NOT NULL AND game_time < previous_game_time
            GROUP BY session_id ORDER BY regressions DESC LIMIT 25
            """
        )
    ]
    session_types = Counter(row[0] or "unknown" for row in connection.execute("SELECT session_type FROM sessions"))
    aggregate_differences: list[dict[str, Any]] = []
    for row in connection.execute(
        "SELECT session_id, best_lap, average_lap, total_fuel_used, laps_json FROM session_aggregates ORDER BY session_id"
    ):
        laps = json.loads(row["laps_json"] or "[]")
        valid = independently_valid_laps(laps)
        lap_times = [float(lap["lap_time"]) for lap in valid]
        fuel = [
            float(lap["fuel_used"]) for lap in valid
            if finite(lap.get("fuel_used")) is not None and float(lap["fuel_used"]) >= 0
        ]
        corrected = {
            "best_lap": min(lap_times) if lap_times else None,
            "average_lap": statistics.fmean(lap_times) if lap_times else None,
            "total_clean_lap_fuel_used": sum(fuel) if fuel else None,
        }
        stored = {"best_lap": row["best_lap"], "average_lap": row["average_lap"], "total_fuel_used": row["total_fuel_used"]}
        comparisons = (
            ("best_lap", "best_lap"),
            ("average_lap", "average_lap"),
            ("total_fuel_used", "total_clean_lap_fuel_used"),
        )
        if any(
            (finite(stored.get(stored_key)) is None) != (finite(corrected.get(corrected_key)) is None)
            or (
                finite(stored.get(stored_key)) is not None
                and finite(corrected.get(corrected_key)) is not None
                and abs(float(stored[stored_key]) - float(corrected[corrected_key])) > 1e-6
            )
            for stored_key, corrected_key in comparisons
        ):
            aggregate_differences.append({
                "session_id": row["session_id"],
                "stored": stored,
                "independent": corrected,
                "stored_valid_laps": sum(lap.get("valid_lap") is not False for lap in laps),
                "independent_valid_laps": len(valid),
            })
    connection.close()
    return {
        "path": str(path.resolve()),
        "size_bytes": path.stat().st_size,
        "table_counts": counts,
        "app_settings": settings,
        "session_types": dict(session_types),
        "sample_stats": sample_stats,
        "lap_stats": lap_stats,
        "lap_quality": lap_quality,
        "duplicate_session_laps": duplicates,
        "game_time_regressions": timestamp_order,
        "fuel_anomalies": fuel_anomalies,
        "aggregate_differences": aggregate_differences,
    }


def native_raw_evidence(path: Path) -> dict[str, Any]:
    import duckdb

    connection = duckdb.connect(str(path), read_only=True)
    try:
        tables = {row[0] for row in connection.execute("SHOW TABLES").fetchall()}
        units = {}
        if "channelsList" in tables:
            units = {str(row[0]): {"frequency": row[1], "unit": row[2]} for row in connection.execute('SELECT channelName, frequency, unit FROM channelsList').fetchall()}
        evidence = {}
        for table in ("Lap", "Lap Time", "Best LapTime", "Current LapTime", "Fuel Level", "Ground Speed", "GPS Time", "Lap Dist", "Tyres Wear", "TyresPressure"):
            if table not in tables:
                continue
            quoted = '"' + table.replace('"', '""') + '"'
            columns = [str(row[1]) for row in connection.execute(f"PRAGMA table_info({quoted})").fetchall()]
            order = ' ORDER BY "ts"' if "ts" in columns else " ORDER BY rowid"
            evidence[table] = {
                "columns": columns,
                "count": connection.execute(f"SELECT COUNT(*) FROM {quoted}").fetchone()[0],
                "metadata": units.get(table),
                "first": connection.execute(f"SELECT * FROM {quoted}{order} LIMIT 5").fetchall(),
                "last": connection.execute(f"SELECT * FROM {quoted}{order} DESC LIMIT 5").fetchall(),
            }
        return evidence
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-only numerical inventory of LMU Telemetry's real local databases.")
    parser.add_argument("--data-dir", type=Path, default=Path(__file__).resolve().parents[2] / "data")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--duckdb-file", type=Path, help="Also inspect one native LMU DuckDB through the application parser.")
    parser.add_argument("--app-metrics", action="store_true", help="Include application profile calculations from the real stores.")
    args = parser.parse_args()

    payload = {"live": live_audit(args.data_dir / "sessions" / "lmu_strategy.sqlite3")}
    if args.app_metrics:
        backend_root = Path(__file__).resolve().parents[1]
        sys.path.insert(0, str(backend_root))
        from app.services.profile_repository import ProfileRepository
        profile = ProfileRepository()
        payload["application"] = {
            "profile_summary": profile.summary(),
            "profile_best_laps": profile.best_laps()[:25],
        }
    if args.duckdb_file:
        backend_root = Path(__file__).resolve().parents[1]
        sys.path.insert(0, str(backend_root))
        from app.services.lmu_duckdb_repository import _review_file

        review = _review_file(args.duckdb_file.resolve(), sample_limit=5000)
        payload["native_duckdb"] = {
            "file": str(args.duckdb_file.resolve()),
            "session": review["session"],
            "summary": review["summary"],
            "laps": review["laps"],
            "pit_events": review["pit_events"],
            "channel_manifest": review["channel_manifest"],
            "available_fields": review["available_fields"],
            "warnings": review["warnings"],
            "raw_channel_evidence": native_raw_evidence(args.duckdb_file.resolve()),
        }
    rendered = json.dumps(payload, indent=2, sort_keys=True, allow_nan=False)
    if args.output:
        args.output.write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)


if __name__ == "__main__":
    main()
