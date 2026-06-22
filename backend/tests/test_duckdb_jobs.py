from __future__ import annotations

import time

import pytest

from app.services.duckdb_jobs import DuckdbJobRegistry


def _wait_for_job(registry: DuckdbJobRegistry, job_id: str) -> tuple[dict, list[int]]:
    percentages = []
    for _ in range(200):
        status = registry.status(job_id)
        percentages.append(status["percentage"])
        if status["status"] in {"complete", "failed"}:
            return status, percentages
        time.sleep(0.005)
    raise AssertionError("job did not finish")


def test_job_progress_is_monotonic_and_result_is_retrievable() -> None:
    registry = DuckdbJobRegistry()

    def work(progress):
        progress("Reading telemetry", "Reading", 1, 3, 25)
        time.sleep(0.01)
        progress("Validating telemetry", "Validating", 2, 3, 70)
        return {"ok": True}

    started = registry.start(work)
    status, percentages = _wait_for_job(registry, started["job_id"])

    assert status["status"] == "complete"
    assert status["percentage"] == 100
    assert percentages == sorted(percentages)
    assert registry.result(started["job_id"]) == {"ok": True}


def test_failed_job_exposes_error_and_has_no_result() -> None:
    registry = DuckdbJobRegistry()
    started = registry.start(lambda _progress: (_ for _ in ()).throw(ValueError("bad telemetry")))
    status, _ = _wait_for_job(registry, started["job_id"])

    assert status["status"] == "failed"
    assert status["error"] == "bad telemetry"
    with pytest.raises(RuntimeError, match="bad telemetry"):
        registry.result(started["job_id"])
