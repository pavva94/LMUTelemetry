from __future__ import annotations

import hashlib
import gc
import json
import math
import os
import re
import threading
import uuid
from collections import OrderedDict
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Any, Callable

from sqlalchemy import delete, desc, func, select

from app.db.database import SessionLocal
from app.db.models import AppSettingModel, LmuDuckdbLapModel, LmuDuckdbSessionModel, LmuDuckdbSyncRunModel
from app.analysis.lap_quality import apply_lap_quality


try:
    import duckdb
except ImportError:  # pragma: no cover - exercised only before dependencies are installed.
    duckdb = None


DUCKDB_EXTENSIONS = {".duckdb", ".db", ".ddb"}
MAX_REVIEW_ROWS = 200_000
DEFAULT_SCAN_LIMIT = 250
MAX_SCAN_LIMIT = 1000
FOLDER_SETTING_KEY = "lmu_duckdb_folder"
SYNC_STATUS_SETTING_KEY = "lmu_duckdb_last_sync_status"
SYNC_AT_SETTING_KEY = "lmu_duckdb_last_sync_at"
DEFAULT_WINDOWS_TELEMETRY_FOLDER = Path("G:/SteamLibrary/steamapps/common/Le Mans Ultimate/UserData/Telemetry")
LMU_TELEMETRY_RELATIVE_PATH = Path("steamapps/common/Le Mans Ultimate/UserData/Telemetry")
ProgressCallback = Callable[[str, str, int, int, int], None]
_REVIEW_CACHE_LIMIT = 8
_review_cache: OrderedDict[tuple[str, str, int], dict] = OrderedDict()
_review_cache_lock = Lock()
_sync_thread_lock = Lock()
_sync_threads: dict[str, threading.Thread] = {}
_SYNC_ACTIVE_STATUSES = {"queued", "running"}


def _report(progress: ProgressCallback | None, phase: str, message: str, completed: int, total: int, percentage: int) -> None:
    if progress:
        progress(phase, message, completed, total, percentage)


def _clear_review_cache(session_id: str | None = None) -> None:
    with _review_cache_lock:
        if session_id is None:
            _review_cache.clear()
            return
        for key in [key for key in _review_cache if key[0] == session_id]:
            _review_cache.pop(key, None)


CHANNEL_ALIASES: dict[str, tuple[str, ...]] = {
    "game_time": ("GPS Time", "Time", "Session Elapsed Time", "timestamp", "time", "game_time"),
    "lap_number": ("Lap", "Lap Number", "lap_number", "lap"),
    "lap_distance": ("Lap Dist", "Lap Distance", "lap_distance"),
    "speed_kph": ("Ground Speed", "GPS Speed", "Speed", "speed_kph"),
    "rpm": ("Engine RPM", "RPM", "rpm"),
    "gear": ("Gear", "gear"),
    "fuel_liters": ("Fuel Level", "fuel_liters", "Fuel"),
    "throttle": ("Throttle Pos", "Throttle Pos Unfiltered", "Throttle", "throttle"),
    "brake": ("Brake Pos", "Brake Pos Unfiltered", "Brake", "brake"),
    "steering": ("Steering Pos", "Steered Angle", "Steering Pos Unfiltered", "Steering", "steering"),
    "track_temp": ("Track Temperature", "track_temp"),
    "ambient_temp": ("Ambient Temperature", "ambient_temp"),
    "engine_oil_temp": ("Engine Oil Temp", "Eng Oil Temp", "engine_oil_temp"),
    "engine_water_temp": ("Engine Water Temp", "Eng Water Temp", "engine_water_temp"),
    "brake_temp_fl": ("Brake Temp FL", "Brakes Temp FL", "brake_temp_fl"),
    "brake_temp_fr": ("Brake Temp FR", "Brakes Temp FR", "brake_temp_fr"),
    "brake_temp_rl": ("Brake Temp RL", "Brakes Temp RL", "brake_temp_rl"),
    "brake_temp_rr": ("Brake Temp RR", "Brakes Temp RR", "brake_temp_rr"),
    "tyre_wear_fl": ("Tyre Wear FL", "Tyres Wear FL", "tyre_wear_fl"),
    "tyre_wear_fr": ("Tyre Wear FR", "Tyres Wear FR", "tyre_wear_fr"),
    "tyre_wear_rl": ("Tyre Wear RL", "Tyres Wear RL", "tyre_wear_rl"),
    "tyre_wear_rr": ("Tyre Wear RR", "Tyres Wear RR", "tyre_wear_rr"),
    "tyre_pressure_fl": ("Tyre Pressure FL", "TyresPressure FL", "tyre_pressure_fl"),
    "tyre_pressure_fr": ("Tyre Pressure FR", "TyresPressure FR", "tyre_pressure_fr"),
    "tyre_pressure_rl": ("Tyre Pressure RL", "TyresPressure RL", "tyre_pressure_rl"),
    "tyre_pressure_rr": ("Tyre Pressure RR", "TyresPressure RR", "tyre_pressure_rr"),
    "tyre_temp_fl": ("Tyre Temp FL", "TyresTempCentre FL", "TyresCarcassTemp FL", "tyre_temp_fl"),
    "tyre_temp_fr": ("Tyre Temp FR", "TyresTempCentre FR", "TyresCarcassTemp FR", "tyre_temp_fr"),
    "tyre_temp_rl": ("Tyre Temp RL", "TyresTempCentre RL", "TyresCarcassTemp RL", "tyre_temp_rl"),
    "tyre_temp_rr": ("Tyre Temp RR", "TyresTempCentre RR", "TyresCarcassTemp RR", "tyre_temp_rr"),
    "ride_height_fl": ("Ride Height FL", "RideHeights FL", "ride_height_fl"),
    "ride_height_fr": ("Ride Height FR", "RideHeights FR", "ride_height_fr"),
    "ride_height_rl": ("Ride Height RL", "RideHeights RL", "ride_height_rl"),
    "ride_height_rr": ("Ride Height RR", "RideHeights RR", "ride_height_rr"),
    "in_pits": ("In Pits", "in_pits"),
    "position": ("Position", "position"),
    "class_position": ("Class Position", "class_position"),
    "last_lap_time": ("Last LapTime", "Lap Time", "last_lap_time"),
    "current_lap_time": ("Current LapTime", "current_lap_time"),
    "best_lap_time": ("Best LapTime", "best_lap_time"),
    "sector": ("Current Sector", "sector", "current_sector"),
    "sector1": ("Current Sector1", "Sector 1", "sector1"),
    "sector2": ("Current Sector2", "Sector 2", "sector2"),
    "last_sector1": ("Last Sector1", "last_sector1"),
    "last_sector2": ("Last Sector2", "last_sector2"),
    "best_sector1": ("Best Sector1", "best_sector1"),
    "best_sector2": ("Best Sector2", "best_sector2"),
    "sector1_flag": ("Sector1 Flag", "sector1_flag"),
    "sector2_flag": ("Sector2 Flag", "sector2_flag"),
    "sector3_flag": ("Sector3 Flag", "sector3_flag"),
    "yellow_flag_state": ("Yellow Flag State", "yellow_flag_state"),
    "abs_active": ("ABS", "abs_active"),
    "abs_level": ("ABSLevel", "ABS Level", "abs_level"),
    "tc_active": ("TC", "tc_active"),
    "tc_level": ("TCLevel", "TC Level", "tc_level"),
    "tc_cut": ("TCCut", "TC Cut", "tc_cut"),
    "tc_slip_angle": ("TCSlipAngle", "TC Slip Angle", "tc_slip_angle"),
    "fuel_mixture_map": ("FuelMixtureMap", "Fuel Mixture Map", "fuel_mixture_map"),
    "brake_bias_rear": ("Brake Bias Rear", "brake_bias_rear"),
    "brake_migration": ("Brake Migration", "brake_migration"),
    "front_flap_active": ("FrontFlapActivated", "Front Flap Activated", "front_flap_active"),
    "rear_flap_active": ("RearFlapActivated", "Rear Flap Activated", "rear_flap_active"),
    "rear_flap_legal": ("RearFlapLegalStatus", "Rear Flap Legal Status", "rear_flap_legal"),
    "speed_limiter": ("Speed Limiter", "speed_limiter"),
    "headlights": ("Headlights State", "headlights"),
    "finish_status": ("Finish Status", "finish_status"),
    "minimum_path_wetness": ("Minimum Path Wetness", "minimum_path_wetness"),
    "offpath_wetness": ("OffpathWetness", "offpath_wetness"),
    "cloud_darkness": ("CloudDarkness", "cloud_darkness"),
    "wind_heading": ("Wind Heading", "wind_heading"),
    "wind_speed": ("Wind Speed", "wind_speed"),
    "gps_latitude": ("GPS Latitude", "gps_latitude"),
    "gps_longitude": ("GPS Longitude", "gps_longitude"),
    "g_force_lat": ("G Force Lat", "g_force_lat"),
    "g_force_long": ("G Force Long", "g_force_long"),
    "g_force_vert": ("G Force Vert", "g_force_vert"),
    "total_distance": ("Total Dist", "Total Distance", "total_distance"),
    "path_lateral": ("Path Lateral", "path_lateral"),
    "track_edge": ("Track Edge", "track_edge"),
    "front_ride_height": ("FrontRideHeight", "Front Ride Height", "front_ride_height"),
    "rear_ride_height": ("RearRideHeight", "Rear Ride Height", "rear_ride_height"),
    "front_3rd_deflection": ("Front3rdDeflection", "front_3rd_deflection"),
    "rear_3rd_deflection": ("Rear3rdDeflection", "rear_3rd_deflection"),
    "turbo_boost_pressure": ("Turbo Boost Pressure", "turbo_boost_pressure"),
    "soc": ("SoC", "soc"),
    "virtual_energy": ("Virtual Energy", "virtual_energy"),
    "regen_rate": ("Regen Rate", "regen_rate"),
    "clutch": ("Clutch Pos", "Clutch", "clutch"),
    "clutch_unfiltered": ("Clutch Pos Unfiltered", "clutch_unfiltered"),
    "clutch_rpm": ("Clutch RPM", "clutch_rpm"),
    "ffb_output": ("FFB Output", "ffb_output"),
    "steering_shaft_torque": ("Steering Shaft Torque", "steering_shaft_torque"),
    "overheating_state": ("OverheatingState", "overheating_state"),
    "time_behind_next": ("Time Behind Next", "time_behind_next"),
    "last_impact_magnitude": ("LastImpactMagnitude", "Last Impact Magnitude", "last_impact_magnitude"),
    "anti_stall_active": ("AntiStall Activated", "Anti Stall Activated", "anti_stall_active"),
}

