from __future__ import annotations

import math
from collections import defaultdict
from statistics import mean, pstdev
from typing import Any, Iterable


SUPPORTED_PLOTS = {
    "gg",
    "speed_binned_gg",
    "brake_deceleration",
    "throttle_acceptance",
    "steering_work_lap_time",
    "curvature_consistency",
    "sideslip_curvature",
    "sideslip_phase",
    "gear_chart",
    "engine_power",
    "tyre_temperature_grip",
    "ride_height_speed",
    "front_rear_ride_height",
}

UNAVAILABLE_REQUIREMENTS: dict[str, list[str]] = {
    "lap_time_understeer": ["steering ratio", "wheelbase"],
    "steering_curvature": ["steering ratio"],
    "speed_steering": ["steering ratio"],
    "handling_diagram": ["steering ratio", "wheelbase", "CG-to-axle geometry"],
    "roll_lateral_g": ["front/rear motion ratios", "front/rear track widths"],
    "pitch_longitudinal_g": ["wheelbase"],
    "oil_pressure_lateral_g": ["oil pressure"],
    "dynamic_square": ["per-wheel torque or tyre-force channels", "dynamic tyre radius"],
    "wheel_slip_longitudinal": ["dynamic tyre radius"],
    "steering_lateral_g": ["steering ratio"],
    "steering_yaw_rate": ["steering ratio"],
    "slip_angles_lateral_g": ["steering ratio", "wheelbase", "CG-to-axle geometry"],
}

RAW_ALIASES = {
    "g_force_lat": "g_force_lat",
    "g_force_long": "g_force_long",
    "speed_kph": "speed_kph",
    "rpm": "rpm",
    "gear": "gear",
    "throttle": "throttle",
    "brake": "brake",
    "steering": "steering",
    "fuel_liters": "fuel_liters",
    "lap_number": "lap_number",
    "lap_distance": "lap_distance",
    "game_time": "game_time",
}

SMOOTH_FIELDS = {
    "g_force_lat",
    "g_force_long",
    "yaw_rate",
    "local_velocity_x",
    "local_velocity_z",
    "steering",
}


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _average(values: Iterable[Any]) -> float | None:
    clean = [number for value in values if (number := _finite(value)) is not None]
    return mean(clean) if clean else None


def _moving_average(values: list[float | None], radius: int = 1) -> list[float | None]:
    result: list[float | None] = []
    for index in range(len(values)):
        window = [value for value in values[max(0, index - radius) : index + radius + 1] if value is not None]
        result.append(mean(window) if window else None)
    return result


def _prepare_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    prepared = [dict(row) for row in rows]
    for field in SMOOTH_FIELDS:
        values = [_finite(row.get(field)) for row in prepared]
        for row, value in zip(prepared, _moving_average(values)):
            row[f"_{field}"] = value
    _assign_corners(prepared)
    return prepared


def _assign_corners(rows: list[dict[str, Any]]) -> None:
    per_lap: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        lap = _finite(row.get("lap_number"))
        if lap is not None:
            per_lap[int(lap)].append(row)
    for lap_rows in per_lap.values():
        active = False
        corner_number = 0
        quiet_samples = 0
        for row in lap_rows:
            lateral = abs(_finite(row.get("_g_force_lat")) or 0)
            speed = _finite(row.get("speed_kph")) or 0
            if lateral >= 0.22 and speed >= 30:
                if not active:
                    corner_number += 1
                    active = True
                quiet_samples = 0
                row["corner_id"] = f"C{corner_number}"
            elif active:
                quiet_samples += 1
                if quiet_samples <= 3:
                    row["corner_id"] = f"C{corner_number}"
                else:
                    active = False
                    quiet_samples = 0


def _ride_height_mm(value: Any) -> float | None:
    number = _finite(value)
    if number is None:
        return None
    return number * 1000 if abs(number) < 2 else number


def _brake_pressure(row: dict[str, Any]) -> float | None:
    pressure = _average(row.get(key) for key in ("brake_pressure_fl", "brake_pressure_fr"))
    return pressure if pressure is not None else _finite(row.get("brake"))


def _tyre_temperature(row: dict[str, Any]) -> float | None:
    values: list[Any] = []
    for wheel in ("fl", "fr", "rl", "rr"):
        for band in ("left", "center", "right"):
            values.append(row.get(f"tyre_temp_{wheel}_{band}"))
        values.append(row.get(f"tyre_temp_{wheel}"))
    return _average(values)


def _combined_g(row: dict[str, Any]) -> float | None:
    gx = _finite(row.get("_g_force_long"))
    gy = _finite(row.get("_g_force_lat"))
    return math.hypot(gx, gy) if gx is not None and gy is not None else None


