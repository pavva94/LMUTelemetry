from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class TyreTemps(BaseModel):
    left_c: float | None = None
    center_c: float | None = None
    right_c: float | None = None
    carcass_c: float | None = None


class TyreState(BaseModel):
    compound_front: str | None = None
    compound_rear: str | None = None
    wear_fl: float | None = None
    wear_fr: float | None = None
    wear_rl: float | None = None
    wear_rr: float | None = None
    pressure_fl: float | None = None
    pressure_fr: float | None = None
    pressure_rl: float | None = None
    pressure_rr: float | None = None
    load_fl: float | None = None
    load_fr: float | None = None
    load_rl: float | None = None
    load_rr: float | None = None
    temp_fl: TyreTemps | None = None
    temp_fr: TyreTemps | None = None
    temp_rl: TyreTemps | None = None
    temp_rr: TyreTemps | None = None
    average_wear: float | None = None
    average_temp_c: float | None = None


class HybridState(BaseModel):
    battery_percent: float | None = None
    virtual_energy_fraction: float | None = None
    regen_kw: float | None = None
    motor_state: str | None = None
    deploy_mode: str | None = None
    regen_active: bool | None = None


class PlayerState(BaseModel):
    vehicle_id: int | None = None
    vehicle_name: str | None = None
    vehicle_model: str | None = None
    vehicle_class: str | None = None
    position: int | None = None
    class_position: int | None = None
    lap_number: int | None = None
    current_sector: int | None = None
    current_lap_time: float | None = None
    last_lap_time: float | None = None
    best_lap_time: float | None = None
    delta_best: float | None = None
    speed_kph: float | None = None
    g_force_lat: float | None = None
    g_force_long: float | None = None
    g_force_vert: float | None = None
    gear: int | None = None
    rpm: float | None = None
    max_rpm: float | None = None
    engine_torque: float | None = None
    fuel_liters: float | None = None
    fuel_capacity_liters: float | None = None
    engine_oil_temp: float | None = None
    engine_water_temp: float | None = None
    throttle: float | None = None
    brake: float | None = None
    steering: float | None = None
    clutch: float | None = None
    speed_limiter: bool | None = None
    abs_active: bool | None = None
    tc_active: bool | None = None
    abs_setting: int | None = None
    abs_max: int | None = None
    tc_setting: int | None = None
    tc_max: int | None = None
    tc_slip_setting: int | None = None
    tc_cut_setting: int | None = None
    brake_temp_fl: float | None = None
    brake_temp_fr: float | None = None
    brake_temp_rl: float | None = None
    brake_temp_rr: float | None = None
    brake_pressure_fl: float | None = None
    brake_pressure_fr: float | None = None
    brake_pressure_rl: float | None = None
    brake_pressure_rr: float | None = None
    wheel_rot_speed_fl: float | None = None
    wheel_rot_speed_fr: float | None = None
    wheel_rot_speed_rl: float | None = None
    wheel_rot_speed_rr: float | None = None
    wheel_ground_speed_fl: float | None = None
    wheel_ground_speed_fr: float | None = None
    wheel_ground_speed_rl: float | None = None
    wheel_ground_speed_rr: float | None = None
    ride_height_fl: float | None = None
    ride_height_fr: float | None = None
    ride_height_rl: float | None = None
    ride_height_rr: float | None = None
    suspension_deflection_fl: float | None = None
    suspension_deflection_fr: float | None = None
    suspension_deflection_rl: float | None = None
    suspension_deflection_rr: float | None = None
    front_third_deflection: float | None = None
    rear_third_deflection: float | None = None
    front_ride_height: float | None = None
    rear_ride_height: float | None = None
    front_downforce: float | None = None
    rear_downforce: float | None = None
    drag: float | None = None
    finish_status: str | None = None
    track_limits_steps: int | None = None
    lap_invalidated: bool | None = None
    gap_car_ahead: float | None = None
    gap_car_behind: float | None = None
    gap_place_ahead: float | None = None
    gap_place_behind: float | None = None
    tyre_state: TyreState | None = None
    hybrid_state: HybridState | None = None


class SessionState(BaseModel):
    track_name: str | None = None
    session_type: str | None = None
    game_phase: str | None = None
    current_time: float | None = None
    end_time: float | None = None
    time_remaining: float | None = None
    max_laps: int | None = None
    num_vehicles: int | None = None
    yellow_flag_state: str | None = None
    sector_flags: list[int] = Field(default_factory=list)
    current_lap: int | None = None


class EnvironmentState(BaseModel):
    raining: float | None = None
    ambient_temp_c: float | None = None
    track_temp_c: float | None = None
    min_wetness: float | None = None
    max_wetness: float | None = None
    avg_wetness: float | None = None
    track_grip: float | None = None
    cloud_coverage: float | None = None


class CompetitorState(BaseModel):
    vehicle_id: int
    driver_name: str | None = None
    vehicle_name: str | None = None
    vehicle_model: str | None = None
    vehicle_class: str | None = None
    position: int | None = None
    class_position: int | None = None
    total_laps: int | None = None
    lap_distance: float | None = None
    best_lap_time: float | None = None
    last_lap_time: float | None = None
    estimated_lap_time: float | None = None
    finish_status: str | None = None
    pitstops: int | None = None
    in_pits: bool | None = None
    pit_state: str | None = None
    time_behind_leader: float | None = None
    time_behind_next: float | None = None
    laps_behind_leader: int | None = None
    gap_to_player: float | None = None
    fuel_fraction: float | None = None
    is_player: bool = False
    estimated_strategy_group: str | None = None
    threat_level: str | None = None


class TelemetrySnapshot(BaseModel):
    timestamp: datetime
    connected: bool
    feed_paused: bool = False
    pause_reason: str | None = None
    session: SessionState | None = None
    player: PlayerState | None = None
    competitors: list[CompetitorState] = Field(default_factory=list)
    environment: EnvironmentState | None = None
    strategy: Any | None = None
    message: str | None = None
