from __future__ import annotations

import json
import math
import sqlite3
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select

from app.db.database import SessionLocal
from app.db.models import SessionModel, TelemetrySampleModel
from app.services.motec_repository import DB_PATH as MOTEC_DB_PATH, init_motec_db


def _num(value: Any) -> float | None:
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    return None


def _avg(values: list[float | None]) -> float | None:
    clean = [value for value in values if value is not None and math.isfinite(value)]
    return sum(clean) / len(clean) if clean else None


def _max(values: list[float | None]) -> float | None:
    clean = [value for value in values if value is not None and math.isfinite(value)]
    return max(clean) if clean else None


def _median(values: list[float]) -> float | None:
    clean = sorted(value for value in values if math.isfinite(value))
    if not clean:
        return None
    middle = len(clean) // 2
    if len(clean) % 2:
        return clean[middle]
    return (clean[middle - 1] + clean[middle]) / 2


def _robust_normal(values: list[float | None], minimum: float = 0.0) -> float | None:
    clean = [value for value in values if value is not None and math.isfinite(value) and value > minimum]
    if not clean:
        return None
    preliminary = _median(clean)
    if preliminary is None:
        return None
    plausible = [value for value in clean if preliminary * 0.70 <= value <= preliminary * 1.35]
    return _median(plausible or clean)


def _integrate_distance(samples: list[dict], time_key: str, speed_key: str) -> float | None:
    distance = 0.0
    usable = 0
    for previous, current in zip(samples, samples[1:]):
        previous_time = _num(previous.get(time_key))
        current_time = _num(current.get(time_key))
        speed = _num(previous.get(speed_key))
        if previous_time is None or current_time is None or speed is None:
            continue
        delta = current_time - previous_time
        if delta <= 0 or delta > 120:
            continue
        distance += speed * delta / 3600
        usable += 1
    return distance if usable else None


def _sample_dict(sample: TelemetrySampleModel) -> dict:
    return {column.name: getattr(sample, column.name) for column in sample.__table__.columns}


@dataclass
class ProfileFilters:
    track: str | None = None
    car: str | None = None
    car_class: str | None = None
    source: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    valid_only: bool = False
    tyre_compound: str | None = None
    track_temp_min: float | None = None
    track_temp_max: float | None = None
    ambient_temp_min: float | None = None
    ambient_temp_max: float | None = None
    fuel_min: float | None = None
    fuel_max: float | None = None
    lap_time_min: float | None = None
    lap_time_max: float | None = None
    search: str | None = None
    sort: str = "date"
    direction: str = "desc"
    page: int = 1
    page_size: int = 100


