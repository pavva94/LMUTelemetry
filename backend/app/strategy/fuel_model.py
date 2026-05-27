from __future__ import annotations

from collections import deque

from app.schemas.strategy import FuelState, StrategyAssumptions
from app.schemas.telemetry import TelemetrySnapshot
from app.telemetry.event_detector import _player_in_pits, _under_yellow


class FuelModel:
    def __init__(self, assumptions: StrategyAssumptions):
        self.assumptions = assumptions
        self._lap_start_fuel: float | None = None
        self._last_lap: int | None = None
        self._valid_usage: deque[float] = deque(maxlen=5)

    def update(self, snapshot: TelemetrySnapshot) -> FuelState:
        player = snapshot.player
        if not player or player.fuel_liters is None:
            return FuelState(confidence="low")
        lap = player.lap_number or 0
        if self._last_lap is None:
            self._last_lap = lap
            self._lap_start_fuel = player.fuel_liters
        elif lap > self._last_lap:
            if self._lap_start_fuel is not None:
                used = self._lap_start_fuel - player.fuel_liters
                if used > 0 and not _player_in_pits(snapshot) and not _under_yellow(snapshot) and not player.lap_invalidated:
                    self._valid_usage.append(used)
            self._last_lap = lap
            self._lap_start_fuel = player.fuel_liters

        fuel_per_lap = (sum(self._valid_usage) / len(self._valid_usage)) if self._valid_usage else None
        estimated_laps = None
        if snapshot.session and snapshot.session.time_remaining and self.assumptions.normal_lap_time:
            estimated_laps = snapshot.session.time_remaining / self.assumptions.normal_lap_time
        if not fuel_per_lap:
            return FuelState(estimated_laps_remaining=estimated_laps, confidence="low")
        fuel_laps = player.fuel_liters / fuel_per_lap
        required = ((estimated_laps or 0) * fuel_per_lap) + self.assumptions.fuel_safety_margin_liters
        delta = player.fuel_liters - required
        save = abs(delta) / estimated_laps if delta < 0 and estimated_laps else None
        confidence = "high" if len(self._valid_usage) >= 3 else "medium" if len(self._valid_usage) >= 2 else "low"
        return FuelState(
            fuel_per_lap_liters=round(fuel_per_lap, 3),
            fuel_laps_remaining=round(fuel_laps, 2),
            estimated_laps_remaining=round(estimated_laps, 2) if estimated_laps is not None else None,
            required_fuel_to_finish=round(required, 2),
            fuel_delta_to_finish=round(delta, 2),
            recommended_fuel_save_per_lap=round(save, 3) if save else None,
            confidence=confidence,
        )
