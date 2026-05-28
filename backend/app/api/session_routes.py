from __future__ import annotations

from fastapi import APIRouter, Request

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


@router.get("/sessions")
def sessions(request: Request):
    service = request.app.state.telemetry_service
    return service.repository.list_sessions()


@router.post("/session/current/finalize")
def finalize_current_session(request: Request):
    service = request.app.state.telemetry_service
    return service.repository.finalize_session(service.session_id, service.latest_snapshot)
