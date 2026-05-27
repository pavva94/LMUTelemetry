from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class SessionSummary(BaseModel):
    id: str
    created_at: datetime
    track_name: str | None = None
    session_type: str | None = None
    vehicle_name: str | None = None
    started_at_game_time: float | None = None
    ended_at_game_time: float | None = None


class LapSummary(BaseModel):
    lap_number: int
    lap_time: float | None = None
    fuel_start: float | None = None
    fuel_end: float | None = None
    fuel_used: float | None = None
    tyre_wear_start: float | None = None
    tyre_wear_end: float | None = None
    valid_lap: bool = True
    in_pit: bool = False
    under_yellow: bool = False


class PitEvent(BaseModel):
    vehicle_id: int | None = None
    driver_name: str | None = None
    lap_number: int | None = None
    pit_entry_time: float | None = None
    pit_exit_time: float | None = None
    stationary_time: float | None = None
    total_pit_loss: float | None = None
    detected_from: str = "telemetry"


class SessionReview(BaseModel):
    session: SessionSummary | None = None
    laps: list[LapSummary] = Field(default_factory=list)
    pit_events: list[PitEvent] = Field(default_factory=list)
    recommendations: list[dict] = Field(default_factory=list)
    telemetry_samples: list[dict] = Field(default_factory=list)