VECTOR_ALIASES: dict[str, tuple[str, ...]] = {
    "brake_temp": ("Brakes Temp",),
    "brake_air_temp": ("Brakes Air Temp",),
    "brake_force": ("Brakes Force",),
    "brake_thickness": ("Brake Thickness",),
    "tyre_wear": ("Tyres Wear",),
    "tyre_pressure": ("TyresPressure",),
    "tyre_temp": ("TyresTempCentre", "TyresCarcassTemp", "TyresRubberTemp"),
    "tyre_temp_carcass": ("TyresCarcassTemp",),
    "tyre_temp_rim": ("TyresRimTemp",),
    "tyre_temp_rubber": ("TyresRubberTemp",),
    "tyre_temp_left": ("TyresTempLeft",),
    "tyre_temp_centre": ("TyresTempCentre",),
    "tyre_temp_right": ("TyresTempRight",),
    "tyre_compound": ("TyresCompound",),
    "ride_height": ("RideHeights",),
    "suspension_position": ("Susp Pos",),
    "wheel_speed": ("Wheel Speed",),
    "surface_type": ("SurfaceTypes",),
    "wheels_detached": ("WheelsDetached",),
}

WHEELS = ("fl", "fr", "rl", "rr")


@dataclass
class TableInfo:
    schema: str
    name: str
    columns: list[str]
    count: int
    mapped: dict[str, str]
    vector_mapped: dict[str, str]
    score: int


@dataclass
class ChannelLayout:
    schema: str
    mapped: dict[str, str]
    vector_mapped: dict[str, str]
    frequencies: dict[str, int]
    units: dict[str, str]
    counts: dict[str, int]
    count: int


def _require_duckdb() -> None:
    if duckdb is None:
        raise RuntimeError("Session file support is not installed. Run `pip install -r backend/requirements.txt` and restart the backend.")


def _norm(value: str) -> str:
    return "".join(ch.lower() for ch in value if ch.isalnum())


def _quote_ident(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _quote_table(schema: str, table: str) -> str:
    return f"{_quote_ident(schema)}.{_quote_ident(table)}"


def _quote_named_table(schema: str, tables: dict[str, tuple[str, list[str]]], name: str) -> str:
    table, _columns = tables[name]
    return _quote_table(schema, table)


def _num(value: Any) -> float | None:
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    if isinstance(value, str):
        try:
            parsed = float(value.strip())
        except ValueError:
            return None
        return parsed if math.isfinite(parsed) else None
    return None


def _bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "y"}:
            return True
        if lowered in {"0", "false", "no", "n"}:
            return False
    return None


def _avg(values: list[float | None]) -> float | None:
    clean = [value for value in values if value is not None and math.isfinite(value)]
    return sum(clean) / len(clean) if clean else None


def _max(values: list[float | None]) -> float | None:
    clean = [value for value in values if value is not None and math.isfinite(value)]
    return max(clean) if clean else None


def _quantile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[int(position)]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def _without_outliers(values: list[float | None]) -> list[float]:
    clean = [value for value in values if value is not None and math.isfinite(value)]
    if len(clean) < 4:
        return clean

    q1 = _quantile(clean, 0.25)
    q3 = _quantile(clean, 0.75)
    if q1 is not None and q3 is not None and q3 > q1:
        iqr = q3 - q1
        lower = max(0.0, q1 - (1.5 * iqr))
        upper = q3 + (1.5 * iqr)
        filtered = [value for value in clean if lower <= value <= upper]
        return filtered or clean

    median = _quantile(clean, 0.5)
    if median is None:
        return clean
    deviations = [abs(value - median) for value in clean]
    mad = _quantile(deviations, 0.5)
    if not mad:
        return clean
    filtered = [value for value in clean if abs(value - median) / mad <= 3.5]
    return filtered or clean


def _without_outlier_items(items: list[dict], field: str, minimum: float | None = None, maximum: float | None = None) -> list[dict]:
    values = []
    keyed: list[tuple[dict, float]] = []
    for item in items:
        value = _num(item.get(field))
        if value is None:
            continue
        if minimum is not None and value < minimum:
            continue
        if maximum is not None and value > maximum:
            continue
        values.append(value)
        keyed.append((item, value))
    clean_values = _without_outliers(values)
    if not clean_values:
        return []
    remaining: dict[float, int] = {}
    for value in clean_values:
        remaining[value] = remaining.get(value, 0) + 1
    filtered = []
    for item, value in keyed:
        count = remaining.get(value, 0)
        if count <= 0:
            continue
        filtered.append(item)
        remaining[value] = count - 1
    return filtered


def _tyre_wear_used_fraction(value: float | None) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    if 0 <= value <= 1:
        return 1.0 - value
    if 1 < value <= 100:
        return (100.0 - value) / 100.0
    return None


def _normalize_native_tyre_wear(rows: list[dict]) -> None:
    for row in rows:
        for wheel in WHEELS:
            key = f"tyre_wear_{wheel}"
            if key in row:
                row[key] = _tyre_wear_used_fraction(_num(row.get(key)))


def _session_id(path: Path) -> str:
    stat = path.stat()
    payload = f"{path.resolve()}|{stat.st_size}|{stat.st_mtime_ns}"
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]


def _file_key(path: Path) -> str:
    return hashlib.sha1(str(path.resolve()).encode("utf-8")).hexdigest()[:16]


def _file_signature(path: Path) -> str:
    stat = path.stat()
    payload = f"{path.resolve()}|{stat.st_size}|{stat.st_mtime_ns}"
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def _iso_mtime(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime).isoformat()


def _metadata(conn) -> dict[str, str]:
    try:
        rows = conn.execute('select "key", "value" from metadata').fetchall()
    except Exception:
        return {}
    return {str(key): str(value) for key, value in rows if key is not None and value is not None}


def _metadata_value(metadata: dict[str, str], aliases: tuple[str, ...]) -> str | None:
    by_norm = {_norm(key): value for key, value in metadata.items()}
    return next((by_norm[_norm(alias)] for alias in aliases if _norm(alias) in by_norm and by_norm[_norm(alias)]), None)


def _file_session(path: Path, info: TableInfo | ChannelLayout | None, warnings: list[str], metadata: dict[str, str] | None = None) -> dict:
    stat = path.stat()
    metadata = metadata or {}
    return {
        "id": _session_id(path),
        "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        "track_name": _metadata_value(metadata, ("track", "track_name", "trackName", "circuit", "venue")),
        "track_layout": _metadata_value(metadata, ("layout", "track_layout", "trackLayout")),
        "session_type": _metadata_value(metadata, ("session", "session_type", "sessionType", "session_name", "sessionName")) or "LMU session",
        "vehicle_name": _metadata_value(metadata, ("vehicle", "vehicle_name", "vehicleName", "car", "car_name", "carName")),
        "vehicle_model": _metadata_value(metadata, ("vehicle_model", "vehicleModel", "car_model", "carModel")),
        "vehicle_class": _metadata_value(metadata, ("vehicle_class", "vehicleClass", "car_class", "carClass", "class")),
        "started_at_game_time": None,
        "ended_at_game_time": None,
        "final_position": None,
        "final_class_position": None,
        "classified_status": None,
        "sample_count": info.count if info else None,
        "latest_lap_number": None,
        "latest_game_time": None,
        "file_name": path.name,
        "file_path": str(path),
        "file_size_bytes": stat.st_size,
        "metadata": metadata,
        "warnings": warnings,
    }


def _open(path: Path):
    _require_duckdb()
    return duckdb.connect(str(path), read_only=True)


def _close(conn) -> None:
    conn.close()
    gc.collect()


def _tables(conn) -> list[tuple[str, str]]:
    rows = conn.execute(
        """
        select table_schema, table_name
        from information_schema.tables
        where table_schema not in ('pg_catalog', 'information_schema')
          and table_type = 'BASE TABLE'
        order by table_schema, table_name
        """
    ).fetchall()
    return [(str(schema), str(table)) for schema, table in rows]


def _columns(conn, schema: str, table: str) -> list[str]:
    rows = conn.execute(
        """
        select column_name
        from information_schema.columns
        where table_schema = ? and table_name = ?
        order by ordinal_position
        """,
        [schema, table],
    ).fetchall()
    return [str(row[0]) for row in rows]


def _match_columns(columns: list[str]) -> tuple[dict[str, str], dict[str, str], int]:
    by_norm = {_norm(column): column for column in columns}
    mapped: dict[str, str] = {}
    vector_mapped: dict[str, str] = {}
    for target, aliases in CHANNEL_ALIASES.items():
        match = next((by_norm.get(_norm(alias)) for alias in aliases if _norm(alias) in by_norm), None)
        if match:
            mapped[target] = match
    for target, aliases in VECTOR_ALIASES.items():
        match = next((by_norm.get(_norm(alias)) for alias in aliases if _norm(alias) in by_norm), None)
        if match:
            vector_mapped[target] = match
    important = {"game_time", "speed_kph", "rpm", "throttle", "brake", "steering", "fuel_liters", "lap_number"}
    score = sum(4 if key in important else 1 for key in mapped) + len(vector_mapped) * 2
    if "game_time" not in mapped:
        score -= 8
    if "speed_kph" not in mapped:
        score -= 4
    return mapped, vector_mapped, score


def _best_table(conn) -> tuple[TableInfo | None, list[str]]:
    warnings: list[str] = []
    best: TableInfo | None = None
    for schema, table in _tables(conn):
        columns = _columns(conn, schema, table)
        if not columns:
            continue
        try:
            count = int(conn.execute(f"select count(*) from {_quote_table(schema, table)}").fetchone()[0] or 0)
        except Exception as exc:
            warnings.append(f"{table}: could not count rows ({exc}).")
            continue
        mapped, vector_mapped, score = _match_columns(columns)
        if count <= 0:
            score -= 5
        candidate = TableInfo(schema, table, columns, count, mapped, vector_mapped, score)
        if best is None or candidate.score > best.score:
            best = candidate
    if best is None or best.score <= 0:
        return None, warnings + ["No supported telemetry table was found."]
    if "game_time" not in best.mapped:
        warnings.append(f"{best.name}: no explicit time channel found; row index will be used.")
    if "lap_number" not in best.mapped and "lap_distance" not in best.mapped:
        warnings.append(f"{best.name}: no lap channel found; all samples will be treated as one session lap.")
    return best, warnings


def _channel_frequencies(conn) -> dict[str, int]:
    try:
        rows = conn.execute('select channelName, frequency from channelsList').fetchall()
    except Exception:
        return {}
    return {str(name): max(1, int(freq or 1)) for name, freq in rows}


