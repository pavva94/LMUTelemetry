from __future__ import annotations

import json
import math
from datetime import datetime

from sqlalchemy import desc, func, select

from app.db.database import SessionLocal
from app.db.models import RecommendationModel, SessionModel, TelemetrySampleModel
from app.schemas.recommendations import StrategyRecommendation
from app.schemas.telemetry import TelemetrySnapshot


class Repository:
    def _session_type_name(self, value: object) -> str | None:
        names = {
            "0": "Test Day",
            "1": "Practice",
            "2": "Practice 2",
            "3": "Practice 3",
            "4": "Practice 4",
            "5": "Qualifying",
            "6": "Warmup",
            "7": "Race",
        }
        if value is None:
            return None
        return names.get(str(value), str(value))

    def _row_dict(self, row) -> dict:
        data = {column.name: getattr(row, column.name) for column in row.__table__.columns}
        if "session_type" in data:
            data["session_type"] = self._session_type_name(data["session_type"])
        return data

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
                    session_type=state.session_type if state else None,
                    vehicle_name=player.vehicle_name if player else None,
                    started_at_game_time=state.current_time if state else None,
                    ended_at_game_time=None,
                )
            )
            db.commit()

    def log_sample(self, session_id: str, snapshot: TelemetrySnapshot) -> None:
        player = snapshot.player
        tyre = player.tyre_state if player else None
        env = snapshot.environment
        state = snapshot.session
        with SessionLocal() as db:
            db.add(
                TelemetrySampleModel(
                    session_id=session_id,
                    timestamp=snapshot.timestamp.isoformat(),
                    game_time=state.current_time if state else None,
                    lap_number=player.lap_number if player else None,
                    speed_kph=player.speed_kph if player else None,
                    gear=player.gear if player else None,
                    rpm=player.rpm if player else None,
                    fuel_liters=player.fuel_liters if player else None,
                    throttle=player.throttle if player else None,
                    brake=player.brake if player else None,
                    steering=player.steering if player else None,
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
                    tyre_temp_fl=tyre.temp_fl.center_c if tyre and tyre.temp_fl else None,
                    tyre_temp_fr=tyre.temp_fr.center_c if tyre and tyre.temp_fr else None,
                    tyre_temp_rl=tyre.temp_rl.center_c if tyre and tyre.temp_rl else None,
                    tyre_temp_rr=tyre.temp_rr.center_c if tyre and tyre.temp_rr else None,
                    track_temp=env.track_temp_c if env else None,
                    ambient_temp=env.ambient_temp_c if env else None,
                    rain=env.raining if env else None,
                    wetness=env.avg_wetness if env else None,
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
            sessions = db.scalars(select(SessionModel).order_by(desc(SessionModel.created_at)).limit(50)).all()
            rows = []
            for session in sessions:
                sample_count = db.scalar(select(func.count()).where(TelemetrySampleModel.session_id == session.id)) or 0
                latest_sample = db.scalar(
                    select(TelemetrySampleModel)
                    .where(TelemetrySampleModel.session_id == session.id)
                    .order_by(desc(TelemetrySampleModel.id))
                    .limit(1)
                )
                row = self._row_dict(session)
                row["sample_count"] = sample_count
                row["latest_lap_number"] = latest_sample.lap_number if latest_sample else None
                row["latest_game_time"] = latest_sample.game_time if latest_sample else None
                rows.append(row)
            return rows

    def finalize_session(self, session_id: str, snapshot: TelemetrySnapshot | None = None) -> dict | None:
        with SessionLocal() as db:
            session = db.get(SessionModel, session_id)
            if not session:
                return None
            state = snapshot.session if snapshot else None
            latest_sample = db.scalar(
                select(TelemetrySampleModel)
                .where(TelemetrySampleModel.session_id == session_id)
                .order_by(desc(TelemetrySampleModel.id))
                .limit(1)
            )
            session.ended_at_game_time = state.current_time if state else (latest_sample.game_time if latest_sample else session.ended_at_game_time)
            db.commit()
            db.refresh(session)
            return self._row_dict(session)

    def _average_wear(self, sample: TelemetrySampleModel) -> float | None:
        values = [sample.tyre_wear_fl, sample.tyre_wear_fr, sample.tyre_wear_rl, sample.tyre_wear_rr]
        finite = [value for value in values if value is not None and math.isfinite(value)]
        return sum(finite) / len(finite) if finite else None

    def _build_laps(self, samples: list[TelemetrySampleModel]) -> list[dict]:
        grouped: dict[int, list[TelemetrySampleModel]] = {}
        for sample in samples:
            if sample.lap_number is None:
                continue
            grouped.setdefault(int(sample.lap_number), []).append(sample)

        laps: list[dict] = []
        previous_fuel_end: float | None = None
        for lap_number in sorted(grouped):
            rows = grouped[lap_number]
            first = rows[0]
            last = rows[-1]
            start_time = first.game_time
            end_time = last.game_time
            duration = end_time - start_time if start_time is not None and end_time is not None and end_time >= start_time else None
            speed_values = [row.speed_kph for row in rows if row.speed_kph is not None]
            rpm_values = [row.rpm for row in rows if row.rpm is not None]
            fuel_start = first.fuel_liters
            fuel_end = last.fuel_liters
            fuel_used = fuel_start - fuel_end if fuel_start is not None and fuel_end is not None and fuel_start >= fuel_end else None
            fuel_added = fuel_start - previous_fuel_end if fuel_start is not None and previous_fuel_end is not None and fuel_start > previous_fuel_end else 0
            wear_start = self._average_wear(first)
            wear_end = self._average_wear(last)
            laps.append(
                {
                    "lap_number": lap_number,
                    "start_time": start_time,
                    "end_time": end_time,
                    "lap_time": duration,
                    "fuel_start": fuel_start,
                    "fuel_end": fuel_end,
                    "fuel_used": fuel_used,
                    "fuel_added": fuel_added,
                    "tyre_wear_start": wear_start,
                    "tyre_wear_end": wear_end,
                    "tyre_wear_delta": wear_end - wear_start if wear_start is not None and wear_end is not None else None,
                    "top_speed": max(speed_values) if speed_values else None,
                    "max_rpm": max(rpm_values) if rpm_values else None,
                    "sample_count": len(rows),
                    "valid_lap": True,
                    "in_pit": bool(fuel_added and fuel_added > 2),
                    "under_yellow": False,
                }
            )
            if fuel_end is not None:
                previous_fuel_end = fuel_end
        return laps

    def _build_pit_events(self, laps: list[dict]) -> list[dict]:
        events = []
        for lap in laps:
            if (lap.get("fuel_added") or 0) > 2:
                events.append(
                    {
                        "vehicle_id": None,
                        "driver_name": None,
                        "lap_number": lap.get("lap_number"),
                        "pit_entry_time": lap.get("start_time"),
                        "pit_exit_time": lap.get("end_time"),
                        "stationary_time": None,
                        "total_pit_loss": None,
                        "detected_from": "fuel increase",
                        "message": f"Refuel detected: +{lap.get('fuel_added'):.1f} L",
                    }
                )
        return events

    def review(self, session_id: str, sample_limit: int = 5000) -> dict:
        with SessionLocal() as db:
            session = db.get(SessionModel, session_id)
            all_samples = db.scalars(
                select(TelemetrySampleModel).where(TelemetrySampleModel.session_id == session_id).order_by(TelemetrySampleModel.id.asc())
            ).all()
            recs = db.scalars(select(RecommendationModel).where(RecommendationModel.session_id == session_id).order_by(RecommendationModel.id.asc()).limit(100)).all()

            if sample_limit > 0 and len(all_samples) > sample_limit:
                step = math.ceil(len(all_samples) / sample_limit)
                samples = all_samples[::step]
            else:
                samples = all_samples
            laps = self._build_laps(all_samples)
            return {
                "session": self._row_dict(session) if session else None,
                "telemetry_samples": [self._row_dict(s) for s in samples],
                "recommendations": [self._row_dict(r) for r in recs],
                "laps": laps,
                "pit_events": self._build_pit_events(laps),
            }
