from __future__ import annotations

import hashlib
import json
import math
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select

from app.db.database import SessionLocal
from app.db.models import LapSummaryModel, LapValidationModel, LmuDuckdbLapModel, LmuDuckdbSessionModel, PersonalBestLapModel, SessionAggregateModel, SessionModel, TelemetrySampleModel
from app.db.repository import Repository


def _num(value: Any) -> float | None:
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    if isinstance(value, str):
        try:
            parsed = float(value.strip())
        except ValueError:
            return None
        return parsed if math.isfinite(parsed) else None
    return None


def _avg(values: list[float | None]) -> float | None:
    clean = [value for value in values if value is not None and math.isfinite(value)]
    return sum(clean) / len(clean) if clean else None


def _max(values: list[float | None]) -> float | None:
    clean = [value for value in values if value is not None and math.isfinite(value)]
    return max(clean) if clean else None


def _cached_tyre_wear_used_fraction(value: Any) -> float | None:
    number = _num(value)
    if number is None:
        return None
    if 0 <= number <= 1:
        return number  # current cache format: fraction already used
    if 1 < number <= 100:
        return 1.0 - (number / 100.0)  # legacy cache format: percent remaining
    return None


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
        previous_speed = _num(previous.get(speed_key))
        current_speed = _num(current.get(speed_key))
        if previous_time is None or current_time is None or previous_speed is None:
            continue
        delta = current_time - previous_time
        if delta <= 0 or delta > 5:
            continue
        speed = (previous_speed + current_speed) / 2 if current_speed is not None else previous_speed
        distance += speed * delta / 3600
        usable += 1
    return distance if usable else None


