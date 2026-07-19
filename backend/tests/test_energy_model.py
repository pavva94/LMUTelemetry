from __future__ import annotations

from app.schemas.strategy import FuelState
from app.strategy.energy_model import EnergyModel
from app.telemetry.mock_collector import MockTelemetryCollector


def test_energy_model_learns_virtual_energy_range_and_fuel_ratio() -> None:
    collector = MockTelemetryCollector()
    model = EnergyModel()
    state = None
    for lap, energy in [(1, 1.0), (2, 0.97), (3, 0.94), (4, 0.91)]:
        snapshot = collector.poll_once()
        snapshot.player.lap_number = lap
        snapshot.player.hybrid_state.virtual_energy_fraction = energy
        snapshot.player.fuel_liters = 85 * energy
        snapshot.player.fuel_capacity_liters = 100
        snapshot.player.lap_invalidated = False
        snapshot.session.yellow_flag_state = "green"
        snapshot.session.game_phase = "green"
        next(car for car in snapshot.competitors if car.is_player).in_pits = False
        state = model.update(snapshot, FuelState(fuel_capacity_liters=100, estimated_laps_remaining=10))

    assert state is not None
    assert state.virtual_energy_per_lap == 0.03
    assert state.virtual_energy_laps_remaining == 30.33
    assert state.full_virtual_energy_stint_laps == 33.33
    assert state.fuel_to_virtual_energy_ratio == 0.85
    assert state.confidence == "medium"


def test_energy_model_is_unavailable_when_channel_is_missing() -> None:
    snapshot = MockTelemetryCollector().poll_once()
    snapshot.player.hybrid_state.virtual_energy_fraction = None
    state = EnergyModel().update(snapshot, FuelState())
    assert state.virtual_energy_laps_remaining is None
    assert "virtual_energy_unavailable" in state.reason_codes
