from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services import lmu_duckdb_repository


router = APIRouter(prefix="/api/lmu-duckdb", tags=["lmu-duckdb"])


class FolderRequest(BaseModel):
    path: str | None = None


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
