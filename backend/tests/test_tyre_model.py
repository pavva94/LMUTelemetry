from __future__ import annotations

from app.schemas.strategy import StrategyAssumptions
from app.strategy.tyre_model import TyreModel
from app.telemetry.mock_collector import MockTelemetryCollector


def test_tyre_wear_high() -> None:
    collector = MockTelemetryCollector()
    snapshot = collector.poll_once()
    snapshot.player.tyre_state.average_wear = 0.8
    state = TyreModel(StrategyAssumptions(max_tyre_wear=0.75)).update(snapshot)
    assert state.tyre_risk_level == "high"
