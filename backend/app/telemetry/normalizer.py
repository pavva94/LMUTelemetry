from __future__ import annotations

from math import sqrt
from typing import Any

from app.core.utils import average, decode_c_string, safe_float, utc_now
from app.schemas.telemetry import (
    CompetitorState,
    EnvironmentState,
    PlayerState,
    SessionState,
    TelemetrySnapshot,
    TyreState,
    TyreTemps,
)


def kelvin_to_celsius(value: float | None) -> float | None:
    if value is None:
        return None
    return value - 273.15 if value > 170 else value


def vector_speed_kph(vector: Any) -> float | None:
    try:
        x = float(getattr(vector, "x", vector[0]))
        y = float(getattr(vector, "y", vector[1]))
        z = float(getattr(vector, "z", vector[2]))
    except Exception:
        return None
    return sqrt(x * x + y * y + z * z) * 3.6


def attr(obj: Any, *names: str, default: Any = None) -> Any:
    for name in names:
        if hasattr(obj, name):
            return getattr(obj, name)
    return default


def normalize_lmu_snapshot(raw: Any) -> TelemetrySnapshot:
    scoring = attr(raw, "scoring", "mScoringInfo", default=raw)
    telemetry = attr(raw, "telemetry", "mTelemetryInfo", default=raw)
    vehicles = list(attr(scoring, "mVehicles", "vehicles", default=[]) or [])
    player_index = int(attr(scoring, "mPlayerVehScoringId", "mPlayerVehicleIndex", default=0) or 0)
    player_raw = vehicles[player_index] if 0 <= player_index < len(vehicles) else None
    competitors = [_normalize_competitor(v, idx == player_index) for idx, v in enumerate(vehicles[:104])]
    player = _normalize_player(player_raw, telemetry)
    session = SessionState(
        track_name=decode_c_string(attr(scoring, "mTrackName", default="")),
        session_type=str(attr(scoring, "mSession", default="Race")),
        game_phase=str(attr(scoring, "mGamePhase", default="unknown")),
        current_time=safe_float(attr(scoring, "mCurrentET", default=None)),
        end_time=safe_float(attr(scoring, "mEndET", default=None)),
        time_remaining=safe_float(attr(scoring, "mEndET", default=0)) - safe_float(attr(scoring, "mCurrentET", default=0)),
        max_laps=attr(scoring, "mMaxLaps", default=None),
        num_vehicles=len(competitors),
        yellow_flag_state=str(attr(scoring, "mYellowFlagState", default="unknown")),
        current_lap=player.lap_number if player else None,
    )
    environment = EnvironmentState(
        raining=safe_float(attr(scoring, "mRaining", default=None)),
        ambient_temp_c=kelvin_to_celsius(safe_float(attr(scoring, "mAmbientTemp", default=None))),
        track_temp_c=kelvin_to_celsius(safe_float(attr(scoring, "mTrackTemp", default=None))),
        avg_wetness=safe_float(attr(scoring, "mAvgPathWetness", default=None)),
        cloud_coverage=safe_float(attr(scoring, "mCloudiness", default=None)),
    )
    return TelemetrySnapshot(
        timestamp=utc_now(),
        connected=player is not None,
        session=session,
        player=player,
        competitors=competitors,
        environment=environment,
        message=None if player is not None else "No player vehicle found",
    )


