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


def test_tyre_model_learns_when_wear_value_decreases() -> None:
    collector = MockTelemetryCollector()
    model = TyreModel(StrategyAssumptions(max_tyre_wear=0.75))
    for lap, wear in [(1, 0.92), (2, 0.90), (3, 0.88), (4, 0.86)]:
        snapshot = collector.poll_once()
        snapshot.player.lap_number = lap
        snapshot.player.tyre_state.average_wear = wear
        state = model.update(snapshot)
    assert state.wear_rate_per_lap is not None
    assert state.estimated_remaining_tyre_life_laps is not None
    assert state.confidence == "high"