def _curvature(row: dict[str, Any]) -> float | None:
    speed = (_finite(row.get("speed_kph")) or 0) / 3.6
    if speed < 5:
        return None
    yaw = _finite(row.get("_yaw_rate"))
    if yaw is not None:
        return yaw / speed
    lateral_g = _finite(row.get("_g_force_lat"))
    return lateral_g * 9.80665 / (speed * speed) if lateral_g is not None else None


def _sideslip(row: dict[str, Any]) -> float | None:
    lateral = _finite(row.get("_local_velocity_x"))
    longitudinal = _finite(row.get("_local_velocity_z"))
    if lateral is None or longitudinal is None or abs(longitudinal) < 1:
        return None
    return math.atan2(lateral, longitudinal)


def _point(row: dict[str, Any], x: Any, y: Any, series: str = "Data") -> dict[str, Any] | None:
    x_value, y_value = _finite(x), _finite(y)
    if x_value is None or y_value is None:
        return None
    return {
        "x": x_value,
        "y": y_value,
        "series": series,
        "lap": row.get("lap_number"),
        "corner": row.get("corner_id"),
        "speed": row.get("speed_kph"),
        "throttle": row.get("throttle"),
        "brake": row.get("brake"),
        "tyre_condition": _average(row.get(f"tyre_wear_{wheel}") for wheel in ("fl", "fr", "rl", "rr")),
        "fuel": row.get("fuel_liters"),
        "timestamp": row.get("timestamp"),
    }


def _filter_rows(rows: list[dict[str, Any]], filters: dict[str, Any], valid_laps: set[int]) -> list[dict[str, Any]]:
    selected_laps = {int(value) for value in filters.get("laps", [])}
    selected_corners = set(filters.get("corners", []))
    speed_min, speed_max = _finite(filters.get("speed_min")), _finite(filters.get("speed_max"))
    fuel_min, fuel_max = _finite(filters.get("fuel_min")), _finite(filters.get("fuel_max"))
    compound = str(filters.get("compound") or "")
    valid_only = bool(filters.get("valid_only", True))
    result: list[dict[str, Any]] = []
    for row in rows:
        lap = int(_finite(row.get("lap_number")) or -1)
        speed = _finite(row.get("speed_kph"))
        fuel = _finite(row.get("fuel_liters"))
        if valid_only and valid_laps and lap not in valid_laps:
            continue
        if selected_laps and lap not in selected_laps:
            continue
        if selected_corners and row.get("corner_id") not in selected_corners:
            continue
        if speed_min is not None and (speed is None or speed < speed_min):
            continue
        if speed_max is not None and (speed is None or speed > speed_max):
            continue
        if fuel_min is not None and (fuel is None or fuel < fuel_min):
            continue
        if fuel_max is not None and (fuel is None or fuel > fuel_max):
            continue
        if compound and compound not in {row.get("tyre_compound_front"), row.get("tyre_compound_rear")}:
            continue
        result.append(row)
    return result


def _lap_time_map(laps: list[dict[str, Any]]) -> dict[int, float]:
    return {
        int(number): time
        for lap in laps
        if (number := _finite(lap.get("lap_number"))) is not None
        and (time := _finite(lap.get("lap_time"))) is not None
    }


