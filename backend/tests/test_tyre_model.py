from __future__ import annotations

from app.schemas.strategy import StrategyAssumptions
from app.strategy.tyre_model import TyreModel
from app.telemetry.mock_collector import MockTelemetryCollector


def _set_player_in_pits(snapshot, value: bool) -> None:
    next(car for car in snapshot.competitors if car.is_player).in_pits = value


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


def test_tyre_model_keeps_session_wear_history_after_pit_exit() -> None:
    collector = MockTelemetryCollector()
    model = TyreModel(StrategyAssumptions(max_tyre_wear=0.75))

    for lap, wear in [(1, 0.96), (2, 0.94), (3, 0.92)]:
        snapshot = collector.poll_once()
        snapshot.player.lap_number = lap
        snapshot.player.tyre_state.average_wear = wear
        _set_player_in_pits(snapshot, False)
        state = model.update(snapshot)

    pit = collector.poll_once()
    pit.player.lap_number = 3
    pit.player.tyre_state.average_wear = 0.92
    _set_player_in_pits(pit, True)
    model.update(pit)

    exit_pit = collector.poll_once()
    exit_pit.player.lap_number = 3
    exit_pit.player.tyre_state.average_wear = 0.99
    _set_player_in_pits(exit_pit, False)
    model.update(exit_pit)

    next_lap = collector.poll_once()
    next_lap.player.lap_number = 4
    next_lap.player.tyre_state.average_wear = 0.97
    _set_player_in_pits(next_lap, False)
    state = model.update(next_lap)

    assert state.observed_laps == 3
    assert state.confidence == "high"
