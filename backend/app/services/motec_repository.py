from __future__ import annotations

import csv
import json
import math
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator

from app.core.config import ROOT_DIR


DB_PATH = ROOT_DIR / "data" / "motec" / "motec.sqlite3"


CATEGORY_MAP: list[tuple[str, set[str]]] = [
    ("Time / lap", {"Time", "Session Elapsed Time", "Lap Number", "Realtime Loss", "Delta Best", "Marker"}),
    ("Driver inputs", {"Throttle Pos", "Brake Pos", "Clutch Pos", "Steering", "Steering Wheel Position", "Steering Shaft Torque", "FFB Output", "Brake Bias Rear"}),
    ("Speed / powertrain", {"Ground Speed", "Max Straight Speed", "Min Corner Speed", "Engine RPM", "Gear", "Eng Water Temp", "Eng Oil Temp", "Fuel Level", "Battery Charge Level"}),
    ("G-forces", {"G Force Lat", "G Force Long", "G Force Vert"}),
    ("Brakes", {"Brake Temp FL", "Brake Temp FR", "Brake Temp RL", "Brake Temp RR"}),
    ("GPS / environment", {"GPS Latitude", "GPS Longitude", "Ambient Temperature", "Track Temperature"}),
    ("Wheel rotation", {"Wheel Rot Speed FL", "Wheel Rot Speed FR", "Wheel Rot Speed RL", "Wheel Rot Speed RR"}),
    ("Tyre wear", {"Tyre Wear FL", "Tyre Wear FR", "Tyre Wear RL", "Tyre Wear RR"}),
    ("Tyre pressure", {"Tyre Pressure FL", "Tyre Pressure FR", "Tyre Pressure RL", "Tyre Pressure RR"}),
    ("Tyre load", {"Tyre Load FL", "Tyre Load FR", "Tyre Load RL", "Tyre Load RR"}),
    ("Grip fraction", {"Grip Fract FL", "Grip Fract FR", "Grip Fract RL", "Grip Fract RR"}),
    ("Ride height / platform", {"Ride Height FL", "Ride Height FR", "Ride Height RL", "Ride Height RR"}),
    ("Tyre temperatures", {
        "Tyre Temp FL Outer", "Tyre Temp FL Centre", "Tyre Temp FL Inner",
        "Tyre Temp FR Outer", "Tyre Temp FR Centre", "Tyre Temp FR Inner",
        "Tyre Temp RL Outer", "Tyre Temp RL Centre", "Tyre Temp RL Inner",
        "Tyre Temp RR Outer", "Tyre Temp RR Centre", "Tyre Temp RR Inner",
    }),
]


DERIVED_AVG: list[tuple[str, str, list[str]]] = [
    ("Front Brake Temp Avg", "C", ["Brake Temp FL", "Brake Temp FR"]),
    ("Rear Brake Temp Avg", "C", ["Brake Temp RL", "Brake Temp RR"]),
    ("Front Tyre Pressure Avg", "kPa", ["Tyre Pressure FL", "Tyre Pressure FR"]),
    ("Rear Tyre Pressure Avg", "kPa", ["Tyre Pressure RL", "Tyre Pressure RR"]),
    ("Front Ride Height Avg", "mm", ["Ride Height FL", "Ride Height FR"]),
    ("Rear Ride Height Avg", "mm", ["Ride Height RL", "Ride Height RR"]),
    ("Tyre Temp Avg FL", "C", ["Tyre Temp FL Outer", "Tyre Temp FL Centre", "Tyre Temp FL Inner"]),
    ("Tyre Temp Avg FR", "C", ["Tyre Temp FR Outer", "Tyre Temp FR Centre", "Tyre Temp FR Inner"]),
    ("Tyre Temp Avg RL", "C", ["Tyre Temp RL Outer", "Tyre Temp RL Centre", "Tyre Temp RL Inner"]),
    ("Tyre Temp Avg RR", "C", ["Tyre Temp RR Outer", "Tyre Temp RR Centre", "Tyre Temp RR Inner"]),
    ("Front Tyre Wear Avg", "%", ["Tyre Wear FL", "Tyre Wear FR"]),
    ("Rear Tyre Wear Avg", "%", ["Tyre Wear RL", "Tyre Wear RR"]),
    ("Left Tyre Wear Avg", "%", ["Tyre Wear FL", "Tyre Wear RL"]),
    ("Right Tyre Wear Avg", "%", ["Tyre Wear FR", "Tyre Wear RR"]),
]


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_motec_db() -> None:
    with _connect() as db:
        db.executescript(
            """
            create table if not exists motec_sessions (
                id text primary key,
                name text not null,
                imported_at text not null,
                sample_count integer not null,
                lap_count integer not null,
                min_session_time real,
                max_session_time real,
                warnings_json text not null
            );
            create table if not exists motec_channels (
                session_id text not null,
                original_name text not null,
                display_name text not null,
                unit text not null,
                category text not null,
                type text not null,
                wheel_position text,
                default_precision integer not null,
                default_graph_type text not null,
                default_min real,
                default_max real,
                derived integer not null default 0,
                primary key (session_id, original_name)
            );
            create table if not exists motec_laps (
                session_id text not null,
                lap_number text not null,
                start_time real,
                end_time real,
                duration real,
                sample_count integer not null,
                max_speed real,
                min_corner_speed real,
                max_rpm real,
                fuel_start real,
                fuel_end real,
                primary key (session_id, lap_number)
            );
            create table if not exists motec_samples (
                session_id text not null,
                row_index integer not null,
                lap_number text,
                time real,
                session_elapsed_time real,
                values_json text not null,
                primary key (session_id, row_index)
            );
            create index if not exists ix_motec_samples_lap on motec_samples(session_id, lap_number, row_index);
            """
        )


