from __future__ import annotations

from math import sqrt
from typing import Any

from app.core.utils import average, decode_c_string, safe_float, utc_now
from app.schemas.telemetry import (
    CompetitorState,
    EnvironmentState,
    HybridState,
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
        6: "Qualifying 2",
        7: "Qualifying 3",
        8: "Qualifying 4",
        9: "Warmup",
        10: "Race",
        11: "Race 2",
        12: "Race 3",
        13: "Race 4",
    }
    try:
        numeric = int(value)
        return names.get(numeric, str(value))
    except Exception:
        return str(value or "Unknown")


def finish_status_name(value: Any) -> str | None:
    names = {0: None, 1: "finished", 2: "dnf", 3: "dq"}
    try:
        numeric = int(value)
        return names.get(numeric, str(value))
    except Exception:
        return None


def motor_state_name(value: Any) -> str | None:
    names = {0: "unavailable", 1: "inactive", 2: "propulsion", 3: "regeneration"}
    try:
        return names.get(int(value), str(value))
    except Exception:
        return None


def bounded_fraction(value: float | None) -> float | None:
    if value is None:
        return None
    return max(0.0, min(1.0, value))


def positive_channel(value: float | None, minimum: float = 0.0) -> float | None:
    return value if value is not None and value > minimum else None


def tyre_wear_used_fraction(value: Any) -> float | None:
    remaining = safe_float(value)
    if remaining is None:
        return None
    if 0 <= remaining <= 1:
        return 1.0 - remaining
    if 1 < remaining <= 100:
        return 1.0 - (remaining / 100.0)
    return None


def completed_lap_time(value: Any) -> float | None:
    lap_time = safe_float(value)
    return lap_time if lap_time is not None and 20.0 <= lap_time <= 1200.0 else None


