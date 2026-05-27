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
        x = float(getattr(vector, "x") if hasattr(vector, "x") else vector[0])
        y = float(getattr(vector, "y") if hasattr(vector, "y") else vector[1])
        z = float(getattr(vector, "z") if hasattr(vector, "z") else vector[2])
    except Exception:
        return None
    return sqrt(x * x + y * y + z * z) * 3.6


def session_type_name(value: Any) -> str:
    names = {
        0: "Test Day",
        1: "Practice",
        2: "Practice 2",
        3: "Practice 3",
        4: "Practice 4",
        5: "Qualifying",
        6: "Warmup",
        7: "Race",
    }
    try:
        numeric = int(value)
        return names.get(numeric, str(value))
    except Exception:
        return str(value or "Unknown")


def attr(obj: Any, *names: str, default: Any = None) -> Any:
    for name in names:
        if hasattr(obj, name):
            return getattr(obj, name)
    return default


def normalize_lmu_snapshot(raw: Any) -> TelemetrySnapshot:
    scoring_data = attr(raw, "scoring", "mScoringData", default=raw)
    scoring = attr(scoring_data, "scoringInfo", "mScoringInfo", default=scoring_data)
    telemetry_data = attr(raw, "telemetry", "mTelemetryData", default=raw)
    vehicle_count = attr(scoring, "mNumVehicles", default=None)
    vehicles_source = attr(scoring_data, "vehScoringInfo", "mVehicles", "vehicles", default=[]) or []
    vehicles = list(vehicles_source)
    if vehicle_count is not None:
        vehicles = vehicles[: int(vehicle_count or 0)]
    player_index = int(
        attr(
            telemetry_data,
            "playerVehicleIdx",
            "mPlayerVehScoringId",
            "mPlayerVehicleIndex",
            default=attr(scoring, "mPlayerVehScoringId", "mPlayerVehicleIndex", default=0),
        )
        or 0
    )
    player_raw = vehicles[player_index] if 0 <= player_index < len(vehicles) else None
    telem_info = attr(telemetry_data, "telemInfo", default=None)
    player_telemetry = telem_info[player_index] if telem_info is not None and 0 <= player_index < len(telem_info) else telemetry_data
    competitors = [_normalize_competitor(v, idx == player_index) for idx, v in enumerate(vehicles[:104])]
    player = _normalize_player(player_raw, player_telemetry)
    session = SessionState(
        track_name=decode_c_string(attr(scoring, "mTrackName", default="")),
        session_type=session_type_name(attr(scoring, "mSession", default="Race")),
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
    wheels = list(attr(telemetry, "mWheels", default=[]) or [])
    def wheel_value(index: int, name: str) -> float | None:
        return safe_float(attr(wheels[index], name, default=None)) if index < len(wheels) else None

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
        clutch=safe_float(attr(telemetry, "mUnfilteredClutch", "mClutch", default=None)),
        speed_limiter=bool(attr(telemetry, "mSpeedLimiter", default=False)),
        brake_temp_fl=wheel_value(0, "mBrakeTemp"),
        brake_temp_fr=wheel_value(1, "mBrakeTemp"),
        brake_temp_rl=wheel_value(2, "mBrakeTemp"),
        brake_temp_rr=wheel_value(3, "mBrakeTemp"),
        brake_pressure_fl=wheel_value(0, "mBrakePressure"),
        brake_pressure_fr=wheel_value(1, "mBrakePressure"),
        brake_pressure_rl=wheel_value(2, "mBrakePressure"),
        brake_pressure_rr=wheel_value(3, "mBrakePressure"),
        ride_height_fl=wheel_value(0, "mRideHeight"),
        ride_height_fr=wheel_value(1, "mRideHeight"),
        ride_height_rl=wheel_value(2, "mRideHeight"),
        ride_height_rr=wheel_value(3, "mRideHeight"),
        suspension_deflection_fl=wheel_value(0, "mSuspensionDeflection"),
        suspension_deflection_fr=wheel_value(1, "mSuspensionDeflection"),
        suspension_deflection_rl=wheel_value(2, "mSuspensionDeflection"),
        suspension_deflection_rr=wheel_value(3, "mSuspensionDeflection"),
        front_ride_height=safe_float(attr(telemetry, "mFrontRideHeight", default=None)),
        rear_ride_height=safe_float(attr(telemetry, "mRearRideHeight", default=None)),
        front_downforce=safe_float(attr(telemetry, "mFrontDownforce", default=None)),
        rear_downforce=safe_float(attr(telemetry, "mRearDownforce", default=None)),
        drag=safe_float(attr(telemetry, "mDrag", default=None)),
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
    wheels = list(attr(telemetry, "mWheels", default=[]) or [])
    def item(values: list, index: int) -> float | None:
        return safe_float(values[index]) if index < len(values) else None
    def wheel_value(index: int, name: str) -> float | None:
        return safe_float(attr(wheels[index], name, default=None)) if index < len(wheels) else None
    def wheel_array(index: int, name: str) -> list[float | None]:
        raw = attr(wheels[index], name, default=[]) if index < len(wheels) else []
        return [kelvin_to_celsius(safe_float(value)) for value in list(raw or [])[:3]]
    def wear_value(index: int) -> float | None:
        return item(wear, index) if wear else wheel_value(index, "mWear")
    def pressure_value(index: int) -> float | None:
        return item(pressures, index) if pressures else wheel_value(index, "mPressure")
    def temp_value(index: int) -> TyreTemps:
        if temps:
            return TyreTemps(center_c=kelvin_to_celsius(item(temps, index)))
        inner = wheel_array(index, "mTireInnerLayerTemperature")
        carcass = kelvin_to_celsius(wheel_value(index, "mTireCarcassTemperature"))
        return TyreTemps(left_c=inner[0] if len(inner) > 0 else None, center_c=inner[1] if len(inner) > 1 else None, right_c=inner[2] if len(inner) > 2 else None, carcass_c=carcass)
    temp_states = [temp_value(i) for i in range(4)]
    temp_values = [state.center_c if state.center_c is not None else state.carcass_c for state in temp_states]
    return TyreState(
        compound_front=decode_c_string(attr(vehicle, "mFrontTireCompoundName", default="")),
        compound_rear=decode_c_string(attr(vehicle, "mRearTireCompoundName", default="")),
        wear_fl=wear_value(0),
        wear_fr=wear_value(1),
        wear_rl=wear_value(2),
        wear_rr=wear_value(3),
        pressure_fl=pressure_value(0),
        pressure_fr=pressure_value(1),
        pressure_rl=pressure_value(2),
        pressure_rr=pressure_value(3),
        load_fl=wheel_value(0, "mTireLoad"),
        load_fr=wheel_value(1, "mTireLoad"),
        load_rl=wheel_value(2, "mTireLoad"),
        load_rr=wheel_value(3, "mTireLoad"),
        temp_fl=temp_states[0],
        temp_fr=temp_states[1],
        temp_rl=temp_states[2],
        temp_rr=temp_states[3],
        average_wear=average([wear_value(i) for i in range(4)]),
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