def _is_completed_driving_lap(lap: dict) -> bool:
    """Broad career-duration eligibility, separate from stricter ranking validity."""
    lap_number = _num(lap.get("lap_number"))
    lap_time = _num(lap.get("lap_time"))
    distance = _num(lap.get("distance_km"))
    return bool(
        lap_number is not None
        and lap_number >= 1
        and lap_time is not None
        and 40.0 <= lap_time <= 900.0
        and (distance is None or distance >= 0.5)
    )


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
    # Keep historical PB selection aligned with the shared live/session guard.
    # A reset or cut is often reported as a 10%+ improvement when LMU misses
    # the transient invalidation flag.
    min_lap_time_ratio = 0.90
    max_lap_time_ratio = 1.20
    min_distance_ratio = 0.75
    _all_laps_cache_key: tuple[int | None, int, str | None] | None = None
    _all_laps_cache: list[dict] | None = None
    _overview_cache_key: tuple[int | None, int, str | None] | None = None
    _overview_cache: dict | None = None

    @staticmethod
    def _identity(value: Any) -> str:
        return " ".join(str(value or "").strip().lower().split())

    def _context(self, lap: dict) -> tuple[str, str, str, str] | None:
        values = tuple(self._identity(lap.get(key)) for key in ("session_type", "track", "layout", "car"))
        if not all(values) or any(value.startswith("unknown") for value in values):
            return None
        return values

    @staticmethod
    def _source_key(lap: dict) -> str:
        return f"{lap.get('source')}:{lap.get('session_id')}:{lap.get('lap_number')}"

    @staticmethod
    def _record_key(context: tuple[str, str, str, str]) -> str:
        return hashlib.sha256("\x1f".join(context).encode("utf-8")).hexdigest()

    def _all_laps_cache_token(self) -> tuple[int | None, int, str | None]:
        with SessionLocal() as db:
            latest_lap_id = db.scalar(select(func.max(LmuDuckdbLapModel.id)))
            active_session_count = db.scalar(select(func.count(LmuDuckdbSessionModel.id)).where(LmuDuckdbSessionModel.active.is_(True))) or 0
            latest_sync = db.scalar(select(func.max(LmuDuckdbSessionModel.synced_at)))
        return latest_lap_id, int(active_session_count), latest_sync

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

    def _duckdb_laps(self) -> list[dict]:
        with SessionLocal() as db:
            rows = db.execute(
                select(LmuDuckdbLapModel, LmuDuckdbSessionModel)
                .join(LmuDuckdbSessionModel, LmuDuckdbSessionModel.id == LmuDuckdbLapModel.session_id)
                .where(LmuDuckdbSessionModel.active.is_(True))
                .order_by(LmuDuckdbLapModel.date.asc(), LmuDuckdbLapModel.id.asc())
            ).all()
        laps: list[dict] = []
        for lap, session in rows:
            laps.append(
                {
                    "id": f"duckdb:{lap.session_id}:{lap.lap_number}",
                    "source": "duckdb",
                    "session_id": lap.session_id,
                    "session_name": lap.session_type or session.session_type or "LMU session",
                    "source_file": lap.source_file or session.file_name,
                    "date": lap.date or session.created_at,
                    "track": lap.track or "Unknown track",
                    "layout": lap.layout or "",
                    "car": lap.car or "Unknown car",
                    "car_class": lap.car_class or "Unknown class",
                    "session_type": lap.session_type or session.session_type,
                    "lap_number": lap.lap_number,
                    "lap_time": lap.lap_time,
                    "valid_lap": lap.valid_lap,
                    "in_pit": lap.in_pit,
                    "distance_km": lap.distance_km,
                    "fuel_start": lap.fuel_start,
                    "fuel_end": lap.fuel_end,
                    "fuel_used": lap.fuel_used,
                    "fuel_added": lap.fuel_added,
                    "tyre_compound": None,
                    "tyre_wear_fl": _cached_tyre_wear_used_fraction(lap.tyre_wear_fl),
                    "tyre_wear_fr": _cached_tyre_wear_used_fraction(lap.tyre_wear_fr),
                    "tyre_wear_rl": _cached_tyre_wear_used_fraction(lap.tyre_wear_rl),
                    "tyre_wear_rr": _cached_tyre_wear_used_fraction(lap.tyre_wear_rr),
                    "tyre_pressure_fl": lap.tyre_pressure_fl,
                    "tyre_pressure_fr": lap.tyre_pressure_fr,
                    "tyre_pressure_rl": lap.tyre_pressure_rl,
                    "tyre_pressure_rr": lap.tyre_pressure_rr,
                    "brake_temp_fl": lap.brake_temp_fl,
                    "brake_temp_fr": lap.brake_temp_fr,
                    "brake_temp_rl": lap.brake_temp_rl,
                    "brake_temp_rr": lap.brake_temp_rr,
                    "track_temp": lap.track_temp,
                    "ambient_temp": lap.ambient_temp,
                    "engine_oil_temp": lap.engine_oil_temp,
                    "engine_water_temp": lap.engine_water_temp,
                    "max_speed": lap.max_speed,
                    "average_speed": lap.average_speed,
                    "finish_position": lap.finish_position,
                    "finish_status": lap.finish_status,
                }
            )
        return laps

    def all_laps(self) -> list[dict]:
        token = self._all_laps_cache_token()
        if self.__class__._all_laps_cache_key == token and self.__class__._all_laps_cache is not None:
            return self.__class__._all_laps_cache
        laps = self._with_lap_quality(self._duckdb_laps())
        self.__class__._all_laps_cache_key = token
        self.__class__._all_laps_cache = laps
        return laps

    def best_lap_candidates(self) -> list[dict]:
        """All historical sources share one validation path for PB selection."""
        return self._with_lap_quality(self._live_laps() + self._duckdb_laps())

    def _with_lap_quality(self, laps: list[dict]) -> list[dict]:
        grouped: dict[tuple[str, str, str, str], list[dict]] = defaultdict(list)
        for lap in laps:
            context = self._context(lap)
            if context:
                grouped[context].append(lap)
            elif not any(key in lap for key in ("session_type", "track", "layout", "car")):
                # Small synthetic/legacy fixtures can still exercise telemetry rules;
                # these rows remain ineligible for PB grouping via _context().
                grouped[(str(lap.get("source")), str(lap.get("session_id")), "", "")].append(lap)
            else:
                lap.update(valid_lap=False, lap_quality="unresolved_session_track_layout_or_car", validation_status="insufficient_data")
        seen_source_laps: set[str] = set()
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
                lap_number = _num(lap.get("lap_number"))
                average_speed = _num(lap.get("average_speed"))
                source_key = self._source_key(lap)
                if source_key in seen_source_laps:
                    valid = False
                    reason = "duplicate_lap"
                elif lap.get("complete") is False:
                    valid = False
                    reason = "incomplete_lap"
                elif lap.get("out_lap"):
                    valid = False
                    reason = "out_lap"
                elif lap.get("in_lap"):
                    valid = False
                    reason = "in_lap"
                elif lap.get("valid_lap") is False:
                    valid = False
                    reason = "recorded_invalid_lap"
                elif lap.get("in_pit"):
                    valid = False
                    reason = "pit_lap"
                elif lap_number is None or lap_number < 1:
                    valid = False
                    reason = "missing_or_out_lap_number"
                elif distance is None or distance < 0.5:
                    valid = False
                    reason = "missing_or_incomplete_distance"
                elif "average_speed" in lap and (average_speed is None or average_speed < 20):
                    valid = False
                    reason = "missing_zero_or_implausibly_low_average_speed"
                elif average_speed is not None and average_speed > 450:
                    valid = False
                    reason = "implausibly_high_average_speed"
                elif lap_time and average_speed and abs((distance / (lap_time / 3600)) - average_speed) / average_speed > 0.35:
                    valid = False
                    reason = "distance_time_speed_disagree"
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
                lap["validation_status"] = "valid" if valid else ("suspicious" if reason == "distance_time_speed_disagree" else "invalid")
                lap["validation_reason_code"] = reason
                lap["historical_valid_laps_compared"] = max(0, len(session_laps) - 1)
                seen_source_laps.add(source_key)
        reason_text = {
            "estimated_full_lap": "Passed timing, identity, completion, distance, speed, and context plausibility checks.",
            "unresolved_session_track_layout_or_car": "Excluded because session type, circuit, layout, or exact car identity could not be resolved.",
            "recorded_invalid_lap": "Excluded because source telemetry marked this lap invalid.",
            "duplicate_lap": "Excluded as a duplicate source lap.",
            "incomplete_lap": "Excluded because the lap did not complete.",
            "out_lap": "Excluded because this is an out lap.",
            "in_lap": "Excluded because this is an in lap.",
            "pit_lap": "Excluded because pit-lane activity identifies this as a pit or in lap.",
            "missing_or_out_lap_number": "Excluded because this is an out lap or its lap number is unresolved.",
            "missing_or_incomplete_distance": "Excluded because meaningful full-lap distance was not recorded.",
            "missing_zero_or_implausibly_low_average_speed": "Excluded because average speed is missing, zero, or implausibly low.",
            "implausibly_high_average_speed": "Excluded because average speed exceeds plausible racing bounds.",
            "distance_time_speed_disagree": "Needs review because distance, lap time, and average speed materially disagree.",
            "insufficient_lap_time": "Excluded because lap timing is missing or cannot be validated.",
            "partial_or_out_lap": "Excluded because timing is implausibly fast against comparable historical laps.",
            "very_slow_or_incident_lap": "Excluded because timing is implausibly slow against comparable historical laps.",
            "short_distance_lap": "Excluded because distance is substantially shorter than comparable laps for this layout.",
        }
        for lap in laps:
            lap.setdefault("validation_reason_code", lap.get("lap_quality"))
            lap["validation_reason"] = reason_text.get(str(lap.get("lap_quality")), "Excluded by telemetry quality validation.")
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
            if _is_completed_driving_lap(lap):
                session["duration"] += _num(lap.get("lap_time")) or 0
        return sessions

    def _persisted_session_counts(self) -> dict[str, int]:
        with SessionLocal() as db:
            duckdb_sessions = db.scalar(select(func.count(LmuDuckdbSessionModel.id)).where(LmuDuckdbSessionModel.active.is_(True))) or 0
        return {"live": 0, "duckdb": int(duckdb_sessions), "total": int(duckdb_sessions)}

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

    def _career_session_distances(self) -> dict[str, float]:
        with SessionLocal() as db:
            rows = db.execute(
                select(LmuDuckdbLapModel.session_id, func.sum(func.coalesce(LmuDuckdbLapModel.distance_km, 0.0)))
                .join(LmuDuckdbSessionModel, LmuDuckdbSessionModel.id == LmuDuckdbLapModel.session_id)
                .where(LmuDuckdbSessionModel.active.is_(True))
                .group_by(LmuDuckdbLapModel.session_id)
            ).all()
        return {f"duckdb:{session_id}": float(distance or 0.0) for session_id, distance in rows}

    def _lifetime_totals(self) -> dict:
        return {}

    def summary(self, laps: list[dict] | None = None, best_laps: list[dict] | None = None) -> dict:
        laps = laps if laps is not None else self.all_laps()
        best_laps = best_laps if best_laps is not None else self._best_laps_from_laps(laps)
        sessions = self._sessions_from_laps(laps)
        persisted_sessions = self._persisted_session_counts()
        session_distances = self._career_session_distances()
        total_distance = sum(session_distances.values())
        completed_driving_laps = [lap for lap in laps if _is_completed_driving_lap(lap)]
        total_driving_time = sum((_num(lap.get("lap_time")) or 0) for lap in completed_driving_laps)
        valid_laps = [lap for lap in laps if lap.get("valid_lap")]
        session_values = list(sessions.values())
        total_session_count = max(len(sessions), persisted_sessions["total"])
        lifetime = self._lifetime_totals()
        lifetime_total_sessions = max(total_session_count, int(lifetime.get("total_sessions") or 0))
        lifetime_distance = max(total_distance, float(lifetime.get("total_distance_km") or 0))
        lifetime_laps = max(len(laps), int(lifetime.get("total_laps") or 0))
        lifetime_time = max(total_driving_time, float(lifetime.get("total_driving_time") or 0))
        race_sessions = [session for session in session_values if self._is_race_session(session)]
        positioned_races = [session for session in race_sessions if _num(session.get("finish_position")) is not None]
        status_races = [session for session in race_sessions if str(session.get("finish_status") or "").strip()]
        wins = sum(1 for session in positioned_races if session.get("finish_position") == 1) if positioned_races else None
        podiums = sum(1 for session in positioned_races if float(session["finish_position"]) <= 3) if positioned_races else None
        top10 = sum(1 for session in positioned_races if float(session["finish_position"]) <= 10) if positioned_races else None
        dnf_dns = sum(1 for session in status_races if str(session.get("finish_status") or "").lower() in {"dnf", "dns", "dq"}) if status_races else None
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
                "completed_laps": len(completed_driving_laps),
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
                "positioned_race_sessions": len(positioned_races),
                "status_race_sessions": len(status_races),
                "live_sessions": max(len({lap["session_id"] for lap in laps if lap["source"] == "live"}), persisted_sessions["live"]),
                "duckdb_sessions": max(len({lap["session_id"] for lap in laps if lap["source"] == "duckdb"}), persisted_sessions["duckdb"]),
                "best_lap_count": len(best_laps),
            },
            "distance_by_class": by_class,
            "top_cars": self._top_cars(laps),
            "top_tracks": self._top_tracks(laps),
            "filter_options": self.filter_options(laps),
        }

    def overview(self) -> dict:
        token = self._all_laps_cache_token()
        if self.__class__._overview_cache_key == token and self.__class__._overview_cache is not None:
            return self.__class__._overview_cache
        candidates = self.best_lap_candidates()
        duckdb_laps = [lap for lap in candidates if lap.get("source") == "duckdb"]
        result = self.revalidate(candidates)
        overview = {"summary": self.summary(duckdb_laps, result["best_laps"]), **result}
        self.__class__._overview_cache_key = token
        self.__class__._overview_cache = overview
        return overview

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
            key = self._context(lap)
            if key is None:
                continue
            if key not in best or lap_time < (best[key].get("lap_time") or math.inf):
                best[key] = lap
        rows = list(best.values())
        for row in rows:
            context = self._context(row)
            peers = sorted((lap for lap in laps if self._context(lap) == context and lap.get("valid_lap")), key=lambda lap: _num(lap.get("lap_time")) or math.inf)
            row["record_key"] = self._record_key(context) if context else None
            row["source_lap_key"] = self._source_key(row)
            row["previous_best_lap"] = _num(peers[1].get("lap_time")) if len(peers) > 1 else None
            row["improvement_seconds"] = row["previous_best_lap"] - row["lap_time"] if row.get("previous_best_lap") else None
        return sorted(rows, key=lambda lap: str(lap.get("date") or ""), reverse=True)

    def best_laps(self) -> list[dict]:
        return self._best_laps_from_laps(self.best_lap_candidates())

    def excluded_best_lap_candidates(self) -> list[dict]:
        return [lap for lap in self.best_lap_candidates() if lap.get("validation_status") != "valid"]

    def revalidate(self, laps: list[dict] | None = None) -> dict:
        """Rebuild audit/current-best tables without altering source telemetry."""
        from app.core.utils import utc_now

        explicit = laps is None
        laps = laps if laps is not None else self.best_lap_candidates()
        best_laps = self._best_laps_from_laps(laps)
        now = utc_now().isoformat()
        with SessionLocal() as db:
            previous = {row.record_key: row for row in db.scalars(select(PersonalBestLapModel)).all()}
            db.query(LapValidationModel).delete()
            db.query(PersonalBestLapModel).delete()
            for lap in laps:
                context = self._context(lap)
                audit = {key: lap.get(key) for key in ("lap_time", "distance_km", "average_speed", "expected_lap_time", "expected_distance_km", "historical_valid_laps_compared")}
                db.add(LapValidationModel(
                    source_lap_key=self._source_key(lap), source_type=str(lap.get("source")), source_session_id=str(lap.get("session_id")),
                    source_lap_number=str(lap.get("lap_number")), context_key=self._record_key(context) if context else None,
                    status=str(lap.get("validation_status")), reason_code=str(lap.get("validation_reason_code")),
                    reason=str(lap.get("validation_reason")), audit_json=json.dumps(audit), validated_at=now,
                ))
            for lap in best_laps:
                record_key = str(lap["record_key"])
                history: list[dict] = []
                old = previous.get(record_key)
                if old:
                    history = json.loads(old.history_json or "[]")
                    if old.source_lap_key != lap["source_lap_key"]:
                        history.append(json.loads(old.record_json))
                db.add(PersonalBestLapModel(
                    record_key=record_key, session_type=str(lap.get("session_type")), track=str(lap.get("track")), layout=str(lap.get("layout")),
                    car=str(lap.get("car")), car_class=lap.get("car_class"), lap_time=float(lap["lap_time"]), source_lap_key=str(lap["source_lap_key"]),
                    source_type=str(lap.get("source")), source_session_id=str(lap.get("session_id")), source_lap_number=str(lap.get("lap_number")),
                    set_at=lap.get("date"), validation_status="valid", record_json=json.dumps(lap, default=str), history_json=json.dumps(history), revalidated_at=now,
                ))
            db.commit()
        counts = Counter(str(lap.get("validation_status")) for lap in laps)
        result = {"best_laps": best_laps, "data_quality": {"valid_candidates": counts["valid"], "excluded_laps": counts["invalid"] + counts["insufficient_data"], "suspicious_laps": counts["suspicious"], "personal_bests": len(best_laps), "revalidated_at": now}}
        if explicit:
            self.__class__._overview_cache_key = None
            self.__class__._overview_cache = None
        return result

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
            (filters.session, lap.get("session_type") or lap.get("session_name")),
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