def _normalize_player(vehicle: Any, telemetry: Any) -> PlayerState | None:
    if vehicle is None:
        return None
    tyres = _normalize_tyres(vehicle, telemetry)
    return PlayerState(
        vehicle_id=attr(vehicle, "mID", "mVehicleID", default=0),
        vehicle_name=decode_c_string(attr(vehicle, "mVehicleName", default="")),
        vehicle_class=decode_c_string(attr(vehicle, "mVehicleClass", default="")),
        position=attr(vehicle, "mPlace", default=None),
        class_position=attr(vehicle, "mClassPosition", default=None),
        lap_number=attr(vehicle, "mTotalLaps", default=None),
        current_sector=attr(vehicle, "mSector", default=None),
        speed_kph=vector_speed_kph(attr(vehicle, "mLocalVel", "mVel", default=None)),
        gear=attr(telemetry, "mGear", default=None),
        rpm=safe_float(attr(telemetry, "mEngineRPM", default=None)),
        fuel_liters=safe_float(attr(telemetry, "mFuel", default=None)),
        fuel_capacity_liters=safe_float(attr(telemetry, "mFuelCapacity", default=None)),
        throttle=safe_float(attr(telemetry, "mUnfilteredThrottle", "mThrottle", default=None)),
        brake=safe_float(attr(telemetry, "mUnfilteredBrake", "mBrake", default=None)),
        steering=safe_float(attr(telemetry, "mUnfilteredSteering", "mSteering", default=None)),
        track_limits_steps=attr(vehicle, "mCutTrackWarnings", default=None),
        lap_invalidated=bool(attr(vehicle, "mLapInvalidated", default=False)),
        gap_car_ahead=safe_float(attr(vehicle, "mTimeBehindNext", default=None)),
        gap_car_behind=safe_float(attr(vehicle, "mTimeBehindPrev", default=None)),
        tyre_state=tyres,
    )


def _normalize_tyres(vehicle: Any, telemetry: Any) -> TyreState:
    wear = list(attr(telemetry, "mWear", default=[]) or [])
    temps = list(attr(telemetry, "mTireTemp", "mTyreTemp", default=[]) or [])
    pressures = list(attr(telemetry, "mPressure", default=[]) or [])
    def item(values: list, index: int) -> float | None:
        return safe_float(values[index]) if index < len(values) else None
    temp_values = [kelvin_to_celsius(item(temps, i)) for i in range(4)]
    return TyreState(
        compound_front=decode_c_string(attr(vehicle, "mFrontTireCompoundName", default="")),
        compound_rear=decode_c_string(attr(vehicle, "mRearTireCompoundName", default="")),
        wear_fl=item(wear, 0),
        wear_fr=item(wear, 1),
        wear_rl=item(wear, 2),
        wear_rr=item(wear, 3),
        pressure_fl=item(pressures, 0),
        pressure_fr=item(pressures, 1),
        pressure_rl=item(pressures, 2),
        pressure_rr=item(pressures, 3),
        temp_fl=TyreTemps(center_c=temp_values[0]),
        temp_fr=TyreTemps(center_c=temp_values[1]),
        temp_rl=TyreTemps(center_c=temp_values[2]),
        temp_rr=TyreTemps(center_c=temp_values[3]),
        average_wear=average([item(wear, i) for i in range(4)]),
        average_temp_c=average(temp_values),
    )


def _normalize_competitor(vehicle: Any, is_player: bool) -> CompetitorState:
    return CompetitorState(
        vehicle_id=int(attr(vehicle, "mID", "mVehicleID", default=0) or 0),
        driver_name=decode_c_string(attr(vehicle, "mDriverName", default="")),
        vehicle_name=decode_c_string(attr(vehicle, "mVehicleName", default="")),
        vehicle_class=decode_c_string(attr(vehicle, "mVehicleClass", default="")),
        position=attr(vehicle, "mPlace", default=None),
        class_position=attr(vehicle, "mClassPosition", default=None),
        total_laps=attr(vehicle, "mTotalLaps", default=None),
        lap_distance=safe_float(attr(vehicle, "mLapDist", default=None)),
        best_lap_time=safe_float(attr(vehicle, "mBestLapTime", default=None)),
        last_lap_time=safe_float(attr(vehicle, "mLastLapTime", default=None)),
        estimated_lap_time=safe_float(attr(vehicle, "mBestLapTime", default=None)),
        pitstops=attr(vehicle, "mNumPitstops", default=None),
        in_pits=bool(attr(vehicle, "mInPits", default=False)),
        pit_state=str(attr(vehicle, "mPitState", default="unknown")),
        time_behind_leader=safe_float(attr(vehicle, "mTimeBehindLeader", default=None)),
        time_behind_next=safe_float(attr(vehicle, "mTimeBehindNext", default=None)),
        laps_behind_leader=attr(vehicle, "mLapsBehindLeader", default=None),
        is_player=is_player,
    )
