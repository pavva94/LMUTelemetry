from __future__ import annotations

from app.schemas.session import LapSummary
from app.schemas.strategy import StrategyAssumptions, StrategyState
from app.strategy.pace_model import PaceModel


def lap(time: float, *, valid: bool = True, pit: bool = False, yellow: bool = False) -> LapSummary:
    return LapSummary(lap_number=1, lap_time=time, valid_lap=valid, in_pit=pit, under_yellow=yellow)


def test_pace_model_filters_invalid_pit_yellow_and_outlier_laps() -> None:
    model = PaceModel(StrategyAssumptions(normal_lap_time=100))

    for value in [100, 101, 102, 103]:
        state = model.update(lap(value))
    state = model.update(lap(104, valid=False))
    state = model.update(lap(105, pit=True))
    state = model.update(lap(106, yellow=True))
    state = model.update(lap(160))

    assert state.sample_laps == 4
    assert state.last_lap_time == 103
    assert "pace_lap_rejected_outlier" in state.reason_codes


def test_pace_model_calculates_recent_windows_and_weighted_pace() -> None:
    model = PaceModel(StrategyAssumptions(normal_lap_time=100))
    state = None
    for value in [100, 101, 102, 103, 104, 105, 106, 107, 108, 109]:
        state = model.update(lap(value))

    assert state is not None
    assert state.sample_laps == 10
    assert state.last_7_lap_average == 106
    assert state.last_10_lap_average == 104.5
    assert state.weighted_recent_pace == 105.85
    assert state.pace_trend_seconds_per_lap == 1.0
    assert state.confidence == "high"


def test_strategy_state_serializes_pace_section() -> None:
    state = StrategyState()
    payload = state.model_dump()

    assert "pace" in payload
    assert payload["pace"]["confidence"] == "low"
