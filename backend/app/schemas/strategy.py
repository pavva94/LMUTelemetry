from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class StrategyAssumptions(BaseModel):
    pit_loss_seconds: float = 28.0
    pit_stationary_seconds: float = 12.0
    tyre_change_seconds_per_tyre: float = 3.0
    refuel_seconds_per_5_liters: float = 1.2
    race_start_fuel_liters: float = 90.0
    race_start_new_tyres: bool = True
    safety_car_pit_loss_seconds: float = 16.0
    fuel_safety_margin_liters: float = 2.0
    fuel_safety_margin_laps: float = 1.0
    max_tyre_wear: float = 0.75
    max_tyres_available: int = Field(default=24, ge=4, le=200)
    lift_coast_mode: Literal["inferred", "fixed"] = "fixed"
    lift_coast_target_percent: float = Field(default=3.0, ge=0.5, le=12)
    normal_lap_time: float = 214.0
    race_duration_minutes: float = 120.0


class FuelState(BaseModel):
    last_lap_fuel_used_liters: float | None = None
    fuel_capacity_liters: float | None = None
    fuel_per_lap_liters: float | None = None
    fuel_use_stddev_liters: float | None = None
    fuel_laps_remaining: float | None = None
    estimated_laps_remaining: float | None = None
    required_fuel_to_finish: float | None = None
    fuel_delta_to_finish: float | None = None
    recommended_fuel_save_per_lap: float | None = None
    valid_laps_observed: int = 0
    valid_laps_required: int = 3
    confidence: str = "low"
    reason_codes: list[str] = Field(default_factory=list)


class EnergyState(BaseModel):
    current_virtual_energy_fraction: float | None = None
    last_lap_virtual_energy_used: float | None = None
    virtual_energy_per_lap: float | None = None
    virtual_energy_use_stddev: float | None = None
    virtual_energy_laps_remaining: float | None = None
    full_virtual_energy_stint_laps: float | None = None
    required_virtual_energy_to_finish: float | None = None
    virtual_energy_delta_to_finish: float | None = None
    fuel_to_virtual_energy_ratio: float | None = None
    valid_laps_observed: int = 0
    valid_laps_required: int = 3
    confidence: str = "low"
    reason_codes: list[str] = Field(default_factory=list)


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


class PaceState(BaseModel):
    last_lap_time: float | None = None
    last_7_lap_average: float | None = None
    last_10_lap_average: float | None = None
    weighted_recent_pace: float | None = None
    pace_trend_seconds_per_lap: float | None = None
    pace_degradation_per_lap: float | None = None
    sample_laps: int = 0
    confidence: str = "low"
    reason_codes: list[str] = Field(default_factory=list)


class StintState(BaseModel):
    current_stint_lap: int | None = None
    last_pit_lap: int | None = None
    fuel_limited_stint_end_lap: int | None = None
    virtual_energy_limited_stint_end_lap: int | None = None
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
    energy: EnergyState = Field(default_factory=EnergyState)
    tyres: TyreStrategyState = Field(default_factory=TyreStrategyState)
    pace: PaceState = Field(default_factory=PaceState)
    stint: StintState = Field(default_factory=StintState)
    pit_window: PitWindowState = Field(default_factory=PitWindowState)
    assumptions: StrategyAssumptions = Field(default_factory=StrategyAssumptions)
