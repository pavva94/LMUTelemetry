from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


Provenance = Literal["session_derived", "robust_estimate", "user_configured", "default_fallback"]
PaceMode = Literal["push", "normal", "conserve"]
TrafficPreset = Literal["clear", "light", "typical", "heavy"]
TrafficAggression = Literal["conservative", "normal", "aggressive"]


class SimulationStint(BaseModel):
    compound: str = "OBSERVED"
    laps: int = Field(ge=1, le=500)
    pace_mode: PaceMode = "normal"
    fuel_added_liters: float = Field(default=0, ge=0, le=500)
    change_tyres: bool = True


class SimulationStrategy(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    stints: list[SimulationStint] = Field(min_length=1, max_length=24)


class RaceSimulationRequest(BaseModel):
    session_id: str
    race_duration_minutes: float = Field(ge=5, le=1440, default=120)
    simulation_count: int = Field(ge=100, le=20_000, default=1000)
    random_seed: int = Field(ge=0, le=2_147_483_647, default=42)
    starting_fuel_liters: float | None = Field(default=None, ge=0, le=500)
    fuel_tank_capacity_liters: float | None = Field(default=None, gt=0, le=500)
    finish_reserve_liters: float = Field(default=2, ge=0, le=100)
    pit_loss_seconds: float | None = Field(default=None, ge=0, le=180)
    normal_lap_time: float | None = Field(default=None, ge=40, le=900)
    fuel_per_lap_liters: float | None = Field(default=None, gt=0, le=30)
    tyre_wear_rate_per_lap: float | None = Field(default=None, gt=0, le=1)
    tyre_change_seconds_per_tyre: float = Field(default=3, ge=0, le=30)
    refuel_seconds_per_5_liters: float = Field(default=1.2, ge=0, le=30)
    service_model: Literal["sequential", "parallel"] = "parallel"
    race_start_new_tyres: bool = True
    tyre_wear_limit: float = Field(default=0.85, gt=0, le=1)
    used_tyre_wear: float = Field(default=0.35, ge=0, le=0.95)
    tyre_wear_variability: float = Field(default=0.12, ge=0, le=0.75)
    pace_variability_multiplier: float = Field(default=1, ge=0, le=5)
    pit_variability_multiplier: float = Field(default=1, ge=0, le=5)
    field_size: int = Field(default=24, ge=1, le=80)
    same_class_cars: int = Field(default=12, ge=0, le=80)
    faster_class_cars: int = Field(default=4, ge=0, le=80)
    slower_class_cars: int = Field(default=7, ge=0, le=80)
    starting_position: int | None = Field(default=None, ge=1, le=80)
    opponent_pace_spread_seconds: float = Field(default=1.2, ge=0.05, le=30)
    faster_class_delta_seconds: float = Field(default=5, ge=0.1, le=120)
    slower_class_delta_seconds: float = Field(default=5, ge=0.1, le=120)
    traffic_preset: TrafficPreset = "typical"
    traffic_aggression: TrafficAggression = "normal"
    traffic_loss_seconds: float = Field(default=1.2, ge=0, le=60)
    traffic_wear_multiplier: float = Field(default=0.12, ge=0, le=2)
    traffic_fuel_multiplier: float = Field(default=0.01, ge=0, le=1)
    objective: Literal["expected_time", "median_time", "downside_risk", "fastest_probability", "balanced"] = "balanced"
