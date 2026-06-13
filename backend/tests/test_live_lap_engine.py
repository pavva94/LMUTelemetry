from __future__ import annotations

import pytest

from app.analysis.live_lap_engine import VehicleAnalysisConfig, analyze_lap, analysis_payload, is_valid_lap, LiveLapBuffer, normalize_snapshot
from app.schemas.telemetry import PlayerState, SessionState, TelemetrySnapshot
from app.core.utils import utc_now


def make_lap(
    *,
    lap_number: int = 3,
    brake_ramp: float = 0.3,
    rear_slip: bool = False,
    coasting: bool = False,
    invalidated: bool = False,
    in_pits: bool = False,
    yellow: bool = False,
) -> list[dict]:
    rows = []
    dt = 0.1
    duration = 50.0
    for index in range(int(duration / dt) + 1):
        t = round(index * dt, 3)
        in_corner = 10 <= t <= 18
        entry = 10 <= t <= 11
        brake = 0.0
        if 10 <= t <= 10 + brake_ramp:
            brake = ((t - 10) / brake_ramp) * 100
        elif 10 + brake_ramp < t <= 12:
            brake = 100 - (t - (10 + brake_ramp)) * 45
        throttle = 0.0 if in_corner else 85.0
        if 15 <= t <= 17:
            throttle = 55.0
        if coasting and 12.2 <= t <= 12.5:
            brake = 0.0
            throttle = 0.0
        steering = 0.0
        if in_corner:
            steering = min(1.0, max(0.0, (t - 10) / 3.0)) * 0.7
        if t > 14:
            steering = max(0.0, 0.7 - (t - 14) * 0.12)
        speed = 260.0 if not in_corner else 250 - min(max(t - 10, 0), 4) * 25 + max(t - 14, 0) * 12
        rear_factor = 1.14 if rear_slip and 16 <= t <= 17 else 1.0
        lat_g = 1.4 if in_corner else 0.05
        if t >= 15:
            lat_g = 0.3
        rows.append({
            "timestamp": t,
            "lap_time": t,
            "lap_number": lap_number,
            "current_sector": min(3, int(t / (duration / 3)) + 1),
            "speed_kph": speed,
            "brake_pct": brake,
            "throttle_pct": throttle,
            "steering_angle": steering,
            "g_force_lat": lat_g,
            "g_force_long": -1.4 if entry else 0.1,
            "lap_invalidated": invalidated,
            "in_pits": in_pits,
            "yellow_flag": yellow,
            "wheel_speed_fl_kph": speed,
            "wheel_speed_fr_kph": speed,
            "wheel_speed_rl_kph": speed * rear_factor,
            "wheel_speed_rr_kph": speed * rear_factor,
            "ride_height_fl_mm": 30.0,
            "ride_height_fr_mm": 31.0,
            "ride_height_rl_mm": 50.0,
            "ride_height_rr_mm": 50.0,
            "suspension_deflection_fl_mm": 50.0,
            "suspension_deflection_fr_mm": 50.0,
            "suspension_deflection_rl_mm": 45.0,
            "suspension_deflection_rr_mm": 45.0,
            "tyre_pressure_fl": 26.0,
            "tyre_temp_fl_inner": 100.0,
            "tyre_temp_fl_center": 101.0,
            "tyre_temp_fl_outer": 99.0,
        })
    return rows


def messages(result: dict) -> list[str]:
    return [item["message"] for item in result["insights"]]


def test_valid_lap_filter_rejects_invalid_sources() -> None:
    config = VehicleAnalysisConfig(poll_hz=10)
    assert is_valid_lap(make_lap(), config)
    assert not is_valid_lap(make_lap(invalidated=True), config)
    assert not is_valid_lap(make_lap(in_pits=True), config)
    assert not is_valid_lap(make_lap(yellow=True), config)
    assert not is_valid_lap(make_lap()[:20], config)


def test_brake_ramp_and_coasting_thresholds_are_strict() -> None:
    config = VehicleAnalysisConfig(poll_hz=10)
    slow = analyze_lap(make_lap(brake_ramp=0.6, coasting=True), make_lap(lap_number=2), config)
    assert any("Initial brake application is too slow" in message for message in messages(slow))
    assert any("Excessive coasting" in message for message in messages(slow))

    threshold = analyze_lap(make_lap(brake_ramp=0.25), make_lap(lap_number=2), config)
    assert not any("Initial brake application is too slow" in message for message in messages(threshold))


def test_rear_slip_threshold_and_corner_numbering() -> None:
    config = VehicleAnalysisConfig(poll_hz=10)
    result = analyze_lap(make_lap(rear_slip=True), make_lap(lap_number=2), config)
    assert result["corners"][0]["label"] == "Turn 1"
    assert any("Severe rear traction loss" in message for message in messages(result))


def test_payload_uses_fastest_valid_lap_as_reference() -> None:
    config = VehicleAnalysisConfig(poll_hz=10)
    buffer = LiveLapBuffer(config)
    buffer._completed[1] = make_lap(lap_number=1)
    faster = make_lap(lap_number=2)
    faster[-1]["lap_time"] = 45.0
    buffer._completed[2] = faster
    payload = analysis_payload(buffer, config)
    assert payload["reference_lap_number"] == 2
    assert payload["selected_lap_number"] == 2


def test_live_snapshot_treats_null_byte_yellow_flag_as_clear() -> None:
    snapshot = TelemetrySnapshot(
        timestamp=utc_now(),
        connected=True,
        session=SessionState(current_time=12.0, yellow_flag_state="b'\\x00'"),
        player=PlayerState(lap_number=1, current_lap_time=12.0, rpm=6000.0, engine_torque=500.0),
    )

    row = normalize_snapshot(snapshot, VehicleAnalysisConfig())

    assert row is not None
    assert row["yellow_flag"] is False
    assert row["rpm"] == 6000.0
    assert row["engine_torque_nm"] == 500.0
    assert row["power_kw"] == pytest.approx(314.159, rel=0.001)
    assert row["power_hp"] == pytest.approx(421.2, rel=0.001)
