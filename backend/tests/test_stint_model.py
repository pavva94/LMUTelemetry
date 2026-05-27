from __future__ import annotations

from app.schemas.strategy import FuelState, TyreStrategyState
from app.strategy.stint_model import StintModel
from app.telemetry.mock_collector import MockTelemetryCollector


def test_stint_end_uses_minimum_limit() -> None:
    snapshot = MockTelemetryCollector().poll_once()
    snapshot.player.lap_number = 10
    state = StintModel().update(
        snapshot,
        FuelState(fuel_laps_remaining=5),
        TyreStrategyState(estimated_remaining_tyre_life_laps=8),
    )
    assert state.recommended_stint_end_lap == 15
