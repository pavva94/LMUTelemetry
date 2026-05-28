from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request

from app.services import motec_repository

router = APIRouter(prefix="/api/motec", tags=["motec"])


@router.post("/sessions/import")
async def import_session(
    request: Request,
    filename: str = Query("telemetry.csv"),
    session_name: str = Query(""),
    track_name: str = Query(""),
    track_layout: str = Query(""),
    car_name: str = Query(""),
    car_class: str = Query(""),
    session_type: str = Query(""),
    finish_position: str = Query(""),
    finish_status: str = Query(""),
):
    try:
        return await motec_repository.import_csv_stream(
            filename,
            request.stream(),
            {
                "session_name": session_name,
                "track_name": track_name,
                "track_layout": track_layout,
                "car_name": car_name,
                "car_class": car_class,
                "session_type": session_type,
                "finish_position": finish_position,
                "finish_status": finish_status,
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/sessions")
def list_sessions():
    return motec_repository.list_sessions()


@router.get("/sessions/{session_id}")
def get_session(session_id: str):
    try:
        return motec_repository.get_session(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="session not found") from exc


@router.get("/sessions/{session_id}/samples")
def get_samples(session_id: str, channels: str, lap: str | None = None, max_points: int = 3000):
    names = [channel for channel in channels.split(",") if channel]
    return motec_repository.get_samples(session_id, lap, names, max_points)