def _num(value: object) -> float | None:
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    return None


def _parse_value(value: str) -> float | str | None:
    raw = value.strip()
    if not raw:
        return None
    try:
        number = float(raw)
    except ValueError:
        return raw
    return number if math.isfinite(number) else None


def _lap_key(value: object) -> str:
    number = _num(value)
    if number is not None:
        return str(int(number)) if number.is_integer() else str(number)
    text = str(value or "").strip()
    return text or "Unknown"


def _avg(values: list[float | None]) -> float | None:
    clean = [value for value in values if value is not None]
    return sum(clean) / len(clean) if clean else None


def _category(name: str) -> str:
    for category, names in CATEGORY_MAP:
        if name in names:
            return category
    return "Imported"


def _wheel(name: str) -> str | None:
    return next((wheel for wheel in ("FL", "FR", "RL", "RR") if f" {wheel}" in name), None)


def _channel_type(name: str) -> str:
    if name == "Marker":
        return "marker"
    if name in {"Time", "Session Elapsed Time", "Lap Number"}:
        return "lap"
    if name.startswith("GPS "):
        return "gps"
    return "perWheel" if _wheel(name) else "scalar"


def _precision(unit: str, name: str) -> int:
    if name in {"Gear", "Lap Number"}:
        return 0
    if unit == "s":
        return 3
    return 1


def _scale(name: str, unit: str) -> tuple[float | None, float | None]:
    if unit == "%":
        return 0, 100
    if name == "Gear":
        return 0, 8
    if unit == "G":
        return -3, 3
    if name == "Ground Speed":
        return 0, 360
    return None, None


def _channel(name: str, unit: str, derived: bool = False) -> dict:
    min_value, max_value = _scale(name, unit)
    return {
        "originalName": name,
        "displayName": name,
        "unit": unit,
        "category": "Derived" if derived else _category(name),
        "type": _channel_type(name),
        "wheelPosition": _wheel(name),
        "defaultPrecision": _precision(unit, name),
        "defaultGraphType": "step" if name == "Gear" else "line",
        "defaultMin": min_value,
        "defaultMax": max_value,
        "derived": derived,
    }


@dataclass
class LapAccumulator:
    lap_number: str
    start_time: float | None = None
    end_time: float | None = None
    sample_count: int = 0
    max_speed: float | None = None
    min_corner_speed: float | None = None
    max_rpm: float | None = None
    fuel_start: float | None = None
    fuel_end: float | None = None

    def add(self, sample: dict) -> None:
        time = _num(sample.get("Time")) or _num(sample.get("Session Elapsed Time"))
        speed = _num(sample.get("Ground Speed"))
        corner = _num(sample.get("Min Corner Speed"))
        rpm = _num(sample.get("Engine RPM"))
        fuel = _num(sample.get("Fuel Level"))
        self.sample_count += 1
        if time is not None:
            self.start_time = time if self.start_time is None else min(self.start_time, time)
            self.end_time = time if self.end_time is None else max(self.end_time, time)
        if speed is not None:
            self.max_speed = speed if self.max_speed is None else max(self.max_speed, speed)
        if corner is not None:
            self.min_corner_speed = corner if self.min_corner_speed is None else min(self.min_corner_speed, corner)
        if rpm is not None:
            self.max_rpm = rpm if self.max_rpm is None else max(self.max_rpm, rpm)
        if fuel is not None and self.fuel_start is None:
            self.fuel_start = fuel
        if fuel is not None:
            self.fuel_end = fuel

    def row(self, session_id: str) -> tuple:
        duration = self.end_time - self.start_time if self.start_time is not None and self.end_time is not None else None
        return (session_id, self.lap_number, self.start_time, self.end_time, duration, self.sample_count, self.max_speed, self.min_corner_speed, self.max_rpm, self.fuel_start, self.fuel_end)


