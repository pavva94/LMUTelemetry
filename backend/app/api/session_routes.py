from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi import HTTPException

router = APIRouter(prefix="/api", tags=["session"])


@router.get("/session/current")
def current_session(request: Request):
    service = request.app.state.telemetry_service
    snapshot = service.latest_snapshot
    return {
        "id": service.session_id,
        "connected": snapshot.connected if snapshot else False,
        "session": snapshot.session if snapshot else None,
        "player": snapshot.player if snapshot else None,
    }


@router.get("/session/review")
def session_review(request: Request, limit: int = 5000):
    service = request.app.state.telemetry_service
    return service.repository.review(service.session_id, sample_limit=limit)


@router.get("/session/review/{session_id}")
def saved_session_review(session_id: str, request: Request, limit: int = 5000):
    service = request.app.state.telemetry_service
    return service.repository.review(session_id, sample_limit=limit)


@router.get("/session/review/{session_id}/dashboard")
def saved_session_dashboard(session_id: str, request: Request):
    service = request.app.state.telemetry_service
    return service.repository.dashboard_snapshot(session_id, service.assumptions)


@router.get("/live-lap-analysis")
def live_lap_analysis(request: Request, selected_lap: int | None = None, reference_lap: int | None = None, analysis_laps: str | None = None):
    service = request.app.state.telemetry_service
    try:
        selected_for_analysis = {int(value) for value in analysis_laps.split(",") if value.strip()} if analysis_laps is not None else None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="analysis_laps must be a comma-separated list of lap numbers") from exc
    return service.live_lap_analysis(selected_lap=selected_lap, reference_lap=reference_lap, analysis_laps=selected_for_analysis)


@router.get("/sessions")
def sessions(request: Request):
    service = request.app.state.telemetry_service
    return service.repository.list_sessions()


@router.post("/session/current/finalize")
def finalize_current_session(request: Request):
    service = request.app.state.telemetry_service
    return service.repository.finalize_session(service.session_id, service.latest_snapshot)


@router.delete("/sessions/{session_id}")
def remove_session(session_id: str, request: Request):
    service = request.app.state.telemetry_service
    removed = service.repository.remove_session(session_id)
    if removed is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return removed
