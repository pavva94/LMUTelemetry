from __future__ import annotations

from typing import Optional

from sqlalchemy import Boolean, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class SessionModel(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    created_at: Mapped[str] = mapped_column(String, nullable=False)
    track_name: Mapped[Optional[str]] = mapped_column(String)
    session_type: Mapped[Optional[str]] = mapped_column(String)
    vehicle_name: Mapped[Optional[str]] = mapped_column(String)
    started_at_game_time: Mapped[Optional[float]] = mapped_column(Float)
    ended_at_game_time: Mapped[Optional[float]] = mapped_column(Float)


class TelemetrySampleModel(Base):
    __tablename__ = "telemetry_samples"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String, nullable=False)
    timestamp: Mapped[str] = mapped_column(String, nullable=False)
    game_time: Mapped[Optional[float]] = mapped_column(Float)
    lap_number: Mapped[Optional[int]] = mapped_column(Integer)
    speed_kph: Mapped[Optional[float]] = mapped_column(Float)
    gear: Mapped[Optional[int]] = mapped_column(Integer)
    rpm: Mapped[Optional[float]] = mapped_column(Float)
    fuel_liters: Mapped[Optional[float]] = mapped_column(Float)
    throttle: Mapped[Optional[float]] = mapped_column(Float)
    brake: Mapped[Optional[float]] = mapped_column(Float)
    steering: Mapped[Optional[float]] = mapped_column(Float)
    brake_temp_fl: Mapped[Optional[float]] = mapped_column(Float)
    brake_temp_fr: Mapped[Optional[float]] = mapped_column(Float)
    brake_temp_rl: Mapped[Optional[float]] = mapped_column(Float)
    brake_temp_rr: Mapped[Optional[float]] = mapped_column(Float)
    brake_pressure_fl: Mapped[Optional[float]] = mapped_column(Float)
    brake_pressure_fr: Mapped[Optional[float]] = mapped_column(Float)
    brake_pressure_rl: Mapped[Optional[float]] = mapped_column(Float)
    brake_pressure_rr: Mapped[Optional[float]] = mapped_column(Float)
    ride_height_fl: Mapped[Optional[float]] = mapped_column(Float)
    ride_height_fr: Mapped[Optional[float]] = mapped_column(Float)
    ride_height_rl: Mapped[Optional[float]] = mapped_column(Float)
    ride_height_rr: Mapped[Optional[float]] = mapped_column(Float)
    front_ride_height: Mapped[Optional[float]] = mapped_column(Float)
    rear_ride_height: Mapped[Optional[float]] = mapped_column(Float)
    suspension_deflection_fl: Mapped[Optional[float]] = mapped_column(Float)
    suspension_deflection_fr: Mapped[Optional[float]] = mapped_column(Float)
    suspension_deflection_rl: Mapped[Optional[float]] = mapped_column(Float)
    suspension_deflection_rr: Mapped[Optional[float]] = mapped_column(Float)
    tyre_wear_fl: Mapped[Optional[float]] = mapped_column(Float)
    tyre_wear_fr: Mapped[Optional[float]] = mapped_column(Float)
    tyre_wear_rl: Mapped[Optional[float]] = mapped_column(Float)
    tyre_wear_rr: Mapped[Optional[float]] = mapped_column(Float)
    tyre_load_fl: Mapped[Optional[float]] = mapped_column(Float)
    tyre_load_fr: Mapped[Optional[float]] = mapped_column(Float)
    tyre_load_rl: Mapped[Optional[float]] = mapped_column(Float)
    tyre_load_rr: Mapped[Optional[float]] = mapped_column(Float)
    tyre_temp_fl: Mapped[Optional[float]] = mapped_column(Float)
    tyre_temp_fr: Mapped[Optional[float]] = mapped_column(Float)
    tyre_temp_rl: Mapped[Optional[float]] = mapped_column(Float)
    tyre_temp_rr: Mapped[Optional[float]] = mapped_column(Float)
    track_temp: Mapped[Optional[float]] = mapped_column(Float)
    ambient_temp: Mapped[Optional[float]] = mapped_column(Float)
    rain: Mapped[Optional[float]] = mapped_column(Float)
    wetness: Mapped[Optional[float]] = mapped_column(Float)


class LapSummaryModel(Base):
    __tablename__ = "lap_summaries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String, nullable=False)
    lap_number: Mapped[int] = mapped_column(Integer, nullable=False)
    lap_time: Mapped[Optional[float]] = mapped_column(Float)
    sector1: Mapped[Optional[float]] = mapped_column(Float)
    sector2: Mapped[Optional[float]] = mapped_column(Float)
    sector3: Mapped[Optional[float]] = mapped_column(Float)
    fuel_start: Mapped[Optional[float]] = mapped_column(Float)
    fuel_end: Mapped[Optional[float]] = mapped_column(Float)
    fuel_used: Mapped[Optional[float]] = mapped_column(Float)
    tyre_wear_start: Mapped[Optional[float]] = mapped_column(Float)
    tyre_wear_end: Mapped[Optional[float]] = mapped_column(Float)
    valid_lap: Mapped[Optional[bool]] = mapped_column(Boolean)
    in_pit: Mapped[Optional[bool]] = mapped_column(Boolean)
    under_yellow: Mapped[Optional[bool]] = mapped_column(Boolean)


class PitEventModel(Base):
    __tablename__ = "pit_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String, nullable=False)
    vehicle_id: Mapped[Optional[int]] = mapped_column(Integer)
    driver_name: Mapped[Optional[str]] = mapped_column(String)
    lap_number: Mapped[Optional[int]] = mapped_column(Integer)
    pit_entry_time: Mapped[Optional[float]] = mapped_column(Float)
    pit_exit_time: Mapped[Optional[float]] = mapped_column(Float)
    stationary_time: Mapped[Optional[float]] = mapped_column(Float)
    total_pit_loss: Mapped[Optional[float]] = mapped_column(Float)
    detected_from: Mapped[Optional[str]] = mapped_column(String)


class RecommendationModel(Base):
    __tablename__ = "recommendations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String, nullable=False)
    timestamp: Mapped[str] = mapped_column(String, nullable=False)
    lap_number: Mapped[Optional[int]] = mapped_column(Integer)
    recommendation_type: Mapped[Optional[str]] = mapped_column(String)
    priority: Mapped[Optional[str]] = mapped_column(String)
    message: Mapped[Optional[str]] = mapped_column(Text)
    reason_codes: Mapped[Optional[str]] = mapped_column(Text)
    assumptions_json: Mapped[Optional[str]] = mapped_column(Text)
    accepted: Mapped[Optional[bool]] = mapped_column(Boolean)


class AssumptionModel(Base):
    __tablename__ = "assumptions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String, nullable=False)
    pit_loss_seconds: Mapped[Optional[float]] = mapped_column(Float)
    pit_stationary_seconds: Mapped[Optional[float]] = mapped_column(Float)
    fuel_safety_margin_liters: Mapped[Optional[float]] = mapped_column(Float)
    fuel_safety_margin_laps: Mapped[Optional[float]] = mapped_column(Float)
    max_tyre_wear: Mapped[Optional[float]] = mapped_column(Float)
    normal_lap_time: Mapped[Optional[float]] = mapped_column(Float)
    safety_car_pit_loss_seconds: Mapped[Optional[float]] = mapped_column(Float)
    updated_at: Mapped[Optional[str]] = mapped_column(String)