def _calculate_points(
    plot_id: str,
    rows: list[dict[str, Any]],
    laps: list[dict[str, Any]],
    x_channel: str | None,
    y_channel: str | None,
) -> tuple[list[dict[str, Any]], str, str, str, str]:
    points: list[dict[str, Any] | None] = []
    x_label, y_label, x_unit, y_unit = "X", "Y", "", ""
    if plot_id == "custom":
        x_key, y_key = x_channel or "lap_number", y_channel or "speed_kph"
        points = [_point(row, row.get(x_key), row.get(y_key)) for row in rows]
        return [p for p in points if p], x_key, y_key, "", ""
    if plot_id in {"gg", "speed_binned_gg"}:
        x_label, y_label, x_unit, y_unit = "Lateral acceleration", "Longitudinal acceleration", "G", "G"
        for row in rows:
            series = "Data"
            if plot_id == "speed_binned_gg":
                speed = _finite(row.get("speed_kph")) or 0
                series = "<100 km/h" if speed < 100 else "100–180 km/h" if speed < 180 else "180+ km/h"
            points.append(_point(row, row.get("_g_force_lat"), row.get("_g_force_long"), series))
    elif plot_id == "brake_deceleration":
        x_label, y_label, x_unit, y_unit = "Brake pressure", "Deceleration", "", "G"
        for row in rows:
            pressure = _brake_pressure(row)
            longitudinal_g = _finite(row.get("_g_force_long"))
            if pressure is not None and pressure > 0.02 and longitudinal_g is not None:
                points.append(_point(row, pressure, -longitudinal_g))
    elif plot_id == "throttle_acceptance":
        x_label, y_label, x_unit, y_unit = "Peak lateral acceleration", "Acceptance at 90% throttle", "G", "%"
        groups: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            if row.get("corner_id"):
                groups[(int(_finite(row.get("lap_number")) or -1), str(row["corner_id"]))].append(row)
        for group in groups.values():
            apex = max(range(len(group)), key=lambda index: abs(_finite(group[index].get("_g_force_lat")) or 0))
            peak_lateral_g = abs(_finite(group[apex].get("_g_force_lat")) or 0)
            if peak_lateral_g <= 0:
                continue
            accepted = next(
                (
                    row
                    for row in group[apex:]
                    if (_finite(row.get("throttle")) or 0) >= 0.9
                    and _finite(row.get("_g_force_lat")) is not None
                ),
                None,
            )
            if accepted is not None:
                accepted_lateral_g = abs(_finite(accepted.get("_g_force_lat")) or 0)
                points.append(_point(accepted, peak_lateral_g, accepted_lateral_g / peak_lateral_g * 100))
    elif plot_id == "steering_work_lap_time":
        x_label, y_label, x_unit, y_unit = "Steering activity", "Lap time", "normalized", "s"
        times = _lap_time_map(laps)
        groups: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            groups[int(_finite(row.get("lap_number")) or -1)].append(row)
        for lap, group in groups.items():
            steering = [_finite(row.get("_steering")) for row in group]
            activity = sum(abs(right - left) for left, right in zip(steering, steering[1:]) if left is not None and right is not None)
            points.append(_point(group[-1], activity, times.get(lap)))
    elif plot_id == "curvature_consistency":
        x_label, y_label, y_unit = "Lap", "Peak curvature", "1/m"
        groups: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            if row.get("corner_id"):
                groups[(int(_finite(row.get("lap_number")) or -1), str(row["corner_id"]))].append(row)
        for (lap, corner), group in groups.items():
            values = [abs(value) for row in group if (value := _curvature(row)) is not None]
            points.append(_point(group[-1], lap, max(values) if values else None, corner))
    elif plot_id == "sideslip_curvature":
        x_label, y_label, x_unit, y_unit = "Curvature", "Vehicle sideslip", "1/m", "rad"
        points = [_point(row, _curvature(row), _sideslip(row)) for row in rows]
    elif plot_id == "sideslip_phase":
        x_label, y_label, x_unit, y_unit = "Vehicle sideslip", "Sideslip rate", "rad", "rad/s"
        betas = [_sideslip(row) for row in rows]
        for index in range(1, len(rows) - 1):
            before, after = betas[index - 1], betas[index + 1]
            t_before, t_after = _finite(rows[index - 1].get("game_time")), _finite(rows[index + 1].get("game_time"))
            rate = (after - before) / (t_after - t_before) if before is not None and after is not None and t_before is not None and t_after is not None and t_after > t_before else None
            points.append(_point(rows[index], betas[index], rate))
    elif plot_id == "gear_chart":
        x_label, y_label, x_unit, y_unit = "Vehicle speed", "Engine speed", "km/h", "rpm"
        points = [_point(row, row.get("speed_kph"), row.get("rpm"), f"Gear {int(_finite(row.get('gear')) or 0)}") for row in rows if (_finite(row.get("gear")) or 0) > 0]
    elif plot_id == "engine_power":
        x_label, y_label, x_unit, y_unit = "Engine speed", "Calculated power", "rpm", "kW"
        points = [
            _point(row, row.get("rpm"), (_finite(row.get("engine_torque")) or 0) * (_finite(row.get("rpm")) or 0) / 9549)
            for row in rows
            if (_finite(row.get("throttle")) or 0) >= 0.95 and (_finite(row.get("engine_torque")) or 0) > 0
        ]
    elif plot_id == "tyre_temperature_grip":
        x_label, y_label, x_unit, y_unit = "Average tyre temperature", "Combined grip", "°C", "G"
        points = [_point(row, _tyre_temperature(row), _combined_g(row)) for row in rows]
    elif plot_id == "ride_height_speed":
        x_label, y_label, x_unit, y_unit = "Vehicle speed", "Ride height", "km/h", "mm"
        for row in rows:
            points.append(_point(row, row.get("speed_kph"), _ride_height_mm(row.get("front_ride_height")), "Front"))
            points.append(_point(row, row.get("speed_kph"), _ride_height_mm(row.get("rear_ride_height")), "Rear"))
    elif plot_id == "front_rear_ride_height":
        x_label, y_label, x_unit, y_unit = "Front ride height", "Rear ride height", "mm", "mm"
        points = [_point(row, _ride_height_mm(row.get("front_ride_height")), _ride_height_mm(row.get("rear_ride_height"))) for row in rows]
    return [point for point in points if point], x_label, y_label, x_unit, y_unit


