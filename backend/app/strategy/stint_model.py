from __future__ import annotations

from app.schemas.strategy import FuelState, StintState, TyreStrategyState
from app.schemas.telemetry import TelemetrySnapshot
from app.telemetry.event_detector import _player_in_pits


class StintModel:
    def __init__(self) -> None:
        self.last_pit_lap = 0
        self._was_in_pits = False

    def update(self, snapshot: TelemetrySnapshot, fuel_state: FuelState, tyre_state: TyreStrategyState) -> StintState:
        lap = snapshot.player.lap_number if snapshot.player else None
        in_pits = _player_in_pits(snapshot)
        if self._was_in_pits and not in_pits and lap is not None:
            self.last_pit_lap = lap
        self._was_in_pits = in_pits
        current_stint_lap = lap - self.last_pit_lap if lap is not None else None
        fuel_end = int(lap + fuel_state.fuel_laps_remaining) if lap is not None and fuel_state.fuel_laps_remaining is not None else None
        tyre_end = int(lap + tyre_state.estimated_remaining_tyre_life_laps) if lap is not None and tyre_state.estimated_remaining_tyre_life_laps is not None else None
        recommended = min([v for v in [fuel_end, tyre_end] if v is not None], default=None)
        return StintState(
            current_stint_lap=current_stint_lap,
            last_pit_lap=self.last_pit_lap,
            fuel_limited_stint_end_lap=fuel_end,
            tyre_limited_stint_end_lap=tyre_end,
            recommended_stint_end_lap=recommended,
        )