def race_gap(value: Any) -> float | None:
    gap = safe_float(value)
    return gap if gap is not None and 0.0 <= gap <= 86400.0 else None


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
    competitors = [
        _normalize_competitor(v, telem_info[idx] if telem_info is not None and idx < len(telem_info) else None, idx == player_index)
        for idx, v in enumerate(vehicles[:104])
    ]
    _apply_gap_context(competitors)
    player = _normalize_player(player_raw, player_telemetry)
    _apply_player_gap_context(player, competitors)
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
    def accel_g(axis: str) -> float | None:
        value = safe_float(attr(attr(telemetry, "mLocalAccel", default=None), axis, default=None))
        return value / 9.80665 if value is not None else None
    elapsed = safe_float(attr(telemetry, "mElapsedTime", default=None))
    lap_start = safe_float(attr(telemetry, "mLapStartET", default=None))
    current_lap_time = elapsed - lap_start if elapsed is not None and lap_start is not None and elapsed >= lap_start else None

    battery_fraction = safe_float(attr(telemetry, "mBatteryChargeFraction", default=None))
    state_of_charge = safe_float(attr(telemetry, "mStateOfCharge", default=None))
    virtual_energy = bounded_fraction(safe_float(attr(telemetry, "mVirtualEnergy", default=None)))
    regen_kw = safe_float(attr(telemetry, "mRegen", default=None))
    motor_state = motor_state_name(attr(telemetry, "mElectricBoostMotorState", default=None))
    return PlayerState(
        vehicle_id=attr(vehicle, "mID", "mVehicleID", default=0),
        vehicle_name=decode_c_string(attr(vehicle, "mVehicleName", default="")),
        vehicle_model=decode_c_string(attr(telemetry, "mVehicleModel", default="")),
        vehicle_class=decode_c_string(attr(vehicle, "mVehicleClass", default="")),
        position=attr(vehicle, "mPlace", default=None),
        class_position=attr(vehicle, "mClassPosition", default=None),
        lap_number=attr(vehicle, "mTotalLaps", default=None),
        current_sector=attr(telemetry, "mCurrentSector", default=attr(vehicle, "mSector", default=None)),
        current_lap_time=current_lap_time,
        last_lap_time=completed_lap_time(attr(vehicle, "mLastLapTime", default=None)),
        best_lap_time=completed_lap_time(attr(vehicle, "mBestLapTime", default=None)),
        delta_best=safe_float(attr(telemetry, "mDeltaBest", default=None)),
        speed_kph=vector_speed_kph(attr(vehicle, "mLocalVel", "mVel", default=None)),
        g_force_lat=accel_g("x"),
        g_force_long=accel_g("z"),
        g_force_vert=accel_g("y"),
        gear=attr(telemetry, "mGear", default=None),
        rpm=safe_float(attr(telemetry, "mEngineRPM", default=None)),
        max_rpm=safe_float(attr(telemetry, "mEngineMaxRPM", default=None)),
        engine_torque=safe_float(attr(telemetry, "mEngineTorque", default=None)),
        fuel_liters=safe_float(attr(telemetry, "mFuel", default=None)),
        fuel_capacity_liters=safe_float(attr(telemetry, "mFuelCapacity", default=None)),
        engine_oil_temp=safe_float(attr(telemetry, "mEngineOilTemp", default=None)),
        engine_water_temp=safe_float(attr(telemetry, "mEngineWaterTemp", default=None)),
        throttle=safe_float(attr(telemetry, "mUnfilteredThrottle", "mThrottle", default=None)),
        brake=safe_float(attr(telemetry, "mUnfilteredBrake", "mBrake", default=None)),
        steering=safe_float(attr(telemetry, "mUnfilteredSteering", "mSteering", default=None)),
        clutch=safe_float(attr(telemetry, "mUnfilteredClutch", "mClutch", default=None)),
        speed_limiter=bool(attr(telemetry, "mSpeedLimiter", default=False)),
        abs_active=bool(attr(telemetry, "mABSActive", default=False)),
        tc_active=bool(attr(telemetry, "mTCActive", default=False)),
        abs_setting=attr(telemetry, "mABS", default=None),
        abs_max=attr(telemetry, "mABSMax", default=None),
        tc_setting=attr(telemetry, "mTC", default=None),
        tc_max=attr(telemetry, "mTCMax", default=None),
        tc_slip_setting=attr(telemetry, "mTCSlip", default=None),
        tc_cut_setting=attr(telemetry, "mTCCut", default=None),
        brake_temp_fl=wheel_value(0, "mBrakeTemp"),
        brake_temp_fr=wheel_value(1, "mBrakeTemp"),
        brake_temp_rl=wheel_value(2, "mBrakeTemp"),
        brake_temp_rr=wheel_value(3, "mBrakeTemp"),
        brake_pressure_fl=wheel_value(0, "mBrakePressure"),
        brake_pressure_fr=wheel_value(1, "mBrakePressure"),
        brake_pressure_rl=wheel_value(2, "mBrakePressure"),
        brake_pressure_rr=wheel_value(3, "mBrakePressure"),
        wheel_rot_speed_fl=wheel_value(0, "mRotation"),
        wheel_rot_speed_fr=wheel_value(1, "mRotation"),
        wheel_rot_speed_rl=wheel_value(2, "mRotation"),
        wheel_rot_speed_rr=wheel_value(3, "mRotation"),
        wheel_ground_speed_fl=wheel_value(0, "mLongitudinalGroundVel"),
        wheel_ground_speed_fr=wheel_value(1, "mLongitudinalGroundVel"),
        wheel_ground_speed_rl=wheel_value(2, "mLongitudinalGroundVel"),
        wheel_ground_speed_rr=wheel_value(3, "mLongitudinalGroundVel"),
        ride_height_fl=wheel_value(0, "mRideHeight"),
        ride_height_fr=wheel_value(1, "mRideHeight"),
        ride_height_rl=wheel_value(2, "mRideHeight"),
        ride_height_rr=wheel_value(3, "mRideHeight"),
        suspension_deflection_fl=wheel_value(0, "mSuspensionDeflection"),
        suspension_deflection_fr=wheel_value(1, "mSuspensionDeflection"),
        suspension_deflection_rl=wheel_value(2, "mSuspensionDeflection"),
        suspension_deflection_rr=wheel_value(3, "mSuspensionDeflection"),
        front_third_deflection=safe_float(attr(telemetry, "mFront3rdDeflection", default=None)),
        rear_third_deflection=safe_float(attr(telemetry, "mRear3rdDeflection", default=None)),
        front_ride_height=safe_float(attr(telemetry, "mFrontRideHeight", default=None)),
        rear_ride_height=safe_float(attr(telemetry, "mRearRideHeight", default=None)),
        front_downforce=safe_float(attr(telemetry, "mFrontDownforce", default=None)),
        rear_downforce=safe_float(attr(telemetry, "mRearDownforce", default=None)),
        drag=safe_float(attr(telemetry, "mDrag", default=None)),
        finish_status=finish_status_name(attr(telemetry, "mFinishStatus", default=None)),
        track_limits_steps=attr(vehicle, "mCutTrackWarnings", default=None),
        lap_invalidated=bool(attr(vehicle, "mLapInvalidated", default=False)),
        gap_car_ahead=race_gap(attr(vehicle, "mTimeBehindNext", default=None)),
        gap_car_behind=race_gap(attr(vehicle, "mTimeBehindPrev", default=None)),
        tyre_state=tyres,
        hybrid_state=HybridState(
            battery_percent=state_of_charge if state_of_charge is not None else (battery_fraction * 100 if battery_fraction is not None else None),
            virtual_energy_fraction=virtual_energy,
            regen_kw=regen_kw,
            motor_state=motor_state,
            regen_active=(regen_kw is not None and regen_kw > 0) or motor_state == "regeneration",
        ),
    )


