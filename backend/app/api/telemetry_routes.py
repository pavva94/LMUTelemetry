from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter(prefix="/api", tags=["telemetry"])


@router.get("/health")
def health(request: Request) -> dict:
    service = request.app.state.telemetry_service
    return {
        "ok": True,
        "connected": service.collector.is_connected(),
        "mock": service.settings.use_mock_telemetry,
        "session_id": service.session_id,
    }


@router.get("/telemetry/latest")
def latest_telemetry(request: Request):
    service = request.app.state.telemetry_service
    return service.latest_snapshot or {
        "connected": False,
        "message": "Le Mans Ultimate shared memory not available",
    }


@router.get("/competitors")
def competitors(request: Request):
    return request.app.state.telemetry_service.competitors