def _channel_units(conn) -> dict[str, str]:
    units: dict[str, str] = {}
    for query, name_column in (
        ("select channelName, unit from channelsList", "channelName"),
        ("select eventName, unit from eventsList", "eventName"),
    ):
        try:
            rows = conn.execute(query).fetchall()
        except Exception:
            continue
        for name, unit in rows:
            if name is not None:
                units[str(name)] = str(unit or "")
    return units


def _channel_layout(conn) -> ChannelLayout | None:
    by_schema: dict[str, dict[str, tuple[str, list[str]]]] = {}
    for schema, table in _tables(conn):
        by_schema.setdefault(schema, {})[_norm(table)] = (table, _columns(conn, schema, table))
    for schema, tables in by_schema.items():
        mapped: dict[str, str] = {}
        vector_mapped: dict[str, str] = {}
        for target, aliases in CHANNEL_ALIASES.items():
            match = next((tables.get(_norm(alias)) for alias in aliases if _norm(alias) in tables), None)
            if match:
                mapped[target] = match[0]
        for target, aliases in VECTOR_ALIASES.items():
            match = next((tables.get(_norm(alias)) for alias in aliases if _norm(alias) in tables), None)
            if match:
                vector_mapped[target] = match[0]
        if not (mapped or vector_mapped):
            continue
        important = {"game_time", "speed_kph", "rpm", "throttle", "brake", "steering", "fuel_liters"}
        if len(important.intersection(mapped)) < 3:
            continue
        counts: dict[str, int] = {}
        for table in set(mapped.values()) | set(vector_mapped.values()):
            try:
                counts[table] = int(conn.execute(f"select count(*) from {_quote_table(schema, table)}").fetchone()[0] or 0)
            except Exception:
                counts[table] = 0
        if not any(counts.values()):
            continue
        return ChannelLayout(
            schema=schema,
            mapped=mapped,
            vector_mapped=vector_mapped,
            frequencies=_channel_frequencies(conn),
            units=_channel_units(conn),
            counts=counts,
            count=max(counts.values(), default=0),
        )
    return None


def _table_kind(columns: list[str]) -> str:
    has_ts = "ts" in columns
    value_columns = _value_columns(columns)
    if len(value_columns) >= 4:
        return "event_vector" if has_ts else "vector"
    if has_ts:
        return "event"
    if value_columns:
        return "dense"
    return "metadata"


def _channel_manifest(conn, layout: ChannelLayout | None) -> list[dict]:
    mapped_by_table: dict[str, list[str]] = {}
    if layout is not None:
        for target, table in layout.mapped.items():
            mapped_by_table.setdefault(table, []).append(target)
        for target, table in layout.vector_mapped.items():
            mapped_by_table.setdefault(table, []).append(target)
    rows: list[dict] = []
    for schema, table in _tables(conn):
        columns = _columns(conn, schema, table)
        try:
            count = int(conn.execute(f"select count(*) from {_quote_table(schema, table)}").fetchone()[0] or 0)
        except Exception:
            count = 0
        rows.append(
            {
                "table": table,
                "schema": schema,
                "kind": _table_kind(columns),
                "columns": columns,
                "row_count": count,
                "frequency": layout.frequencies.get(table) if layout else None,
                "unit": layout.units.get(table) if layout else None,
                "mapped_fields": sorted(mapped_by_table.get(table, [])),
            }
        )
    return rows


def _available_fields(layout: ChannelLayout | TableInfo | None, rows: list[dict] | None = None) -> dict[str, bool]:
    mapped = set(layout.mapped) if layout is not None else set()
    vector = set(layout.vector_mapped) if isinstance(layout, ChannelLayout) else set()
    row_keys = set().union(*(row.keys() for row in rows or [])) if rows else set()
    keys = mapped | vector | row_keys
    return {
        "position": "position" in keys,
        "class_position": "class_position" in keys,
        "sectors": any(key in keys for key in ("sector", "sector1", "sector2", "last_sector1", "last_sector2", "best_sector1", "best_sector2")),
        "flags": any(key in keys for key in ("sector1_flag", "sector2_flag", "sector3_flag", "yellow_flag_state")),
        "assists": any(key in keys for key in ("abs_active", "abs_level", "tc_active", "tc_level", "tc_cut", "tc_slip_angle", "fuel_mixture_map", "brake_bias_rear", "brake_migration")),
        "gps": any(key in keys for key in ("gps_latitude", "gps_longitude", "g_force_lat", "g_force_long", "g_force_vert", "total_distance", "path_lateral", "track_edge")),
        "brake_detail": any(key in keys for key in ("brake_air_temp", "brake_force", "brake_thickness")),
        "tyre_detail": any(key in keys for key in ("tyre_temp_carcass", "tyre_temp_rim", "tyre_temp_rubber", "tyre_temp_left", "tyre_temp_centre", "tyre_temp_right", "tyre_compound")),
        "energy": any(key in keys for key in ("soc", "virtual_energy", "regen_rate", "turbo_boost_pressure", "clutch", "clutch_unfiltered", "clutch_rpm")),
        "environment": any(key in keys for key in ("minimum_path_wetness", "offpath_wetness", "cloud_darkness", "wind_heading", "wind_speed", "headlights", "speed_limiter", "front_flap_active", "rear_flap_active", "rear_flap_legal", "surface_type", "wheels_detached")),
    }


def _table_columns(conn, schema: str, table: str) -> list[str]:
    return _columns(conn, schema, table)


def _value_columns(columns: list[str]) -> list[str]:
    values = [column for column in columns if _norm(column).startswith("value")]
    return values or [columns[-1]]


def _channel_freq(layout: ChannelLayout, table: str) -> int:
    return max(1, int(layout.frequencies.get(table) or layout.frequencies.get(_norm(table)) or 1))


def _event_values(conn, layout: ChannelLayout, target: str) -> list[tuple[float, Any]]:
    table = layout.mapped.get(target)
    if not table:
        return []
    columns = _table_columns(conn, layout.schema, table)
    if "ts" not in columns or "value" not in columns:
        return []
    try:
        rows = conn.execute(f"select ts, value from {_quote_table(layout.schema, table)} order by ts").fetchall()
    except Exception:
        return []
    return [(float(ts), value) for ts, value in rows if _num(ts) is not None]


def _event_vector_values(conn, layout: ChannelLayout, target: str) -> list[tuple[float, tuple[Any, ...]]]:
    table = layout.vector_mapped.get(target)
    if not table:
        return []
    columns = _table_columns(conn, layout.schema, table)
    values = _value_columns(columns)
    if "ts" not in columns or len(values) < 4:
        return []
    selected = ", ".join(_quote_ident(value) for value in values[:4])
    try:
        rows = conn.execute(f"select ts, {selected} from {_quote_table(layout.schema, table)} order by ts").fetchall()
    except Exception:
        return []
    return [(float(row[0]), tuple(row[1:5])) for row in rows if _num(row[0]) is not None]


def _nearest_event(events: list[tuple[float, Any]], time_value: float, cursor: int) -> tuple[Any, int]:
    while cursor + 1 < len(events) and events[cursor + 1][0] <= time_value:
        cursor += 1
    return (events[cursor][1], cursor) if events and events[cursor][0] <= time_value else (None, cursor)


def _row_limit_for_review(sample_limit: int) -> int:
    # The response point limit is a presentation concern. Calculating laps and
    # summaries from that decimated display set changes fuel endpoints, extrema,
    # distance, and averages when a caller requests fewer chart points.
    return MAX_REVIEW_ROWS


