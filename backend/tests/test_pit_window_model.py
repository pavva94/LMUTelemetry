from __future__ import annotations

from app.schemas.strategy import FuelState, StrategyAssumptions, StintState, TyreStrategyState
from app.schemas.telemetry import CompetitorState
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
