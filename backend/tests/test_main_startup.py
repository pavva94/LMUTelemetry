from __future__ import annotations

import sqlite3
from pathlib import Path

from app import main
from app.db.database import bootstrap_sqlite_database


def test_startup_sync_triggers_duckdb_sync(monkeypatch) -> None:
    calls = []

    def fake_mark_interrupted():
        calls.append("interrupted")
        return 1

    def fake_start_sync_run():
        calls.append("started")
        return {"id": "run", "status": "queued"}

    monkeypatch.setattr(main.lmu_duckdb_repository, "mark_interrupted_sync_runs", fake_mark_interrupted)
    monkeypatch.setattr(main.lmu_duckdb_repository, "start_sync_run", fake_start_sync_run)

    main._sync_lmu_duckdb_on_startup()

    assert calls == ["interrupted", "started"]


def test_startup_sync_ignores_missing_duckdb_folder(monkeypatch) -> None:
    monkeypatch.setattr(main.lmu_duckdb_repository, "mark_interrupted_sync_runs", lambda: 0)

    def fake_start_sync_run():
        raise FileNotFoundError("No LMU DuckDB telemetry folder is configured.")

    monkeypatch.setattr(main.lmu_duckdb_repository, "start_sync_run", fake_start_sync_run)

    main._sync_lmu_duckdb_on_startup()


def test_bootstrap_installs_seed_only_when_database_is_absent(tmp_path: Path) -> None:
    seed = tmp_path / "seed.sqlite3"
    target = tmp_path / "runtime" / "app.sqlite3"
    with sqlite3.connect(seed) as db:
        db.execute("CREATE TABLE cached_sessions (id INTEGER PRIMARY KEY)")
        db.execute("INSERT INTO cached_sessions VALUES (42)")

    assert bootstrap_sqlite_database(f"sqlite:///{target}", seed) is True
    with sqlite3.connect(target) as db:
        assert db.execute("SELECT id FROM cached_sessions").fetchone() == (42,)

    with sqlite3.connect(target) as db:
        db.execute("INSERT INTO cached_sessions VALUES (43)")
    assert bootstrap_sqlite_database(f"sqlite:///{target}", seed) is False
    with sqlite3.connect(target) as db:
        assert db.execute("SELECT COUNT(*) FROM cached_sessions").fetchone() == (2,)


def test_bootstrap_ignores_non_sqlite_database(tmp_path: Path) -> None:
    assert bootstrap_sqlite_database("postgresql://localhost/app", tmp_path / "seed.sqlite3") is False