def _select_channel_rows(conn, layout: ChannelLayout, row_limit: int = MAX_REVIEW_ROWS) -> tuple[list[dict], list[str]]:
    warnings: list[str] = []
    base_table = layout.mapped.get("game_time") or layout.mapped.get("speed_kph") or next(iter(layout.mapped.values()), "")
    if not base_table:
        return [], ["No channel table can be used as a time base."]
    base_count = max(0, layout.counts.get(base_table, 0))
    if base_count <= 0:
        return [], [f"{base_table}: no rows found."]
    step = max(1, math.ceil(base_count / max(1, row_limit)))
    if step > 1:
        warnings.append(f"{base_table}: sampled every {step} rows for review performance.")

    base_freq = _channel_freq(layout, base_table)
    base_is_time = base_table == layout.mapped.get("game_time")
    base_columns = _table_columns(conn, layout.schema, base_table)
    base_value = "value" if "value" in base_columns else _value_columns(base_columns)[0]
    base_expr = _quote_ident(base_value) if base_is_time else f"rowid / {float(base_freq)}"
    base_query = (
        f"select rowid + 1 as __rn, {base_expr}::double as game_time "
        f"from {_quote_table(layout.schema, base_table)} "
        f"where rowid % ? = 0 order by rowid"
    )
    rows = [{"__rn": int(rn), "game_time": float(game_time)} for rn, game_time in conn.execute(base_query, [step]).fetchall()]
    if not rows:
        return [], [f"{base_table}: no sampled rows found."]
    start_time = rows[0]["game_time"]
    used_tables: set[str] = {base_table}

    def assign_dense(table: str, fields: list[tuple[str, str]], freq: int) -> None:
        targets = sorted(
            {
                max(1, int(math.floor((row["game_time"] - start_time) * float(freq)) + 1))
                for row in rows
                if row.get("game_time") is not None
            }
        )
        if not targets:
            return
        selected = ", ".join(_quote_ident(column) for _field, column in fields)
        fetched: dict[int, tuple[Any, ...]] = {}
        for index in range(0, len(targets), 900):
            chunk = targets[index:index + 900]
            placeholders = ", ".join(str(target) for target in chunk)
            query = (
                f"select rowid + 1 as rn, {selected} "
                f"from {_quote_table(layout.schema, table)} "
                f"where rowid + 1 in ({placeholders})"
            )
            fetched.update({int(row[0]): row[1:] for row in conn.execute(query).fetchall()})
        for row in rows:
            target_rn = max(1, int(math.floor((row["game_time"] - start_time) * float(freq)) + 1))
            values = fetched.get(target_rn)
            if values is None:
                continue
            for index, (field, _column) in enumerate(fields):
                row[field] = _num(values[index])

    for target, table in layout.mapped.items():
        if target == "game_time":
            continue
        columns = _table_columns(conn, layout.schema, table)
        if "ts" in columns:
            continue
        values = _value_columns(columns)
        assign_dense(table, [(target, values[0])], _channel_freq(layout, table))
        used_tables.add(table)

    for target, table in layout.vector_mapped.items():
        columns = _table_columns(conn, layout.schema, table)
        if "ts" in columns:
            continue
        values = _value_columns(columns)
        if len(values) < 4:
            continue
        assign_dense(table, [(f"{target}_{wheel}", values[index]) for index, wheel in enumerate(WHEELS)], _channel_freq(layout, table))
        used_tables.add(table)

    event_targets = {
        target
        for target, table in layout.mapped.items()
        if target != "game_time" and "ts" in _table_columns(conn, layout.schema, table)
    }
    event_rows = {target: _event_values(conn, layout, target) for target in event_targets}
    used_tables.update(layout.mapped[target] for target, events in event_rows.items() if events and target in layout.mapped)
    cursors = {target: 0 for target in event_rows}
    event_vector_targets = {
        target
        for target, table in layout.vector_mapped.items()
        if "ts" in _table_columns(conn, layout.schema, table)
    }
    event_vector_rows = {target: _event_vector_values(conn, layout, target) for target in event_vector_targets}
    used_tables.update(layout.vector_mapped[target] for target, events in event_vector_rows.items() if events and target in layout.vector_mapped)
    vector_cursors = {target: 0 for target in event_vector_rows}
    for row in rows:
        time_value = _num(row.get("game_time")) or 0.0
        for target, events in event_rows.items():
            value, cursors[target] = _nearest_event(events, time_value, cursors[target])
            if value is None:
                continue
            if target in {"lap_number", "gear", "position", "class_position", "sector", "sector1_flag", "sector2_flag", "sector3_flag", "yellow_flag_state", "abs_level", "tc_level", "tc_cut", "tc_slip_angle", "fuel_mixture_map", "finish_status"}:
                number = _num(value)
                row[target] = int(number) if number is not None else None
            elif target in {"in_pits", "abs_active", "tc_active", "front_flap_active", "rear_flap_active", "rear_flap_legal", "speed_limiter", "headlights", "offpath_wetness", "cloud_darkness", "anti_stall_active"}:
                row[target] = bool(value)
            else:
                row[target] = _num(value)
        for target, events in event_vector_rows.items():
            value, vector_cursors[target] = _nearest_event(events, time_value, vector_cursors[target])
            if not isinstance(value, tuple):
                continue
            for index, wheel in enumerate(WHEELS):
                row[f"{target}_{wheel}"] = _num(value[index]) if index < len(value) else None

    for row in rows:
        row.pop("__rn", None)
    if _norm(layout.vector_mapped.get("tyre_wear", "")) == "tyreswear":
        _normalize_native_tyre_wear(rows)
    if "lap_number" not in rows[0] if rows else True:
        warnings.append("Lap table has no usable events; lap numbers will be inferred from Lap Dist when possible.")
    unmapped = sorted((set(layout.mapped.values()) | set(layout.vector_mapped.values())) - used_tables)
    if unmapped:
        warnings.append(f"Skipped event/sparse tables not needed for review: {', '.join(unmapped[:8])}.")
    return rows, warnings


def _select_rows(conn, info: TableInfo, row_limit: int = MAX_REVIEW_ROWS) -> tuple[list[dict], list[str]]:
    warnings: list[str] = []
    selected_columns = sorted(set(info.mapped.values()) | set(info.vector_mapped.values()))
    if not selected_columns:
        return [], ["No mapped telemetry channels were found."]
    table_name = _quote_table(info.schema, info.name)
    select_list = ", ".join(_quote_ident(column) for column in selected_columns)
    order_column = info.mapped.get("game_time")
    step = max(1, math.ceil(info.count / max(1, row_limit)))
    if step > 1:
        warnings.append(f"{info.name}: sampled every {step} rows for review performance.")
    order_sql = f"order by {_quote_ident(order_column)}" if order_column else ""
    query = (
        f"select {select_list} from ("
        f"select row_number() over ({order_sql}) as __rn, {select_list} from {table_name}"
        f") where (__rn - 1) % ? = 0 order by __rn"
    )
    cursor = conn.execute(query, [step])
    names = [column[0] for column in cursor.description]
    rows = [dict(zip(names, row)) for row in cursor.fetchall()]
    return rows, warnings


def _vector_value(value: Any, index: int) -> float | None:
    if isinstance(value, (list, tuple)) and index < len(value):
        return _num(value[index])
    return None


def _mapped_value(raw: dict, info: TableInfo, target: str) -> float | int | bool | None:
    column = info.mapped.get(target)
    value = raw.get(column) if column else None
    if target == "lap_number":
        number = _num(value)
        return int(number) if number is not None else None
    if target in {"gear", "position", "class_position"}:
        number = _num(value)
        return int(number) if number is not None else None
    if target == "in_pits":
        return _bool(value)
    number = _num(value)
    if number is not None:
        return number
    vector_target = next((name for name in VECTOR_ALIASES if target.startswith(name)), None)
    if vector_target and vector_target in info.vector_mapped:
        wheel = target.rsplit("_", 1)[-1]
        if wheel in WHEELS:
            return _vector_value(raw.get(info.vector_mapped[vector_target]), WHEELS.index(wheel))
    return None


def _review_rows(raw_rows: list[dict], info: TableInfo) -> list[dict]:
    rows: list[dict] = []
    inferred_lap = 1
    previous_lap_distance: float | None = None
    for index, raw in enumerate(raw_rows):
        row = {target: _mapped_value(raw, info, target) for target in CHANNEL_ALIASES}
        for wheel in WHEELS:
            row[f"surface_type_{wheel}"] = _mapped_value(raw, info, f"surface_type_{wheel}")
        if row.get("game_time") is None:
            row["game_time"] = float(index)
        if row.get("lap_number") is None:
            lap_distance = row.get("lap_distance")
            if isinstance(lap_distance, (int, float)):
                if previous_lap_distance is not None and lap_distance + 50 < previous_lap_distance:
                    inferred_lap += 1
                previous_lap_distance = float(lap_distance)
            row["lap_number"] = inferred_lap
        rows.append({key: value for key, value in row.items() if value is not None and key != "lap_distance"})
    tyre_source = info.vector_mapped.get("tyre_wear", "")
    if _norm(tyre_source) == "tyreswear":
        _normalize_native_tyre_wear(rows)
    return rows


def _build_laps(rows: list[dict]) -> list[dict]:
    grouped: dict[int, list[dict]] = {}
    for row in rows:
        lap_number = row.get("lap_number")
        if isinstance(lap_number, (int, float)):
            grouped.setdefault(int(lap_number), []).append(row)
    lap_numbers = sorted(grouped)
    official_lap_times: dict[int, float] = {}
    for lap_number in lap_numbers:
        values = [
            _num(row.get("last_lap_time")) for row in grouped[lap_number]
            if (_num(row.get("last_lap_time")) or 0) > 0
        ]
        if values:
            official_lap_times[lap_number - 1] = values[-1]  # last-lap channel belongs to the preceding lap
    laps: list[dict] = []
    previous_fuel_end: float | None = None
    for index, lap_number in enumerate(lap_numbers):
        lap_rows = grouped[lap_number]
        first = lap_rows[0]
        last = lap_rows[-1]
        start_time = _num(first.get("game_time"))
        next_lap = lap_numbers[index + 1] if index + 1 < len(lap_numbers) else None
        next_start = _num(grouped[next_lap][0].get("game_time")) if next_lap is not None else None
        sample_end = _num(last.get("game_time"))
        end_time = next_start if next_start is not None else sample_end
        official = official_lap_times.get(lap_number)
        if official and official > 0:
            duration = official
            timing_source = "official"
        elif next_start is not None and start_time is not None and next_start >= start_time:
            duration = next_start - start_time
            timing_source = "lap_boundary"
        else:
            duration = sample_end - start_time if start_time is not None and sample_end is not None and sample_end >= start_time else None
            timing_source = "partial_samples"
        fuel_start = _num(first.get("fuel_liters"))
        fuel_end = _num(last.get("fuel_liters"))
        fuel_used = fuel_start - fuel_end if fuel_start is not None and fuel_end is not None and fuel_start >= fuel_end else None
        fuel_added = fuel_start - previous_fuel_end if fuel_start is not None and previous_fuel_end is not None and fuel_start > previous_fuel_end else 0
        distance = _distance_km(lap_rows)
        lap = {
            "lap_number": lap_number,
            "start_time": start_time,
            "end_time": end_time,
            "lap_time": duration,
            "timing_source": timing_source,
            "fuel_start": fuel_start,
            "fuel_end": fuel_end,
            "fuel_used": fuel_used,
            "fuel_added": fuel_added,
            "distance_km": distance,
            "position": last.get("position"),
            "class_position": last.get("class_position"),
            "top_speed": _max([_num(row.get("speed_kph")) for row in lap_rows]),
            "speed_kph": _avg([_num(row.get("speed_kph")) for row in lap_rows]),
            "max_rpm": _max([_num(row.get("rpm")) for row in lap_rows]),
            "rpm": _avg([_num(row.get("rpm")) for row in lap_rows]),
            "throttle": _avg([_num(row.get("throttle")) for row in lap_rows]),
            "brake": _avg([_num(row.get("brake")) for row in lap_rows]),
            "steering": _avg([_num(row.get("steering")) for row in lap_rows]),
            "track_temp": _avg([_num(row.get("track_temp")) for row in lap_rows]),
            "ambient_temp": _avg([_num(row.get("ambient_temp")) for row in lap_rows]),
            "sample_count": len(lap_rows),
            "valid_lap": True,
            "in_pit": any(bool(row.get("in_pits")) for row in lap_rows),
            "under_yellow": False,
        }
        for wheel in WHEELS:
            lap[f"tyre_wear_end_{wheel}"] = _num(last.get(f"tyre_wear_{wheel}"))
            lap[f"tyre_temp_{wheel}"] = _avg([_num(row.get(f"tyre_temp_{wheel}")) for row in lap_rows])
            lap[f"tyre_pressure_{wheel}"] = _avg([_num(row.get(f"tyre_pressure_{wheel}")) for row in lap_rows])
            lap[f"brake_temp_{wheel}"] = _avg([_num(row.get(f"brake_temp_{wheel}")) for row in lap_rows])
            lap[f"ride_height_{wheel}"] = _avg([_num(row.get(f"ride_height_{wheel}")) for row in lap_rows])
        laps.append(lap)
        if fuel_end is not None:
            previous_fuel_end = fuel_end
    return apply_lap_quality(laps)


