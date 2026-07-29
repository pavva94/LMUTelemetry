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


@router.get("/session/review/{session_id}/xy-plot")
def session_xy_plot(
    session_id: str,
    request: Request,
    plot_id: str = "custom",
    x_channel: str | None = None,
    y_channel: str | None = None,
    laps: str | None = None,
    corners: str | None = None,
    speed_min: float | None = None,
    speed_max: float | None = None,
    compound: str | None = None,
    fuel_min: float | None = None,
    fuel_max: float | None = None,
    valid_only: bool = True,
    color_by: str = "speed",
    trend: bool = False,
    percentile_envelope: bool = False,
    max_points: int = 5000,
):
    service = request.app.state.telemetry_service

    def comma_values(value: str | None) -> list[str]:
        return [part.strip() for part in (value or "").split(",") if part.strip()]

    try:
        selected_laps = [int(value) for value in comma_values(laps)]
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="laps must be a comma-separated list of lap numbers") from exc
    filters = {
        "laps": selected_laps,
        "corners": comma_values(corners),
        "speed_min": speed_min,
        "speed_max": speed_max,
        "compound": compound,
        "fuel_min": fuel_min,
        "fuel_max": fuel_max,
        "valid_only": valid_only,
    }
    return service.repository.xy_plot(
        session_id,
        plot_id=plot_id,
        x_channel=x_channel,
        y_channel=y_channel,
        filters=filters,
        color_by=color_by,
        include_trend=trend,
        include_envelope=percentile_envelope,
        max_points=max(100, min(10000, max_points)),
    )


@router.get("/session/review/{session_id}/lap-inputs")
def session_lap_inputs(session_id: str, request: Request, lap_a: int, lap_b: int | None = None, max_points: int = 2400):
    service = request.app.state.telemetry_service
    return service.repository.lap_input_trace(
        session_id,
        [lap_a, *([lap_b] if lap_b is not None else [])],
        max_points=max(80, min(5000, max_points)),
    )


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