def _normalize_tyres(vehicle: Any, telemetry: Any) -> TyreState:
    wear = list(attr(telemetry, "mWear", default=[]) or [])
    temps = list(attr(telemetry, "mTireTemp", "mTyreTemp", default=[]) or [])
    pressures = list(attr(telemetry, "mPressure", default=[]) or [])
    wheels = list(attr(telemetry, "mWheels", default=[]) or [])
    def item(values: list, index: int) -> float | None:
        return safe_float(values[index]) if index < len(values) else None
    def raw_wheel_value(index: int, name: str) -> float | None:
        return safe_float(attr(wheels[index], name, default=None)) if index < len(wheels) else None
    def wheel_value(index: int, name: str, minimum: float = 0.0) -> float | None:
        value = raw_wheel_value(index, name)
        return positive_channel(value, minimum)
    def wheel_array(index: int, *names: str) -> list[float | None]:
        raw = []
        if index < len(wheels):
            for name in names:
                raw = attr(wheels[index], name, default=[])
                if raw:
                    break
        return [kelvin_to_celsius(safe_float(value)) for value in list(raw or [])[:3]]
    def wear_value(index: int) -> float | None:
        value = item(wear, index) if wear else raw_wheel_value(index, "mWear")
        return tyre_wear_used_fraction(value)
    def pressure_value(index: int) -> float | None:
        value = item(pressures, index) if pressures else wheel_value(index, "mPressure")
        return positive_channel(value, 0.01)
    def temp_value(index: int) -> TyreTemps:
        if temps:
            return TyreTemps(center_c=positive_channel(kelvin_to_celsius(item(temps, index)), 0.01))
        inner = [positive_channel(value, 0.01) for value in wheel_array(index, "mTireInnerLayerTemperature", "mTemperature")]
        carcass = positive_channel(kelvin_to_celsius(wheel_value(index, "mTireCarcassTemperature")), 0.01)
        return TyreTemps(left_c=inner[0] if len(inner) > 0 else None, center_c=inner[1] if len(inner) > 1 else None, right_c=inner[2] if len(inner) > 2 else None, carcass_c=carcass)
    temp_states = [temp_value(i) for i in range(4)]
    temp_values = [state.center_c if state.center_c is not None else state.carcass_c for state in temp_states]
    return TyreState(
        compound_front=decode_c_string(attr(telemetry, "mFrontTireCompoundName", default="")),
        compound_rear=decode_c_string(attr(telemetry, "mRearTireCompoundName", default="")),
        wear_fl=wear_value(0),
        wear_fr=wear_value(1),
        wear_rl=wear_value(2),
        wear_rr=wear_value(3),
        pressure_fl=pressure_value(0),
        pressure_fr=pressure_value(1),
        pressure_rl=pressure_value(2),
        pressure_rr=pressure_value(3),
        load_fl=wheel_value(0, "mTireLoad", 0.01),
        load_fr=wheel_value(1, "mTireLoad", 0.01),
        load_rl=wheel_value(2, "mTireLoad", 0.01),
        load_rr=wheel_value(3, "mTireLoad", 0.01),
        temp_fl=temp_states[0],
        temp_fr=temp_states[1],
        temp_rl=temp_states[2],
        temp_rr=temp_states[3],
        average_wear=average([wear_value(i) for i in range(4)]),
        average_temp_c=average(temp_values),
    )