def _pit_events(rows: list[dict]) -> list[dict]:
    events = []
    previous = False
    entry_time: float | None = None
    entry_lap: int | None = None
    for row in rows:
        in_pits = bool(row.get("in_pits"))
        if in_pits and not previous:
            entry_time = _num(row.get("game_time"))
            lap = row.get("lap_number")
            entry_lap = int(lap) if isinstance(lap, (int, float)) else None
        elif previous and not in_pits:
            exit_time = _num(row.get("game_time"))
            events.append(
                {
                    "driver_name": "Player",
                    "lap_number": row.get("lap_number") or entry_lap,
                    "pit_entry_time": entry_time,
                    "pit_exit_time": exit_time,
                    "total_pit_loss": exit_time - entry_time if exit_time is not None and entry_time is not None else None,
                    "detected_from": "LMU session",
                    "message": "Pit stop detected from native telemetry",
                }
            )
        previous = in_pits
    return events


def _summary(rows: list[dict], laps: list[dict], info: TableInfo) -> dict:
    completed_laps = [lap for lap in laps if lap.get("valid_lap") is True]
    pace_laps = _without_outlier_items(completed_laps, "lap_time", minimum=40.0, maximum=900.0)
    lap_times = [_num(lap.get("lap_time")) for lap in pace_laps]
    fuel_used = [_num(lap.get("fuel_used")) for lap in completed_laps]
    fuel_used_positive = [value for value in fuel_used if value is not None and value > 0]
    fuel_used_for_average = _without_outliers(fuel_used_positive)
    recent_five_lap_pace = _avg(lap_times[-5:]) if len(lap_times) >= 5 else None
    duration = None
    if len(rows) >= 2:
        start = _num(rows[0].get("game_time"))
        end = _num(rows[-1].get("game_time"))
        duration = end - start if start is not None and end is not None and end >= start else None
    tyre_remaining_values = [_num(row.get(f"tyre_wear_{wheel}")) for row in rows for wheel in WHEELS]
    tyre_wear_used_values = [value * 100.0 for value in tyre_remaining_values if value is not None and 0 <= value <= 1]
    speed_values = _without_outliers([_num(row.get("speed_kph")) for row in rows])
    return {
        "session_id": "external",
        "completed_at": None,
        "duration_seconds": duration,
        "lap_count": len(laps),
        "valid_lap_count": len(completed_laps),
        "pace_lap_count": len(pace_laps),
        "total_distance_km": sum(value for value in (_num(lap.get("distance_km")) for lap in laps) if value is not None) or _distance_km(rows),
        "best_lap": min((value for value in lap_times if value is not None and value > 0), default=None),
        "average_lap": _avg(lap_times),
        "average_fuel_per_lap": _avg(fuel_used_for_average),
        "average_five_lap_pace": recent_five_lap_pace,
        "total_fuel_used": sum(fuel_used_positive) or None,
        "average_tyre_wear": _avg(_without_outliers(tyre_wear_used_values)),
        "average_tyre_life_remaining": 100.0 - (_avg(_without_outliers(tyre_wear_used_values)) or 0.0) if tyre_wear_used_values else None,
        "average_tyre_temp": _avg(_without_outliers([_num(row.get(f"tyre_temp_{wheel}")) for row in rows for wheel in WHEELS])),
        "average_tyre_pressure": _avg(_without_outliers([_num(row.get(f"tyre_pressure_{wheel}")) for row in rows for wheel in WHEELS])),
        "average_brake_temp": _avg(_without_outliers([_num(row.get(f"brake_temp_{wheel}")) for row in rows for wheel in WHEELS])),
        "top_speed": _max(speed_values),
        "latest_lap_number": max((int(lap["lap_number"]) for lap in laps), default=None),
        "sample_count": info.count,
    }


def _downsample(rows: list[dict], limit: int) -> list[dict]:
    if limit <= 0:
        return []
    if len(rows) <= limit:
        return rows
    step = math.ceil(len(rows) / limit)
    return rows[::step]


def _downsample_evenly(rows: list[dict], limit: int) -> list[dict]:
    if limit <= 0 or len(rows) <= limit:
        return rows
    step = (len(rows) - 1) / max(1, limit - 1)
    indexes = {round(index * step) for index in range(limit)}
    return [row for index, row in enumerate(rows) if index in indexes]


def _default_trajectory_laps(session_id: str) -> list[str]:
    with SessionLocal() as db:
        rows = db.scalars(select(LmuDuckdbLapModel).where(LmuDuckdbLapModel.session_id == session_id)).all()
    clean = [
        lap for lap in rows
        if lap.lap_time is not None and lap.lap_time > 0 and not lap.in_pit
    ]
    clean.sort(key=lambda lap: float(lap.lap_time or 0))
    return [str(lap.lap_number) for lap in clean[:2]]


def _dense_channel_values(conn, layout: ChannelLayout, target: str) -> tuple[list[Any], int]:
    table = layout.mapped.get(target)
    if not table:
        return [], 1
    columns = _table_columns(conn, layout.schema, table)
    if "ts" in columns:
        return [], 1
    value_column = "value" if "value" in columns else _value_columns(columns)[0]
    values = [row[0] for row in conn.execute(f"select {_quote_ident(value_column)} from {_quote_table(layout.schema, table)} order by rowid").fetchall()]
    return values, _channel_freq(layout, table)


def _trajectory_rows(conn, layout: ChannelLayout, lap_numbers: list[str], max_points: int) -> tuple[list[dict], list[str]]:
    warnings: list[str] = []
    if "game_time" not in layout.mapped:
        return [], ["GPS Time is missing, so lap traces cannot be synchronized."]
    if "lap_number" not in layout.mapped:
        return [], ["Lap Number is missing, so trajectory laps cannot be isolated."]

    selected_laps = {str(lap) for lap in lap_numbers if str(lap) != ""}
    if not selected_laps:
        return [], ["No laps were selected for trajectory comparison."]

    game_times, _base_freq = _dense_channel_values(conn, layout, "game_time")
    if not game_times:
        return [], ["GPS Time has no dense samples."]
    start_time = _num(game_times[0]) or 0.0
    dense_targets = ("gps_latitude", "gps_longitude", "throttle", "brake", "speed_kph", "lap_distance")
    dense = {target: _dense_channel_values(conn, layout, target) for target in dense_targets}
    lap_events = _event_values(conn, layout, "lap_number")
    if not lap_events:
        return [], ["Lap Number has no usable events."]

    grouped: dict[str, list[dict]] = {lap: [] for lap in selected_laps}
    lap_cursor = 0
    for time_value_raw in game_times:
        time_value = _num(time_value_raw)
        if time_value is None:
            continue
        while lap_cursor + 1 < len(lap_events) and lap_events[lap_cursor + 1][0] <= time_value:
            lap_cursor += 1
        lap_raw = lap_events[lap_cursor][1] if lap_events and lap_events[lap_cursor][0] <= time_value else None
        lap_num = _num(lap_raw)
        lap = str(int(lap_num)) if lap_num is not None else ""
        if lap not in selected_laps:
            continue

        row: dict[str, Any] = {"lap_number": int(lap), "game_time": time_value}
        for target, (values, frequency) in dense.items():
            if not values:
                continue
            index = max(0, int(math.floor((time_value - start_time) * float(frequency))))
            if index < len(values):
                row[target] = _num(values[index])
        grouped[lap].append(row)

    per_lap_limit = max(80, math.ceil(max_points / max(1, len(selected_laps))))
    rows: list[dict] = []
    for lap in lap_numbers:
        lap_rows = grouped.get(str(lap), [])
        distances = [row.get("lap_distance") for row in lap_rows]
        valid_distances = [float(value) for value in distances if isinstance(value, (int, float)) and math.isfinite(float(value))]
        distance_min = min(valid_distances) if valid_distances else None
        distance_span = (max(valid_distances) - distance_min) if distance_min is not None else 0.0
        denominator = max(1, len(lap_rows) - 1)
        for index, row in enumerate(lap_rows):
            distance = row.get("lap_distance")
            if distance_min is not None and distance_span > 1.0 and isinstance(distance, (int, float)):
                row["progress"] = max(0.0, min(1.0, (float(distance) - distance_min) / distance_span))
            else:
                row["progress"] = index / denominator
        rows.extend(_downsample_evenly(lap_rows, per_lap_limit))
    if not {"gps_latitude", "gps_longitude"}.issubset(layout.mapped):
        warnings.append("GPS coordinates are unavailable; input traces remain available.")
    return rows, warnings


def _find_session(folder: Path, session_id: str) -> Path | None:
    for path in _candidate_files(folder):
        if _session_id(path) == session_id:
            return path
    return None


def _find_session_by_id(session_id: str) -> Path | None:
    with SessionLocal() as db:
        session = db.get(LmuDuckdbSessionModel, session_id)
        if not session or not session.active:
            session = None
        if session:
            path = Path(session.file_path)
            return path if path.exists() else None
    folder_path = _configured_folder_path()
    if not folder_path:
        return None
    try:
        folder = _folder(folder_path)
    except (FileNotFoundError, NotADirectoryError):
        return None
    return _find_session(folder, session_id)


def _candidate_files(folder: Path):
    for path in folder.rglob("*"):
        if path.is_file() and path.suffix.lower() in DUCKDB_EXTENSIONS:
            yield path


def _scan_candidates(folder: Path) -> list[Path]:
    return sorted(_candidate_files(folder), key=lambda path: path.stat().st_mtime, reverse=True)


def _folder(path: str) -> Path:
    folder = Path(path).expanduser()
    if not folder.exists():
        raise FileNotFoundError(f"Folder not found: {folder}")
    if not folder.is_dir():
        raise NotADirectoryError(f"Not a folder: {folder}")
    return folder


def _distance_km(rows: list[dict]) -> float | None:
    distance = 0.0
    usable = 0
    for previous, current in zip(rows, rows[1:]):
        previous_time = _num(previous.get("game_time"))
        current_time = _num(current.get("game_time"))
        previous_speed = _num(previous.get("speed_kph"))
        current_speed = _num(current.get("speed_kph"))
        if previous_time is None or current_time is None or previous_speed is None:
            continue
        delta = current_time - previous_time
        if delta <= 0 or delta > 5:
            continue
        speed = (previous_speed + current_speed) / 2 if current_speed is not None else previous_speed
        distance += speed * delta / 3600
        usable += 1
    return distance if usable else None


def _json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def _get_setting(key: str) -> str | None:
    with SessionLocal() as db:
        setting = db.get(AppSettingModel, key)
        return setting.value if setting else None


