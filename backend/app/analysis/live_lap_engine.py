from __future__ import annotations

import math
import statistics
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any

from app.analysis.lap_quality import apply_lap_quality
from app.schemas.telemetry import TelemetrySnapshot


WHEELS = ("fl", "fr", "rl", "rr")
GRAVITY = 9.80665


@dataclass(frozen=True)
class VehicleAnalysisConfig:
    poll_hz: int = 10
    # Keep a full normal driving session available for review and manual
    # inclusion, rather than silently trimming the Coach ledger to ten laps.
    retained_laps: int = 100
    tyre_radius_m: float = 0.32
    mass_kg: float = 1030.0
    roll_center_height_m: float = 0.08
    track_width_m: float = 1.9
    wheelbase_m: float = 3.0


def _num(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _avg(values: list[float | None]) -> float | None:
    clean = [value for value in values if value is not None and math.isfinite(value)]
    return sum(clean) / len(clean) if clean else None


def _max(values: list[float | None]) -> float | None:
    clean = [value for value in values if value is not None and math.isfinite(value)]
    return max(clean) if clean else None


def _min(values: list[float | None]) -> float | None:
    clean = [value for value in values if value is not None and math.isfinite(value)]
    return min(clean) if clean else None


def _time(row: dict) -> float | None:
    return _num(row.get("lap_time")) if row.get("lap_time") is not None else _num(row.get("timestamp"))


def _sample_at(rows: list[dict], timestamp: float | None) -> dict | None:
    if timestamp is None or not rows:
        return rows[-1] if rows else None
    return min(rows, key=lambda row: abs((_time(row) or 0.0) - timestamp))


def _is_yellow_flag(value: Any) -> bool:
    text = str(value or "").strip().lower()
    if text in {"", "0", "none", "green", "clear", "false", "unknown", "b'\\x00'", 'b"\\x00"'}:
        return False
    try:
        return float(text) > 0
    except ValueError:
        return True


def _engine_power_kw(rpm: float | None, torque_nm: float | None) -> float | None:
    if rpm is None or torque_nm is None or rpm <= 0 or torque_nm <= 0:
        return None
    return torque_nm * rpm * 2 * math.pi / 60000


def _wheel_speed_kph(row: dict, wheel: str, config: VehicleAnalysisConfig) -> float | None:
    ground = _num(row.get(f"wheel_ground_speed_{wheel}"))
    if ground is not None:
        return abs(ground) * 3.6
    rotation = _num(row.get(f"wheel_rot_speed_{wheel}"))
    if rotation is None:
        return None
    return abs(rotation) * config.tyre_radius_m * 3.6


def _ride_mm(row: dict, key: str) -> float | None:
    value = _num(row.get(key))
    if value is None:
        return None
    return value * 1000 if abs(value) < 5 else value


def _derivative(rows: list[dict], key: str) -> list[tuple[float, float]]:
    result: list[tuple[float, float]] = []
    for previous, current in zip(rows, rows[1:]):
        t0 = _time(previous)
        t1 = _time(current)
        v0 = _num(previous.get(key))
        v1 = _num(current.get(key))
        if t0 is None or t1 is None or v0 is None or v1 is None:
            continue
        delta = t1 - t0
        if delta <= 0:
            continue
        result.append((t1, (v1 - v0) / delta))
    return result


def _sign_changes(values: list[float], deadband: float) -> int:
    last = 0
    changes = 0
    for value in values:
        sign = 1 if value > deadband else -1 if value < -deadband else 0
        if sign == 0:
            continue
        if last and sign != last:
            changes += 1
        last = sign
    return changes


def normalize_snapshot(snapshot: TelemetrySnapshot, config: VehicleAnalysisConfig) -> dict | None:
    player = snapshot.player
    session = snapshot.session
    if not player or not session:
        return None
    player_id = player.vehicle_id
    player_comp = next((car for car in snapshot.competitors if car.is_player or car.vehicle_id == player_id), None)
    lap_time = player.current_lap_time
    if lap_time is None:
        lap_time = session.current_time
    tyre = player.tyre_state
    rpm = _num(player.rpm)
    torque_nm = _num(player.engine_torque)
    power_kw = _engine_power_kw(rpm, torque_nm)
    row: dict[str, Any] = {
        "timestamp": session.current_time,
        "lap_time": lap_time,
        "lap_number": player.lap_number,
        "current_sector": player.current_sector,
        "speed_kph": player.speed_kph,
        "brake_pct": (player.brake * 100.0) if player.brake is not None else None,
        "throttle_pct": (player.throttle * 100.0) if player.throttle is not None else None,
        "steering_angle": player.steering,
        "g_force_lat": player.g_force_lat,
        "g_force_long": player.g_force_long,
        "g_force_vert": player.g_force_vert,
        "lap_invalidated": player.lap_invalidated,
        "in_pits": player_comp.in_pits if player_comp else False,
        "yellow_flag": _is_yellow_flag(session.yellow_flag_state),
        "rpm": rpm,
        "engine_torque_nm": torque_nm,
        "power_kw": power_kw,
        "power_hp": power_kw * 1.34102209 if power_kw is not None else None,
    }
    for wheel in WHEELS:
        row[f"ride_height_{wheel}_mm"] = _ride_mm(row={f"ride_height_{wheel}": getattr(player, f"ride_height_{wheel}")}, key=f"ride_height_{wheel}")
        suspension = getattr(player, f"suspension_deflection_{wheel}")
        row[f"suspension_deflection_{wheel}_mm"] = suspension * 1000 if suspension is not None and abs(suspension) < 5 else suspension
        row[f"wheel_rot_speed_{wheel}"] = getattr(player, f"wheel_rot_speed_{wheel}")
        row[f"wheel_ground_speed_{wheel}"] = getattr(player, f"wheel_ground_speed_{wheel}")
        row[f"wheel_speed_{wheel}_kph"] = _wheel_speed_kph(row, wheel, config)
        if tyre:
            row[f"tyre_pressure_{wheel}"] = getattr(tyre, f"pressure_{wheel}")
            temps = getattr(tyre, f"temp_{wheel}")
            if temps:
                row[f"tyre_temp_{wheel}_inner"] = temps.left_c
                row[f"tyre_temp_{wheel}_center"] = temps.center_c
                row[f"tyre_temp_{wheel}_outer"] = temps.right_c
                row[f"tyre_temp_{wheel}_carcass"] = temps.carcass_c
    return row


class LiveLapBuffer:
    def __init__(self, config: VehicleAnalysisConfig):
        self.config = config
        self._active_lap: int | None = None
        self._active_rows: list[dict] = []
        self._completed: OrderedDict[int, list[dict]] = OrderedDict()

    def reset(self) -> None:
        self._active_lap = None
        self._active_rows = []
        self._completed.clear()

    def add_snapshot(self, snapshot: TelemetrySnapshot) -> None:
        row = normalize_snapshot(snapshot, self.config)
        if row is None:
            return
        lap = row.get("lap_number")
        if lap is None:
            return
        lap = int(lap)
        if self._active_lap is None:
            self._active_lap = lap
        if lap != self._active_lap:
            if self._active_lap is not None and self._active_rows:
                self._completed[self._active_lap] = self._active_rows
                while len(self._completed) > self.config.retained_laps:
                    self._completed.popitem(last=False)
            self._active_lap = lap
            self._active_rows = []
        self._active_rows.append(row)

    def completed_laps(self) -> OrderedDict[int, list[dict]]:
        return OrderedDict(self._completed)

    def valid_laps(self) -> OrderedDict[int, list[dict]]:
        return OrderedDict((lap, rows) for lap, rows in self._completed.items() if is_valid_lap(rows, self.config))


def lap_validation(rows: list[dict], config: VehicleAnalysisConfig) -> dict:
    reasons: list[str] = []
    min_samples = max(8, config.poll_hz * 20)
    if len(rows) < min_samples:
        reasons.append("Too few samples")
    if any(row.get("lap_invalidated") is True for row in rows):
        reasons.append("Lap invalidated")
    if any(row.get("in_pits") is True for row in rows):
        reasons.append("Pit lane")
    if any(row.get("yellow_flag") is True for row in rows):
        reasons.append("Yellow flag")
    start = _time(rows[0]) if rows else None
    end = _time(rows[-1]) if rows else None
    duration = end - start if start is not None and end is not None else None
    if duration is None:
        reasons.append("Missing lap time")
    elif duration < 40 or duration > 900:
        reasons.append("Lap time outside range")
    return {
        "valid_lap": not reasons,
        "reason_codes": [_reason_code(reason) for reason in reasons],
        "reason": ", ".join(reasons) if reasons else None,
    }


def _reason_code(reason: str) -> str:
    return reason.lower().replace(" ", "_")


def is_valid_lap(rows: list[dict], config: VehicleAnalysisConfig) -> bool:
    return bool(lap_validation(rows, config)["valid_lap"])


def lap_summary(lap_number: int, rows: list[dict], config: VehicleAnalysisConfig | None = None) -> dict:
    start = _time(rows[0])
    end = _time(rows[-1])
    validation = lap_validation(rows, config) if config else {"valid_lap": True, "reason_codes": [], "reason": None}
    summary = {
        "lap_number": lap_number,
        "lap_time": end - start if start is not None and end is not None else None,
        "sample_count": len(rows),
        "top_speed": _max([_num(row.get("speed_kph")) for row in rows]),
        "lap_invalidated": any(row.get("lap_invalidated") is True for row in rows),
        "in_pits": any(row.get("in_pits") is True for row in rows),
        "yellow_flag": any(row.get("yellow_flag") is True for row in rows),
    }
    summary.update(validation)
    return summary


def detect_corners(rows: list[dict]) -> list[dict]:
    if len(rows) < 4:
        return []
    max_steer = _max([abs(_num(row.get("steering_angle")) or 0.0) for row in rows]) or 0.0
    steer_entry = max(0.04, max_steer * 0.2)
    windows: list[tuple[float, float]] = []
    in_corner = False
    start: float | None = None
    below_count = 0
    for row in rows:
        t = _time(row)
        if t is None:
            continue
        brake = _num(row.get("brake_pct")) or 0.0
        throttle = _num(row.get("throttle_pct")) or 0.0
        steer = abs(_num(row.get("steering_angle")) or 0.0)
        lat_g = abs(_num(row.get("g_force_lat")) or 0.0)
        entry = brake > 8 or (steer > steer_entry and lat_g > 0.3)
        exit_ready = brake < 3 and (throttle > 65 or (steer < max(0.04, max_steer * 0.22) and lat_g < 0.28))
        if not in_corner and entry:
            in_corner = True
            start = t
            below_count = 0
        elif in_corner:
            below_count = below_count + 1 if exit_ready else 0
            corner_age = t - start if start is not None else 0.0
            if (below_count >= 2 and corner_age >= 0.8) or corner_age >= 20.0:
                windows.append((start, t))
                in_corner = False
                start = None
    if in_corner and start is not None:
        windows.append((start, _time(rows[-1]) or start))
    merged: list[tuple[float, float]] = []
    for start, end in windows:
        if not merged or start - merged[-1][1] > 0.65:
            merged.append((start, end))
        else:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
    corners = []
    for index, (start, end) in enumerate(merged, start=1):
        segment = [row for row in rows if (_time(row) or -1) >= start and (_time(row) or -1) <= end]
        if len(segment) < 3:
            continue
        vmin_row = min(segment, key=lambda row: _num(row.get("speed_kph")) if _num(row.get("speed_kph")) is not None else math.inf)
        steer_row = max(segment, key=lambda row: abs(_num(row.get("steering_angle")) or 0.0))
        corners.append({
            "id": index,
            "label": f"Turn {index}",
            "start": start,
            "end": end,
            "vmin_timestamp": _time(vmin_row),
            "max_steering_timestamp": _time(steer_row),
        })
    return corners


def _insight(category: str, icon: str, severity: str, message: str, timestamp: float | None, lap_number: int | None, corner: dict | None, evidence: list[str] | None = None) -> dict:
    return {
        "category": category,
        "icon": icon,
        "severity": severity,
        "message": message,
        "timestamp": timestamp,
        "lap_time": timestamp,
        "lap_number": lap_number,
        "corner_id": corner.get("id") if corner else None,
        "evidence": evidence or [],
    }


def analyze_lap(rows: list[dict], reference_rows: list[dict] | None, config: VehicleAnalysisConfig) -> dict:
    lap_number = int(rows[0].get("lap_number") or 0) if rows else None
    session_peak_g = _max([
        math.sqrt((_num(row.get("g_force_lat")) or 0.0) ** 2 + (_num(row.get("g_force_long")) or 0.0) ** 2)
        for row in rows
    ])
    corners = detect_corners(rows)
    insights: list[dict] = []
    for corner in corners:
        segment = [row for row in rows if (_time(row) or -1) >= corner["start"] and (_time(row) or -1) <= corner["end"]]
        before_count = len(insights)
        _driver_insights(segment, rows, corner, lap_number, session_peak_g, insights)
        if len(insights) == before_count:
            insights.append(_insight("Driver", "check", "success", f'{corner["label"]}: Clean execution through this corner.', corner.get("vmin_timestamp"), lap_number, corner, ["No driver input thresholds exceeded"]))
    _setup_insights(rows, corners, lap_number, config, insights)
    return {
        "laps": [lap_summary(int(rows[0].get("lap_number") or 0), rows)] if rows else [],
        "current_lap_data": rows,
        "reference_lap_data": reference_rows or [],
        "sectors": sector_summary(rows, reference_rows or []),
        "insights": insights,
        "corners": corners,
        "metrics": {
            "session_peak_combined_g": session_peak_g,
            "understeer_gradient": understeer_gradient(rows, config),
            "load_transfer_geom": load_transfer(rows, config),
        },
    }


def _driver_insights(segment: list[dict], lap_rows: list[dict], corner: dict, lap_number: int | None, session_peak_g: float | None, insights: list[dict]) -> None:
    label = corner["label"]
    brake_start = next((row for row in segment if (_num(row.get("brake_pct")) or 0.0) > 5), None)
    brake_90 = next((row for row in segment if brake_start and (_time(row) or -1) >= (_time(brake_start) or 0) and (_num(row.get("brake_pct")) or 0.0) >= 90), None)
    if brake_start and brake_90:
        dt = (_time(brake_90) or 0.0) - (_time(brake_start) or 0.0)
        if dt > 0.25:
            insights.append(_insight("Driver", "stop", "critical", f"{label}: Initial brake application is too slow. Spike the pedal harder.", _time(brake_90), lap_number, corner, [f"{dt:.2f}s brake ramp"]))

    coast_start: float | None = None
    coast_longest = 0.0
    coast_timestamp: float | None = None
    for row in segment:
        t = _time(row)
        coasting = (_num(row.get("brake_pct")) or 0.0) < 5 and (_num(row.get("throttle_pct")) or 0.0) < 5
        if coasting and coast_start is None:
            coast_start = t
        elif not coasting and coast_start is not None and t is not None:
            duration = t - coast_start
            if duration > coast_longest:
                coast_longest = duration
                coast_timestamp = coast_start
            coast_start = None
    if coast_start is not None and (_time(segment[-1]) or 0.0) - coast_start > coast_longest:
        coast_longest = (_time(segment[-1]) or 0.0) - coast_start
        coast_timestamp = coast_start
    if coast_longest > 0.15:
        insights.append(_insight("Driver", "stop", "critical", f"{label}: Excessive coasting detected. You are over-slowing.", coast_timestamp, lap_number, corner, [f"{coast_longest:.2f}s coasting"]))

    max_steer = _max([abs(_num(row.get("steering_angle")) or 0.0) for row in segment]) or 0.0
    brake_zero = next((row for row in segment if (_num(row.get("brake_pct")) or 0.0) <= 0.5), None)
    steer_half = next((row for row in segment if abs(_num(row.get("steering_angle")) or 0.0) >= max_steer * 0.5), None)
    if brake_zero and steer_half and (_time(brake_zero) or 0.0) < (_time(steer_half) or 0.0):
        insights.append(_insight("Driver", "stop", "critical", f"{label}: Releasing brakes too early before turn-in. Trail brake deeper.", _time(brake_zero), lap_number, corner, ["Brake released before 50% steering"]))

    vmin_t = corner.get("vmin_timestamp")
    steer_t = corner.get("max_steering_timestamp")
    if vmin_t is not None and steer_t is not None and vmin_t < steer_t - 0.5:
        insights.append(_insight("Driver", "stop", "critical", f"{label}: Over-slowing entry. Minimum speed reached too early.", vmin_t, lap_number, corner, [f"VMin {steer_t - vmin_t:.2f}s before max steering"]))

    vmin_row = _sample_at(segment, vmin_t)
    if session_peak_g and vmin_row:
        combined = math.sqrt((_num(vmin_row.get("g_force_lat")) or 0.0) ** 2 + (_num(vmin_row.get("g_force_long")) or 0.0) ** 2)
        if combined < 0.85 * session_peak_g:
            insights.append(_insight("Driver", "stop", "critical", f"{label}: Under-driving mid-corner. Grip in reserve.", vmin_t, lap_number, corner, [f"{combined:.2f}G vs {session_peak_g:.2f}G peak"]))

    exit_rows = [row for row in segment if (_time(row) or 0.0) >= (vmin_t or corner["start"])]
    drops = 0
    applied = False
    for previous, current in zip(exit_rows, exit_rows[1:]):
        prev_throttle = _num(previous.get("throttle_pct")) or 0.0
        throttle = _num(current.get("throttle_pct")) or 0.0
        prev_lat = abs(_num(previous.get("g_force_lat")) or 0.0)
        lat = abs(_num(current.get("g_force_lat")) or 0.0)
        if throttle > 10:
            applied = True
        if applied and throttle + 3 < prev_throttle and lat < prev_lat:
            drops += 1
    if drops > 0:
        insights.append(_insight("Driver", "stop", "critical", f"{label}: Hesitant throttle on exit.", vmin_t, lap_number, corner, [f"{drops} throttle lift{'s' if drops != 1 else ''}"]))

    mid_start = corner["start"] + (corner["end"] - corner["start"]) * 0.25
    mid_end = corner["start"] + (corner["end"] - corner["start"]) * 0.75
    mid_rows = [row for row in segment if mid_start <= (_time(row) or -1) <= mid_end]
    steering_rates = [rate for _, rate in _derivative(mid_rows, "steering_angle")]
    changes = _sign_changes(steering_rates, 0.02)
    if changes > 3:
        insights.append(_insight("Driver", "stop", "critical", f"{label}: 'Sawing' at the wheel detected.", steer_t, lap_number, corner, [f"{changes} steering reversals"]))


def _setup_insights(rows: list[dict], corners: list[dict], lap_number: int | None, config: VehicleAnalysisConfig, insights: list[dict]) -> None:
    for corner in corners:
        exit_rows = [row for row in rows if (_time(row) or -1) >= (corner.get("vmin_timestamp") or corner["start"]) and (_time(row) or -1) <= corner["end"]]
        for row in exit_rows:
            ground = _num(row.get("speed_kph"))
            rear = _avg([_num(row.get("wheel_speed_rl_kph")), _num(row.get("wheel_speed_rr_kph"))])
            lat = abs(_num(row.get("g_force_lat")) or 0.0)
            if ground and ground > 5 and rear is not None:
                slip = (rear - ground) / ground * 100
                if slip > 10 and lat < 0.5:
                    insights.append(_insight("Setup", "wrench", "warning", "Setup: Severe rear traction loss. Soften rear springs/pressure.", _time(row), lap_number, corner, [f"{slip:.1f}% rear slip"]))
                    break

    brake_rows = [row for row in rows if (_num(row.get("brake_pct")) or 0.0) > 80]
    if len(brake_rows) >= 3:
        front_rates = _wheel_decel(brake_rows, ("fl", "fr"))
        rear_rates = _wheel_decel(brake_rows, ("rl", "rr"))
        front = _avg(front_rates)
        rear = _avg(rear_rates)
        if front is not None and rear is not None and rear > 0 and front > rear * 1.15:
            insights.append(_insight("Setup", "wrench", "warning", "Setup: Front locking prematurely. Move bias rearward.", _time(brake_rows[0]), lap_number, None, [f"Front decel {front / rear * 100 - 100:.0f}% faster"]))

    straight = [row for row in rows if abs(_num(row.get("g_force_lat")) or 0.0) < 0.25 and abs(_num(row.get("g_force_long")) or 0.0) < 0.25]
    static_front = _avg([_avg([_num(row.get("ride_height_fl_mm")), _num(row.get("ride_height_fr_mm"))]) for row in straight])
    dive_rows = [row for row in rows if (_num(row.get("g_force_long")) or 0.0) < -1.2]
    dive_front = _min([_avg([_num(row.get("ride_height_fl_mm")), _num(row.get("ride_height_fr_mm"))]) for row in dive_rows])
    if static_front is not None and dive_front is not None and static_front - dive_front > 25:
        insights.append(_insight("Setup", "wrench", "warning", "Setup: Excessive brake dive. Stiffen front springs/bump.", _time(dive_rows[0]) if dive_rows else None, lap_number, None, [f"{static_front - dive_front:.1f}mm front drop"]))

    roll_rows = [row for row in rows if abs(_num(row.get("g_force_lat")) or 0.0) > 1.2]
    roll_values = []
    for row in roll_rows:
        left = _avg([_num(row.get("ride_height_fl_mm")), _num(row.get("ride_height_rl_mm"))])
        right = _avg([_num(row.get("ride_height_fr_mm")), _num(row.get("ride_height_rr_mm"))])
        if left is not None and right is not None:
            roll_values.append(abs(left - right))
    roll = _max(roll_values)
    if roll is not None and roll > 20:
        insights.append(_insight("Setup", "wrench", "warning", "Setup: Heavy roll onto outside tires. Stiffen Anti-Roll Bar.", _time(roll_rows[0]) if roll_rows else None, lap_number, None, [f"{roll:.1f}mm roll"]))

    for row in rows:
        ride = _num(row.get("ride_height_fl_mm"))
        speed = _num(row.get("speed_kph"))
        if ride is not None and speed is not None and ride <= 0 and speed > 200:
            insights.append(_insight("Setup", "wrench", "critical", "Aero: Front splitter bottoming out. Stiffen front packer shims.", _time(row), lap_number, None, [f"{ride:.1f}mm FL at {speed:.0f}km/h"]))
            break

    latest = rows[-1] if rows else {}
    for wheel in WHEELS:
        label = wheel.upper()
        inner = _num(latest.get(f"tyre_temp_{wheel}_inner"))
        center = _num(latest.get(f"tyre_temp_{wheel}_center"))
        outer = _num(latest.get(f"tyre_temp_{wheel}_outer"))
        if inner is not None and outer is not None and inner > outer + 20:
            insights.append(_insight("Setup", "wrench", "warning", f"Setup: {label} inner shoulder overheating. Reduce negative camber.", _time(latest), lap_number, None, [f"Inner {inner:.0f}C / outer {outer:.0f}C"]))
        if center is not None and inner is not None and outer is not None and center > ((inner + outer) / 2) + 5:
            insights.append(_insight("Setup", "wrench", "warning", f"Setup: {label} ballooning. Drop cold pressure.", _time(latest), lap_number, None, [f"Center {center:.0f}C / shoulder avg {((inner + outer) / 2):.0f}C"]))


def _wheel_decel(rows: list[dict], wheels: tuple[str, str]) -> list[float]:
    rates = []
    for previous, current in zip(rows, rows[1:]):
        t0 = _time(previous)
        t1 = _time(current)
        if t0 is None or t1 is None or t1 <= t0:
            continue
        prev_speed = _avg([_num(previous.get(f"wheel_speed_{wheel}_kph")) for wheel in wheels])
        speed = _avg([_num(current.get(f"wheel_speed_{wheel}_kph")) for wheel in wheels])
        if prev_speed is not None and speed is not None and speed < prev_speed:
            rates.append((prev_speed - speed) / (t1 - t0))
    return rates


def understeer_gradient(rows: list[dict], config: VehicleAnalysisConfig) -> float | None:
    points = []
    for row in rows:
        speed = _num(row.get("speed_kph"))
        lat_g = _num(row.get("g_force_lat"))
        steering = _num(row.get("steering_angle"))
        if speed is None or lat_g is None or steering is None or abs(lat_g) < 0.2:
            continue
        radius = (speed / 3.6) ** 2 / max(abs(lat_g) * GRAVITY, 0.001)
        ackermann = config.wheelbase_m / radius
        points.append((lat_g, steering - ackermann))
    if len(points) < 4:
        return None
    mean_x = sum(x for x, _ in points) / len(points)
    mean_y = sum(y for _, y in points) / len(points)
    denom = sum((x - mean_x) ** 2 for x, _ in points)
    if denom <= 0:
        return None
    return sum((x - mean_x) * (y - mean_y) for x, y in points) / denom


def load_transfer(rows: list[dict], config: VehicleAnalysisConfig) -> float | None:
    peak_lat = _max([abs(_num(row.get("g_force_lat")) or 0.0) for row in rows])
    if peak_lat is None:
        return None
    return (config.mass_kg * peak_lat * GRAVITY * config.roll_center_height_m) / config.track_width_m


def sector_summary(rows: list[dict], reference_rows: list[dict]) -> list[dict]:
    result = []
    for sector in (1, 2, 3):
        current = _sector_time(rows, sector)
        reference = _sector_time(reference_rows, sector)
        result.append({
            "sector": sector,
            "time": current,
            "reference_time": reference,
            "delta": current - reference if current is not None and reference is not None else None,
        })
    return result


def _sector_time(rows: list[dict], sector: int) -> float | None:
    sector_rows = [row for row in rows if row.get("current_sector") == sector]
    if len(sector_rows) < 2:
        return None
    start = _time(sector_rows[0])
    end = _time(sector_rows[-1])
    return end - start if start is not None and end is not None else None


def _percentile(values: list[float | None], percentile: float) -> float | None:
    clean = sorted(value for value in values if value is not None and math.isfinite(value))
    if not clean:
        return None
    if len(clean) == 1:
        return clean[0]
    rank = max(0.0, min(1.0, percentile)) * (len(clean) - 1)
    low = int(math.floor(rank))
    high = int(math.ceil(rank))
    if low == high:
        return clean[low]
    return clean[low] + (clean[high] - clean[low]) * (rank - low)


def _median(values: list[float | None]) -> float | None:
    clean = [value for value in values if value is not None and math.isfinite(value)]
    return statistics.median(clean) if clean else None


def _mad(values: list[float | None]) -> float | None:
    center = _median(values)
    if center is None:
        return None
    return _median([abs(value - center) for value in values if value is not None and math.isfinite(value)])


QUALITY_LIMITS: dict[str, tuple[float, float, float]] = {
    "speed_kph": (0.0, 450.0, 65.0),
    "g_force_lat": (-4.5, 4.5, 1.4),
    "g_force_long": (-6.0, 4.0, 1.8),
    "steering_angle": (-4.0, 4.0, 1.2),
    "throttle_pct": (-1.0, 101.0, 80.0),
    "brake_pct": (-1.0, 101.0, 80.0),
}


def _quality_rows(rows: list[dict], config: VehicleAnalysisConfig) -> tuple[list[dict], dict]:
    """Flag implausible isolated samples without removing the raw evidence."""
    copied = [dict(row) for row in rows]
    flagged: set[int] = set()
    gaps = 0
    expected_gap = 1.0 / max(config.poll_hz, 1)
    for index, row in enumerate(copied):
        reasons: list[str] = []
        if index:
            previous_time = _time(copied[index - 1])
            current_time = _time(row)
            if previous_time is not None and current_time is not None and current_time - previous_time > max(0.75, expected_gap * 5):
                gaps += 1
                reasons.append("timestamp_gap")
        for key, (lower, upper, jump_limit) in QUALITY_LIMITS.items():
            value = _num(row.get(key))
            if value is None:
                continue
            if value < lower or value > upper:
                reasons.append(f"{key}_physical_limit")
                continue
            if 0 < index < len(copied) - 1:
                previous = _num(copied[index - 1].get(key))
                following = _num(copied[index + 1].get(key))
                if previous is not None and following is not None:
                    local_center = statistics.median((previous, following))
                    local_mad = statistics.median((abs(previous - local_center), abs(following - local_center)))
                    robust_scale = max(1.4826 * local_mad, jump_limit * 0.08)
                    if abs(value - local_center) > max(jump_limit, 7.0 * robust_scale):
                        reasons.append(f"{key}_isolated_spike")
        row["quality_flags"] = reasons
        row["sample_quality"] = "flagged" if reasons else "valid"
        if reasons:
            flagged.add(index)
    cumulative_distance = 0.0
    distances = [0.0]
    for previous, current in zip(copied, copied[1:]):
        t0, t1 = _time(previous), _time(current)
        v0, v1 = _num(previous.get("speed_kph")), _num(current.get("speed_kph"))
        if t0 is not None and t1 is not None and t1 > t0 and v0 is not None and v1 is not None:
            cumulative_distance += max(0.0, (v0 + v1) / 7.2 * (t1 - t0))
        distances.append(cumulative_distance)
    for row, distance in zip(copied, distances):
        row["distance_pct"] = max(0.0, min(100.0, distance / cumulative_distance * 100.0)) if cumulative_distance > 0 else None
    ratio = len(flagged) / len(copied) if copied else 1.0
    state = "Valid" if ratio < 0.005 and gaps == 0 else "Valid but noisy" if ratio < 0.03 and gaps <= 2 else "Partially unreliable"
    return copied, {"state": state, "flagged_samples": len(flagged), "timestamp_gaps": gaps, "quality_score": max(0, round(100 * (1 - min(1.0, ratio * 8 + gaps * 0.04))))}


def _clean_values(rows: list[dict], key: str) -> list[float]:
    return [value for row in rows if row.get("sample_quality") != "flagged" and (value := _num(row.get(key))) is not None]


def _window_for_lap(rows: list[dict], start_pct: float, end_pct: float) -> list[dict]:
    return [row for row in rows if row.get("distance_pct") is not None and start_pct <= row["distance_pct"] <= end_pct]


def _first_sustained(rows: list[dict], key: str, threshold: float, *, above: bool = True, count: int = 2) -> dict | None:
    streak: list[dict] = []
    for row in rows:
        value = _num(row.get(key))
        matches = value is not None and (value >= threshold if above else value <= threshold)
        streak = streak + [row] if matches else []
        if len(streak) >= count:
            return streak[0]
    return None


def _corner_metrics(rows: list[dict], start_pct: float, end_pct: float) -> dict | None:
    segment = _window_for_lap(rows, start_pct, end_pct)
    clean = [row for row in segment if row.get("sample_quality") != "flagged"]
    if len(clean) < 3:
        return None
    start_time, end_time = _time(clean[0]), _time(clean[-1])
    minimum = min(clean, key=lambda row: _num(row.get("speed_kph")) if _num(row.get("speed_kph")) is not None else math.inf)
    minimum_time = _time(minimum)
    before_apex = [row for row in clean if minimum_time is None or (_time(row) or 0.0) <= minimum_time]
    after_apex = [row for row in clean if minimum_time is None or (_time(row) or 0.0) >= minimum_time]
    brake_on = _first_sustained(clean, "brake_pct", 5.0)
    brake_release = next((row for row in reversed(before_apex) if (_num(row.get("brake_pct")) or 0.0) >= 5.0), None)
    throttle_on = _first_sustained(after_apex, "throttle_pct", 10.0)
    full_throttle = _first_sustained(after_apex, "throttle_pct", 90.0)
    coast = 0.0
    for previous, current in zip(clean, clean[1:]):
        if (_num(previous.get("throttle_pct")) or 0.0) < 5 and (_num(previous.get("brake_pct")) or 0.0) < 5:
            coast += max(0.0, (_time(current) or 0.0) - (_time(previous) or 0.0))
    steering_rates = [rate for _, rate in _derivative(clean, "steering_angle")]
    return {
        "segment_time": end_time - start_time if start_time is not None and end_time is not None else None,
        "entry_speed": _num(clean[0].get("speed_kph")),
        "minimum_speed": _num(minimum.get("speed_kph")),
        "exit_speed": _num(clean[-1].get("speed_kph")),
        "brake_onset_pct": brake_on.get("distance_pct") if brake_on else None,
        "brake_release_pct": brake_release.get("distance_pct") if brake_release else None,
        "throttle_on_pct": throttle_on.get("distance_pct") if throttle_on else None,
        "full_throttle_pct": full_throttle.get("distance_pct") if full_throttle else None,
        "coast_time": coast,
        "corrections": _sign_changes(steering_rates, 0.02),
        "sustained_lat_g": _median([abs(value) for value in _clean_values(clean, "g_force_lat")]),
    }


def _session_model(completed: OrderedDict[int, list[dict]], summaries: list[dict], config: VehicleAnalysisConfig, reference_lap: int) -> dict:
    quality_rows: dict[int, list[dict]] = {}
    quality_by_lap: dict[int, dict] = {}
    for lap, rows in completed.items():
        quality_rows[lap], quality_by_lap[lap] = _quality_rows(rows, config)
    # Validity is an automatic recommendation, not an irreversible decision.
    # The driver may include any completed lap in the coaching population.
    valid_summaries = [summary for summary in summaries if summary.get("included_in_analysis")]
    valid_times = [summary.get("lap_time") for summary in valid_summaries]
    median_time = _median(valid_times)
    pace_mad = _mad(valid_times)
    robust_spread = 1.4826 * pace_mad if pace_mad is not None else None
    representative = [summary for summary in valid_summaries if median_time is not None and (robust_spread in (None, 0) or abs(summary["lap_time"] - median_time) <= 2.5 * robust_spread)]
    if not representative:
        representative = valid_summaries
    representative_fast = min(representative, key=lambda item: item["lap_time"], default=None)
    representative_pace_lap = min(representative, key=lambda item: (abs(item["lap_time"] - median_time), item["lap_time"]), default=None) if median_time is not None else representative_fast
    best = min(valid_summaries, key=lambda item: item["lap_time"], default=None)
    for summary in summaries:
        lap = int(summary["lap_number"])
        q = quality_by_lap[lap]
        summary.update(q)
        summary["quality_state"] = "Excluded from current analysis" if not summary.get("included_in_analysis") else q["state"]
        summary["gap_to_representative"] = summary.get("lap_time") - median_time if summary.get("lap_time") is not None and median_time is not None else None
        summary["role"] = "Personal best selected lap" if best and lap == best["lap_number"] else "Representative selected lap" if representative_fast and lap == representative_fast["lap_number"] else "Selected for analysis" if summary.get("included_in_analysis") else "Not selected for analysis"

    reference_rows = quality_rows.get(reference_lap, [])
    detected = detect_corners(reference_rows)
    reference_start, reference_end = (_time(reference_rows[0]), _time(reference_rows[-1])) if reference_rows else (None, None)
    reference_duration = reference_end - reference_start if reference_start is not None and reference_end is not None else None
    corners: list[dict] = []
    findings: list[dict] = []
    theoretical_sectors: list[float] = []
    for sector in (1, 2, 3):
        best_sector = _min([_sector_time(quality_rows[int(summary["lap_number"])], sector) for summary in valid_summaries])
        if best_sector is not None:
            theoretical_sectors.append(best_sector)
    theoretical = sum(theoretical_sectors) if len(theoretical_sectors) == 3 else (best.get("lap_time") if best else None)

    for corner in detected:
        if not reference_duration:
            continue
        start_pct = max(0.0, (corner["start"] - reference_start) / reference_duration * 100.0)
        end_pct = min(100.0, (corner["end"] - reference_start) / reference_duration * 100.0)
        lap_metrics: list[tuple[int, dict]] = []
        for summary in valid_summaries:
            lap = int(summary["lap_number"])
            metrics = _corner_metrics(quality_rows[lap], start_pct, end_pct)
            if metrics and metrics.get("segment_time") is not None:
                lap_metrics.append((lap, metrics))
        if not lap_metrics:
            continue
        target_lap, target = min(lap_metrics, key=lambda item: item[1]["segment_time"])
        losses = [(lap, metrics["segment_time"] - target["segment_time"], metrics) for lap, metrics in lap_metrics]
        meaningful = [(lap, loss, metrics) for lap, loss, metrics in losses if loss >= 0.03]
        opportunity = _median([loss for _, loss, _ in meaningful]) or 0.0
        repeatability = len(meaningful) / len(lap_metrics)
        data_quality = _median([quality_by_lap[lap]["quality_score"] / 100 for lap, _, _ in meaningful or losses]) or 0.0
        evidence_strength = min(1.0, opportunity / 0.25) if opportunity else 0.0
        confidence_score = round(100 * (0.45 * repeatability + 0.3 * evidence_strength + 0.25 * data_quality))
        confidence = "High" if confidence_score >= 75 else "Medium" if confidence_score >= 50 else "Low"
        current = _median([metrics["coast_time"] for _, _, metrics in meaningful]) or 0.0
        target_coast = target.get("coast_time") or 0.0
        throttle_delay = (_median([metrics.get("throttle_on_pct") for _, _, metrics in meaningful]) or target.get("throttle_on_pct") or 0.0) - (target.get("throttle_on_pct") or 0.0)
        brake_onset_delay = (_median([metrics.get("brake_onset_pct") for _, _, metrics in meaningful]) or target.get("brake_onset_pct") or 0.0) - (target.get("brake_onset_pct") or 0.0)
        brake_release_delay = (_median([metrics.get("brake_release_pct") for _, _, metrics in meaningful]) or target.get("brake_release_pct") or 0.0) - (target.get("brake_release_pct") or 0.0)
        exit_delta = (_median([metrics.get("exit_speed") for _, _, metrics in meaningful]) or target.get("exit_speed") or 0.0) - (target.get("exit_speed") or 0.0)
        minimum_speed_delta = (_median([metrics.get("minimum_speed") for _, _, metrics in meaningful]) or target.get("minimum_speed") or 0.0) - (target.get("minimum_speed") or 0.0)
        correction_delta = (_median([metrics.get("corrections") for _, _, metrics in meaningful]) or target.get("corrections") or 0.0) - (target.get("corrections") or 0.0)
        trend_values = [loss for _, loss, _ in losses]
        trend = "Improving" if len(trend_values) >= 3 and trend_values[-1] < trend_values[0] - 0.03 else "Worsening" if len(trend_values) >= 3 and trend_values[-1] > trend_values[0] + 0.03 else "Stable"
        candidates: list[dict] = []

        def add_candidate(category: str, phase: str, strength: float, threshold: float, title: str, happened: str, action: str, avoid: str, channels: list[str]) -> None:
            if strength < threshold or opportunity < 0.02:
                return
            share = min(0.82, max(0.28, strength / max(threshold * 3.0, 0.001)))
            candidates.append({
                "category": category, "phase": phase, "opportunity": max(0.02, opportunity * share), "title": f'{corner["label"]} — {title}',
                "what_happened": happened, "primary_action": action, "avoid": avoid, "relevant_channels": channels,
            })

        coast_delta = current - target_coast
        add_candidate("Coasting", "Entry", coast_delta, 0.06, "Close the coast gap", f"Coasting is {coast_delta:.2f}s longer than your best clean pattern.", "Blend brake release into light throttle.", "Do not solve this by braking later.", ["speed", "brake", "throttle"])
        add_candidate("Brake release", "Rotation", brake_release_delay, 0.12, "Release earlier", f"Brake release is {brake_release_delay:.1f}% of lap distance later.", "Taper pressure sooner and let the car rotate.", "Avoid an abrupt pedal release.", ["speed", "brake", "steering"])
        add_candidate("Braking point", "Approach", abs(brake_onset_delay), 0.18, "Stabilize the brake point", f"Brake onset varies by {abs(brake_onset_delay):.1f}% of lap distance from the clean target.", "Use one repeatable marker before chasing distance.", "Later is not automatically faster.", ["speed", "brake"])
        add_candidate("Minimum speed", "Apex", abs(minimum_speed_delta) if minimum_speed_delta < 0 else 0.0, 0.6, "Protect minimum speed", f"Minimum speed is {abs(minimum_speed_delta):.1f} km/h below your clean target.", "Settle the car once and keep the apex rolling.", "Do not add entry speed if exit suffers.", ["speed", "brake", "g_force"])
        add_candidate("Throttle", "Exit", throttle_delay, 0.12, "Throttle sooner", f"First throttle is {throttle_delay:.1f}% of lap distance later.", "Finish rotation, then squeeze throttle earlier.", "Do not jump straight to full throttle.", ["speed", "throttle", "steering"])
        add_candidate("Exit speed", "Acceleration", abs(exit_delta) if exit_delta < 0 else 0.0, 0.6, "Recover exit speed", f"Exit speed is {abs(exit_delta):.1f} km/h below your clean target.", "Prioritize the exit line and earlier acceleration.", "Do not sacrifice the exit for entry speed.", ["speed", "throttle"])
        add_candidate("Steering", "Apex", correction_delta, 0.75, "Use one steering arc", f"About {correction_delta:.0f} extra steering corrections appear in slower laps.", "Make one input and let the car take a set.", "Do not chase the apex with more lock.", ["speed", "steering", "g_force"])
        if not candidates and opportunity >= 0.03:
            candidates.append({"category": "Corner time", "phase": "Whole corner", "opportunity": opportunity, "title": f'{corner["label"]} — Match the clean rhythm',
                               "what_happened": f"This corner is {opportunity:.2f}s slower on affected clean laps.", "primary_action": "Repeat the timing from your strongest clean pass.",
                               "avoid": "Change one phase at a time.", "relevant_channels": ["speed", "brake", "throttle"]})
        candidates.sort(key=lambda item: item["opportunity"], reverse=True)
        if not candidates:
            corners.append({
                "id": corner["id"], "label": corner["label"], "start_pct": start_pct, "end_pct": end_pct,
                "category": "On target", "phase": "Clean", "opportunity": 0.0, "confidence": confidence,
                "confidence_score": confidence_score, "affected_laps": 0, "clean_laps": len(lap_metrics), "trend": trend, "signals": [],
            })
            continue
        primary = candidates[0]
        corner_payload = {
            "id": corner["id"], "label": corner["label"], "start_pct": start_pct, "end_pct": end_pct,
            "category": primary["category"], "phase": primary["phase"], "opportunity": opportunity, "confidence": confidence,
            "confidence_score": confidence_score, "affected_laps": len(meaningful), "clean_laps": len(lap_metrics), "trend": trend,
            "signals": [{"category": item["category"], "phase": item["phase"], "opportunity": item["opportunity"]} for item in candidates[:2]],
        }
        corners.append(corner_payload)
        for candidate in candidates:
            findings.append({
                "id": f'corner-{corner["id"]}-{candidate["category"].lower().replace(" ", "-")}', "corner_id": corner["id"], "title": candidate["title"],
                "summary": f'{candidate["opportunity"]:.2f}s repeatable opportunity.', "what_happened": candidate["what_happened"],
                "why_it_matters": "This pattern repeats on slower clean laps.",
                "primary_action": candidate["primary_action"], "supporting_action": None, "avoid": candidate["avoid"],
                "category": candidate["category"], "phase": candidate["phase"], "opportunity": candidate["opportunity"], "confidence": confidence, "confidence_score": confidence_score,
                "affected_laps": len(meaningful), "clean_laps": len(lap_metrics), "trend": trend, "start_pct": start_pct, "end_pct": end_pct,
                "affected_lap_numbers": [lap for lap, _, _ in meaningful],
                "reference_lap": target_lap, "relevant_channels": candidate["relevant_channels"],
                "metrics": {"segment_time_delta": candidate["opportunity"], "brake_release_delta_pct": brake_release_delay, "throttle_delta_pct": throttle_delay,
                            "exit_speed_delta": exit_delta, "coast_time_delta": current - target_coast, "steering_correction_delta": correction_delta},
            })
    findings.sort(key=lambda item: item["opportunity"] * item["confidence_score"], reverse=True)
    corners.sort(key=lambda item: item["id"])
    peak_g_values = [math.sqrt(value ** 2 + (_num(row.get("g_force_long")) or 0.0) ** 2) for rows in quality_rows.values() for row in rows if row.get("sample_quality") != "flagged" and (value := _num(row.get("g_force_lat"))) is not None]
    pace_trend = "Stable"
    if len(valid_times) >= 3 and valid_times[-1] is not None and valid_times[0] is not None:
        pace_trend = "Improving" if valid_times[-1] < valid_times[0] - 0.15 else "Degrading" if valid_times[-1] > valid_times[0] + 0.15 else "Stable"
    total_flagged = sum(item["flagged_samples"] for item in quality_by_lap.values())
    quality_status = "Valid" if all(item["state"] == "Valid" for item in quality_by_lap.values()) else "Valid but noisy" if all(item["state"] != "Partially unreliable" for item in quality_by_lap.values()) else "Partially unreliable"
    return {
        "rows": quality_rows,
        "summary": {"best_valid_lap": best.get("lap_time") if best else None, "best_valid_lap_number": best.get("lap_number") if best else None,
                    "representative_pace": median_time, "representative_lap_number": representative_pace_lap.get("lap_number") if representative_pace_lap else None,
                    "robust_consistency": robust_spread, "theoretical_best": theoretical,
                    "time_to_theoretical": (median_time - theoretical) if median_time is not None and theoretical is not None else None,
                    "pace_trend": pace_trend, "robust_peak_combined_g": _percentile(peak_g_values, 0.99),
                    "largest_opportunity_corner": findings[0]["title"].split(" — ")[0] if findings else None},
        "quality": {"status": quality_status, "clean_laps": len(valid_summaries), "excluded_laps": len(summaries) - len(valid_summaries),
                    "flagged_samples": total_flagged, "total_samples": sum(len(rows) for rows in completed.values())},
        "references": {"personal_best_lap": best.get("lap_number") if best else None, "representative_fast_lap": representative_fast.get("lap_number") if representative_fast else None,
                       "representative_pace_lap": representative_pace_lap.get("lap_number") if representative_pace_lap else None},
        "corner_opportunities": corners, "findings": findings,
    }


def analysis_payload(
    buffer: LiveLapBuffer,
    config: VehicleAnalysisConfig,
    selected_lap: int | None = None,
    reference_lap: int | None = None,
    session: dict | None = None,
    analysis_laps: set[int] | None = None,
) -> dict:
    completed = buffer.completed_laps()
    summaries = [lap_summary(lap, rows, config) for lap, rows in completed.items()]
    # Apply the same session-relative guard used by stored sessions.  The live
    # recorder can miss the game's one-tick invalidation flag after a reset, so
    # a suddenly implausible fast lap must not become the coach's reference.
    for summary in summaries:
        summary["in_pit"] = summary.get("in_pits")
        summary["under_yellow"] = summary.get("yellow_flag")
    apply_lap_quality(summaries)
    for summary in summaries:
        summary["automatic_valid_lap"] = summary.get("valid_lap") is True
        summary["included_in_analysis"] = (
            int(summary["lap_number"]) in analysis_laps
            if analysis_laps is not None
            else summary["automatic_valid_lap"]
        )
        if summary.get("invalid_reasons"):
            summary["reason"] = summary.get("reason") or ", ".join(summary["invalid_reasons"])
            summary["reason_codes"] = list(summary["invalid_reasons"])
    if not completed:
        return {
            "session": session or {},
            "laps": [],
            "selected_lap_number": None,
            "reference_lap_number": None,
            "current_lap_data": [],
            "reference_lap_data": [],
            "sectors": sector_summary([], []),
            "insights": [],
            "corners": [],
            "session_summary": {},
            "quality": {"status": "Valid", "clean_laps": 0, "excluded_laps": 0, "flagged_samples": 0, "total_samples": 0},
            "references": {"personal_best_lap": None, "representative_fast_lap": None, "representative_pace_lap": None},
            "corner_opportunities": [],
            "findings": [],
            "metrics": {"session_peak_combined_g": None, "understeer_gradient": None, "load_transfer_geom": None},
        }
    valid_summaries = [summary for summary in summaries if summary.get("included_in_analysis")]
    timed_summaries = valid_summaries or [summary for summary in summaries if summary.get("lap_time") is not None]
    fastest = min(timed_summaries, key=lambda item: item.get("lap_time") if item.get("lap_time") is not None else math.inf) if timed_summaries else summaries[-1]
    session_reference = int(fastest["lap_number"])
    reference = reference_lap if reference_lap in completed else session_reference
    model = _session_model(completed, summaries, config, session_reference)
    selected = selected_lap if selected_lap in completed else int(model["summary"].get("representative_lap_number") or next(reversed(completed.keys())))
    analyzed = analyze_lap(model["rows"][selected], model["rows"][reference], config)
    analyzed.update({
        "session": session or {},
        "laps": summaries,
        "selected_lap_number": selected,
        "reference_lap_number": reference,
        "session_summary": model["summary"],
        "quality": model["quality"],
        "references": model["references"],
        "corner_opportunities": model["corner_opportunities"],
        "findings": model["findings"],
    })
    analyzed["metrics"]["session_peak_combined_g"] = model["summary"]["robust_peak_combined_g"]
    return analyzed
