from __future__ import annotations

from app.schemas.strategy import StrategyAssumptions
from app.strategy.fuel_model import FuelModel
from app.telemetry.mock_collector import MockTelemetryCollector


def _set_player_in_pits(snapshot, value: bool) -> None:
    next(car for car in snapshot.competitors if car.is_player).in_pits = value


def _make_green(snapshot) -> None:
    snapshot.session.yellow_flag_state = "green"
    snapshot.session.game_phase = "green"
    snapshot.player.lap_invalidated = False


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
    assert state.fuel_capacity_liters == 90


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


def test_fuel_model_resets_usage_on_pit_stint_boundary() -> None:
    collector = MockTelemetryCollector()
    model = FuelModel(StrategyAssumptions(normal_lap_time=100))

    first = collector.poll_once()
    first.player.lap_number = 1
    first.player.fuel_liters = 100
    _set_player_in_pits(first, False)
    _make_green(first)
    model.update(first)

    second = collector.poll_once()
    second.player.lap_number = 2
    second.player.fuel_liters = 97
    _set_player_in_pits(second, False)
    _make_green(second)
    model.update(second)

    pit_entry = collector.poll_once()
    pit_entry.player.lap_number = 2
    pit_entry.player.fuel_liters = 96
    _set_player_in_pits(pit_entry, True)
    _make_green(pit_entry)
    assert model.update(pit_entry).fuel_per_lap_liters is None

    pit_exit = collector.poll_once()
    pit_exit.player.lap_number = 2
    pit_exit.player.fuel_liters = 110
    _set_player_in_pits(pit_exit, False)
    _make_green(pit_exit)
    assert model.update(pit_exit).fuel_per_lap_liters is None

    next_lap = collector.poll_once()
    next_lap.player.lap_number = 3
    next_lap.player.fuel_liters = 106
    _set_player_in_pits(next_lap, False)
    _make_green(next_lap)
    after_pit_lap_1 = model.update(next_lap)
    assert after_pit_lap_1.last_lap_fuel_used_liters == 4
    assert after_pit_lap_1.fuel_per_lap_liters is None
    assert after_pit_lap_1.valid_laps_observed == 2

    later_lap = collector.poll_once()
    later_lap.player.lap_number = 4
    later_lap.player.fuel_liters = 102
    _set_player_in_pits(later_lap, False)
    _make_green(later_lap)
    session_estimate = model.update(later_lap)
    assert session_estimate.valid_laps_observed == 3
    assert session_estimate.fuel_per_lap_liters is not None


def test_fuel_model_requires_enough_valid_session_laps_for_estimates() -> None:
    collector = MockTelemetryCollector()
    model = FuelModel(StrategyAssumptions(normal_lap_time=100))
    state = None
    for lap, fuel in [(1, 100), (2, 97), (3, 94), (4, 91)]:
        snapshot = collector.poll_once()
        snapshot.player.lap_number = lap
        snapshot.player.fuel_liters = fuel
        _set_player_in_pits(snapshot, False)
        _make_green(snapshot)
        state = model.update(snapshot)
    assert state is not None
    assert state.valid_laps_observed == 3
    assert state.fuel_per_lap_liters == 3
    assert state.fuel_laps_remaining is not None


def test_fuel_model_uses_all_valid_session_laps_not_only_recent_window() -> None:
    collector = MockTelemetryCollector()
    model = FuelModel(StrategyAssumptions(normal_lap_time=100))
    state = None
    for lap, fuel in [(1, 100), (2, 99), (3, 98), (4, 97), (5, 96), (6, 95), (7, 88)]:
        snapshot = collector.poll_once()
        snapshot.player.lap_number = lap
        snapshot.player.fuel_liters = fuel
        _set_player_in_pits(snapshot, False)
        _make_green(snapshot)
        state = model.update(snapshot)
    assert state is not None
    assert state.valid_laps_observed == 6
    assert state.fuel_per_lap_liters == 2
