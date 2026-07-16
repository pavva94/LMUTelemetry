from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas.race_simulation import RaceSimulationRequest
from app.schemas.endurance_event import FullFieldRequest
from app.services import lmu_duckdb_repository
from app.services.duckdb_jobs import duckdb_jobs
from app.strategy.race_simulation import derive_model, run_simulation
from app.strategy.endurance_event import import_event, run_full_field

router = APIRouter(prefix="/api/race-simulation", tags=["race-simulation"])

@router.get("/events/{session_id}/import")
def event_import(session_id: str):
    try:
        return import_event(lmu_duckdb_repository.review_session(None, session_id, sample_limit=5000), session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Saved session not found") from exc

@router.post("/full-field/jobs", status_code=202)
def start_full_field(payload: FullFieldRequest):
    return duckdb_jobs.start(lambda progress: run_full_field(payload, progress))

@router.post("/jobs", status_code=202)
def start_simulation(payload: RaceSimulationRequest):
    def work(progress):
        progress("Loading session", "Reading validated saved-session data", 0, 1, 5)
        review = lmu_duckdb_repository.review_session(None, payload.session_id, sample_limit=5000, progress=progress)
        progress("Building models", "Deriving robust pace, fuel, tyre, pit and variability models", 0, 1, 25)
        derive_model(review, payload)
        return run_simulation(review, payload, progress)
    try:
        return duckdb_jobs.start(work)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Saved session not found") from exc