def _stats(points: list[dict[str, Any]]) -> dict[str, float | int | None]:
    values = [float(point["y"]) for point in points]
    if not values:
        return {"min": None, "max": None, "average": None, "std_dev": None, "count": 0}
    return {
        "min": min(values),
        "max": max(values),
        "average": mean(values),
        "std_dev": pstdev(values),
        "count": len(values),
    }


def _trend(points: list[dict[str, Any]]) -> list[dict[str, float]]:
    if len(points) < 2:
        return []
    xs, ys = [float(p["x"]) for p in points], [float(p["y"]) for p in points]
    x_mean, y_mean = mean(xs), mean(ys)
    denominator = sum((x - x_mean) ** 2 for x in xs)
    if denominator <= 0:
        return []
    slope = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, ys)) / denominator
    intercept = y_mean - slope * x_mean
    return [{"x": x, "y": slope * x + intercept} for x in (min(xs), max(xs))]


def _percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] * (upper - position) + ordered[upper] * (position - lower)


def _envelope(points: list[dict[str, Any]], bins: int = 12) -> list[dict[str, float]]:
    if len(points) < 12:
        return []
    min_x, max_x = min(float(p["x"]) for p in points), max(float(p["x"]) for p in points)
    span = max_x - min_x
    if span <= 0:
        return []
    grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for point in points:
        grouped[min(bins - 1, int((float(point["x"]) - min_x) / span * bins))].append(point)
    result = []
    for index in sorted(grouped):
        group = grouped[index]
        if len(group) < 3:
            continue
        ys = [float(point["y"]) for point in group]
        result.append({"x": mean(float(point["x"]) for point in group), "low": _percentile(ys, 0.05), "high": _percentile(ys, 0.95)})
    return result


def _downsample(points: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    if len(points) <= limit:
        return points
    step = len(points) / limit
    return [points[min(len(points) - 1, int(index * step))] for index in range(limit)]


def build_xy_plot(
    rows: list[dict[str, Any]],
    laps: list[dict[str, Any]],
    *,
    plot_id: str,
    x_channel: str | None = None,
    y_channel: str | None = None,
    filters: dict[str, Any] | None = None,
    color_by: str = "speed",
    include_trend: bool = False,
    include_envelope: bool = False,
    max_points: int = 5000,
) -> dict[str, Any]:
    filters = filters or {}
    if plot_id not in SUPPORTED_PLOTS and plot_id != "custom":
        requirements = UNAVAILABLE_REQUIREMENTS.get(plot_id, ["required telemetry channels"])
        return {
            "plot_id": plot_id,
            "available": False,
            "missing_requirements": requirements,
            "warnings": [f"Unavailable: requires {', '.join(requirements)}."],
            "points": [],
            "trend": [],
            "envelope": [],
            "stats": _stats([]),
        }
    prepared = _prepare_rows(rows)
    valid_laps = {
        int(number)
        for lap in laps
        if lap.get("valid_lap") is not False
        and not lap.get("in_pit")
        and (number := _finite(lap.get("lap_number"))) is not None
    }
    filtered = _filter_rows(prepared, filters, valid_laps)
    points, x_label, y_label, x_unit, y_unit = _calculate_points(plot_id, filtered, laps, x_channel, y_channel)
    available_fields = sorted(
        key
        for key in {key for row in rows for key, value in row.items() if _finite(value) is not None}
        if not key.startswith("_")
    )
    compounds = sorted(
        {
            str(value)
            for row in rows
            for value in (row.get("tyre_compound_front"), row.get("tyre_compound_rear"))
            if value
        }
    )
    corners = sorted({str(row["corner_id"]) for row in prepared if row.get("corner_id")}, key=lambda value: int(value[1:]))
    lap_options = sorted({int(value) for row in rows if (value := _finite(row.get("lap_number"))) is not None})
    warnings: list[str] = []
    if not points:
        warnings.append("No points match the selected plot and filters, or required channels were not recorded for this session.")
    full_points = points
    return {
        "plot_id": plot_id,
        "available": bool(points),
        "missing_requirements": [] if points else ["recorded samples for the required channels"],
        "warnings": warnings,
        "axes": {
            "x": {"label": x_label, "unit": x_unit},
            "y": {"label": y_label, "unit": y_unit},
        },
        "points": _downsample(points, max(10, min(10000, max_points))),
        "trend": _trend(full_points) if include_trend else [],
        "envelope": _envelope(full_points) if include_envelope else [],
        "stats": _stats(full_points),
        "available_fields": available_fields,
        "filter_options": {
            "laps": lap_options,
            "corners": corners,
            "compounds": compounds,
            "drivers": ["Player"],
            "setups": [],
        },
        "applied_filters": filters,
        "color_by": color_by,
        "source_count": len(rows),
        "filtered_count": len(filtered),
    }
