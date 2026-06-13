from __future__ import annotations

import math
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any

from app.schemas.telemetry import TelemetrySnapshot


WHEELS = ("fl", "fr", "rl", "rr")
GRAVITY = 9.80665


@dataclass(frozen=True)
class VehicleAnalysisConfig:
    poll_hz: int = 10
    retained_laps: int = 10
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


def is_valid_lap(rows: list[dict], config: VehicleAnalysisConfig) -> bool:
    if len(rows) < max(8, config.poll_hz * 20):
        return False
    if any(row.get("lap_invalidated") is True or row.get("in_pits") is True or row.get("yellow_flag") is True for row in rows):
        return False
    start = _time(rows[0])
    end = _time(rows[-1])
    duration = end - start if start is not None and end is not None else None
    return duration is not None and 40 <= duration <= 900


def lap_summary(lap_number: int, rows: list[dict]) -> dict:
    start = _time(rows[0])
    end = _time(rows[-1])
    return {
        "lap_number": lap_number,
        "lap_time": end - start if start is not None and end is not None else None,
        "sample_count": len(rows),
        "top_speed": _max([_num(row.get("speed_kph")) for row in rows]),
    }


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
        entry = brake > 5 or steer > steer_entry or lat_g > 0.45
        exit_ready = throttle > 80 and steer < max(0.04, max_steer * 0.25) and lat_g < 0.35
        if not in_corner and entry:
            in_corner = True
            start = t
            below_count = 0
        elif in_corner:
            below_count = below_count + 1 if exit_ready else 0
            if below_count >= 2 and start is not None:
                windows.append((start, t))
                in_corner = False
                start = None
    if in_corner and start is not None:
        windows.append((start, _time(rows[-1]) or start))
    merged: list[tuple[float, float]] = []
    for start, end in windows:
        if not merged or start - merged[-1][1] > 0.4:
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


def analysis_payload(buffer: LiveLapBuffer, config: VehicleAnalysisConfig, selected_lap: int | None = None, reference_lap: int | None = None, session: dict | None = None) -> dict:
    valid = buffer.valid_laps()
    summaries = [lap_summary(lap, rows) for lap, rows in valid.items()]
    if not valid:
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
            "metrics": {"session_peak_combined_g": None, "understeer_gradient": None, "load_transfer_geom": None},
        }
    fastest = min(summaries, key=lambda item: item.get("lap_time") if item.get("lap_time") is not None else math.inf)
    selected = selected_lap if selected_lap in valid else next(reversed(valid.keys()))
    reference = reference_lap if reference_lap in valid else int(fastest["lap_number"])
    analyzed = analyze_lap(valid[selected], valid[reference], config)
    analyzed.update({
        "session": session or {},
        "laps": summaries,
        "selected_lap_number": selected,
        "reference_lap_number": reference,
    })
    return analyzed