def _steam_install_candidates() -> list[Path]:
    candidates: list[Path] = []
    for env_key in ("PROGRAMFILES(X86)", "PROGRAMFILES"):
        value = os.environ.get(env_key)
        if value:
            candidates.append(Path(value) / "Steam")
    candidates.append(Path("C:/Program Files (x86)/Steam"))
    candidates.append(Path("C:/Program Files/Steam"))
    return list(dict.fromkeys(candidates))


def _steam_library_roots() -> list[Path]:
    roots: list[Path] = []
    for steam_path in _steam_install_candidates():
        if (steam_path / "steamapps").is_dir():
            roots.append(steam_path)
        manifest = steam_path / "steamapps" / "libraryfolders.vdf"
        if not manifest.is_file():
            continue
        try:
            text = manifest.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for raw in re.findall(r'"path"\s+"([^"]+)"', text):
            path = Path(raw.replace("\\\\", "\\"))
            if (path / "steamapps").is_dir():
                roots.append(path)
    return list(dict.fromkeys(roots))


def _common_steam_library_roots() -> list[Path]:
    roots: list[Path] = []
    for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        root = Path(f"{letter}:/SteamLibrary")
        if (root / "steamapps").is_dir():
            roots.append(root)
    return roots


def discover_lmu_telemetry_folder() -> str | None:
    candidates = [DEFAULT_WINDOWS_TELEMETRY_FOLDER]
    candidates.extend(root / LMU_TELEMETRY_RELATIVE_PATH for root in _steam_library_roots())
    candidates.extend(root / LMU_TELEMETRY_RELATIVE_PATH for root in _common_steam_library_roots())
    for folder in dict.fromkeys(candidates):
        if folder.exists() and folder.is_dir():
            return str(folder)
    return None


def _configured_folder_path() -> str | None:
    configured = _get_setting(FOLDER_SETTING_KEY)
    if configured:
        return configured
    return discover_lmu_telemetry_folder()


def _set_setting(db, key: str, value: str | None, now: str) -> None:
    setting = db.get(AppSettingModel, key)
    if setting is None:
        db.add(AppSettingModel(key=key, value=value, updated_at=now))
    else:
        setting.value = value
        setting.updated_at = now


def get_settings() -> dict:
    with SessionLocal() as db:
        folder = db.get(AppSettingModel, FOLDER_SETTING_KEY)
        last_status = db.get(AppSettingModel, SYNC_STATUS_SETTING_KEY)
        last_sync = db.get(AppSettingModel, SYNC_AT_SETTING_KEY)
        active_sessions = int(db.scalar(select(func.count(LmuDuckdbSessionModel.id)).where(LmuDuckdbSessionModel.active.is_(True))) or 0)
        cached_sessions = int(db.scalar(select(func.count(LmuDuckdbSessionModel.id))) or 0)
        warning_rows = db.scalars(select(LmuDuckdbSessionModel.warnings_json).where(LmuDuckdbSessionModel.active.is_(True))).all()
    warning_count = 0
    for raw in warning_rows:
        try:
            warning_count += len(json.loads(raw or "[]"))
        except Exception:
            pass
    return {
        "folder_path": folder.value if folder else _configured_folder_path(),
        "last_sync_at": last_sync.value if last_sync else None,
        "last_sync_status": last_status.value if last_status else None,
        "cached_sessions": cached_sessions,
        "active_sessions": active_sessions,
        "warning_count": warning_count,
    }


def save_settings(path: str) -> dict:
    folder = _folder(path)
    now = datetime.utcnow().isoformat()
    with SessionLocal() as db:
        _set_setting(db, FOLDER_SETTING_KEY, str(folder), now)
        db.commit()
    return get_settings()


def _sync_run_to_dict(run: LmuDuckdbSyncRunModel) -> dict:
    completed = int(run.processed or 0) + int(run.skipped or 0) + int(run.failed or 0)
    total = max(0, int(run.total_files or 0))
    percentage = 100 if run.status == "complete" else (round((completed / total) * 100) if total else 0)
    try:
        warnings = json.loads(run.warnings_json or "[]")
    except Exception:
        warnings = []
    return {
        "id": run.id,
        "folder_path": run.folder_path,
        "status": run.status,
        "total_files": total,
        "processed": int(run.processed or 0),
        "skipped": int(run.skipped or 0),
        "failed": int(run.failed or 0),
        "inactive": int(run.inactive or 0),
        "completed_files": completed,
        "current_file": run.current_file,
        "warnings": warnings,
        "started_at": run.started_at,
        "updated_at": run.updated_at,
        "finished_at": run.finished_at,
        "percentage": max(0, min(100, percentage)),
    }


def _latest_sync_run(db) -> LmuDuckdbSyncRunModel | None:
    return db.scalars(select(LmuDuckdbSyncRunModel).order_by(desc(LmuDuckdbSyncRunModel.updated_at)).limit(1)).first()


def _active_sync_run(db, folder: Path | None = None) -> LmuDuckdbSyncRunModel | None:
    query = select(LmuDuckdbSyncRunModel).where(LmuDuckdbSyncRunModel.status.in_(_SYNC_ACTIVE_STATUSES))
    if folder is not None:
        query = query.where(LmuDuckdbSyncRunModel.folder_path == str(folder))
    return db.scalars(query.order_by(desc(LmuDuckdbSyncRunModel.updated_at)).limit(1)).first()


def current_sync_run() -> dict | None:
    with SessionLocal() as db:
        run = _active_sync_run(db) or _latest_sync_run(db)
        return _sync_run_to_dict(run) if run else None


def mark_interrupted_sync_runs() -> int:
    now = datetime.utcnow().isoformat()
    count = 0
    with SessionLocal() as db:
        runs = db.scalars(select(LmuDuckdbSyncRunModel).where(LmuDuckdbSyncRunModel.status.in_(_SYNC_ACTIVE_STATUSES))).all()
        for run in runs:
            run.status = "interrupted"
            run.current_file = None
            run.updated_at = now
            run.finished_at = now
            count += 1
        db.commit()
    return count


def _create_sync_run(folder: Path) -> LmuDuckdbSyncRunModel:
    now = datetime.utcnow().isoformat()
    return LmuDuckdbSyncRunModel(
        id=uuid.uuid4().hex,
        folder_path=str(folder),
        status="queued",
        warnings_json="[]",
        started_at=now,
        updated_at=now,
    )


def _session_model_to_dict(session: LmuDuckdbSessionModel) -> dict:
    metadata = {}
    warnings = []
    summary = {}
    try:
        metadata = json.loads(session.metadata_json or "{}")
    except Exception:
        pass
    try:
        warnings = json.loads(session.warnings_json or "[]")
    except Exception:
        pass
    try:
        summary = json.loads(session.summary_json or "{}")
    except Exception:
        pass
    lap_count = _num(summary.get("lap_count"))
    return {
        "id": session.id,
        "created_at": session.created_at,
        "track_name": session.track_name,
        "track_layout": session.track_layout,
        "session_type": session.session_type,
        "vehicle_name": session.vehicle_name,
        "vehicle_model": session.vehicle_model,
        "vehicle_class": session.vehicle_class,
        "started_at_game_time": session.started_at_game_time,
        "ended_at_game_time": session.ended_at_game_time,
        "final_position": session.final_position,
        "final_class_position": session.final_class_position,
        "classified_status": session.classified_status,
        "sample_count": session.sample_count,
        "lap_count": int(lap_count) if lap_count is not None else None,
        "latest_lap_number": session.latest_lap_number,
        "latest_game_time": session.latest_game_time,
        "file_name": session.file_name,
        "file_path": session.file_path,
        "file_size_bytes": session.file_size_bytes,
        "metadata": metadata,
        "warnings": warnings,
    }


def _cached_lap_to_dict(lap: LmuDuckdbLapModel) -> dict:
    row = {
        "lap_number": int(lap.lap_number) if str(lap.lap_number).isdigit() else lap.lap_number,
        "lap_time": lap.lap_time,
        "valid_lap": lap.valid_lap,
        "in_pit": lap.in_pit,
        "distance_km": lap.distance_km,
        "fuel_start": lap.fuel_start,
        "fuel_end": lap.fuel_end,
        "fuel_used": lap.fuel_used,
        "fuel_added": lap.fuel_added,
        "top_speed": lap.max_speed,
        "speed_kph": lap.average_speed,
        "track_temp": lap.track_temp,
        "ambient_temp": lap.ambient_temp,
        "engine_oil_temp": lap.engine_oil_temp,
        "engine_water_temp": lap.engine_water_temp,
    }
    for wheel in WHEELS:
        row[f"tyre_wear_end_{wheel}"] = getattr(lap, f"tyre_wear_{wheel}")
        row[f"tyre_pressure_{wheel}"] = getattr(lap, f"tyre_pressure_{wheel}")
        row[f"brake_temp_{wheel}"] = getattr(lap, f"brake_temp_{wheel}")
    return row


def _cached_review_parts(session_id: str, file_path: Path) -> dict | None:
    signature = _file_signature(file_path)
    with SessionLocal() as db:
        session = db.get(LmuDuckdbSessionModel, session_id)
        if session is None or not session.active or session.signature != signature:
            return None
        lap_models = db.scalars(
            select(LmuDuckdbLapModel)
            .where(LmuDuckdbLapModel.session_id == session_id)
            .order_by(LmuDuckdbLapModel.id.asc())
        ).all()
        try:
            laps = json.loads(session.laps_json or "[]")
        except Exception:
            laps = []
        if not laps:
            laps = [_cached_lap_to_dict(lap) for lap in lap_models]
        session_data = _session_model_to_dict(session)
        try:
            summary = json.loads(session.summary_json or "null")
        except Exception:
            summary = None
        try:
            pit_events = json.loads(session.pit_events_json or "[]")
        except Exception:
            pit_events = []
        try:
            warnings = json.loads(session.warnings_json or "[]")
        except Exception:
            warnings = []
    return {
        "signature": signature,
        "session": session_data,
        "laps": laps,
        "summary": summary,
        "pit_events": pit_events,
        "warnings": warnings,
    }


def _display_rows(file_path: Path, sample_limit: int) -> tuple[list[dict], list[dict], list[str], Any]:
    warnings: list[str] = []
    conn = _open(file_path)
    try:
        channel_info = _channel_layout(conn)
        if channel_info is not None:
            rows, row_warnings = _select_channel_rows(conn, channel_info, row_limit=max(1, sample_limit))
            info = channel_info
        else:
            info, row_warnings = _best_table(conn)
            if info is None:
                return [], _channel_manifest(conn, None), row_warnings, None
            raw_rows, select_warnings = _select_rows(conn, info, row_limit=max(1, sample_limit))
            row_warnings.extend(select_warnings)
            rows = _review_rows(raw_rows, info)
        warnings.extend(row_warnings)
        manifest = _channel_manifest(conn, channel_info if channel_info is not None else None)
    finally:
        _close(conn)
    return _downsample_evenly(rows, sample_limit), manifest, warnings, info


