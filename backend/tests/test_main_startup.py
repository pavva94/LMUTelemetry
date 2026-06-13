from __future__ import annotations

from app import main


def test_startup_sync_triggers_duckdb_sync(monkeypatch) -> None:
    calls = []

    def fake_sync_folder():
        calls.append(True)
        return {"processed": 1, "skipped": 2, "inactive": 0, "failed": 0}

    monkeypatch.setattr(main.lmu_duckdb_repository, "sync_folder", fake_sync_folder)

    main._sync_lmu_duckdb_on_startup()

    assert calls == [True]


def test_startup_sync_ignores_missing_duckdb_folder(monkeypatch) -> None:
    def fake_sync_folder():
        raise FileNotFoundError("No LMU DuckDB telemetry folder is configured.")

    monkeypatch.setattr(main.lmu_duckdb_repository, "sync_folder", fake_sync_folder)

    main._sync_lmu_duckdb_on_startup()
