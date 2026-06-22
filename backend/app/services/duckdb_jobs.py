from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable


ProgressCallback = Callable[[str, str, int, int, int], None]
JobWork = Callable[[ProgressCallback], Any]


@dataclass
class DuckdbJob:
    id: str
    status: str = "queued"
    phase: str = "Loading database"
    message: str = "Waiting to start"
    completed_items: int = 0
    total_items: int = 1
    percentage: int = 0
    result: Any = None
    error: str | None = None
    updated_at: float = field(default_factory=time.time)

    def public(self) -> dict[str, Any]:
        return {
            "job_id": self.id,
            "status": self.status,
            "phase": self.phase,
            "message": self.message,
            "completed_items": self.completed_items,
            "total_items": self.total_items,
            "percentage": self.percentage,
            "error": self.error,
        }


class DuckdbJobRegistry:
    def __init__(self, ttl_seconds: int = 600) -> None:
        self._jobs: dict[str, DuckdbJob] = {}
        self._lock = threading.Lock()
        self._ttl_seconds = ttl_seconds

    def _cleanup(self) -> None:
        cutoff = time.time() - self._ttl_seconds
        stale = [job_id for job_id, job in self._jobs.items() if job.updated_at < cutoff and job.status in {"complete", "failed"}]
        for job_id in stale:
            self._jobs.pop(job_id, None)

    def start(self, work: JobWork) -> dict[str, Any]:
        job = DuckdbJob(id=uuid.uuid4().hex)
        with self._lock:
            self._cleanup()
            self._jobs[job.id] = job

        def progress(phase: str, message: str, completed: int, total: int, percentage: int) -> None:
            with self._lock:
                current = self._jobs.get(job.id)
                if current is None:
                    return
                current.status = "running"
                current.phase = phase
                current.message = message
                current.completed_items = max(0, completed)
                current.total_items = max(1, total)
                current.percentage = max(current.percentage, min(99, percentage))
                current.updated_at = time.time()

        def run() -> None:
            progress("Loading database", "Opening DuckDB data", 0, 1, 2)
            try:
                result = work(progress)
                with self._lock:
                    current = self._jobs[job.id]
                    current.result = result
                    current.status = "complete"
                    current.phase = "Preparing page"
                    current.message = "Ready"
                    current.completed_items = current.total_items
                    current.percentage = 100
                    current.updated_at = time.time()
            except Exception as exc:  # errors are exposed by the status/result endpoints
                with self._lock:
                    current = self._jobs[job.id]
                    current.status = "failed"
                    current.error = str(exc)
                    current.message = str(exc)
                    current.updated_at = time.time()

        threading.Thread(target=run, name=f"duckdb-job-{job.id[:8]}", daemon=True).start()
        return job.public()

    def status(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            self._cleanup()
            job = self._jobs.get(job_id)
            if job is None:
                raise KeyError(job_id)
            return job.public()

    def result(self, job_id: str) -> Any:
        with self._lock:
            self._cleanup()
            job = self._jobs.get(job_id)
            if job is None:
                raise KeyError(job_id)
            if job.status == "failed":
                raise RuntimeError(job.error or "DuckDB job failed")
            if job.status != "complete":
                raise LookupError("DuckDB job is not complete")
            return job.result


duckdb_jobs = DuckdbJobRegistry()
