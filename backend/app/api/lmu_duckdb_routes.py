from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services import lmu_duckdb_repository
from app.services.duckdb_jobs import duckdb_jobs
from app.services.profile_repository import ProfileRepository


router = APIRouter(prefix="/api/lmu-duckdb", tags=["lmu-duckdb"])


class FolderRequest(BaseModel):
    path: str | None = None


class HistoryRequest(BaseModel):
    session_ids: list[str]


@router.get("/settings")
def settings():
    return lmu_duckdb_repository.get_settings()


@router.post("/settings")
def save_settings(payload: FolderRequest):
    try:
        if not payload.path:
            raise FileNotFoundError("Folder path is required.")
        return lmu_duckdb_repository.save_settings(payload.path)
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/sync")
def sync(payload: FolderRequest | None = None):
    try:
        return lmu_duckdb_repository.sync_folder(payload.path if payload else None)
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/jobs/sync", status_code=202)
def start_sync_job(payload: FolderRequest | None = None):
    path = payload.path if payload else None
    return duckdb_jobs.start(lambda progress: lmu_duckdb_repository.sync_folder(path, progress=progress))


@router.post("/jobs/sessions", status_code=202)
def start_sessions_job(limit: int = Query(250, ge=1, le=1000), offset: int = Query(0, ge=0)):
    def work(progress):
        progress("Loading database", "Reading the cached DuckDB session index", 0, 1, 35)
        result = lmu_duckdb_repository.sessions_from_cache_or_setting(limit=limit, offset=offset)
        progress("Preparing page", "Preparing the session list", 1, 1, 92)
        return result
    return duckdb_jobs.start(work)


@router.post("/jobs/profile-overview", status_code=202)
def start_profile_overview_job():
    def work(progress):
        progress("Loading database", "Reading validated profile data", 0, 1, 20)
        result = ProfileRepository().overview()
        progress("Processing database", "Preparing profile totals and best laps", 1, 1, 92)
        return result
    return duckdb_jobs.start(work)


@router.post("/sessions/{session_id}/review-jobs", status_code=202)
def start_review_job(session_id: str, limit: int = Query(5000, ge=1, le=5000)):
    return duckdb_jobs.start(lambda progress: lmu_duckdb_repository.review_session(None, session_id, sample_limit=limit, progress=progress))


@router.post("/jobs/history", status_code=202)
def start_history_job(payload: HistoryRequest):
    session_ids = list(dict.fromkeys(payload.session_ids))[:50]
    return duckdb_jobs.start(lambda progress: lmu_duckdb_repository.comparable_history(session_ids, progress=progress))


@router.get("/jobs/{job_id}")
def job_status(job_id: str):
    try:
        return duckdb_jobs.status(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="job not found") from exc


@router.get("/jobs/{job_id}/result")
def job_result(job_id: str):
    try:
        return duckdb_jobs.result(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="job not found") from exc
    except LookupError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/sessions")
def cached_sessions(limit: int = Query(250, ge=1, le=1000), offset: int = Query(0, ge=0)):
    return lmu_duckdb_repository.sessions_from_cache_or_setting(limit=limit, offset=offset)


@router.post("/sessions")
def scan_sessions(payload: FolderRequest, limit: int = Query(250, ge=1, le=1000), offset: int = Query(0, ge=0)):
    try:
        if not payload.path:
            return lmu_duckdb_repository.sessions_from_cache_or_setting(limit=limit, offset=offset)
        return lmu_duckdb_repository.scan_folder(payload.path, limit=limit, offset=offset)
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/review")
def review_session(session_id: str, payload: FolderRequest, limit: int = 5000):
    try:
        return lmu_duckdb_repository.review_session(payload.path, session_id, sample_limit=limit)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="session not found") from exc
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/review")
def review_cached_session(session_id: str, limit: int = 5000):
    try:
        return lmu_duckdb_repository.review_session(None, session_id, sample_limit=limit)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="session not found") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/trajectory")
def trajectory_session(
    session_id: str,
    lap_a: str | None = None,
    lap_b: str | None = None,
    max_points: int = Query(1600, ge=200, le=5000),
):
    try:
        return lmu_duckdb_repository.trajectory_session(session_id, lap_a=lap_a, lap_b=lap_b, max_points=max_points)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="session not found") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