class ProfileRepository:
    min_lap_time_ratio = 0.75
    max_lap_time_ratio = 1.80
    min_distance_ratio = 0.75

    def _live_laps(self) -> list[dict]:
        with SessionLocal() as db:
            sessions = db.scalars(select(SessionModel).order_by(SessionModel.created_at.asc())).all()
            rows: list[dict] = []
            for session in sessions:
                samples = db.scalars(
                    select(TelemetrySampleModel)
                    .where(TelemetrySampleModel.session_id == session.id)
                    .order_by(TelemetrySampleModel.id.asc())
                ).all()
                grouped: dict[int, list[TelemetrySampleModel]] = defaultdict(list)
                for sample in samples:
                    if sample.lap_number is not None:
                        grouped[int(sample.lap_number)].append(sample)
                for lap_number, lap_samples in sorted(grouped.items()):
                    dict_samples = [_sample_dict(sample) for sample in lap_samples]
                    first = lap_samples[0]
                    last = lap_samples[-1]
                    duration = None
                    if first.game_time is not None and last.game_time is not None and last.game_time >= first.game_time:
                        duration = last.game_time - first.game_time
                    distance = _integrate_distance(dict_samples, "game_time", "speed_kph")
                    speed_values = [sample.speed_kph for sample in lap_samples if sample.speed_kph is not None]
                    fuel_used = first.fuel_liters - last.fuel_liters if first.fuel_liters is not None and last.fuel_liters is not None and first.fuel_liters >= last.fuel_liters else None
                    rows.append(
                        {
                            "id": f"live:{session.id}:{lap_number}",
                            "source": "live",
                            "session_id": session.id,
                            "session_name": session.session_type or "Live session",
                            "source_file": None,
                            "date": session.created_at,
                            "track": session.track_name or "Unknown track",
                            "layout": session.track_layout or "",
                            "car": session.vehicle_name or "Unknown car",
                            "car_class": session.vehicle_class or "Unknown class",
                    "session_type": session.session_type,
                            "lap_number": lap_number,
                            "lap_time": duration,
                            "valid_lap": None,
                            "distance_km": distance,
                            "fuel_start": first.fuel_liters,
                            "fuel_end": last.fuel_liters,
                            "fuel_used": fuel_used,
                            "tyre_compound": None,
                            "tyre_wear_fl": last.tyre_wear_fl,
                            "tyre_wear_fr": last.tyre_wear_fr,
                            "tyre_wear_rl": last.tyre_wear_rl,
                            "tyre_wear_rr": last.tyre_wear_rr,
                            "tyre_pressure_fl": last.tyre_pressure_fl,
                            "tyre_pressure_fr": last.tyre_pressure_fr,
                            "tyre_pressure_rl": last.tyre_pressure_rl,
                            "tyre_pressure_rr": last.tyre_pressure_rr,
                            "brake_temp_fl": _max([sample.brake_temp_fl for sample in lap_samples]),
                            "brake_temp_fr": _max([sample.brake_temp_fr for sample in lap_samples]),
                            "brake_temp_rl": _max([sample.brake_temp_rl for sample in lap_samples]),
                            "brake_temp_rr": _max([sample.brake_temp_rr for sample in lap_samples]),
                            "track_temp": _avg([sample.track_temp for sample in lap_samples]),
                            "ambient_temp": _avg([sample.ambient_temp for sample in lap_samples]),
                            "engine_oil_temp": _max([sample.engine_oil_temp for sample in lap_samples]),
                            "engine_water_temp": _max([sample.engine_water_temp for sample in lap_samples]),
                            "max_speed": max(speed_values) if speed_values else None,
                            "average_speed": distance / (duration / 3600) if distance is not None and duration and duration > 0 else _avg(speed_values),
                            "finish_position": session.final_position,
                    "finish_status": session.classified_status,
                        }
                    )
            return rows

    def _motec_laps(self) -> list[dict]:
        init_motec_db()
        if not MOTEC_DB_PATH.exists():
            return []
        rows: list[dict] = []
        with sqlite3.connect(MOTEC_DB_PATH) as db:
            db.row_factory = sqlite3.Row
            sessions = db.execute("select * from motec_sessions order by imported_at asc").fetchall()
            for session in sessions:
                lap_rows = db.execute("select * from motec_laps where session_id = ? order by cast(lap_number as real)", (session["id"],)).fetchall()
                for lap in lap_rows:
                    needs_sample_fallback = lap["distance_km"] is None
                    samples = []
                    if needs_sample_fallback:
                        samples = [
                            json.loads(row["values_json"])
                            for row in db.execute(
                                "select values_json from motec_samples where session_id = ? and lap_number = ? order by row_index",
                                (session["id"], lap["lap_number"]),
                            )
                        ]
                    first = samples[0] if samples else {}
                    last = samples[-1] if samples else {}
                    distance = lap["distance_km"] if lap["distance_km"] is not None else _integrate_distance(samples, "Time", "Ground Speed")
                    duration = _num(lap["duration"])
                    speed_values = [_num(sample.get("Ground Speed")) for sample in samples]
                    rows.append(
                        {
                            "id": f"csv:{session['id']}:{lap['lap_number']}",
                            "source": "csv",
                            "session_id": session["id"],
                            "session_name": session["name"],
                            "source_file": session["name"],
                            "date": session["imported_at"],
                            "track": session["track_name"] or "Unknown track",
                            "layout": session["track_layout"] or "",
                            "car": session["car_name"] or "Unknown car",
                            "car_class": session["car_class"] or "Unknown class",
                            "session_type": session["session_type"] if "session_type" in session.keys() and session["session_type"] else "CSV Import",
                            "lap_number": lap["lap_number"],
                            "lap_time": duration,
                            "valid_lap": None,
                            "distance_km": distance,
                            "fuel_start": lap["fuel_start"],
                            "fuel_end": lap["fuel_end"],
                            "fuel_used": lap["fuel_start"] - lap["fuel_end"] if lap["fuel_start"] is not None and lap["fuel_end"] is not None and lap["fuel_start"] >= lap["fuel_end"] else None,
                            "tyre_compound": None,
                            "tyre_wear_fl": lap["tyre_wear_fl"] if lap["tyre_wear_fl"] is not None else last.get("Tyre Wear FL"),
                            "tyre_wear_fr": lap["tyre_wear_fr"] if lap["tyre_wear_fr"] is not None else last.get("Tyre Wear FR"),
                            "tyre_wear_rl": lap["tyre_wear_rl"] if lap["tyre_wear_rl"] is not None else last.get("Tyre Wear RL"),
                            "tyre_wear_rr": lap["tyre_wear_rr"] if lap["tyre_wear_rr"] is not None else last.get("Tyre Wear RR"),
                            "tyre_pressure_fl": lap["tyre_pressure_fl"] if lap["tyre_pressure_fl"] is not None else last.get("Tyre Pressure FL"),
                            "tyre_pressure_fr": lap["tyre_pressure_fr"] if lap["tyre_pressure_fr"] is not None else last.get("Tyre Pressure FR"),
                            "tyre_pressure_rl": lap["tyre_pressure_rl"] if lap["tyre_pressure_rl"] is not None else last.get("Tyre Pressure RL"),
                            "tyre_pressure_rr": lap["tyre_pressure_rr"] if lap["tyre_pressure_rr"] is not None else last.get("Tyre Pressure RR"),
                            "brake_temp_fl": lap["brake_temp_fl"] if lap["brake_temp_fl"] is not None else _max([_num(sample.get("Brake Temp FL")) for sample in samples]),
                            "brake_temp_fr": lap["brake_temp_fr"] if lap["brake_temp_fr"] is not None else _max([_num(sample.get("Brake Temp FR")) for sample in samples]),
                            "brake_temp_rl": lap["brake_temp_rl"] if lap["brake_temp_rl"] is not None else _max([_num(sample.get("Brake Temp RL")) for sample in samples]),
                            "brake_temp_rr": lap["brake_temp_rr"] if lap["brake_temp_rr"] is not None else _max([_num(sample.get("Brake Temp RR")) for sample in samples]),
                            "track_temp": lap["track_temp"] if lap["track_temp"] is not None else _avg([_num(sample.get("Track Temperature")) for sample in samples]),
                            "ambient_temp": lap["ambient_temp"] if lap["ambient_temp"] is not None else _avg([_num(sample.get("Ambient Temperature")) for sample in samples]),
                            "engine_oil_temp": lap["engine_oil_temp"] if lap["engine_oil_temp"] is not None else _max([_num(sample.get("Eng Oil Temp")) for sample in samples]),
                            "engine_water_temp": lap["engine_water_temp"] if lap["engine_water_temp"] is not None else _max([_num(sample.get("Eng Water Temp")) for sample in samples]),
                            "max_speed": lap["max_speed"],
                            "average_speed": lap["average_speed"] if lap["average_speed"] is not None else (distance / (duration / 3600) if distance is not None and duration and duration > 0 else _avg(speed_values)),
                            "finish_position": session["finish_position"],
                            "finish_status": session["finish_status"],
                        }
                    )
        return rows

    def all_laps(self) -> list[dict]:
        return self._with_lap_quality(self._live_laps() + self._motec_laps())

    def _with_lap_quality(self, laps: list[dict]) -> list[dict]:
        grouped: dict[str, list[dict]] = defaultdict(list)
        for lap in laps:
            grouped[f"{lap.get('source')}:{lap.get('session_id')}"].append(lap)
        for session_laps in grouped.values():
            normal_time = _robust_normal([_num(lap.get("lap_time")) for lap in session_laps], minimum=40.0)
            normal_distance = _robust_normal([_num(lap.get("distance_km")) for lap in session_laps], minimum=0.5)
            for lap in session_laps:
                lap_time = _num(lap.get("lap_time"))
                distance = _num(lap.get("distance_km"))
                time_ratio = lap_time / normal_time if lap_time is not None and normal_time else None
                distance_ratio = distance / normal_distance if distance is not None and normal_distance else None
                valid = True
                reason = "estimated_full_lap"
                if lap_time is None or normal_time is None:
                    valid = False
                    reason = "insufficient_lap_time"
                elif time_ratio is not None and time_ratio < self.min_lap_time_ratio:
                    valid = False
                    reason = "partial_or_out_lap"
                elif time_ratio is not None and time_ratio > self.max_lap_time_ratio:
                    valid = False
                    reason = "very_slow_or_incident_lap"
                elif distance_ratio is not None and distance_ratio < self.min_distance_ratio:
                    valid = False
                    reason = "short_distance_lap"
                lap["expected_lap_time"] = normal_time
                lap["lap_time_ratio"] = time_ratio
                lap["expected_distance_km"] = normal_distance
                lap["distance_ratio"] = distance_ratio
                lap["valid_lap"] = valid
                lap["lap_quality"] = reason
        return laps

    def _sessions_from_laps(self, laps: list[dict]) -> dict[str, dict]:
        sessions: dict[str, dict] = {}
        for lap in laps:
            key = f"{lap['source']}:{lap['session_id']}"
            session = sessions.setdefault(
                key,
                {
                    "source": lap["source"],
                    "session_id": lap["session_id"],
                    "track": lap["track"],
                    "layout": lap["layout"],
                    "car": lap["car"],
                    "car_class": lap["car_class"],
                    "session_type": lap.get("session_type"),
                    "date": lap["date"],
                    "finish_position": lap.get("finish_position"),
                    "finish_status": lap.get("finish_status"),
                    "laps": 0,
                    "distance_km": 0.0,
                    "duration": 0.0,
                },
            )
            session["laps"] += 1
            session["distance_km"] += _num(lap.get("distance_km")) or 0
            session["duration"] += _num(lap.get("lap_time")) or 0
        return sessions

    def summary(self) -> dict:
        laps = self.all_laps()
        sessions = self._sessions_from_laps(laps)
        total_distance = sum((_num(lap.get("distance_km")) or 0) for lap in laps)
        total_driving_time = sum((_num(lap.get("lap_time")) or 0) for lap in laps)
        valid_laps = [lap for lap in laps if lap.get("valid_lap")]
        session_values = list(sessions.values())
        race_sessions = [session for session in session_values if self._is_race_session(session)]
        wins = sum(1 for session in race_sessions if session.get("finish_position") == 1)
        podiums = sum(1 for session in race_sessions if (session.get("finish_position") or 999) <= 3)
        top10 = sum(1 for session in race_sessions if (session.get("finish_position") or 999) <= 10)
        dnf_dns = sum(1 for session in race_sessions if str(session.get("finish_status") or "").lower() in {"dnf", "dns", "dq"})
        by_class = []
        for car_class, class_laps in self._group(laps, "car_class").items():
            distance = sum((_num(lap.get("distance_km")) or 0) for lap in class_laps)
            class_sessions = {f"{lap['source']}:{lap['session_id']}" for lap in class_laps}
            by_class.append(
                {
                    "car_class": car_class,
                    "distance_km": distance,
                    "sessions": len(class_sessions),
                    "laps": len(class_laps),
                    "distance_percent": (distance / total_distance * 100) if total_distance else 0,
                }
            )
        by_class.sort(key=lambda row: row["distance_km"], reverse=True)
        return {
            "totals": {
                "total_distance_km": total_distance,
                "total_sessions": len(sessions),
                "total_laps": len(laps),
                "valid_laps": len(valid_laps),
                "total_driving_time": total_driving_time,
                "different_cars": len({lap["car"] for lap in laps if lap.get("car")}),
                "different_tracks": len({lap["track"] for lap in laps if lap.get("track")}),
                "average_session_duration": total_driving_time / len(sessions) if sessions else None,
                "average_distance_per_session": total_distance / len(sessions) if sessions else None,
                "average_laps_per_session": len(laps) / len(sessions) if sessions else None,
                "wins": wins,
                "podiums": podiums,
                "top10": top10,
                "dnf_dns": dnf_dns,
                "race_sessions": len(race_sessions),
                "live_sessions": len({lap["session_id"] for lap in laps if lap["source"] == "live"}),
                "csv_sessions": len({lap["session_id"] for lap in laps if lap["source"] == "csv"}),
                "best_lap_count": len(self.best_laps()),
            },
            "distance_by_class": by_class,
            "top_cars": self._top_cars(laps),
            "top_tracks": self._top_tracks(laps),
        }

    def _is_race_session(self, session: dict) -> bool:
        session_type = str(session.get("session_type") or "").lower()
        return "race" in session_type

    def _group(self, laps: list[dict], key: str) -> dict[str, list[dict]]:
        grouped: dict[str, list[dict]] = defaultdict(list)
        for lap in laps:
            grouped[str(lap.get(key) or "Unknown")].append(lap)
        return grouped

    def _top_cars(self, laps: list[dict]) -> list[dict]:
        rows = []
        for car, car_laps in self._group(laps, "car").items():
            distance = sum((_num(lap.get("distance_km")) or 0) for lap in car_laps)
            sessions = {f"{lap['source']}:{lap['session_id']}" for lap in car_laps}
            tracks = {lap["track"] for lap in car_laps}
            rows.append(
                {
                    "car": car,
                    "car_class": car_laps[0].get("car_class") or "Unknown class",
                    "distance_km": distance,
                    "sessions": len(sessions),
                    "laps": len(car_laps),
                    "tracks": len(tracks),
                }
            )
        return sorted(rows, key=lambda row: row["distance_km"], reverse=True)[:5]

    def _top_tracks(self, laps: list[dict]) -> list[dict]:
        rows = []
        for track, track_laps in self._group(laps, "track").items():
            distance = sum((_num(lap.get("distance_km")) or 0) for lap in track_laps)
            sessions = {f"{lap['source']}:{lap['session_id']}" for lap in track_laps}
            best = min((_num(lap.get("lap_time")) for lap in track_laps if lap.get("valid_lap") and _num(lap.get("lap_time"))), default=None)
            car_counter = Counter(str(lap.get("car") or "Unknown car") for lap in track_laps)
            rows.append(
                {
                    "track": track,
                    "layout": track_laps[0].get("layout") or "",
                    "distance_km": distance,
                    "sessions": len(sessions),
                    "laps": len(track_laps),
                    "best_lap": best,
                    "most_used_car": car_counter.most_common(1)[0][0] if car_counter else "Unknown car",
                }
            )
        return sorted(rows, key=lambda row: row["distance_km"], reverse=True)[:5]

    def best_laps(self) -> list[dict]:
        best: dict[tuple, dict] = {}
        for lap in self.all_laps():
            lap_time = _num(lap.get("lap_time"))
            if lap_time is None or lap_time <= 0 or not lap.get("valid_lap"):
                continue
            key = (lap.get("track"), lap.get("layout"), lap.get("car"), lap.get("car_class"))
            if key not in best or lap_time < (best[key].get("lap_time") or math.inf):
                best[key] = lap
        return sorted(best.values(), key=lambda lap: (str(lap.get("track")), str(lap.get("car")), lap.get("lap_time") or math.inf))

    def filtered_laps(self, filters: ProfileFilters) -> dict:
        laps = self.all_laps()
        filtered = [lap for lap in laps if self._matches(lap, filters)]
        reverse = filters.direction != "asc"
        sort_key = filters.sort
        filtered.sort(key=lambda lap: self._sort_value(lap, sort_key), reverse=reverse)
        page_size = max(10, min(filters.page_size, 500))
        page = max(1, filters.page)
        start = (page - 1) * page_size
        return {
            "total": len(filtered),
            "page": page,
            "page_size": page_size,
            "laps": filtered[start:start + page_size],
        }

    def _matches(self, lap: dict, filters: ProfileFilters) -> bool:
        checks = [
            (filters.track, lap.get("track")),
            (filters.car, lap.get("car")),
            (filters.car_class, lap.get("car_class")),
            (filters.source, lap.get("source")),
            (filters.tyre_compound, lap.get("tyre_compound")),
        ]
        for expected, actual in checks:
            if expected and str(expected).lower() != str(actual or "").lower():
                return False
        if filters.valid_only and not lap.get("valid_lap"):
            return False
        if filters.date_from and str(lap.get("date") or "") < filters.date_from:
            return False
        if filters.date_to and str(lap.get("date") or "") > filters.date_to:
            return False
        ranges = [
            ("track_temp", filters.track_temp_min, filters.track_temp_max),
            ("ambient_temp", filters.ambient_temp_min, filters.ambient_temp_max),
            ("fuel_start", filters.fuel_min, filters.fuel_max),
            ("lap_time", filters.lap_time_min, filters.lap_time_max),
        ]
        for key, min_value, max_value in ranges:
            value = _num(lap.get(key))
            if min_value is not None and (value is None or value < min_value):
                return False
            if max_value is not None and (value is None or value > max_value):
                return False
        if filters.search:
            haystack = " ".join(str(lap.get(key) or "") for key in ("car", "track", "car_class", "session_name", "source_file")).lower()
            if filters.search.lower() not in haystack:
                return False
        return True

    def _sort_value(self, lap: dict, key: str) -> Any:
        aliases = {
            "date": "date",
            "lap_time": "lap_time",
            "track": "track",
            "car": "car",
            "fuel": "fuel_start",
            "tyre_wear": "tyre_wear_fl",
            "track_temp": "track_temp",
        }
        value = lap.get(aliases.get(key, key))
        if isinstance(value, str):
            return value.lower()
        if key in {"date", "track", "car"}:
            return ""
        return value if value is not None else math.inf
