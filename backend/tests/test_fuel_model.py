from __future__ import annotations

from app.schemas.strategy import StrategyAssumptions
from app.strategy.fuel_model import FuelModel
from app.telemetry.mock_collector import MockTelemetryCollector


def test_fuel_model_learns_consumption() -> None:
    collector = MockTelemetryCollector()
    model = FuelModel(StrategyAssumptions(normal_lap_time=1))
    state = None
    collector.started_at -= 214 * 5
    for _ in range(4):
        snapshot = collector.poll_once()
        snapshot.player.lap_number += _
        snapshot.player.fuel_liters -= _ * 3.2
        state = model.update(snapshot)
    assert state is not None
    assert state.confidence in {"low", "medium", "high"}


def test_fuel_too_low_delta() -> None:
    collector = MockTelemetryCollector()
    snapshot = collector.poll_once()
    snapshot.player.fuel_liters = 5
    snapshot.session.time_remaining = 1000
    model = FuelModel(StrategyAssumptions(normal_lap_time=100, fuel_safety_margin_liters=2))
    model._valid_usage.extend([3.0, 3.1, 3.2])
    state = model.update(snapshot)
    assert state.fuel_delta_to_finish is not None
    assert state.fuel_delta_to_finish < 0
