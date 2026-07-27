from __future__ import annotations

import sqlite3
from pathlib import Path

from scripts.build_seed_cache import build_seed_cache


def test_build_seed_cache_keeps_derived_data_and_removes_runtime_state(tmp_path: Path) -> None:
    source = tmp_path / "live.sqlite3"
    output = tmp_path / "seed" / "cache.sqlite3"
    with sqlite3.connect(source) as db:
        db.execute("CREATE TABLE lmu_duckdb_sessions (id TEXT PRIMARY KEY)")
        db.execute("INSERT INTO lmu_duckdb_sessions VALUES ('cached-session')")
        db.execute("CREATE TABLE telemetry_samples (id INTEGER PRIMARY KEY)")
        db.execute("INSERT INTO telemetry_samples VALUES (1)")
        db.execute("CREATE TABLE lmu_duckdb_sync_runs (id TEXT PRIMARY KEY)")
        db.execute("INSERT INTO lmu_duckdb_sync_runs VALUES ('transient-run')")
        db.execute(
            "CREATE TABLE session_aggregates "
            "(session_id TEXT PRIMARY KEY, laps_json TEXT, sample_trace_json TEXT)"
        )
        db.execute(
            "INSERT INTO session_aggregates VALUES "
            "('cached-session', '[{\"lap\": 1}]', '[{\"speed\": 250}]')"
        )
        db.execute("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT)")
        db.execute(
            "INSERT INTO app_settings VALUES ('lmu_duckdb_folder', 'C:/machine-specific')"
        )
        db.execute("INSERT INTO app_settings VALUES ('language', 'en')")

    counts = build_seed_cache(source, output)

    assert counts["lmu_duckdb_sessions"] == 1
    assert counts["telemetry_samples"] == 0
    assert counts["lmu_duckdb_sync_runs"] == 0
    with sqlite3.connect(output) as db:
        assert db.execute("SELECT id FROM lmu_duckdb_sessions").fetchall() == [
            ("cached-session",)
        ]
        assert db.execute("SELECT id FROM telemetry_samples").fetchall() == []
        assert db.execute("SELECT id FROM lmu_duckdb_sync_runs").fetchall() == []
        assert db.execute(
            "SELECT laps_json, sample_trace_json FROM session_aggregates"
        ).fetchone() == ('[{"lap": 1}]', None)
        assert db.execute("SELECT key, value FROM app_settings").fetchall() == [
            ("language", "en")
        ]
