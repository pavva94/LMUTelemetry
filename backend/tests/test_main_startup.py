from __future__ import annotations

from app import main


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
