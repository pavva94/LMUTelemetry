from __future__ import annotations

from app.schemas.strategy import FuelState, StrategyAssumptions, StintState, TyreStrategyState
from app.schemas.telemetry import CompetitorState
from app.strategy.pit_window_model import PitWindowModel
from app.telemetry.mock_collector import MockTelemetryCollector


def test_pit_window_open() -> None:
    snapshot = MockTelemetryCollector().poll_once()
    snapshot.player.lap_number = 12
    snapshot.session.yellow_flag_state = "0"
    snapshot.session.game_phase = "5"
    state = PitWindowModel(StrategyAssumptions()).update(
        snapshot,
        FuelState(fuel_laps_remaining=6),
        TyreStrategyState(estimated_remaining_tyre_life_laps=6),
        StintState(fuel_limited_stint_end_lap=18, tyre_limited_stint_end_lap=20),
    )
    assert state.earliest_viable_pit_lap == 15
    assert state.latest_safe_pit_lap == 17
    assert state.optimal_pit_lap == 17


def test_optimal_pit_lap_uses_fuel_range_instead_of_current_lap_plus_two() -> None:
    snapshot = MockTelemetryCollector().poll_once()
    snapshot.player.lap_number = 6
    snapshot.session.yellow_flag_state = "0"
    snapshot.session.game_phase = "5"
    state = PitWindowModel(StrategyAssumptions()).update(
        snapshot,
        FuelState(fuel_laps_remaining=14.29, fuel_per_lap_liters=4.2),
        TyreStrategyState(estimated_remaining_tyre_life_laps=20),
        StintState(fuel_limited_stint_end_lap=20, tyre_limited_stint_end_lap=26),
    )
    assert state.earliest_viable_pit_lap == 17
    assert state.latest_safe_pit_lap == 19
    assert state.optimal_pit_lap == 19


def test_tyre_limit_can_trigger_the_stop() -> None:
    snapshot = MockTelemetryCollector().poll_once()
    snapshot.player.lap_number = 10
    snapshot.session.yellow_flag_state = "0"
    snapshot.session.game_phase = "5"
    state = PitWindowModel(StrategyAssumptions()).update(
        snapshot,
        FuelState(fuel_laps_remaining=15),
        TyreStrategyState(estimated_remaining_tyre_life_laps=5),
        StintState(fuel_limited_stint_end_lap=25, tyre_limited_stint_end_lap=15),
    )
    assert state.optimal_pit_lap == 14
    assert "tyres limit the stint" in state.explanation[0]


def test_virtual_energy_limit_drives_pit_window() -> None:
    snapshot = MockTelemetryCollector().poll_once()
    snapshot.player.lap_number = 10
    snapshot.session.yellow_flag_state = "0"
    snapshot.session.game_phase = "5"
    state = PitWindowModel(StrategyAssumptions()).update(
        snapshot,
        FuelState(fuel_laps_remaining=15),
        TyreStrategyState(estimated_remaining_tyre_life_laps=12),
        StintState(fuel_limited_stint_end_lap=25, virtual_energy_limited_stint_end_lap=16, tyre_limited_stint_end_lap=22),
    )
    assert state.latest_safe_pit_lap == 15
    assert state.optimal_pit_lap == 15
    assert "virtual energy limit the stint" in state.explanation[0]


def test_numeric_fcy_state_moves_recommendation_to_current_lap() -> None:
    snapshot = MockTelemetryCollector().poll_once()
    snapshot.player.lap_number = 10
    snapshot.session.game_phase = "6"
    snapshot.session.yellow_flag_state = "4"
    state = PitWindowModel(StrategyAssumptions()).update(
        snapshot,
        FuelState(fuel_laps_remaining=8),
        TyreStrategyState(estimated_remaining_tyre_life_laps=10),
        StintState(fuel_limited_stint_end_lap=18, tyre_limited_stint_end_lap=20),
    )
    assert state.latest_safe_pit_lap == 17
    assert state.optimal_pit_lap == 10
    assert state.safety_car_pit_recommendation is True


def test_rejoin_position_uses_player_relative_gaps_and_reports_missing_data() -> None:
    snapshot = MockTelemetryCollector().poll_once()
    snapshot.player.lap_number = 12
    snapshot.player.position = 3
    snapshot.session.yellow_flag_state = "green"
    snapshot.session.game_phase = "green"
    snapshot.competitors = [
        CompetitorState(vehicle_id=1, is_player=True, position=3, gap_to_player=0),
        CompetitorState(vehicle_id=2, driver_name="A", position=4, gap_to_player=5),
        CompetitorState(vehicle_id=3, driver_name="B", position=5, gap_to_player=20),
        CompetitorState(vehicle_id=4, driver_name="C", position=6, gap_to_player=35),
    ]
    state = PitWindowModel(StrategyAssumptions(pit_loss_seconds=28)).update(
        snapshot, FuelState(fuel_laps_remaining=6), TyreStrategyState(), StintState(fuel_limited_stint_end_lap=18)
    )
    assert state.projected_rejoin_position == 5
    assert state.undercut_targets == ["A", "B"]

    for competitor in snapshot.competitors:
        competitor.gap_to_player = None
    unavailable = PitWindowModel(StrategyAssumptions()).update(
        snapshot, FuelState(fuel_laps_remaining=6), TyreStrategyState(), StintState(fuel_limited_stint_end_lap=18)
    )
    assert unavailable.projected_rejoin_position is None
    assert unavailable.traffic_risk_after_stop == "unknown"
