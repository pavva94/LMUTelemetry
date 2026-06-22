from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

from fastapi import WebSocket

from app.analysis.live_lap_engine import LiveLapBuffer, VehicleAnalysisConfig, analysis_payload
from app.ai.assistant import StrategyAssistant
from app.core.config import Settings
from app.db.repository import Repository
from app.schemas.recommendations import RecommendationPayload, StrategyRecommendation
from app.schemas.strategy import StrategyAssumptions, StrategyState
from app.schemas.telemetry import CompetitorState, TelemetrySnapshot
from app.services.session_logger import SessionLogger
from app.strategy.competitor_model import CompetitorModel
from app.strategy.fuel_model import FuelModel
from app.strategy.pace_model import PaceModel
from app.strategy.pit_window_model import PitWindowModel
from app.strategy.recommendation_engine import RecommendationEngine
from app.strategy.stint_model import StintModel
from app.strategy.tyre_model import TyreModel
from app.telemetry.event_detector import EventDetector
from app.telemetry.event_detector import _player_in_pits
from app.telemetry.lmu_collector import LMUTelemetryCollector
from app.telemetry.mock_collector import MockTelemetryCollector

logger = logging.getLogger(__name__)


class WebSocketHub:
    def __init__(self) -> None:
        self.channels: dict[str, set[WebSocket]] = {"telemetry": set(), "strategy": set(), "recommendations": set()}

    async def connect(self, channel: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.channels.setdefault(channel, set()).add(websocket)

    def disconnect(self, channel: str, websocket: WebSocket) -> None:
        self.channels.setdefault(channel, set()).discard(websocket)

    async def broadcast(self, channel: str, payload: Any) -> None:
        dead: list[WebSocket] = []
        data = payload.model_dump(mode="json") if hasattr(payload, "model_dump") else payload
        for websocket in list(self.channels.setdefault(channel, set())):
            try:
                await websocket.send_json(data)
            except Exception:
                dead.append(websocket)
        for websocket in dead:
            self.disconnect(channel, websocket)


class TelemetryService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.assumptions: StrategyAssumptions = settings.assumptions
        self.collector = MockTelemetryCollector(settings.poll_hz) if settings.use_mock_telemetry else LMUTelemetryCollector(settings.poll_hz)
        self.fuel_model = FuelModel(self.assumptions)
        self.tyre_model = TyreModel(self.assumptions)
        self.stint_model = StintModel()
        self.pit_window_model = PitWindowModel(self.assumptions)
        self.pace_model = PaceModel(self.assumptions)
        self.competitor_model = CompetitorModel()
        self.recommendation_engine = RecommendationEngine(self.assumptions)
        self.event_detector = EventDetector()
        self.assistant = StrategyAssistant()
        self.repository = Repository()
        self.live_analysis_config = VehicleAnalysisConfig(
            poll_hz=settings.poll_hz,
            retained_laps=settings.live_analysis_retained_laps,
            tyre_radius_m=settings.tyre_radius_m,
            mass_kg=settings.vehicle_mass_kg,
            roll_center_height_m=settings.roll_center_height_m,
            track_width_m=settings.track_width_m,
            wheelbase_m=settings.wheelbase_m,
        )
        self.live_lap_buffer = LiveLapBuffer(self.live_analysis_config)
        self.session_logger = SessionLogger(self.repository, settings.log_hz)
        self.hub = WebSocketHub()
        self.session_id = str(uuid.uuid4())
        self.latest_snapshot: TelemetrySnapshot | None = None
        self._last_session_snapshot: TelemetrySnapshot | None = None
        self._session_signature: tuple[str | None, str | None, str | None] | None = None
        self._last_game_time: float | None = None
        self._last_lap_number: int | None = None
        self._idle_since_game_time: float | None = None
        self._last_player_progress: tuple[int | None, float | None] | None = None
        self.feed_paused = False
        self.pause_reason: str | None = None
        self.strategy_state = StrategyState(assumptions=self.assumptions)
        self.competitors: list[CompetitorState] = []
        self.recommendation = StrategyRecommendation()
        self.recommendation_payload = RecommendationPayload(current=self.recommendation)
        self._task: asyncio.Task | None = None
        self._running = False

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self.collector.start()
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._finish_active_session("service stopped")
        self.collector.stop()

    def update_assumptions(self, assumptions: StrategyAssumptions) -> StrategyState:
        self.assumptions = assumptions
        self.strategy_state.assumptions = assumptions
        self.fuel_model.assumptions = assumptions
        self.tyre_model.assumptions = assumptions
        self.pit_window_model.assumptions = assumptions
        self.pace_model.assumptions = assumptions
        self.recommendation_engine.assumptions = assumptions
        return self.strategy_state

    def _reset_live_models(self) -> None:
        self.fuel_model = FuelModel(self.assumptions)
        self.tyre_model = TyreModel(self.assumptions)
        self.stint_model = StintModel()
        self.pit_window_model = PitWindowModel(self.assumptions)
        self.pace_model = PaceModel(self.assumptions)
        self.competitor_model = CompetitorModel()
        self.recommendation_engine = RecommendationEngine(self.assumptions)
        self.event_detector = EventDetector()
        self.strategy_state = StrategyState(assumptions=self.assumptions)
        self.competitors = []
        self.recommendation = StrategyRecommendation()
        self.recommendation_payload = RecommendationPayload(current=self.recommendation)
        self._idle_since_game_time = None
        self._last_player_progress = None
        self.live_lap_buffer.reset()

    def _snapshot_signature(self, snapshot: TelemetrySnapshot) -> tuple[str | None, str | None, str | None]:
        session = snapshot.session
        player = snapshot.player
        return (
            session.track_name if session else None,
            session.session_type if session else None,
            (player.vehicle_model or player.vehicle_name) if player else None,
        )

    def _player_track_progress(self, snapshot: TelemetrySnapshot) -> tuple[int | None, float | None]:
        player = snapshot.player
        player_id = player.vehicle_id if player else None
        player_comp = next((car for car in snapshot.competitors if car.is_player or car.vehicle_id == player_id), None)
        return (player.lap_number if player else None, player_comp.lap_distance if player_comp else None)

    def _is_on_track(self, snapshot: TelemetrySnapshot) -> tuple[bool, str | None]:
        player = snapshot.player
        session = snapshot.session
        if not snapshot.connected or not player:
            return False, "telemetry unavailable"
        phase = f"{session.game_phase if session else ''}".lower()
        in_pits = _player_in_pits(snapshot)
        if any(token in phase for token in ("garage", "menu", "replay", "paused")):
            return False, f"game phase {phase}".strip()
        if in_pits:
            self._idle_since_game_time = None
            return True, None
        progress = self._player_track_progress(snapshot)
        previous_progress = self._last_player_progress
        self._last_player_progress = progress
        speed = player.speed_kph or 0.0
        inputs_active = any((value or 0.0) > 0.03 for value in (player.throttle, player.brake, player.clutch))
        progressed = (
            previous_progress is not None
            and progress[0] == previous_progress[0]
            and progress[1] is not None
            and previous_progress[1] is not None
            and abs(progress[1] - previous_progress[1]) > 0.00005
        )
        if speed > 5 or inputs_active or progressed:
            self._idle_since_game_time = None
            return True, None
        current_time = session.current_time if session else None
        if current_time is None:
            return False, "no session clock"
        if self._idle_since_game_time is None:
            self._idle_since_game_time = current_time
            return True, None
        if current_time - self._idle_since_game_time >= 15:
            return False, "car stationary or menu idle"
        return True, None

    def _pause_live_feed(self, snapshot: TelemetrySnapshot, reason: str) -> None:
        self.feed_paused = True
        self.pause_reason = reason
        if (not snapshot.connected or not snapshot.player) and self.latest_snapshot is not None:
            snapshot = self.latest_snapshot
        snapshot.feed_paused = True
        snapshot.session_id = self.session_id
        snapshot.pause_reason = reason
        snapshot.strategy = self.strategy_state
        self.latest_snapshot = snapshot

    def _resume_live_feed(self) -> None:
        self.feed_paused = False
        self.pause_reason = None

    def _finish_active_session(self, reason: str) -> None:
        if self._last_session_snapshot is None:
            return
        logger.info("Finalizing telemetry session %s (%s)", self.session_id, reason)
        self.repository.finalize_session(self.session_id, self._last_session_snapshot)
        self.session_id = str(uuid.uuid4())
        self._session_signature = None
        self._last_session_snapshot = None
        self._last_game_time = None
        self._last_lap_number = None
        self.session_logger.reset()
        self.live_lap_buffer.reset()
        self._reset_live_models()

    def live_lap_analysis(self, selected_lap: int | None = None, reference_lap: int | None = None) -> dict:
        player = self.latest_snapshot.player if self.latest_snapshot and self.latest_snapshot.player else None
        session_state = self.latest_snapshot.session if self.latest_snapshot and self.latest_snapshot.session else None
        session = {
            "track_name": session_state.track_name if session_state else None,
            "session_type": session_state.session_type if session_state else None,
            "vehicle_name": player.vehicle_name if player else None,
            "vehicle_model": player.vehicle_model if player else None,
        }
        return analysis_payload(self.live_lap_buffer, self.live_analysis_config, selected_lap, reference_lap, session)

    def _maybe_rotate_session(self, snapshot: TelemetrySnapshot) -> None:
        session = snapshot.session
        player = snapshot.player
        signature = self._snapshot_signature(snapshot)
        current_time = session.current_time if session else None
        lap_number = player.lap_number if player else None
        reason: str | None = None

        if self._session_signature is None:
            self._session_signature = signature
            resumable = self.repository.find_resume_session(snapshot)
            if resumable:
                self.session_id = str(resumable["id"])
                logger.info("Resuming unfinished telemetry session %s", self.session_id)
        elif signature != self._session_signature:
            reason = "session identity changed"
        elif (
            current_time is not None
            and self._last_game_time is not None
            and self._last_game_time > 60
            and current_time + 30 < self._last_game_time
        ):
            reason = "session clock reset"
        elif (
            lap_number is not None
            and self._last_lap_number is not None
            and self._last_lap_number > 2
            and lap_number + 1 < self._last_lap_number
        ):
            reason = "lap counter reset"

        if reason:
            logger.info("Detected new LMU session (%s): %s -> %s", reason, self._session_signature, signature)
            self._finish_active_session(reason)
            self._session_signature = signature

        self._last_game_time = current_time
        self._last_lap_number = lap_number

    async def _loop(self) -> None:
        poll_delay = 1 / max(1, self.settings.poll_hz)
        broadcast_every = max(1, int(self.settings.poll_hz / max(1, self.settings.broadcast_hz)))
        ticks = 0
        while self._running:
            try:
                snapshot = self.collector.poll_once()
                if snapshot:
                    self._process(snapshot)
                    if ticks % broadcast_every == 0:
                        await self.hub.broadcast("telemetry", self.latest_snapshot)
                        await self.hub.broadcast("strategy", self.strategy_state)
                        await self.hub.broadcast("recommendations", self.recommendation_payload)
                ticks += 1
            except Exception as exc:
                logger.exception("Telemetry service loop failed: %s", exc)
            await asyncio.sleep(poll_delay)

    def _process(self, snapshot: TelemetrySnapshot) -> None:
        if not snapshot.connected or not snapshot.player:
            self._pause_live_feed(snapshot, "telemetry unavailable")
            return
        on_track, reason = self._is_on_track(snapshot)
        if not on_track:
            self._pause_live_feed(snapshot, reason or "not on track")
            return
        self._resume_live_feed()
        snapshot.feed_paused = False
        snapshot.pause_reason = None
        self._maybe_rotate_session(snapshot)
        snapshot.session_id = self.session_id
        self.latest_snapshot = snapshot
        events = self.event_detector.update(snapshot)
        fuel = self.fuel_model.update(snapshot)
        tyres = self.tyre_model.update(snapshot)
        pace = self.pace_model.update(events.get("lap_completed"))
        stint = self.stint_model.update(snapshot, fuel, tyres)
        pit_window = self.pit_window_model.update(snapshot, fuel, tyres, stint)
        competitors = self.competitor_model.update(snapshot)
        recommendation = self.recommendation_engine.update(snapshot, fuel, tyres, stint, pit_window, competitors)
        strategy = StrategyState(fuel=fuel, tyres=tyres, pace=pace, stint=stint, pit_window=pit_window, assumptions=self.assumptions)
        recommendation.explanation = self.assistant.explain_recommendation(recommendation, strategy)
        self.strategy_state = strategy
        self.competitors = competitors
        self.recommendation = recommendation
        self.recommendation_payload = RecommendationPayload(
            current=recommendation,
            ai_explanation=recommendation.explanation,
            metadata={"session_id": self.session_id},
        )
        snapshot.strategy = strategy
        self.live_lap_buffer.add_snapshot(snapshot)
        self.session_logger.log(self.session_id, snapshot, recommendation)
        self._last_session_snapshot = snapshot
