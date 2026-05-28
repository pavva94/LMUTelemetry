from __future__ import annotations

from pydantic import BaseModel, Field


class StrategyAssumptions(BaseModel):
    pit_loss_seconds: float = 28.0
    pit_stationary_seconds: float = 12.0
    safety_car_pit_loss_seconds: float = 16.0
    fuel_safety_margin_liters: float = 2.0
    fuel_safety_margin_laps: float = 1.0
    max_tyre_wear: float = 0.75
    normal_lap_time: float = 214.0
    race_duration_minutes: float = 120.0


class FuelState(BaseModel):
    last_lap_fuel_used_liters: float | None = None
    fuel_per_lap_liters: float | None = None
    fuel_laps_remaining: float | None = None
    estimated_laps_remaining: float | None = None
    required_fuel_to_finish: float | None = None
    fuel_delta_to_finish: float | None = None
    recommended_fuel_save_per_lap: float | None = None
    stint_laps_observed: int = 0
    confidence: str = "low"


class TyreStrategyState(BaseModel):
    average_wear: float | None = None
    wear_rate_per_lap: float | None = None
    estimated_remaining_tyre_life_laps: float | None = None
    pace_degradation_per_lap: float | None = None
    tyre_risk_level: str = "unknown"
    confidence: str = "low"
    observed_laps: int = 0
    laps_required: int = 3
    reason_codes: list[str] = Field(default_factory=list)


class StintState(BaseModel):
    current_stint_lap: int | None = None
    last_pit_lap: int | None = None
    fuel_limited_stint_end_lap: int | None = None
    tyre_limited_stint_end_lap: int | None = None
    recommended_stint_end_lap: int | None = None


class PitWindowState(BaseModel):
    earliest_viable_pit_lap: int | None = None
    latest_safe_pit_lap: int | None = None
    optimal_pit_lap: int | None = None
    traffic_risk_after_stop: str = "unknown"
    projected_rejoin_position: int | None = None
    undercut_targets: list[str] = Field(default_factory=list)
    overcut_targets: list[str] = Field(default_factory=list)
    safety_car_pit_recommendation: bool = False
    explanation: list[str] = Field(default_factory=list)


class StrategyState(BaseModel):
    fuel: FuelState = Field(default_factory=FuelState)
    tyres: TyreStrategyState = Field(default_factory=TyreStrategyState)
    stint: StintState = Field(default_factory=StintState)
    pit_window: PitWindowState = Field(default_factory=PitWindowState)
    assumptions: StrategyAssumptions = Field(default_factory=StrategyAssumptions)
