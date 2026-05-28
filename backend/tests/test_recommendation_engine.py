from __future__ import annotations

from app.schemas.strategy import FuelState, PitWindowState, StrategyAssumptions, StintState, TyreStrategyState
from app.strategy.recommendation_engine import RecommendationEngine
from app.telemetry.mock_collector import MockTelemetryCollector


def test_recommends_pit_this_lap_when_window_closes() -> None:
    snapshot = MockTelemetryCollector().poll_once()
    snapshot.player.lap_number = 20
    rec = RecommendationEngine(StrategyAssumptions()).update(
        snapshot,
        FuelState(fuel_laps_remaining=4, fuel_per_lap_liters=3, valid_laps_observed=3, valid_laps_required=3, confidence="high"),
        TyreStrategyState(tyre_risk_level="low"),
        StintState(),
        PitWindowState(latest_safe_pit_lap=20),
        snapshot.competitors,
    )
    assert rec.type.value == "pit_this_lap"


def test_holds_when_models_do_not_have_enough_clean_laps() -> None:
    snapshot = MockTelemetryCollector().poll_once()
    snapshot.player.lap_number = 20

    rec = RecommendationEngine(StrategyAssumptions()).update(
        snapshot,
        FuelState(fuel_laps_remaining=1, fuel_per_lap_liters=3, valid_laps_observed=1, valid_laps_required=3, confidence="low"),
        TyreStrategyState(estimated_remaining_tyre_life_laps=1, tyre_risk_level="high", observed_laps=1, laps_required=3, confidence="low"),
        StintState(),
        PitWindowState(latest_safe_pit_lap=20),
        snapshot.competitors,
    )

    assert rec.type.value == "hold_strategy"
    assert "fuel_model_collecting_laps" in rec.reason_codes
    assert "tyre_model_collecting_laps" in rec.reason_codes


def test_nearby_competitor_does_not_trigger_without_verified_pit_window() -> None:
    snapshot = MockTelemetryCollector().poll_once()
    competitor = next(car for car in snapshot.competitors if not car.is_player)
    competitor.threat_level = "high"

    rec = RecommendationEngine(StrategyAssumptions()).update(
        snapshot,
        FuelState(confidence="low"),
        TyreStrategyState(tyre_risk_level="unknown", confidence="low"),
        StintState(),
        PitWindowState(traffic_risk_after_stop="low"),
        snapshot.competitors,
    )

    assert rec.type.value == "hold_strategy"