def _review_from_validated_cache(file_path: Path, session_id: str, sample_limit: int, progress: ProgressCallback | None) -> dict | None:
    cached = _cached_review_parts(session_id, file_path)
    if cached is None:
        return None
    key = (session_id, cached["signature"], sample_limit)
    with _review_cache_lock:
        hit = _review_cache.get(key)
        if hit is not None:
            _review_cache.move_to_end(key)
            _report(progress, "Preparing page", "Using prepared validated session", 1, 1, 95)
            return deepcopy(hit)
    _report(progress, "Reading telemetry", "Reading chart samples from the selected session", 0, 1, 30)
    rows, manifest, read_warnings, info = _display_rows(file_path, sample_limit)
    _report(progress, "Processing database", "Combining validated results with chart data", 1, 1, 85)
    result = {
        "session": cached["session"],
        "telemetry_samples": rows,
        "recommendations": [],
        "laps": cached["laps"],
        "pit_events": cached["pit_events"],
        "summary": cached["summary"],
        "channel_manifest": manifest,
        "available_fields": _available_fields(info, rows),
        "warnings": list(dict.fromkeys([*cached["warnings"], *(warning for warning in read_warnings if "sampled every" not in warning)])),
    }
    with _review_cache_lock:
        _review_cache[key] = deepcopy(result)
        _review_cache.move_to_end(key)
        while len(_review_cache) > _REVIEW_CACHE_LIMIT:
            _review_cache.popitem(last=False)
    return result


def _store_review(db, file_path: Path, review: dict, signature: str, now: str) -> None:
    session_data = review["session"]
    summary = review.get("summary") or {}
    session_id = session_data["id"]
    existing_for_file = db.scalars(select(LmuDuckdbSessionModel).where(LmuDuckdbSessionModel.file_key == _file_key(file_path))).all()
    for existing in existing_for_file:
        if existing.id != session_id:
            existing.active = False
    db.execute(delete(LmuDuckdbLapModel).where(LmuDuckdbLapModel.session_id == session_id))
    model = db.get(LmuDuckdbSessionModel, session_id)
    if model is None:
        model = LmuDuckdbSessionModel(id=session_id, file_key=_file_key(file_path), file_path=str(file_path), file_name=file_path.name, signature=signature, created_at=session_data.get("created_at") or now)
        db.add(model)
    model.file_key = _file_key(file_path)
    model.file_path = str(file_path)
    model.file_name = file_path.name
    model.file_size_bytes = int(file_path.stat().st_size)
    model.modified_at = _iso_mtime(file_path)
    model.signature = signature
    model.active = True
    model.created_at = session_data.get("created_at") or _iso_mtime(file_path)
    model.synced_at = now
    model.track_name = session_data.get("track_name")
    model.track_layout = session_data.get("track_layout")
    model.session_type = session_data.get("session_type")
    model.vehicle_name = session_data.get("vehicle_name")
    model.vehicle_model = session_data.get("vehicle_model")
    model.vehicle_class = session_data.get("vehicle_class")
    model.started_at_game_time = _num(session_data.get("started_at_game_time"))
    model.ended_at_game_time = _num(session_data.get("ended_at_game_time"))
    model.final_position = session_data.get("final_position")
    model.final_class_position = session_data.get("final_class_position")
    model.classified_status = session_data.get("classified_status")
    model.sample_count = int(summary.get("sample_count") or session_data.get("sample_count") or 0)
    model.latest_lap_number = session_data.get("latest_lap_number")
    model.latest_game_time = _num(session_data.get("latest_game_time"))
    model.metadata_json = _json(session_data.get("metadata") or {})
    model.warnings_json = _json(review.get("warnings") or [])
    model.summary_json = _json(summary)
    model.pit_events_json = _json(review.get("pit_events") or [])
    model.laps_json = _json(review.get("laps") or [])
    track = session_data.get("track_name") or "Unknown track"
    layout = session_data.get("track_layout") or ""
    car = session_data.get("vehicle_model") or session_data.get("vehicle_name") or "Unknown car"
    car_class = session_data.get("vehicle_class") or "Unknown class"
    lap_models = []
    for lap in review.get("laps") or []:
        lap_models.append(
            LmuDuckdbLapModel(
                session_id=session_id,
                lap_number=str(lap.get("lap_number") or ""),
                date=model.created_at,
                track=track,
                layout=layout,
                car=car,
                car_class=car_class,
                session_type=model.session_type,
                source_file=model.file_name,
                lap_time=_num(lap.get("lap_time")),
                valid_lap=lap.get("valid_lap"),
                in_pit=lap.get("in_pit"),
                distance_km=_num(lap.get("distance_km")),
                fuel_start=_num(lap.get("fuel_start")),
                fuel_end=_num(lap.get("fuel_end")),
                fuel_used=_num(lap.get("fuel_used")),
                fuel_added=_num(lap.get("fuel_added")),
                tyre_wear_fl=_num(lap.get("tyre_wear_end_fl")),
                tyre_wear_fr=_num(lap.get("tyre_wear_end_fr")),
                tyre_wear_rl=_num(lap.get("tyre_wear_end_rl")),
                tyre_wear_rr=_num(lap.get("tyre_wear_end_rr")),
                tyre_pressure_fl=_num(lap.get("tyre_pressure_fl")),
                tyre_pressure_fr=_num(lap.get("tyre_pressure_fr")),
                tyre_pressure_rl=_num(lap.get("tyre_pressure_rl")),
                tyre_pressure_rr=_num(lap.get("tyre_pressure_rr")),
                brake_temp_fl=_num(lap.get("brake_temp_fl")),
                brake_temp_fr=_num(lap.get("brake_temp_fr")),
                brake_temp_rl=_num(lap.get("brake_temp_rl")),
                brake_temp_rr=_num(lap.get("brake_temp_rr")),
                track_temp=_num(lap.get("track_temp")),
                ambient_temp=_num(lap.get("ambient_temp")),
                engine_oil_temp=_num(lap.get("engine_oil_temp")),
                engine_water_temp=_num(lap.get("engine_water_temp")),
                max_speed=_num(lap.get("top_speed")),
                average_speed=_num(lap.get("speed_kph")),
                finish_position=model.final_position,
                finish_status=model.classified_status,
            )
        )
    if lap_models:
        db.bulk_save_objects(lap_models)


def scan_folder(path: str, limit: int = DEFAULT_SCAN_LIMIT, offset: int = 0) -> dict:
    folder = _folder(path)
    limit = max(1, min(limit, MAX_SCAN_LIMIT))
    offset = max(0, offset)
    candidates = _scan_candidates(folder)
    page = candidates[offset:offset + limit]
    sessions = [_file_session(file_path, None, [], {}) for file_path in page]
    return {
        "sessions": sessions,
        "warnings": [],
        "total": len(candidates),
        "offset": offset,
        "limit": limit,
        "next_offset": offset + limit if offset + limit < len(candidates) else None,
    }


def cached_sessions(limit: int = DEFAULT_SCAN_LIMIT, offset: int = 0) -> dict:
    limit = max(1, min(limit, MAX_SCAN_LIMIT))
    offset = max(0, offset)
    with SessionLocal() as db:
        total = int(db.scalar(select(func.count(LmuDuckdbSessionModel.id)).where(LmuDuckdbSessionModel.active.is_(True))) or 0)
        rows = db.scalars(
            select(LmuDuckdbSessionModel)
            .where(LmuDuckdbSessionModel.active.is_(True))
            .order_by(LmuDuckdbSessionModel.modified_at.desc(), LmuDuckdbSessionModel.file_name.asc())
            .offset(offset)
            .limit(limit)
        ).all()
    return {
        "sessions": [_session_model_to_dict(row) for row in rows],
        "warnings": [],
        "total": total,
        "offset": offset,
        "limit": limit,
        "next_offset": offset + limit if offset + limit < total else None,
    }


def sessions_from_cache_or_setting(limit: int = DEFAULT_SCAN_LIMIT, offset: int = 0) -> dict:
    cached = cached_sessions(limit=limit, offset=offset)
    if cached["total"]:
        return cached
    folder_path = _configured_folder_path()
    if not folder_path:
        return cached
    try:
        scanned = scan_folder(folder_path, limit=limit, offset=offset)
    except (FileNotFoundError, NotADirectoryError) as exc:
        cached["warnings"] = [str(exc)]
        return cached
    scanned["warnings"] = [
        "Showing configured folder files because no session cache exists yet. Use Save and sync in User Profile to populate profile totals.",
        *(scanned.get("warnings") or []),
    ]
    return scanned


def _sync_result_from_run(run: dict) -> dict:
    result = get_settings()
    result.update(
        {
            "processed": run["processed"],
            "skipped": run["skipped"],
            "inactive": run["inactive"],
            "failed": run["failed"],
            "warnings": run["warnings"][:200],
            "sync_run": run,
        }
    )
    return result


def _set_run_progress(run: LmuDuckdbSyncRunModel, now: str, warnings: list[str]) -> None:
    run.updated_at = now
    run.warnings_json = _json(warnings[:200])


