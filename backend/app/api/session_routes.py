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
def session_review(request: Request):
    service = request.app.state.telemetry_service
    return service.repository.review(service.session_id)