def _apply_derived(sample: dict, lap_start_time: float | None) -> None:
    for name, _unit, fields in DERIVED_AVG:
        sample[name] = _avg([_num(sample.get(field)) for field in fields])
    sample["Rake"] = (_num(sample.get("Rear Ride Height Avg")) or 0) - (_num(sample.get("Front Ride Height Avg")) or 0)
    sample["Brake/Throttle Overlap"] = (_num(sample.get("Brake Pos")) or 0) > 5 and (_num(sample.get("Throttle Pos")) or 0) > 5
    sample["Front Ride Height Min"] = min([value for value in [_num(sample.get("Ride Height FL")), _num(sample.get("Ride Height FR"))] if value is not None], default=None)
    sample["Rear Ride Height Min"] = min([value for value in [_num(sample.get("Ride Height RL")), _num(sample.get("Ride Height RR"))] if value is not None], default=None)
    sample["Combined G"] = math.hypot(_num(sample.get("G Force Lat")) or 0, _num(sample.get("G Force Long")) or 0)
    time = _num(sample.get("Time"))
    sample["Lap-relative time"] = time - lap_start_time if time is not None and lap_start_time is not None else None


async def _lines(chunks: AsyncIterator[bytes]) -> AsyncIterator[str]:
    buffer = ""
    for_aiter = chunks.__aiter__()
    while True:
        try:
            chunk = await for_aiter.__anext__()
        except StopAsyncIteration:
            break
        buffer += chunk.decode("utf-8-sig", errors="replace")
        parts = buffer.splitlines(keepends=True)
        buffer = ""
        for part in parts:
            if part.endswith("\n") or part.endswith("\r"):
                yield part.strip("\r\n")
            else:
                buffer = part
    if buffer:
        yield buffer.strip("\r\n")


