from __future__ import annotations

from app.schemas.strategy import EnergyState, FuelState, TyreStrategyState
from app.strategy.stint_model import StintModel
from app.telemetry.mock_collector import MockTelemetryCollector


def _set_player_in_pits(snapshot, value: bool) -> None:
    next(car for car in snapshot.competitors if car.is_player).in_pits = value


def test_stint_end_uses_minimum_limit() -> None:
    snapshot = MockTelemetryCollector().poll_once()
    snapshot.player.lap_number = 10
    state = StintModel().update(
        snapshot,
        FuelState(fuel_laps_remaining=5),
        TyreStrategyState(estimated_remaining_tyre_life_laps=8),
    )
    assert state.recommended_stint_end_lap == 15


def test_virtual_energy_can_limit_the_stint_before_fuel() -> None:
    snapshot = MockTelemetryCollector().poll_once()
    snapshot.player.lap_number = 10
    state = StintModel().update(
        snapshot,
        FuelState(fuel_laps_remaining=8),
        TyreStrategyState(estimated_remaining_tyre_life_laps=10),
        EnergyState(virtual_energy_laps_remaining=4.8),
    )
    assert state.virtual_energy_limited_stint_end_lap == 14
    assert state.recommended_stint_end_lap == 14


def test_stint_resets_after_pit_exit() -> None:
    collector = MockTelemetryCollector()
    model = StintModel()

    on_track = collector.poll_once()
    on_track.player.lap_number = 8
    _set_player_in_pits(on_track, False)
    assert model.update(on_track, FuelState(), TyreStrategyState()).current_stint_lap == 8

    pit_entry = collector.poll_once()
    pit_entry.player.lap_number = 8
    _set_player_in_pits(pit_entry, True)
    assert model.update(pit_entry, FuelState(), TyreStrategyState()).current_stint_lap == 0

    pit_exit = collector.poll_once()
    pit_exit.player.lap_number = 9
    _set_player_in_pits(pit_exit, False)
    state = model.update(pit_exit, FuelState(fuel_laps_remaining=5), TyreStrategyState())
    assert state.last_pit_lap == 9
    assert state.current_stint_lap == 0