def _normalize_competitor(vehicle: Any, telemetry: Any, is_player: bool) -> CompetitorState:
    return CompetitorState(
        vehicle_id=int(attr(vehicle, "mID", "mVehicleID", default=0) or 0),
        driver_name=decode_c_string(attr(vehicle, "mDriverName", default="")),
        vehicle_name=decode_c_string(attr(vehicle, "mVehicleName", default="")),
        vehicle_model=decode_c_string(attr(telemetry, "mVehicleModel", default="")) if telemetry is not None else None,
        vehicle_class=decode_c_string(attr(vehicle, "mVehicleClass", default="")),
        position=attr(vehicle, "mPlace", default=None),
        class_position=attr(vehicle, "mClassPosition", default=None),
        total_laps=attr(vehicle, "mTotalLaps", default=None),
        lap_distance=safe_float(attr(vehicle, "mLapDist", default=None)),
        best_lap_time=completed_lap_time(attr(vehicle, "mBestLapTime", default=None)),
        last_lap_time=completed_lap_time(attr(vehicle, "mLastLapTime", default=None)),
        estimated_lap_time=completed_lap_time(attr(vehicle, "mEstimatedLapTime", default=None)),
        finish_status=finish_status_name(attr(vehicle, "mFinishStatus", default=None)),
        pitstops=attr(vehicle, "mNumPitstops", default=None),
        in_pits=bool(attr(vehicle, "mInPits", default=False)),
        pit_state=str(attr(vehicle, "mPitState", default="unknown")),
        time_behind_leader=race_gap(attr(vehicle, "mTimeBehindLeader", default=None)),
        time_behind_next=race_gap(attr(vehicle, "mTimeBehindNext", default=None)),
        laps_behind_leader=attr(vehicle, "mLapsBehindLeader", default=None),
        fuel_fraction=bounded_fraction((safe_float(attr(vehicle, "mFuelFraction", default=None)) or 0) / 255) if attr(vehicle, "mFuelFraction", default=None) is not None else None,
        is_player=is_player,
    )


def _apply_gap_context(competitors: list[CompetitorState]) -> None:
    player = next((car for car in competitors if car.is_player), None)
    if player is None:
        return
    player_leader_gap = player.time_behind_leader or 0.0
    player_position = player.position
    for car in competitors:
        if car.is_player:
            car.gap_to_player = 0.0
        elif car.time_behind_leader is not None and player.time_behind_leader is not None:
            car.gap_to_player = car.time_behind_leader - player_leader_gap
        elif player_position is not None and car.position is not None:
            if car.position == player_position - 1:
                car.gap_to_player = -player.time_behind_next if player.time_behind_next is not None else None
            elif car.position == player_position + 1:
                car.gap_to_player = car.time_behind_next


def _apply_player_gap_context(player: PlayerState | None, competitors: list[CompetitorState]) -> None:
    if player is None:
        return
    player_car = next((car for car in competitors if car.is_player), None)
    player_position = player_car.position if player_car else player.position
    if player_position is None:
        return
    ahead = next((car for car in competitors if car.position == player_position - 1), None)
    behind = next((car for car in competitors if car.position == player_position + 1), None)
    if ahead and ahead.gap_to_player is not None:
        player.gap_car_ahead = abs(ahead.gap_to_player)
    if behind and behind.gap_to_player is not None:
        player.gap_car_behind = abs(behind.gap_to_player)
