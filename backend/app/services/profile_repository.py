from __future__ import annotations

import math
import sqlite3
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select

from app.db.database import SessionLocal
from app.db.models import LapSummaryModel, SessionAggregateModel, SessionModel, TelemetrySampleModel, UserLifetimeStatsModel
from app.db.repository import Repository
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
    session: str | None = None
    layout: str | None = None
    lap_number: str | None = None
    source: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    valid_only: bool = False
    valid_status: str | None = None
    tyre_compound: str | None = None
    track_temp_min: float | None = None
    track_temp_max: float | None = None
    ambient_temp_min: float | None = None
    ambient_temp_max: float | None = None
    fuel_min: float | None = None
    fuel_max: float | None = None
    fuel_used_min: float | None = None
    fuel_used_max: float | None = None
    lap_time_min: float | None = None
    lap_time_max: float | None = None
    tyre_wear_min: float | None = None
    tyre_wear_max: float | None = None
    tyre_pressure_min: float | None = None
    tyre_pressure_max: float | None = None
    brake_temp_min: float | None = None
    brake_temp_max: float | None = None
    oil_temp_min: float | None = None
    oil_temp_max: float | None = None
    water_temp_min: float | None = None
    water_temp_max: float | None = None
    speed_min: float | None = None
    speed_max: float | None = None
    search: str | None = None
    sort: str = "date"
    direction: str = "desc"
    page: int = 1
    page_size: int = 100


