from __future__ import annotations

from app.schemas.strategy import FuelState, StrategyAssumptions, StintState, TyreStrategyState
from app.strategy.pit_window_model import PitWindowModel
from app.telemetry.mock_collector import MockTelemetryCollector


def test_pit_window_open() -> None:
    snapshot = MockTelemetryCollector().poll_once()
    snapshot.player.lap_number = 12
    state = PitWindowModel(StrategyAssumptions()).update(
        snapshot,
        FuelState(fuel_laps_remaining=6),
        TyreStrategyState(estimated_remaining_tyre_life_laps=6),
        StintState(fuel_limited_stint_end_lap=18, tyre_limited_stint_end_lap=20),
    )
    assert state.earliest_viable_pit_lap == 12
    assert state.latest_safe_pit_lap == 17