def _execute_sync_run(run_id: str, folder_path: str, progress: ProgressCallback | None = None) -> dict:
    folder = _folder(folder_path)
    candidates = _scan_candidates(folder)
    total = len(candidates)
    now = datetime.utcnow().isoformat()
    _report(progress, "Loading sessions", f"Found {total} session files", 0, max(1, total), 8)
    signatures = {str(file_path.resolve()): _file_signature(file_path) for file_path in candidates}
    present_keys = {_file_key(file_path) for file_path in candidates}
    processed = 0
    skipped = 0
    failed = 0
    inactive = 0
    warnings: list[str] = []

    with SessionLocal() as db:
        run = db.get(LmuDuckdbSyncRunModel, run_id)
        if run is None:
            raise KeyError(run_id)
        run.status = "running"
        run.total_files = total
        run.processed = 0
        run.skipped = 0
        run.failed = 0
        run.inactive = 0
        run.current_file = None
        _set_run_progress(run, now, warnings)
        db.commit()

        cached_by_file_key = {
            file_key: {"signature": signature, "active": active}
            for file_key, signature, active in db.execute(
                select(LmuDuckdbSessionModel.file_key, LmuDuckdbSessionModel.signature, LmuDuckdbSessionModel.active)
            ).all()
        }

        for index, file_path in enumerate(candidates):
            signature = signatures[str(file_path.resolve())]
            file_key = _file_key(file_path)
            percent = 10 + round((index / max(1, total)) * 80)
            run = db.get(LmuDuckdbSyncRunModel, run_id)
            if run is None:
                raise KeyError(run_id)
            run.current_file = str(file_path)
            _set_run_progress(run, datetime.utcnow().isoformat(), warnings)
            db.commit()

            cached = cached_by_file_key.get(file_key)
            if cached and cached["signature"] == signature and cached["active"]:
                skipped += 1
                run = db.get(LmuDuckdbSyncRunModel, run_id)
                if run is not None:
                    run.skipped = skipped
                    run.current_file = str(file_path)
                    _set_run_progress(run, datetime.utcnow().isoformat(), warnings)
                    db.commit()
                _report(progress, "Validating telemetry", f"Checked {file_path.name}", index + 1, max(1, total), 10 + round(((index + 1) / max(1, total)) * 80))
                continue

            try:
                _report(progress, "Reading telemetry", f"Reading {file_path.name}", index, max(1, total), percent)
                review = _review_file(file_path, sample_limit=0)
                run = db.get(LmuDuckdbSyncRunModel, run_id)
                if run is None:
                    raise KeyError(run_id)
                _store_review(db, file_path, review, signature, now)
                processed += 1
                run.processed = processed
                run.current_file = str(file_path)
                warnings.extend(f"{file_path.name}: {warning}" for warning in review.get("warnings") or [])
                _set_run_progress(run, datetime.utcnow().isoformat(), warnings)
                db.commit()
                db.expunge_all()
                cached_by_file_key[file_key] = {"signature": signature, "active": True}
                _clear_review_cache(review["session"]["id"])
            except Exception as exc:
                db.rollback()
                failed += 1
                warnings.append(f"{file_path.name}: {exc}")
                run = db.get(LmuDuckdbSyncRunModel, run_id)
                if run is not None:
                    run.failed = failed
                    run.current_file = str(file_path)
                    _set_run_progress(run, datetime.utcnow().isoformat(), warnings)
                    db.commit()

            _report(progress, "Validating telemetry", f"Processed {index + 1} of {total} files", index + 1, max(1, total), 10 + round(((index + 1) / max(1, total)) * 80))

        run = db.get(LmuDuckdbSyncRunModel, run_id)
        if run is None:
            raise KeyError(run_id)
        for cached in db.scalars(select(LmuDuckdbSessionModel).where(LmuDuckdbSessionModel.active.is_(True))).all():
            if cached.file_key not in present_keys:
                cached.active = False
                inactive += 1
        finished = datetime.utcnow().isoformat()
        status = f"Processed {processed}, skipped {skipped}, marked inactive {inactive}, failed {failed}."
        _set_setting(db, FOLDER_SETTING_KEY, str(folder), finished)
        _set_setting(db, SYNC_STATUS_SETTING_KEY, status, finished)
        _set_setting(db, SYNC_AT_SETTING_KEY, finished, finished)
        run.status = "complete"
        run.processed = processed
        run.skipped = skipped
        run.failed = failed
        run.inactive = inactive
        run.current_file = None
        run.finished_at = finished
        _set_run_progress(run, finished, warnings)
        db.commit()
        run_dict = _sync_run_to_dict(run)

    _report(progress, "Processing sessions", "Updating the local session index", total, max(1, total), 94)
    return _sync_result_from_run(run_dict)


def _fail_sync_run(run_id: str, exc: Exception) -> dict | None:
    now = datetime.utcnow().isoformat()
    with SessionLocal() as db:
        run = db.get(LmuDuckdbSyncRunModel, run_id)
        if run is None:
            return None
        try:
            warnings = json.loads(run.warnings_json or "[]")
        except Exception:
            warnings = []
        warnings.append(str(exc))
        run.status = "failed"
        run.current_file = None
        run.finished_at = now
        _set_run_progress(run, now, warnings)
        db.commit()
        return _sync_run_to_dict(run)


def _sync_thread_target(run_id: str, folder_path: str) -> None:
    try:
        _execute_sync_run(run_id, folder_path)
    except Exception as exc:
        _fail_sync_run(run_id, exc)
    finally:
        with _sync_thread_lock:
            _sync_threads.pop(run_id, None)


def _ensure_sync_thread(run_id: str, folder_path: str) -> None:
    with _sync_thread_lock:
        existing = _sync_threads.get(run_id)
        if existing and existing.is_alive():
            return
        thread = threading.Thread(target=_sync_thread_target, args=(run_id, folder_path), name=f"lmu-sync-{run_id[:8]}", daemon=True)
        _sync_threads[run_id] = thread
        thread.start()


def start_sync_run(path: str | None = None) -> dict:
    folder_path = path or _configured_folder_path()
    if not folder_path:
        raise FileNotFoundError("No LMU telemetry session folder is configured.")
    folder = _folder(folder_path)
    with _sync_thread_lock:
        with SessionLocal() as db:
            active = _active_sync_run(db, folder)
            if active is None:
                active = _create_sync_run(folder)
                db.add(active)
                db.commit()
                db.refresh(active)
            run_dict = _sync_run_to_dict(active)
    _ensure_sync_thread(run_dict["id"], run_dict["folder_path"])
    return run_dict


def sync_folder(path: str | None = None, progress: ProgressCallback | None = None) -> dict:
    folder_path = path or _configured_folder_path()
    if not folder_path:
        raise FileNotFoundError("No LMU telemetry session folder is configured.")
    folder = _folder(folder_path)
    with SessionLocal() as db:
        run = _create_sync_run(folder)
        db.add(run)
        db.commit()
        run_id = run.id
    try:
        return _execute_sync_run(run_id, str(folder), progress=progress)
    except Exception as exc:
        _fail_sync_run(run_id, exc)
        raise


def _review_file(file_path: Path, sample_limit: int = 5000, progress: ProgressCallback | None = None) -> dict:
    warnings: list[str] = []
    _report(progress, "Loading database", f"Opening {file_path.name}", 0, 1, 8)
    conn = _open(file_path)
    try:
        _report(progress, "Reading telemetry", "Discovering telemetry channels", 0, 1, 20)
        metadata = _metadata(conn)
        channel_info = _channel_layout(conn)
        row_limit = _row_limit_for_review(sample_limit)
        if channel_info is not None:
            raw_rows, row_warnings = _select_channel_rows(conn, channel_info, row_limit=row_limit)
            warnings.extend(row_warnings)
            info = channel_info
            rows = raw_rows
        else:
            table_info, table_warnings = _best_table(conn)
            warnings.extend(table_warnings)
            if table_info is None:
                session = _file_session(file_path, None, warnings, metadata)
                session["sample_count"] = 0
                return {
                    "session": session,
                    "telemetry_samples": [],
                    "recommendations": [],
                    "laps": [],
                    "pit_events": [],
                    "summary": None,
                    "channel_manifest": _channel_manifest(conn, None),
                    "available_fields": _available_fields(None, []),
                    "warnings": warnings,
                }
            raw_rows, row_warnings = _select_rows(conn, table_info, row_limit=row_limit)
            warnings.extend(row_warnings)
            info = table_info
            rows = _review_rows(raw_rows, table_info)
        channel_manifest = _channel_manifest(conn, channel_info if channel_info is not None else None)
    finally:
        _close(conn)
    _report(progress, "Validating telemetry", "Validating laps and telemetry quality", 0, 1, 68)
    laps = _build_laps(rows)
    session = _file_session(file_path, info, warnings, metadata)
    session["latest_lap_number"] = max((int(lap["lap_number"]) for lap in laps), default=None)
    session["latest_game_time"] = rows[-1].get("game_time") if rows else None
    session["ended_at_game_time"] = session["latest_game_time"]
    _report(progress, "Processing database", "Building session summaries and charts", 1, 1, 88)
    return {
        "session": session,
        "telemetry_samples": _downsample(rows, sample_limit),
        "recommendations": [],
        "laps": laps,
        "pit_events": _pit_events(rows),
        "summary": _summary(rows, laps, info),
        "channel_manifest": channel_manifest,
        "available_fields": _available_fields(info, rows),
        "warnings": warnings,
    }


def review_session(path: str | None, session_id: str, sample_limit: int = 5000, progress: ProgressCallback | None = None) -> dict:
    file_path = None
    if path:
        folder = _folder(path)
        file_path = _find_session(folder, session_id)
    else:
        file_path = _find_session_by_id(session_id)
    if file_path is None:
        raise KeyError(session_id)
    if not path:
        fast = _review_from_validated_cache(file_path, session_id, sample_limit, progress)
        if fast is not None:
            return fast
    return _review_file(file_path, sample_limit=sample_limit, progress=progress)


def comparable_history(session_ids: list[str], progress: ProgressCallback | None = None) -> dict:
    reviews = []
    total = max(1, len(session_ids))
    for index, session_id in enumerate(session_ids):
        _report(progress, "Loading database", f"Loading comparable session {index + 1} of {len(session_ids)}", index, total, 5 + round((index / total) * 85))
        review = review_session(None, session_id, sample_limit=1)
        reviews.append(review)
        _report(progress, "Processing database", f"Processed comparable session {index + 1} of {len(session_ids)}", index + 1, total, 5 + round(((index + 1) / total) * 85))
    return {
        "telemetry_samples": [sample for review in reviews for sample in review.get("telemetry_samples") or []],
        "laps": [lap for review in reviews for lap in review.get("laps") or []],
        "pit_events": [event for review in reviews for event in review.get("pit_events") or []],
        "recommendations": [],
        "session_count": len(reviews),
    }


def trajectory_session(session_id: str, lap_a: str | None = None, lap_b: str | None = None, max_points: int = 1600) -> dict:
    file_path = _find_session_by_id(session_id)
    if file_path is None:
        raise KeyError(session_id)
    lap_numbers = [str(lap) for lap in (lap_a, lap_b) if lap not in (None, "")]
    if not lap_numbers:
        lap_numbers = _default_trajectory_laps(session_id)
    else:
        lap_numbers = list(dict.fromkeys(lap_numbers))
    conn = _open(file_path)
    try:
        layout = _channel_layout(conn)
        if layout is None:
            points, warnings = [], ["No supported session channel layout was found."]
        else:
            points, warnings = _trajectory_rows(conn, layout, lap_numbers, max(200, min(5000, max_points)))
    finally:
        _close(conn)
    return {
        "session_id": session_id,
        "laps": lap_numbers,
        "points": points,
        "warnings": warnings,
    }