class ProfileRepository:
    min_lap_time_ratio = 0.75
    max_lap_time_ratio = 1.80
    min_distance_ratio = 0.75
    _all_laps_cache_key: tuple[int | None, int, str | None, float | None, float | None] | None = None
    _all_laps_cache: list[dict] | None = None

    def _all_laps_cache_token(self) -> tuple[int | None, int, str | None, float | None, int | None, str | None, float | None]:
        with SessionLocal() as db:
            latest_live_sample_id = db.scalar(select(func.max(TelemetrySampleModel.id)))
            live_session_count = db.scalar(select(func.count(SessionModel.id))) or 0
            latest_session_created = db.scalar(select(func.max(SessionModel.created_at)))
            latest_session_end = db.scalar(select(func.max(SessionModel.ended_at_game_time)))
            latest_aggregate_count = db.scalar(select(func.count(SessionAggregateModel.session_id))) or 0
            latest_removed = db.scalar(select(func.max(SessionModel.removed_at)))
        motec_mtime = MOTEC_DB_PATH.stat().st_mtime if MOTEC_DB_PATH.exists() else None
        return latest_live_sample_id, int(live_session_count), latest_session_created, latest_session_end, int(latest_aggregate_count), latest_removed, motec_mtime

    def _live_lap_base(self, session: SessionModel, repository: Repository, lap_number: Any) -> dict:
        return {
            "id": f"live:{session.id}:{lap_number}",
            "source": "live",
            "session_id": session.id,
            "session_name": session.session_type or "Live session",
            "source_file": None,
            "date": session.created_at,
            "track": session.track_name or "Unknown track",
            "layout": session.track_layout or "",
            "car": session.vehicle_model or session.vehicle_name or "Unknown car",
            "car_class": session.vehicle_class or "Unknown class",
            "session_type": repository._session_type_name(session.session_type),
            "lap_number": lap_number,
            "finish_position": session.final_position,
            "finish_status": session.classified_status,
        }

    def _aggregate_lap_row(self, session: SessionModel, aggregate: SessionAggregateModel, lap: dict, repository: Repository) -> dict:
        lap_distance = aggregate.total_distance_km / aggregate.lap_count if aggregate.total_distance_km is not None and aggregate.lap_count else None
        row = self._live_lap_base(session, repository, lap.get("lap_number"))
        row.update(
            {
                "session_name": session.session_type or "Saved session",
                "lap_time": lap.get("lap_time"),
                "valid_lap": lap.get("valid_lap"),
                "in_pit": lap.get("in_pit"),
                "distance_km": lap_distance,
                "fuel_start": lap.get("fuel_start"),
                "fuel_end": lap.get("fuel_end"),
                "fuel_used": lap.get("fuel_used"),
                "fuel_added": lap.get("fuel_added"),
                "tyre_compound": None,
                "tyre_wear_fl": lap.get("tyre_wear_end_fl") or lap.get("tyre_wear_end"),
                "tyre_wear_fr": lap.get("tyre_wear_end_fr") or lap.get("tyre_wear_end"),
                "tyre_wear_rl": lap.get("tyre_wear_end_rl") or lap.get("tyre_wear_end"),
                "tyre_wear_rr": lap.get("tyre_wear_end_rr") or lap.get("tyre_wear_end"),
                "tyre_pressure_fl": lap.get("tyre_pressure_fl") or aggregate.average_tyre_pressure,
                "tyre_pressure_fr": lap.get("tyre_pressure_fr") or aggregate.average_tyre_pressure,
                "tyre_pressure_rl": lap.get("tyre_pressure_rl") or aggregate.average_tyre_pressure,
                "tyre_pressure_rr": lap.get("tyre_pressure_rr") or aggregate.average_tyre_pressure,
                "brake_temp_fl": lap.get("brake_temp_fl") or aggregate.average_brake_temp,
                "brake_temp_fr": lap.get("brake_temp_fr") or aggregate.average_brake_temp,
                "brake_temp_rl": lap.get("brake_temp_rl") or aggregate.average_brake_temp,
                "brake_temp_rr": lap.get("brake_temp_rr") or aggregate.average_brake_temp,
                "track_temp": lap.get("track_temp"),
                "ambient_temp": lap.get("ambient_temp"),
                "engine_oil_temp": lap.get("engine_oil_temp"),
                "engine_water_temp": lap.get("engine_water_temp"),
                "max_speed": lap.get("top_speed") or aggregate.top_speed,
                "average_speed": lap.get("speed_kph"),
            }
        )
        return row

    def _live_laps(self) -> list[dict]:
        repository = Repository()
        with SessionLocal() as db:
            sessions = db.scalars(select(SessionModel).where(SessionModel.is_saved.is_(True)).order_by(SessionModel.created_at.asc())).all()
            session_ids = [session.id for session in sessions]
            if not session_ids:
                return []
            aggregates = {
                aggregate.session_id: aggregate
                for aggregate in db.scalars(select(SessionAggregateModel).where(SessionAggregateModel.session_id.in_(session_ids))).all()
            }
            sample_counts = {
                session_id: int(count or 0)
                for session_id, count in db.execute(
                    select(TelemetrySampleModel.session_id, func.count(TelemetrySampleModel.id))
                    .where(TelemetrySampleModel.session_id.in_(session_ids))
                    .group_by(TelemetrySampleModel.session_id)
                ).all()
            }
            raw_session_ids = [session.id for session in sessions if not (aggregates.get(session.id) and sample_counts.get(session.id, 0) == 0)]
            samples_by_session: dict[str, list[TelemetrySampleModel]] = defaultdict(list)
            laps_by_session: dict[str, list[LapSummaryModel]] = defaultdict(list)
            if raw_session_ids:
                samples = db.scalars(
                    select(TelemetrySampleModel)
                    .where(TelemetrySampleModel.session_id.in_(raw_session_ids))
                    .order_by(TelemetrySampleModel.session_id.asc(), TelemetrySampleModel.id.asc())
                ).all()
                for sample in samples:
                    samples_by_session[sample.session_id].append(sample)
                stored_laps = db.scalars(
                    select(LapSummaryModel)
                    .where(LapSummaryModel.session_id.in_(raw_session_ids))
                    .order_by(LapSummaryModel.session_id.asc(), LapSummaryModel.lap_number.asc())
                ).all()
                for lap in stored_laps:
                    laps_by_session[lap.session_id].append(lap)
            rows: list[dict] = []
            for session in sessions:
                aggregate = aggregates.get(session.id)
                if aggregate and sample_counts.get(session.id, 0) == 0:
                    rows.extend(self._aggregate_lap_row(session, aggregate, lap, repository) for lap in repository._json_rows(aggregate.laps_json))
                    continue
                samples = samples_by_session.get(session.id, [])
                grouped: dict[int, list[TelemetrySampleModel]] = defaultdict(list)
                for sample in samples:
                    if sample.lap_number is not None:
                        grouped[int(sample.lap_number)].append(sample)
                stored_laps = laps_by_session.get(session.id, [])
                if stored_laps:
                    for lap in stored_laps:
                        lap_samples = grouped.get(int(lap.lap_number), [])
                        dict_samples = [_sample_dict(sample) for sample in lap_samples]
                        distance = _integrate_distance(dict_samples, "game_time", "speed_kph")
                        speed_values = [sample.speed_kph for sample in lap_samples if sample.speed_kph is not None]
                        last = lap_samples[-1] if lap_samples else None
                        row = self._live_lap_base(session, repository, lap.lap_number)
                        row.update(
                            {
                                "lap_number": lap.lap_number,
                                "lap_time": lap.lap_time,
                                "valid_lap": lap.valid_lap,
                                "in_pit": lap.in_pit,
                                "distance_km": distance,
                                "fuel_start": lap.fuel_start,
                                "fuel_end": lap.fuel_end,
                                "fuel_used": lap.fuel_used,
                                "fuel_added": None,
                                "tyre_compound": None,
                                "tyre_wear_fl": last.tyre_wear_fl if last else lap.tyre_wear_end,
                                "tyre_wear_fr": last.tyre_wear_fr if last else lap.tyre_wear_end,
                                "tyre_wear_rl": last.tyre_wear_rl if last else lap.tyre_wear_end,
                                "tyre_wear_rr": last.tyre_wear_rr if last else lap.tyre_wear_end,
                                "tyre_pressure_fl": last.tyre_pressure_fl if last else None,
                                "tyre_pressure_fr": last.tyre_pressure_fr if last else None,
                                "tyre_pressure_rl": last.tyre_pressure_rl if last else None,
                                "tyre_pressure_rr": last.tyre_pressure_rr if last else None,
                                "brake_temp_fl": _max([sample.brake_temp_fl for sample in lap_samples]),
                                "brake_temp_fr": _max([sample.brake_temp_fr for sample in lap_samples]),
                                "brake_temp_rl": _max([sample.brake_temp_rl for sample in lap_samples]),
                                "brake_temp_rr": _max([sample.brake_temp_rr for sample in lap_samples]),
                                "track_temp": _avg([sample.track_temp for sample in lap_samples]),
                                "ambient_temp": _avg([sample.ambient_temp for sample in lap_samples]),
                                "engine_oil_temp": _max([sample.engine_oil_temp for sample in lap_samples]),
                                "engine_water_temp": _max([sample.engine_water_temp for sample in lap_samples]),
                                "max_speed": max(speed_values) if speed_values else None,
                                "average_speed": distance / (lap.lap_time / 3600) if distance is not None and lap.lap_time and lap.lap_time > 0 else _avg(speed_values),
                            }
                        )
                        rows.append(row)
                    continue
                built_laps = repository._build_laps(samples)
                for lap in built_laps:
                    lap_number = int(lap["lap_number"])
                    lap_samples = grouped.get(lap_number, [])
                    if not lap_samples:
                        continue
                    dict_samples = [_sample_dict(sample) for sample in lap_samples]
                    first = lap_samples[0]
                    last = lap_samples[-1]
                    distance = _integrate_distance(dict_samples, "game_time", "speed_kph")
                    speed_values = [sample.speed_kph for sample in lap_samples if sample.speed_kph is not None]
                    row = self._live_lap_base(session, repository, lap_number)
                    row.update(
                        {
                            "lap_number": lap_number,
                            "lap_time": lap.get("lap_time"),
                            "valid_lap": lap.get("valid_lap"),
                            "in_pit": lap.get("in_pit"),
                            "distance_km": distance,
                            "fuel_start": lap.get("fuel_start"),
                            "fuel_end": lap.get("fuel_end"),
                            "fuel_used": lap.get("fuel_used"),
                            "fuel_added": lap.get("fuel_added"),
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
                            "max_speed": lap.get("top_speed") or (max(speed_values) if speed_values else None),
                            "average_speed": distance / (lap["lap_time"] / 3600) if distance is not None and lap.get("lap_time") and lap["lap_time"] > 0 else _avg(speed_values),
                        }
                    )
                    rows.append(row)
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
                    distance = lap["distance_km"]
                    duration = _num(lap["duration"])
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
                            "tyre_wear_fl": lap["tyre_wear_fl"],
                            "tyre_wear_fr": lap["tyre_wear_fr"],
                            "tyre_wear_rl": lap["tyre_wear_rl"],
                            "tyre_wear_rr": lap["tyre_wear_rr"],
                            "tyre_pressure_fl": lap["tyre_pressure_fl"],
                            "tyre_pressure_fr": lap["tyre_pressure_fr"],
                            "tyre_pressure_rl": lap["tyre_pressure_rl"],
                            "tyre_pressure_rr": lap["tyre_pressure_rr"],
                            "brake_temp_fl": lap["brake_temp_fl"],
                            "brake_temp_fr": lap["brake_temp_fr"],
                            "brake_temp_rl": lap["brake_temp_rl"],
                            "brake_temp_rr": lap["brake_temp_rr"],
                            "track_temp": lap["track_temp"],
                            "ambient_temp": lap["ambient_temp"],
                            "engine_oil_temp": lap["engine_oil_temp"],
                            "engine_water_temp": lap["engine_water_temp"],
                            "max_speed": lap["max_speed"],
                            "average_speed": lap["average_speed"] if lap["average_speed"] is not None else (distance / (duration / 3600) if distance is not None and duration and duration > 0 else None),
                            "finish_position": session["finish_position"],
                            "finish_status": session["finish_status"],
                        }
                    )
        return rows

    def all_laps(self) -> list[dict]:
        token = self._all_laps_cache_token()
        if self.__class__._all_laps_cache_key == token and self.__class__._all_laps_cache is not None:
            return self.__class__._all_laps_cache
        laps = self._with_lap_quality(self._live_laps() + self._motec_laps())
        self.__class__._all_laps_cache_key = token
        self.__class__._all_laps_cache = laps
        return laps

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
                if lap.get("valid_lap") is False:
                    valid = False
                    reason = "recorded_invalid_lap"
                elif lap.get("in_pit"):
                    valid = False
                    reason = "pit_lap"
                elif lap_time is None or normal_time is None:
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

    def _persisted_session_counts(self) -> dict[str, int]:
        with SessionLocal() as db:
            live_sessions = db.scalar(select(func.count(SessionModel.id)).where(SessionModel.is_saved.is_(True))) or 0
        csv_sessions = 0
        init_motec_db()
        if MOTEC_DB_PATH.exists():
            with sqlite3.connect(MOTEC_DB_PATH) as db:
                csv_sessions = int(db.execute("select count(*) from motec_sessions").fetchone()[0] or 0)
        return {"live": int(live_sessions), "csv": csv_sessions, "total": int(live_sessions) + csv_sessions}

    def _live_session_distances(self) -> dict[str, float]:
        with SessionLocal() as db:
            sessions = db.scalars(select(SessionModel).where(SessionModel.is_saved.is_(True)).order_by(SessionModel.created_at.asc())).all()
            session_ids = [session.id for session in sessions]
            if not session_ids:
                return {}
            aggregates = {
                aggregate.session_id: aggregate
                for aggregate in db.scalars(select(SessionAggregateModel).where(SessionAggregateModel.session_id.in_(session_ids))).all()
            }
            distances: dict[str, float] = {}
            sessions_needing_samples: list[str] = []
            for session in sessions:
                aggregate = aggregates.get(session.id)
                if aggregate and aggregate.total_distance_km is not None:
                    distances[f"live:{session.id}"] = aggregate.total_distance_km
                    continue
                sessions_needing_samples.append(session.id)
            if sessions_needing_samples:
                samples_by_session: dict[str, list[TelemetrySampleModel]] = defaultdict(list)
                samples = db.scalars(
                    select(TelemetrySampleModel)
                    .where(TelemetrySampleModel.session_id.in_(sessions_needing_samples))
                    .order_by(TelemetrySampleModel.session_id.asc(), TelemetrySampleModel.id.asc())
                ).all()
                for sample in samples:
                    samples_by_session[sample.session_id].append(sample)
                for session_id in sessions_needing_samples:
                    distance = _integrate_distance([_sample_dict(sample) for sample in samples_by_session.get(session_id, [])], "game_time", "speed_kph")
                    distances[f"live:{session_id}"] = distance or 0.0
            return distances

    def _motec_session_distances(self) -> dict[str, float]:
        init_motec_db()
        if not MOTEC_DB_PATH.exists():
            return {}
        with sqlite3.connect(MOTEC_DB_PATH) as db:
            db.row_factory = sqlite3.Row
            rows = db.execute("select session_id, sum(coalesce(distance_km, 0)) as distance from motec_laps group by session_id").fetchall()
            return {f"csv:{row['session_id']}": float(row["distance"] or 0.0) for row in rows}

    def _career_session_distances(self) -> dict[str, float]:
        return {**self._live_session_distances(), **self._motec_session_distances()}

    def _lifetime_totals(self) -> dict:
        with SessionLocal() as db:
            stats = db.get(UserLifetimeStatsModel, 1)
        if not stats:
            return {}
        return {
            "total_distance_km": stats.total_distance_km,
            "total_sessions": stats.total_sessions,
            "total_laps": stats.total_laps,
            "total_driving_time": stats.total_driving_time,
        }

    def summary(self, laps: list[dict] | None = None, best_laps: list[dict] | None = None) -> dict:
        laps = laps if laps is not None else self.all_laps()
        best_laps = best_laps if best_laps is not None else self._best_laps_from_laps(laps)
        sessions = self._sessions_from_laps(laps)
        persisted_sessions = self._persisted_session_counts()
        session_distances = self._career_session_distances()
        total_distance = sum(session_distances.values())
        total_driving_time = sum((_num(lap.get("lap_time")) or 0) for lap in laps)
        valid_laps = [lap for lap in laps if lap.get("valid_lap")]
        session_values = list(sessions.values())
        total_session_count = max(len(sessions), persisted_sessions["total"])
        lifetime = self._lifetime_totals()
        lifetime_total_sessions = max(total_session_count, int(lifetime.get("total_sessions") or 0))
        lifetime_distance = max(total_distance, float(lifetime.get("total_distance_km") or 0))
        lifetime_laps = max(len(laps), int(lifetime.get("total_laps") or 0))
        lifetime_time = max(total_driving_time, float(lifetime.get("total_driving_time") or 0))
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
                "total_distance_km": lifetime_distance,
                "total_sessions": lifetime_total_sessions,
                "total_laps": lifetime_laps,
                "valid_laps": len(valid_laps),
                "total_driving_time": lifetime_time,
                "different_cars": len({lap["car"] for lap in laps if lap.get("car")}),
                "different_tracks": len({lap["track"] for lap in laps if lap.get("track")}),
                "average_session_duration": lifetime_time / lifetime_total_sessions if lifetime_total_sessions else None,
                "average_distance_per_session": lifetime_distance / lifetime_total_sessions if lifetime_total_sessions else None,
                "average_laps_per_session": lifetime_laps / lifetime_total_sessions if lifetime_total_sessions else None,
                "wins": wins,
                "podiums": podiums,
                "top10": top10,
                "dnf_dns": dnf_dns,
                "race_sessions": len(race_sessions),
                "live_sessions": max(len({lap["session_id"] for lap in laps if lap["source"] == "live"}), persisted_sessions["live"]),
                "csv_sessions": max(len({lap["session_id"] for lap in laps if lap["source"] == "csv"}), persisted_sessions["csv"]),
                "best_lap_count": len(best_laps),
            },
            "distance_by_class": by_class,
            "top_cars": self._top_cars(laps),
            "top_tracks": self._top_tracks(laps),
            "filter_options": self.filter_options(laps),
        }

    def overview(self) -> dict:
        laps = self.all_laps()
        best_laps = self._best_laps_from_laps(laps)
        return {"summary": self.summary(laps, best_laps), "best_laps": best_laps}

    def filter_options(self, laps: list[dict] | None = None) -> dict:
        laps = laps if laps is not None else self.all_laps()
        return {
            "tracks": sorted({str(lap.get("track")) for lap in laps if lap.get("track")}),
            "cars": sorted({str(lap.get("car")) for lap in laps if lap.get("car")}),
            "classes": sorted({str(lap.get("car_class")) for lap in laps if lap.get("car_class")}),
            "sources": sorted({str(lap.get("source")) for lap in laps if lap.get("source")}),
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

    def _best_laps_from_laps(self, laps: list[dict]) -> list[dict]:
        best: dict[tuple, dict] = {}
        for lap in laps:
            lap_time = _num(lap.get("lap_time"))
            if lap_time is None or lap_time <= 0 or not lap.get("valid_lap"):
                continue
            key = (lap.get("track"), lap.get("layout"), lap.get("car"), lap.get("car_class"))
            if key not in best or lap_time < (best[key].get("lap_time") or math.inf):
                best[key] = lap
        return sorted(best.values(), key=lambda lap: (str(lap.get("track")), str(lap.get("car")), lap.get("lap_time") or math.inf))

    def best_laps(self) -> list[dict]:
        return self._best_laps_from_laps(self.all_laps())

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
            "filter_options": self.filter_options(laps),
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
        contains_checks = [
            (filters.session, lap.get("session_name")),
            (filters.layout, lap.get("layout")),
        ]
        for expected, actual in contains_checks:
            if expected and expected.lower() not in str(actual or "").lower():
                return False
        if filters.lap_number and filters.lap_number.lower() not in str(lap.get("lap_number") or "").lower():
            return False
        if filters.valid_only and not lap.get("valid_lap"):
            return False
        if filters.valid_status == "valid" and not lap.get("valid_lap"):
            return False
        if filters.valid_status == "invalid" and lap.get("valid_lap"):
            return False
        if filters.date_from and str(lap.get("date") or "") < filters.date_from:
            return False
        if filters.date_to and str(lap.get("date") or "") > filters.date_to:
            return False
        ranges = [
            ("track_temp", filters.track_temp_min, filters.track_temp_max),
            ("ambient_temp", filters.ambient_temp_min, filters.ambient_temp_max),
            ("fuel_start", filters.fuel_min, filters.fuel_max),
            ("fuel_used", filters.fuel_used_min, filters.fuel_used_max),
            ("lap_time", filters.lap_time_min, filters.lap_time_max),
        ]
        for key, min_value, max_value in ranges:
            value = _num(lap.get(key))
            if min_value is not None and (value is None or value < min_value):
                return False
            if max_value is not None and (value is None or value > max_value):
                return False
        wheel_ranges = [
            (("tyre_wear_fl", "tyre_wear_fr", "tyre_wear_rl", "tyre_wear_rr"), filters.tyre_wear_min, filters.tyre_wear_max),
            (("tyre_pressure_fl", "tyre_pressure_fr", "tyre_pressure_rl", "tyre_pressure_rr"), filters.tyre_pressure_min, filters.tyre_pressure_max),
            (("brake_temp_fl", "brake_temp_fr", "brake_temp_rl", "brake_temp_rr"), filters.brake_temp_min, filters.brake_temp_max),
            (("engine_oil_temp",), filters.oil_temp_min, filters.oil_temp_max),
            (("engine_water_temp",), filters.water_temp_min, filters.water_temp_max),
            (("max_speed", "average_speed"), filters.speed_min, filters.speed_max),
        ]
        for keys, min_value, max_value in wheel_ranges:
            if min_value is None and max_value is None:
                continue
            values = [_num(lap.get(key)) for key in keys]
            clean = [value for value in values if value is not None]
            if not clean:
                return False
            if min_value is not None and max(clean) < min_value:
                return False
            if max_value is not None and min(clean) > max_value:
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
