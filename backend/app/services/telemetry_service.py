from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

from fastapi import WebSocket

from app.ai.assistant import StrategyAssistant
from app.core.config import Settings
from app.db.repository import Repository
from app.schemas.recommendations import RecommendationPayload, StrategyRecommendation
from app.schemas.strategy import StrategyAssumptions, StrategyState
from app.schemas.telemetry import CompetitorState, TelemetrySnapshot
from app.services.session_logger import SessionLogger
from app.strategy.competitor_model import CompetitorModel
from app.strategy.fuel_model import FuelModel
from app.strategy.pit_window_model import PitWindowModel
from app.strategy.recommendation_engine import RecommendationEngine
from app.strategy.stint_model import StintModel
from app.strategy.tyre_model import TyreModel
from app.telemetry.event_detector import EventDetector
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
        self.competitor_model = CompetitorModel()
        self.recommendation_engine = RecommendationEngine(self.assumptions)
        self.event_detector = EventDetector()
        self.assistant = StrategyAssistant()
        self.repository = Repository()
        self.session_logger = SessionLogger(self.repository, settings.log_hz)
        self.hub = WebSocketHub()
        self.session_id = str(uuid.uuid4())
        self.latest_snapshot: TelemetrySnapshot | None = None
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
        self.collector.stop()

    def update_assumptions(self, assumptions: StrategyAssumptions) -> StrategyState:
        self.assumptions = assumptions
        self.strategy_state.assumptions = assumptions
        self.fuel_model.assumptions = assumptions
        self.tyre_model.assumptions = assumptions
        self.pit_window_model.assumptions = assumptions
        self.recommendation_engine.assumptions = assumptions
        return self.strategy_state

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
        self.latest_snapshot = snapshot
        if not snapshot.connected or not snapshot.player:
            return
        self.event_detector.update(snapshot)
        fuel = self.fuel_model.update(snapshot)
        tyres = self.tyre_model.update(snapshot)
        stint = self.stint_model.update(snapshot, fuel, tyres)
        pit_window = self.pit_window_model.update(snapshot, fuel, tyres, stint)
        competitors = self.competitor_model.update(snapshot)
        recommendation = self.recommendation_engine.update(snapshot, fuel, tyres, stint, pit_window, competitors)
        strategy = StrategyState(fuel=fuel, tyres=tyres, stint=stint, pit_window=pit_window, assumptions=self.assumptions)
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
        self.session_logger.log(self.session_id, snapshot, recommendation)
