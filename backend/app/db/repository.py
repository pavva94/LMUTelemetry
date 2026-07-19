from __future__ import annotations

import json
import math
from datetime import datetime
from statistics import median, pstdev

from sqlalchemy import delete, desc, func, select

from app.db.database import SessionLocal
from app.analysis.lap_quality import apply_lap_quality
from app.db.models import LapSummaryModel, RecommendationModel, SessionAggregateModel, SessionModel, TelemetrySampleModel, UserLifetimeStatsModel
from app.schemas.recommendations import RecommendationPayload, StrategyRecommendation
from app.schemas.strategy import FuelState, PitWindowState, StrategyAssumptions, StrategyState, StintState, TyreStrategyState
from app.schemas.telemetry import CompetitorState, EnvironmentState, PlayerState, SessionState, TelemetrySnapshot, TyreState


MIN_SAVED_SESSION_LAPS = 2
MIN_SAVED_VALID_LAPS = 1


class Repository:
    def __init__(self) -> None:
        self._review_cache: dict[tuple[str, int, int | None, int | None], dict] = {}

    def _session_type_name(self, value: object) -> str | None:
        names = {
            "0": "Test Day",
            "1": "Practice",
            "2": "Practice 2",
            "3": "Practice 3",
            "4": "Practice 4",
            "5": "Qualifying",
            "6": "Qualifying 2",
            "7": "Qualifying 3",
            "8": "Qualifying 4",
            "9": "Warmup",
            "10": "Race",
            "11": "Race 2",
            "12": "Race 3",
            "13": "Race 4",
        }
        if value is None:
            return None
        return names.get(str(value), str(value))

    def _row_dict(self, row) -> dict:
        data = {column.name: getattr(row, column.name) for column in row.__table__.columns}
        if "session_type" in data:
            data["session_type"] = self._session_type_name(data["session_type"])
        return data

    def _rows_json(self, rows: list[dict]) -> str:
        return json.dumps(rows, default=str)

    def _json_rows(self, payload: str | None) -> list[dict]:
        if not payload:
            return []
        try:
            value = json.loads(payload)
            return value if isinstance(value, list) else []
        except json.JSONDecodeError:
            return []

    def _sample_trace_rows(self, samples: list[TelemetrySampleModel], limit: int = 2000) -> list[dict]:
        if len(samples) <= limit:
            selected = samples
        else:
            step = math.ceil(len(samples) / limit)
            selected = samples[::step]
        return [self._row_dict(sample) for sample in selected]

    def _average_fields(self, samples: list[TelemetrySampleModel], fields: list[str]) -> float | None:
        values = []
        for sample in samples:
            wheel_values = [getattr(sample, field) for field in fields]
            finite = [value for value in wheel_values if value is not None and math.isfinite(value)]
            if finite:
                values.append(sum(finite) / len(finite))
        return sum(values) / len(values) if values else None

    def _integrated_distance(self, samples: list[TelemetrySampleModel]) -> float | None:
        distance = 0.0
        usable = 0
        for previous, current in zip(samples, samples[1:]):
            if previous.game_time is None or current.game_time is None or previous.speed_kph is None:
                continue
            delta = current.game_time - previous.game_time
            if delta <= 0 or delta > 5:
                continue
            current_speed = current.speed_kph if current.speed_kph is not None else previous.speed_kph
            distance += ((previous.speed_kph + current_speed) / 2) * delta / 3600
            usable += 1
        return distance if usable else None

    def ensure_session(self, session_id: str, snapshot: TelemetrySnapshot | None) -> None:
        with SessionLocal() as db:
            exists = db.get(SessionModel, session_id)
            if exists:
                return
            player = snapshot.player if snapshot else None
            state = snapshot.session if snapshot else None
            db.add(
                SessionModel(
                    id=session_id,
                    created_at=datetime.utcnow().isoformat(),
                    track_name=state.track_name if state else None,
                    track_layout=None,
                    session_type=state.session_type if state else None,
                    vehicle_name=player.vehicle_name if player else None,
                    vehicle_model=player.vehicle_model if player else None,
                    vehicle_class=player.vehicle_class if player else None,
                    started_at_game_time=state.current_time if state else None,
                    ended_at_game_time=None,
                    final_position=None,
                    final_class_position=None,
                    classified_status=None,
                    total_cars=state.num_vehicles if state else None,
                )
            )
            db.commit()

    def log_sample(self, session_id: str, snapshot: TelemetrySnapshot) -> None:
        player = snapshot.player
        tyre = player.tyre_state if player else None
        env = snapshot.environment
        state = snapshot.session
        player_id = player.vehicle_id if player else None
        player_comp = next((c for c in snapshot.competitors if c.is_player or c.vehicle_id == player_id), None)
        with SessionLocal() as db:
            db.add(
                TelemetrySampleModel(
                    session_id=session_id,
                    timestamp=snapshot.timestamp.isoformat(),
                    game_time=state.current_time if state else None,
                    lap_number=player.lap_number if player else None,
                    position=player.position if player else None,
                    class_position=player.class_position if player else None,
                    current_lap_time=player.current_lap_time if player else None,
                    last_lap_time=player.last_lap_time if player else None,
                    best_lap_time=player.best_lap_time if player else None,
                    speed_kph=player.speed_kph if player else None,
                    gear=player.gear if player else None,
                    rpm=player.rpm if player else None,
                    fuel_liters=player.fuel_liters if player else None,
                    fuel_capacity_liters=player.fuel_capacity_liters if player else None,
                    engine_oil_temp=player.engine_oil_temp if player else None,
                    engine_water_temp=player.engine_water_temp if player else None,
                    surface_type_fl=player.surface_type_fl if player else None,
                    surface_type_fr=player.surface_type_fr if player else None,
                    surface_type_rl=player.surface_type_rl if player else None,
                    surface_type_rr=player.surface_type_rr if player else None,
                    throttle=player.throttle if player else None,
                    brake=player.brake if player else None,
                    steering=player.steering if player else None,
                    abs_active=player.abs_active if player else None,
                    tc_active=player.tc_active if player else None,
                    abs_setting=player.abs_setting if player else None,
                    abs_max=player.abs_max if player else None,
                    tc_setting=player.tc_setting if player else None,
                    tc_max=player.tc_max if player else None,
                    tc_slip_setting=player.tc_slip_setting if player else None,
                    tc_cut_setting=player.tc_cut_setting if player else None,
                    brake_temp_fl=player.brake_temp_fl if player else None,
                    brake_temp_fr=player.brake_temp_fr if player else None,
                    brake_temp_rl=player.brake_temp_rl if player else None,
                    brake_temp_rr=player.brake_temp_rr if player else None,
                    brake_pressure_fl=player.brake_pressure_fl if player else None,
                    brake_pressure_fr=player.brake_pressure_fr if player else None,
                    brake_pressure_rl=player.brake_pressure_rl if player else None,
                    brake_pressure_rr=player.brake_pressure_rr if player else None,
                    ride_height_fl=player.ride_height_fl if player else None,
                    ride_height_fr=player.ride_height_fr if player else None,
                    ride_height_rl=player.ride_height_rl if player else None,
                    ride_height_rr=player.ride_height_rr if player else None,
                    front_ride_height=player.front_ride_height if player else None,
                    rear_ride_height=player.rear_ride_height if player else None,
                    suspension_deflection_fl=player.suspension_deflection_fl if player else None,
                    suspension_deflection_fr=player.suspension_deflection_fr if player else None,
                    suspension_deflection_rl=player.suspension_deflection_rl if player else None,
                    suspension_deflection_rr=player.suspension_deflection_rr if player else None,
                    tyre_wear_fl=tyre.wear_fl if tyre else None,
                    tyre_wear_fr=tyre.wear_fr if tyre else None,
                    tyre_wear_rl=tyre.wear_rl if tyre else None,
                    tyre_wear_rr=tyre.wear_rr if tyre else None,
                    tyre_load_fl=tyre.load_fl if tyre else None,
                    tyre_load_fr=tyre.load_fr if tyre else None,
                    tyre_load_rl=tyre.load_rl if tyre else None,
                    tyre_load_rr=tyre.load_rr if tyre else None,
                    tyre_pressure_fl=tyre.pressure_fl if tyre else None,
                    tyre_pressure_fr=tyre.pressure_fr if tyre else None,
                    tyre_pressure_rl=tyre.pressure_rl if tyre else None,
                    tyre_pressure_rr=tyre.pressure_rr if tyre else None,
                    tyre_temp_fl=tyre.temp_fl.center_c if tyre and tyre.temp_fl else None,
                    tyre_temp_fr=tyre.temp_fr.center_c if tyre and tyre.temp_fr else None,
                    tyre_temp_rl=tyre.temp_rl.center_c if tyre and tyre.temp_rl else None,
                    tyre_temp_rr=tyre.temp_rr.center_c if tyre and tyre.temp_rr else None,
                    track_temp=env.track_temp_c if env else None,
                    ambient_temp=env.ambient_temp_c if env else None,
                    rain=env.raining if env else None,
                    wetness=env.avg_wetness if env else None,
                    pitstops=player_comp.pitstops if player_comp else None,
                    in_pits=player_comp.in_pits if player_comp else None,
                    pit_state=player_comp.pit_state if player_comp else None,
                )
            )
            db.commit()

    def log_recommendation(self, session_id: str, snapshot: TelemetrySnapshot, recommendation: StrategyRecommendation) -> None:
        with SessionLocal() as db:
            db.add(
                RecommendationModel(
                    session_id=session_id,
                    timestamp=snapshot.timestamp.isoformat(),
                    lap_number=snapshot.player.lap_number if snapshot.player else None,
                    recommendation_type=recommendation.type.value,
                    priority=recommendation.priority,
                    message=recommendation.message,
                    reason_codes=json.dumps(recommendation.reason_codes),
                    assumptions_json=json.dumps(recommendation.assumptions_used),
                    accepted=None,
                )
            )
            db.commit()

    def list_sessions(self) -> list[dict]:
        with SessionLocal() as db:
            sessions = db.scalars(
                select(SessionModel)
                .where(SessionModel.is_saved.is_(True))
                .order_by(desc(SessionModel.created_at))
                .limit(50)
            ).all()
            session_ids = [session.id for session in sessions]
            sample_stats = {}
            latest_ids = []
            latest_samples = {}
            if session_ids:
                aggregate_rows = db.scalars(
                    select(SessionAggregateModel).where(SessionAggregateModel.session_id.in_(session_ids))
                ).all()
                for aggregate in aggregate_rows:
                    sample_stats[aggregate.session_id] = {
                        "sample_count": aggregate.sample_count,
                        "latest_lap_number": aggregate.latest_lap_number,
                        "latest_game_time": aggregate.duration_seconds,
                    }
                stats_rows = db.execute(
                    select(
                        TelemetrySampleModel.session_id,
                        func.count(TelemetrySampleModel.id),
                        func.max(TelemetrySampleModel.id),
                        func.max(TelemetrySampleModel.game_time),
                    )
                    .where(TelemetrySampleModel.session_id.in_(session_ids))
                    .group_by(TelemetrySampleModel.session_id)
                ).all()
                for session_id, count, latest_id, latest_game_time in stats_rows:
                    sample_stats[session_id] = {
                        "sample_count": count or 0,
                        "latest_id": latest_id,
                        "latest_game_time": latest_game_time,
                    }
                    if latest_id is not None:
                        latest_ids.append(latest_id)
                if latest_ids:
                    latest_samples = {
                        sample.id: sample
                        for sample in db.scalars(select(TelemetrySampleModel).where(TelemetrySampleModel.id.in_(latest_ids))).all()
                    }
            rows = []
            for session in sessions:
                stats = sample_stats.get(session.id, {})
                latest_sample = latest_samples.get(stats.get("latest_id"))
                row = self._row_dict(session)
                row["sample_count"] = stats.get("sample_count", 0)
                row["latest_lap_number"] = latest_sample.lap_number if latest_sample else stats.get("latest_lap_number")
                row["latest_game_time"] = latest_sample.game_time if latest_sample else stats.get("latest_game_time")
                rows.append(row)
            return rows

    def find_resume_session(self, snapshot: TelemetrySnapshot) -> dict | None:
        session_state = snapshot.session
        player = snapshot.player
        if not session_state or not player:
            return None
        with SessionLocal() as db:
            sessions = db.scalars(
                select(SessionModel)
                .where(SessionModel.ended_at_game_time.is_(None))
                .order_by(desc(SessionModel.created_at))
                .limit(20)
            ).all()
            for session in sessions:
                if (
                    session.track_name == session_state.track_name
                    and session.session_type == session_state.session_type
                    and (session.vehicle_model or session.vehicle_name) == (player.vehicle_model or player.vehicle_name)
                ):
                    return self._row_dict(session)
        return None

    def finalize_session(self, session_id: str, snapshot: TelemetrySnapshot | None = None) -> dict | None:
        with SessionLocal() as db:
            session = db.get(SessionModel, session_id)
            if not session:
                return None
            state = snapshot.session if snapshot else None
            player = snapshot.player if snapshot else None
            latest_sample = db.scalar(
                select(TelemetrySampleModel)
                .where(TelemetrySampleModel.session_id == session_id)
                .order_by(desc(TelemetrySampleModel.id))
                .limit(1)
            )
            session.ended_at_game_time = state.current_time if state else (latest_sample.game_time if latest_sample else session.ended_at_game_time)
            if player:
                session.vehicle_class = session.vehicle_class or player.vehicle_class
                session.vehicle_model = session.vehicle_model or player.vehicle_model
                session.final_position = player.position
                session.final_class_position = player.class_position
                session.classified_status = player.finish_status or session.classified_status or "unknown"
            elif latest_sample:
                session.final_position = latest_sample.position
                session.final_class_position = latest_sample.class_position
                session.classified_status = session.classified_status or "unknown"
            if state:
                session.total_cars = state.num_vehicles or session.total_cars
            samples = db.scalars(
                select(TelemetrySampleModel)
                .where(TelemetrySampleModel.session_id == session_id)
                .order_by(TelemetrySampleModel.id.asc())
            ).all()
            laps = self._build_laps(samples)
            pit_events = self._build_pit_events(samples)
            recommendations = db.scalars(
                select(RecommendationModel)
                .where(RecommendationModel.session_id == session_id)
                .order_by(RecommendationModel.id.asc())
                .limit(100)
            ).all()
            if not self._should_save_completed_session(laps):
                self._discard_session(db, session_id)
                self._review_cache = {}
                db.commit()
                return None
            self._store_lap_summaries(db, session_id, laps)
            had_aggregate = db.get(SessionAggregateModel, session_id) is not None
            aggregate = self._store_session_aggregate(db, session_id, session, samples, laps, pit_events, recommendations)
            if not had_aggregate:
                self._add_lifetime_stats(db, aggregate)
            db.execute(delete(TelemetrySampleModel).where(TelemetrySampleModel.session_id == session_id))
            db.execute(delete(RecommendationModel).where(RecommendationModel.session_id == session_id))
            db.commit()
            db.refresh(session)
            return self._row_dict(session)

    def _should_save_completed_session(self, laps: list[dict]) -> bool:
        valid_laps = self._valid_laps(laps)
        return len(laps) >= MIN_SAVED_SESSION_LAPS and len(valid_laps) >= MIN_SAVED_VALID_LAPS

    def _discard_session(self, db, session_id: str) -> None:
        db.execute(delete(TelemetrySampleModel).where(TelemetrySampleModel.session_id == session_id))
        db.execute(delete(RecommendationModel).where(RecommendationModel.session_id == session_id))
        db.execute(delete(LapSummaryModel).where(LapSummaryModel.session_id == session_id))
        db.execute(delete(SessionAggregateModel).where(SessionAggregateModel.session_id == session_id))
        db.execute(delete(SessionModel).where(SessionModel.id == session_id))

    def _store_session_aggregate(
        self,
        db,
        session_id: str,
        session: SessionModel,
        samples: list[TelemetrySampleModel],
        laps: list[dict],
        pit_events: list[dict],
        recommendations: list[RecommendationModel],
    ) -> SessionAggregateModel:
        latest = samples[-1] if samples else None
        lap_times = [float(lap["lap_time"]) for lap in self._valid_laps(laps)]
        distance = self._integrated_distance(samples)
        # Endpoint subtraction across a pit/refuel lap can look like enormous
        # consumption (the real store contained 50-87 L examples). Keep this
        # aggregate explicitly scoped to complete, clean laps; refuel/pit fuel
        # requires sample-level integration and must not contaminate this KPI.
        fuel_values = [
            float(lap["fuel_used"]) for lap in self._valid_laps(laps)
            if lap.get("fuel_used") is not None and math.isfinite(float(lap["fuel_used"])) and float(lap["fuel_used"]) >= 0
        ]
        speed_values = [sample.speed_kph for sample in samples if sample.speed_kph is not None]
        duration = None
        if session.ended_at_game_time is not None and session.started_at_game_time is not None:
            duration = max(0, session.ended_at_game_time - session.started_at_game_time)
        elif samples:
            start = samples[0].game_time
            end = samples[-1].game_time
            duration = end - start if start is not None and end is not None and end >= start else None
        aggregate = db.get(SessionAggregateModel, session_id) or SessionAggregateModel(session_id=session_id)
        db.add(aggregate)
        aggregate.completed_at = datetime.utcnow().isoformat()
        aggregate.duration_seconds = duration
        aggregate.lap_count = len(laps)
        aggregate.total_distance_km = distance
        aggregate.best_lap = min(lap_times) if lap_times else None
        aggregate.average_lap = sum(lap_times) / len(lap_times) if lap_times else None
        aggregate.total_fuel_used = sum(fuel_values) if fuel_values else None
        aggregate.average_tyre_wear = self._average_fields(samples, ["tyre_wear_fl", "tyre_wear_fr", "tyre_wear_rl", "tyre_wear_rr"])
        aggregate.average_tyre_temp = self._average_fields(samples, ["tyre_temp_fl", "tyre_temp_fr", "tyre_temp_rl", "tyre_temp_rr"])
        aggregate.average_tyre_pressure = self._average_fields(samples, ["tyre_pressure_fl", "tyre_pressure_fr", "tyre_pressure_rl", "tyre_pressure_rr"])
        aggregate.average_brake_temp = self._average_fields(samples, ["brake_temp_fl", "brake_temp_fr", "brake_temp_rl", "brake_temp_rr"])
        aggregate.top_speed = max(speed_values) if speed_values else None
        aggregate.latest_lap_number = latest.lap_number if latest else None
        aggregate.sample_count = len(samples)
        aggregate.latest_sample_json = self._rows_json(self._row_dict(latest)) if latest else None
        aggregate.sample_trace_json = self._rows_json(self._sample_trace_rows(samples))
        aggregate.laps_json = self._rows_json(laps)
        aggregate.pit_events_json = self._rows_json(pit_events)
        aggregate.recommendations_json = self._rows_json([self._row_dict(row) for row in recommendations])
        return aggregate

    def _add_lifetime_stats(self, db, aggregate: SessionAggregateModel) -> None:
        stats = db.get(UserLifetimeStatsModel, 1) or UserLifetimeStatsModel(id=1)
        db.add(stats)
        stats.total_distance_km = (stats.total_distance_km or 0) + (aggregate.total_distance_km or 0)
        stats.total_laps = (stats.total_laps or 0) + (aggregate.lap_count or 0)
        stats.total_driving_time = (stats.total_driving_time or 0) + (aggregate.duration_seconds or 0)
        stats.total_sessions = (stats.total_sessions or 0) + 1
        stats.updated_at = datetime.utcnow().isoformat()

    def _store_lap_summaries(self, db, session_id: str, laps: list[dict]) -> None:
        existing = {
            lap.lap_number: lap
            for lap in db.scalars(select(LapSummaryModel).where(LapSummaryModel.session_id == session_id)).all()
        }
        for lap in laps:
            lap_number = int(lap["lap_number"])
            row = existing.get(lap_number)
            if row is None:
                row = LapSummaryModel(session_id=session_id, lap_number=lap_number)
                db.add(row)
            row.lap_time = lap.get("lap_time")
            row.fuel_start = lap.get("fuel_start")
            row.fuel_end = lap.get("fuel_end")
            row.fuel_used = lap.get("fuel_used")
            row.tyre_wear_start = lap.get("tyre_wear_start")
            row.tyre_wear_end = lap.get("tyre_wear_end")
            row.valid_lap = lap.get("valid_lap")
            row.in_pit = lap.get("in_pit")
            row.under_yellow = lap.get("under_yellow")

    def _average_wear(self, sample: TelemetrySampleModel) -> float | None:
        values = [sample.tyre_wear_fl, sample.tyre_wear_fr, sample.tyre_wear_rl, sample.tyre_wear_rr]
        finite = [value for value in values if value is not None and math.isfinite(value)]
        return sum(finite) / len(finite) if finite else None

    def _average_sample_field(self, samples: list[TelemetrySampleModel], field: str) -> float | None:
        values = [getattr(sample, field) for sample in samples]
        finite = [value for value in values if value is not None and math.isfinite(value)]
        return sum(finite) / len(finite) if finite else None

    def _lap_start_time(self, rows: list[TelemetrySampleModel]) -> float | None:
        starts = []
        for row in rows:
            if row.game_time is None or row.current_lap_time is None:
                continue
            if not math.isfinite(row.game_time) or not math.isfinite(row.current_lap_time):
                continue
            if row.current_lap_time < 0 or row.current_lap_time > 1200:
                continue
            starts.append(row.game_time - row.current_lap_time)
        if not starts:
            return None
        starts.sort()
        return starts[len(starts) // 2]

    def _build_laps(self, samples: list[TelemetrySampleModel]) -> list[dict]:
        grouped: dict[int, list[TelemetrySampleModel]] = {}
        for sample in samples:
            if sample.lap_number is None:
                continue
            grouped.setdefault(int(sample.lap_number), []).append(sample)

        official_lap_times: dict[int, float] = {}
        for lap_number in sorted(grouped):
            values = [
                row.last_lap_time for row in grouped[lap_number]
                if row.last_lap_time is not None and math.isfinite(row.last_lap_time)
            ]
            if values:
                official_lap_times[lap_number - 1] = values[-1]

        lap_numbers = sorted(grouped)
        lap_start_times = {lap_number: self._lap_start_time(grouped[lap_number]) for lap_number in lap_numbers}
        boundary_lap_times: dict[int, float] = {}
        for previous_lap, next_lap in zip(lap_numbers, lap_numbers[1:]):
            previous_start = lap_start_times.get(previous_lap)
            next_start = lap_start_times.get(next_lap)
            if previous_start is None or next_start is None or next_start < previous_start:
                continue
            boundary_lap_times[previous_lap] = next_start - previous_start

        laps: list[dict] = []
        previous_fuel_end: float | None = None
        for index, lap_number in enumerate(lap_numbers):
            rows = grouped[lap_number]
            first = rows[0]
            last = rows[-1]
            next_lap_number = lap_numbers[index + 1] if index + 1 < len(lap_numbers) else None
            start_time = lap_start_times.get(lap_number) if lap_start_times.get(lap_number) is not None else first.game_time
            end_time = lap_start_times.get(next_lap_number) if next_lap_number is not None and lap_start_times.get(next_lap_number) is not None else last.game_time
            duration_from_samples = end_time - start_time if start_time is not None and end_time is not None and end_time >= start_time else None
            official_duration = official_lap_times.get(lap_number)
            boundary_duration = boundary_lap_times.get(lap_number)
            if official_duration is not None and (boundary_duration is None or abs(official_duration - boundary_duration) <= 2.0):
                duration = official_duration
                timing_source = "official"
            else:
                duration = boundary_duration or duration_from_samples
                timing_source = "lap_boundary" if boundary_duration is not None else "partial_samples"
            speed_values = [row.speed_kph for row in rows if row.speed_kph is not None]
            rpm_values = [row.rpm for row in rows if row.rpm is not None]
            fuel_start = first.fuel_liters
            fuel_end = last.fuel_liters
            fuel_used = fuel_start - fuel_end if fuel_start is not None and fuel_end is not None and fuel_start >= fuel_end else None
            fuel_added = fuel_start - previous_fuel_end if fuel_start is not None and previous_fuel_end is not None and fuel_start > previous_fuel_end else 0
            in_pit = any(bool(row.in_pits) for row in rows)
            wear_start = self._average_wear(first)
            wear_end = self._average_wear(last)
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
                "tyre_wear_start": wear_start,
                "tyre_wear_end": wear_end,
                "tyre_wear_delta": wear_end - wear_start if wear_start is not None and wear_end is not None else None,
                "position": last.position,
                "class_position": last.class_position,
                "top_speed": max(speed_values) if speed_values else None,
                "speed_kph": self._average_sample_field(rows, "speed_kph"),
                "max_rpm": max(rpm_values) if rpm_values else None,
                "rpm": self._average_sample_field(rows, "rpm"),
                "throttle": self._average_sample_field(rows, "throttle"),
                "brake": self._average_sample_field(rows, "brake"),
                "steering": self._average_sample_field(rows, "steering"),
                "track_temp": self._average_sample_field(rows, "track_temp"),
                "ambient_temp": self._average_sample_field(rows, "ambient_temp"),
                "sample_count": len(rows),
                "valid_lap": True,
                "in_pit": in_pit,
                "under_yellow": False,
            }
            for wheel in ("fl", "fr", "rl", "rr"):
                start_wear = getattr(first, f"tyre_wear_{wheel}")
                end_wear = getattr(last, f"tyre_wear_{wheel}")
                lap[f"tyre_wear_start_{wheel}"] = start_wear
                lap[f"tyre_wear_end_{wheel}"] = end_wear
                lap[f"tyre_wear_delta_{wheel}"] = end_wear - start_wear if start_wear is not None and end_wear is not None else None
                lap[f"tyre_temp_{wheel}"] = self._average_sample_field(rows, f"tyre_temp_{wheel}")
                lap[f"tyre_pressure_{wheel}"] = self._average_sample_field(rows, f"tyre_pressure_{wheel}")
                lap[f"brake_temp_{wheel}"] = self._average_sample_field(rows, f"brake_temp_{wheel}")
                lap[f"ride_height_{wheel}"] = self._average_sample_field(rows, f"ride_height_{wheel}")
            laps.append(lap)
            if fuel_end is not None:
                previous_fuel_end = fuel_end
        self._apply_lap_quality(laps)
        return laps

    def _apply_lap_quality(self, laps: list[dict]) -> list[dict]:
        return apply_lap_quality(laps)

    def _build_pit_events(self, samples: list[TelemetrySampleModel]) -> list[dict]:
        events = []
        previous_in_pits = False
        pit_entry_time: float | None = None
        pit_entry_lap: int | None = None
        for sample in samples:
            in_pits = bool(sample.in_pits)
            if in_pits and not previous_in_pits:
                pit_entry_time = sample.game_time
                pit_entry_lap = sample.lap_number
            elif previous_in_pits and not in_pits:
                events.append(
                    {
                        "vehicle_id": None,
                        "driver_name": "Player",
                        "lap_number": sample.lap_number or pit_entry_lap,
                        "pit_entry_time": pit_entry_time,
                        "pit_exit_time": sample.game_time,
                        "stationary_time": None,
                        "total_pit_loss": sample.game_time - pit_entry_time if sample.game_time is not None and pit_entry_time is not None else None,
                        "detected_from": "telemetry",
                        "message": "Pit stop detected from telemetry",
                    }
                )
                pit_entry_time = None
                pit_entry_lap = None
            previous_in_pits = in_pits
        return events

    def _latest_sample(self, session_id: str) -> TelemetrySampleModel | None:
        with SessionLocal() as db:
            return db.scalar(
                select(TelemetrySampleModel)
                .where(TelemetrySampleModel.session_id == session_id)
                .order_by(desc(TelemetrySampleModel.id))
                .limit(1)
            )

    def _valid_laps(self, laps: list[dict]) -> list[dict]:
        self._apply_lap_quality(laps)
        return [lap for lap in laps if lap.get("valid_lap") is True]

    def _review_summary(self, aggregate: SessionAggregateModel | None, laps: list[dict]) -> dict | None:
        """Return stored sample KPIs with lap KPIs recalculated under today's quality rules."""
        if aggregate is None:
            return None
        summary = self._row_dict(aggregate)
        valid_laps = self._valid_laps(laps)
        lap_times = [float(lap["lap_time"]) for lap in valid_laps if lap.get("lap_time") is not None]
        fuel_values = [
            float(lap["fuel_used"])
            for lap in valid_laps
            if lap.get("fuel_used") is not None
            and math.isfinite(float(lap["fuel_used"]))
            and float(lap["fuel_used"]) >= 0
        ]
        # Historical aggregates were created before pit/partial-lap filtering.
        # Recalculate these fields on read so old sessions do not keep reporting
        # impossible best laps or refuel quantities as consumption.
        summary["lap_count"] = len(laps)
        summary["valid_lap_count"] = len(valid_laps)
        summary["best_lap"] = min(lap_times) if lap_times else None
        summary["average_lap"] = sum(lap_times) / len(lap_times) if lap_times else None
        summary["total_fuel_used"] = sum(fuel_values) if fuel_values else None
        return summary

    def _fuel_state_from_laps(self, latest: TelemetrySampleModel, laps: list[dict], assumptions: StrategyAssumptions) -> FuelState:
        fuel_values = [
            float(lap["fuel_used"]) for lap in self._valid_laps(laps)
            if lap.get("fuel_used") is not None and float(lap["fuel_used"]) > 0
        ]
        if len(fuel_values) >= 3:
            baseline = median(fuel_values)
            fuel_values = [value for value in fuel_values if baseline * 0.5 <= value <= baseline * 1.5]
        if len(fuel_values) < 3:
            return FuelState(
                last_lap_fuel_used_liters=fuel_values[-1] if fuel_values else None,
                fuel_capacity_liters=round(latest.fuel_capacity_liters, 3) if latest.fuel_capacity_liters is not None else None,
                valid_laps_observed=len(fuel_values),
                valid_laps_required=3,
                confidence="low",
                reason_codes=["historical_fuel_history_below_three_laps"],
            )
        recent = fuel_values[-5:]
        fuel_per_lap = sum(recent) / len(recent)
        fuel_stddev = pstdev(recent) if len(recent) >= 2 else None
        fuel_laps = latest.fuel_liters / fuel_per_lap if latest.fuel_liters is not None and fuel_per_lap else None
        return FuelState(
            last_lap_fuel_used_liters=round(fuel_values[-1], 3),
            fuel_capacity_liters=round(latest.fuel_capacity_liters, 3) if latest.fuel_capacity_liters is not None else None,
            fuel_per_lap_liters=round(fuel_per_lap, 3),
            fuel_use_stddev_liters=round(fuel_stddev, 3) if fuel_stddev is not None else None,
            fuel_laps_remaining=round(fuel_laps, 2) if fuel_laps is not None else None,
            valid_laps_observed=len(fuel_values),
            valid_laps_required=3,
            confidence="high" if len(fuel_values) >= 5 else "medium",
            reason_codes=["historical_recent_five_clean_lap_mean"],
        )

    def _tyre_state_from_samples(self, latest: TelemetrySampleModel, laps: list[dict], assumptions: StrategyAssumptions) -> TyreStrategyState:
        average_wear = self._average_wear(latest)
        valid = self._valid_laps(laps)
        deltas = [
            float(lap["tyre_wear_delta"]) for lap in valid
            if lap.get("tyre_wear_delta") is not None and 0 < float(lap["tyre_wear_delta"]) < 0.2
        ]
        wear_rate = sum(deltas[-5:]) / len(deltas[-5:]) if deltas else None
        remaining = (assumptions.max_tyre_wear - average_wear) / wear_rate if average_wear is not None and wear_rate else None
        return TyreStrategyState(
            average_wear=round(average_wear, 3) if average_wear is not None else None,
            wear_rate_per_lap=round(wear_rate, 4) if wear_rate else None,
            estimated_remaining_tyre_life_laps=round(remaining, 1) if remaining is not None else None,
            tyre_risk_level="high" if average_wear is not None and average_wear >= assumptions.max_tyre_wear else "low" if wear_rate else "unknown",
            confidence="high" if len(deltas) >= 3 else "medium" if len(deltas) >= 2 else "low",
            observed_laps=len(deltas),
            laps_required=3,
            reason_codes=["historical_session_summary"],
        )

    def _snapshot_from_sample(self, session: SessionModel | None, sample: TelemetrySampleModel) -> TelemetrySnapshot:
        tyres = TyreState(
            wear_fl=sample.tyre_wear_fl,
            wear_fr=sample.tyre_wear_fr,
            wear_rl=sample.tyre_wear_rl,
            wear_rr=sample.tyre_wear_rr,
            pressure_fl=sample.tyre_pressure_fl,
            pressure_fr=sample.tyre_pressure_fr,
            pressure_rl=sample.tyre_pressure_rl,
            pressure_rr=sample.tyre_pressure_rr,
            load_fl=sample.tyre_load_fl,
            load_fr=sample.tyre_load_fr,
            load_rl=sample.tyre_load_rl,
            load_rr=sample.tyre_load_rr,
            average_wear=self._average_wear(sample),
        )
        player = PlayerState(
            vehicle_name=session.vehicle_name if session else None,
            vehicle_model=session.vehicle_model if session else None,
            vehicle_class=session.vehicle_class if session else None,
            position=sample.position,
            class_position=sample.class_position,
            lap_number=sample.lap_number,
            current_lap_time=sample.current_lap_time,
            last_lap_time=sample.last_lap_time,
            best_lap_time=sample.best_lap_time,
            speed_kph=sample.speed_kph,
            gear=sample.gear,
            rpm=sample.rpm,
            fuel_liters=sample.fuel_liters,
            fuel_capacity_liters=sample.fuel_capacity_liters,
            engine_oil_temp=sample.engine_oil_temp,
            engine_water_temp=sample.engine_water_temp,
            surface_type_fl=sample.surface_type_fl,
            surface_type_fr=sample.surface_type_fr,
            surface_type_rl=sample.surface_type_rl,
            surface_type_rr=sample.surface_type_rr,
            throttle=sample.throttle,
            brake=sample.brake,
            steering=sample.steering,
            abs_active=sample.abs_active,
            tc_active=sample.tc_active,
            abs_setting=sample.abs_setting,
            abs_max=sample.abs_max,
            tc_setting=sample.tc_setting,
            tc_max=sample.tc_max,
            tc_slip_setting=sample.tc_slip_setting,
            tc_cut_setting=sample.tc_cut_setting,
            brake_temp_fl=sample.brake_temp_fl,
            brake_temp_fr=sample.brake_temp_fr,
            brake_temp_rl=sample.brake_temp_rl,
            brake_temp_rr=sample.brake_temp_rr,
            brake_pressure_fl=sample.brake_pressure_fl,
            brake_pressure_fr=sample.brake_pressure_fr,
            brake_pressure_rl=sample.brake_pressure_rl,
            brake_pressure_rr=sample.brake_pressure_rr,
            ride_height_fl=sample.ride_height_fl,
            ride_height_fr=sample.ride_height_fr,
            ride_height_rl=sample.ride_height_rl,
            ride_height_rr=sample.ride_height_rr,
            front_ride_height=sample.front_ride_height,
            rear_ride_height=sample.rear_ride_height,
            suspension_deflection_fl=sample.suspension_deflection_fl,
            suspension_deflection_fr=sample.suspension_deflection_fr,
            suspension_deflection_rl=sample.suspension_deflection_rl,
            suspension_deflection_rr=sample.suspension_deflection_rr,
            tyre_state=tyres,
        )
        session_state = SessionState(
            track_name=session.track_name if session else None,
            session_type=session.session_type if session else None,
            current_time=sample.game_time,
            current_lap=sample.lap_number,
            num_vehicles=session.total_cars if session else None,
        )
        competitor = CompetitorState(
            vehicle_id=0,
            driver_name="Player",
            vehicle_name=session.vehicle_name if session else None,
            vehicle_model=session.vehicle_model if session else None,
            vehicle_class=session.vehicle_class if session else None,
            position=sample.position,
            class_position=sample.class_position,
            total_laps=sample.lap_number,
            best_lap_time=sample.best_lap_time,
            last_lap_time=sample.last_lap_time,
            is_player=True,
            pitstops=sample.pitstops,
            in_pits=sample.in_pits,
            pit_state=sample.pit_state,
        )
        timestamp = datetime.fromisoformat(sample.timestamp)
        return TelemetrySnapshot(
            timestamp=timestamp,
            connected=True,
            feed_paused=True,
            pause_reason="saved session snapshot",
            session=session_state,
            player=player,
            competitors=[competitor],
            environment=EnvironmentState(track_temp_c=sample.track_temp, ambient_temp_c=sample.ambient_temp, raining=sample.rain, avg_wetness=sample.wetness),
        )

    def dashboard_snapshot(self, session_id: str, assumptions: StrategyAssumptions | None = None) -> dict:
        assumptions = assumptions or StrategyAssumptions()
        review = self.review(session_id, sample_limit=0)
        latest = self._latest_sample(session_id)
        with SessionLocal() as db:
            session = db.get(SessionModel, session_id)
            aggregate = db.get(SessionAggregateModel, session_id)
        if latest is None:
            return {"session": review["session"], "telemetry": None, "strategy": StrategyState(assumptions=assumptions), "recommendation": RecommendationPayload(current=StrategyRecommendation()), "review": review}
        snapshot = self._snapshot_from_sample(session, latest)
        laps = review["laps"]
        fuel = self._fuel_state_from_laps(latest, laps, assumptions)
        tyres = self._tyre_state_from_samples(latest, laps, assumptions)
        current_lap = latest.lap_number or 0
        last_pit_lap = max((int(lap["lap_number"]) for lap in laps if lap.get("in_pit")), default=0)
        stint = StintState(current_stint_lap=current_lap - last_pit_lap if current_lap else None, last_pit_lap=last_pit_lap)
        strategy = StrategyState(fuel=fuel, tyres=tyres, stint=stint, pit_window=PitWindowState(), assumptions=assumptions)
        latest_rec = (review["recommendations"] or [])[-1] if review["recommendations"] else None
        recommendation = RecommendationPayload(current=StrategyRecommendation(message=str(latest_rec.get("message") if latest_rec else "Saved session snapshot")))
        return {"session": review["session"], "telemetry": snapshot, "strategy": strategy, "recommendation": recommendation, "review": review}

    def review(self, session_id: str, sample_limit: int = 5000) -> dict:
        with SessionLocal() as db:
            session = db.get(SessionModel, session_id)
            if not session or not session.is_saved:
                return {"session": None, "telemetry_samples": [], "recommendations": [], "laps": [], "pit_events": [], "summary": None}
            aggregate = db.get(SessionAggregateModel, session_id)
            latest_sample_id = db.scalar(
                select(func.max(TelemetrySampleModel.id)).where(TelemetrySampleModel.session_id == session_id)
            )
            latest_recommendation_id = db.scalar(
                select(func.max(RecommendationModel.id)).where(RecommendationModel.session_id == session_id)
            )
            cache_key = (session_id, sample_limit, latest_sample_id, latest_recommendation_id)
            cached = self._review_cache.get(cache_key)
            if cached is not None:
                return cached
            all_samples = db.scalars(
                select(TelemetrySampleModel).where(TelemetrySampleModel.session_id == session_id).order_by(TelemetrySampleModel.id.asc())
            ).all()
            recs = db.scalars(select(RecommendationModel).where(RecommendationModel.session_id == session_id).order_by(RecommendationModel.id.asc()).limit(100)).all()
            if not all_samples and aggregate:
                stored_laps = self._json_rows(aggregate.laps_json)
                self._apply_lap_quality(stored_laps)
                result = {
                    "session": self._row_dict(session),
                    "telemetry_samples": self._json_rows(aggregate.sample_trace_json),
                    "recommendations": self._json_rows(aggregate.recommendations_json),
                    "laps": stored_laps,
                    "pit_events": self._json_rows(aggregate.pit_events_json),
                    "summary": self._review_summary(aggregate, stored_laps),
                }
                self._review_cache = {cache_key: result}
                return result

            if sample_limit <= 0:
                samples = []
            elif len(all_samples) > sample_limit:
                step = math.ceil(len(all_samples) / sample_limit)
                samples = all_samples[::step]
            else:
                samples = all_samples
            laps = self._build_laps(all_samples)
            result = {
                "session": self._row_dict(session) if session else None,
                "telemetry_samples": [self._row_dict(s) for s in samples],
                "recommendations": [self._row_dict(r) for r in recs],
                "laps": laps,
                "pit_events": self._build_pit_events(all_samples),
                "summary": self._review_summary(aggregate, laps),
            }
            self._review_cache = {cache_key: result}
            return result

    def lap_input_trace(self, session_id: str, lap_numbers: list[int], max_points: int = 2400) -> dict:
        selected = list(dict.fromkeys(number for number in lap_numbers if number >= 0))[:2]
        if not selected:
            return {"session_id": session_id, "laps": [], "points": [], "warnings": ["No laps were selected."]}
        with SessionLocal() as db:
            session = db.get(SessionModel, session_id)
            if not session or not session.is_saved:
                return {"session_id": session_id, "laps": selected, "points": [], "warnings": ["Session is unavailable."]}
            rows = db.scalars(
                select(TelemetrySampleModel)
                .where(TelemetrySampleModel.session_id == session_id, TelemetrySampleModel.lap_number.in_(selected))
                .order_by(TelemetrySampleModel.id.asc())
            ).all()
        per_lap_limit = max(40, max_points // max(1, len(selected)))
        points: list[dict] = []
        for lap_number in selected:
            lap_rows = [row for row in rows if row.lap_number == lap_number]
            if len(lap_rows) > per_lap_limit:
                step = (len(lap_rows) - 1) / max(1, per_lap_limit - 1)
                indexes = {round(index * step) for index in range(per_lap_limit)}
                lap_rows = [row for index, row in enumerate(lap_rows) if index in indexes]
            times = [row.game_time for row in lap_rows if row.game_time is not None]
            start = min(times) if times else None
            span = (max(times) - start) if times and start is not None else 0.0
            for index, row in enumerate(lap_rows):
                elapsed = row.game_time - start if row.game_time is not None and start is not None else None
                points.append({
                    "lap_number": lap_number,
                    "game_time": row.game_time,
                    "progress": elapsed / span if elapsed is not None and span > 0 else index / max(1, len(lap_rows) - 1),
                    "throttle": row.throttle,
                    "brake": row.brake,
                    "speed_kph": row.speed_kph,
                })
        warnings = [] if points else ["No input samples were stored for the selected laps."]
        return {"session_id": session_id, "laps": selected, "points": points, "warnings": warnings}

    def remove_session(self, session_id: str) -> dict | None:
        with SessionLocal() as db:
            session = db.get(SessionModel, session_id)
            if not session:
                return None
            session.is_saved = False
            session.removed_at = datetime.utcnow().isoformat()
            db.execute(delete(TelemetrySampleModel).where(TelemetrySampleModel.session_id == session_id))
            db.execute(delete(RecommendationModel).where(RecommendationModel.session_id == session_id))
            self._review_cache = {}
            db.commit()
            db.refresh(session)
            return self._row_dict(session)
