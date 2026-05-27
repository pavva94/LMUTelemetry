from __future__ import annotations

import json
from datetime import datetime

from sqlalchemy import select

from app.db.database import SessionLocal
from app.db.models import RecommendationModel, SessionModel, TelemetrySampleModel
from app.schemas.recommendations import StrategyRecommendation
from app.schemas.telemetry import TelemetrySnapshot


class Repository:
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
                    tyre_wear_fl=tyre.wear_fl if tyre else None,
                    tyre_wear_fr=tyre.wear_fr if tyre else None,
                    tyre_wear_rl=tyre.wear_rl if tyre else None,
                    tyre_wear_rr=tyre.wear_rr if tyre else None,
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

    def review(self, session_id: str) -> dict:
        with SessionLocal() as db:
            session = db.get(SessionModel, session_id)
            samples = db.scalars(select(TelemetrySampleModel).where(TelemetrySampleModel.session_id == session_id).order_by(TelemetrySampleModel.id.desc()).limit(300)).all()
            recs = db.scalars(select(RecommendationModel).where(RecommendationModel.session_id == session_id).order_by(RecommendationModel.id.desc()).limit(100)).all()
            return {
                "session": session.__dict__ if session else None,
                "telemetry_samples": [s.__dict__ for s in reversed(samples)],
                "recommendations": [r.__dict__ for r in reversed(recs)],
                "laps": [],
                "pit_events": [],
            }
