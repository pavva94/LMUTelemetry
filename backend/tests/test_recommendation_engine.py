from __future__ import annotations

from app.schemas.strategy import FuelState, PitWindowState, StrategyAssumptions, StintState, TyreStrategyState
from app.strategy.recommendation_engine import RecommendationEngine
from app.telemetry.mock_collector import MockTelemetryCollector


def test_recommends_pit_this_lap_when_window_closes() -> None:
    snapshot = MockTelemetryCollector().poll_once()
    snapshot.player.lap_number = 20
    rec = RecommendationEngine(StrategyAssumptions()).update(
        snapshot,
        FuelState(fuel_laps_remaining=4),
        TyreStrategyState(tyre_risk_level="low"),
        StintState(),
        PitWindowState(latest_safe_pit_lap=20),
        snapshot.competitors,
    )
    assert rec.type.value == "pit_this_lap"