async def import_csv_stream(file_name: str, chunks: AsyncIterator[bytes]) -> dict:
    init_motec_db()
    session_id = f"{int(datetime.now(tz=timezone.utc).timestamp() * 1000)}"
    names: list[str] | None = None
    units: list[str] | None = None
    warnings: list[str] = []
    row_index = 0
    min_session_time: float | None = None
    max_session_time: float | None = None
    lap_starts: dict[str, float | None] = {}
    laps: dict[str, LapAccumulator] = {}
    pending: list[tuple] = []

    with _connect() as db:
        db.execute("delete from motec_sessions where id = ?", (session_id,))
        async for line in _lines(chunks):
            if not line.strip():
                continue
            row = next(csv.reader([line]))
            if names is None:
                names = [item.strip() for item in row]
                continue
            if units is None:
                units = [item.strip() for item in row]
                if len(names) != len(units):
                    warnings.append("Channel and unit row lengths differ.")
                all_channels = [_channel(name, units[index] if index < len(units) else "") for index, name in enumerate(names)]
                all_channels.extend(_channel(name, unit, True) for name, unit, _fields in DERIVED_AVG)
                for name, unit in [
                    ("Rake", "mm"), ("Brake/Throttle Overlap", ""), ("Front Ride Height Min", "mm"),
                    ("Rear Ride Height Min", "mm"), ("Combined G", "G"), ("Lap-relative time", "s"),
                ]:
                    all_channels.append(_channel(name, unit, True))
                db.executemany(
                    """
                    insert into motec_channels values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            session_id, c["originalName"], c["displayName"], c["unit"], c["category"], c["type"],
                            c["wheelPosition"], c["defaultPrecision"], c["defaultGraphType"], c["defaultMin"],
                            c["defaultMax"], int(bool(c["derived"])),
                        )
                        for c in all_channels
                    ],
                )
                continue
            sample = {name: _parse_value(row[index] if index < len(row) else "") for index, name in enumerate(names)}
            lap = _lap_key(sample.get("Lap Number"))
            lap_starts.setdefault(lap, _num(sample.get("Time")))
            _apply_derived(sample, lap_starts.get(lap))
            session_time = _num(sample.get("Session Elapsed Time"))
            if session_time is not None:
                min_session_time = session_time if min_session_time is None else min(min_session_time, session_time)
                max_session_time = session_time if max_session_time is None else max(max_session_time, session_time)
            laps.setdefault(lap, LapAccumulator(lap)).add(sample)
            pending.append((session_id, row_index, lap, _num(sample.get("Time")), session_time, json.dumps(sample, separators=(",", ":"))))
            row_index += 1
            if len(pending) >= 5000:
                db.executemany("insert into motec_samples values (?, ?, ?, ?, ?, ?)", pending)
                db.commit()
                pending.clear()
        if names is None or units is None or row_index == 0:
            raise ValueError("CSV must contain channel row, unit row, and sample rows.")
        if pending:
            db.executemany("insert into motec_samples values (?, ?, ?, ?, ?, ?)", pending)
        db.executemany("insert into motec_laps values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [lap.row(session_id) for lap in laps.values()])
        db.execute(
            "insert into motec_sessions values (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                session_id,
                Path(file_name).stem,
                datetime.now(tz=timezone.utc).isoformat(),
                row_index,
                len(laps),
                min_session_time,
                max_session_time,
                json.dumps(warnings),
            ),
        )
        db.commit()
    return get_session(session_id)


def _session_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "importedAt": row["imported_at"],
        "sampleCount": row["sample_count"],
        "lapCount": row["lap_count"],
        "minSessionTime": row["min_session_time"],
        "maxSessionTime": row["max_session_time"],
        "warnings": json.loads(row["warnings_json"] or "[]"),
        "channels": [],
        "laps": [],
        "samples": [],
    }


def list_sessions() -> list[dict]:
    init_motec_db()
    with _connect() as db:
        return [_session_row(row) for row in db.execute("select * from motec_sessions order by imported_at desc")]


def get_session(session_id: str) -> dict:
    init_motec_db()
    with _connect() as db:
        row = db.execute("select * from motec_sessions where id = ?", (session_id,)).fetchone()
        if not row:
            raise KeyError(session_id)
        session = _session_row(row)
        session["channels"] = [
            {
                "originalName": c["original_name"], "displayName": c["display_name"], "unit": c["unit"],
                "category": c["category"], "type": c["type"], "wheelPosition": c["wheel_position"],
                "defaultPrecision": c["default_precision"], "defaultGraphType": c["default_graph_type"],
                "defaultMin": c["default_min"], "defaultMax": c["default_max"], "derived": bool(c["derived"]),
            }
            for c in db.execute("select * from motec_channels where session_id = ? order by rowid", (session_id,))
        ]
        session["laps"] = [
            {
                "lapNumber": lap["lap_number"], "startTime": lap["start_time"], "endTime": lap["end_time"],
                "duration": lap["duration"], "sampleCount": lap["sample_count"], "maxSpeed": lap["max_speed"],
                "minCornerSpeed": lap["min_corner_speed"], "maxRpm": lap["max_rpm"], "fuelStart": lap["fuel_start"],
                "fuelEnd": lap["fuel_end"],
            }
            for lap in db.execute("select * from motec_laps where session_id = ? order by cast(lap_number as real)", (session_id,))
        ]
        session["samples"] = []
        return session


def get_samples(session_id: str, lap: str | None, channels: list[str], max_points: int = 3000) -> dict:
    init_motec_db()
    max_points = max(100, min(max_points, 10000))
    where = "session_id = ?"
    params: list[object] = [session_id]
    if lap:
        where += " and lap_number = ?"
        params.append(lap)
    with _connect() as db:
        total = db.execute(f"select count(*) as n from motec_samples where {where}", params).fetchone()["n"]
        step = max(1, math.ceil(total / max_points))
        rows = db.execute(f"select values_json from motec_samples where {where} and (row_index % ?) = 0 order by row_index", [*params, step]).fetchall()
    requested = set(channels)
    base = {"Time", "Session Elapsed Time", "Lap Number", "Lap-relative time"}
    samples = []
    for row in rows:
        values = json.loads(row["values_json"])
        samples.append({key: values.get(key) for key in values.keys() if key in requested or key in base})
    return {"totalSamples": total, "returnedSamples": len(samples), "decimation": step, "samples": samples}
