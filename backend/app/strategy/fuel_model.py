from __future__ import annotations

from collections import deque

from app.schemas.strategy import FuelState, StrategyAssumptions
from app.schemas.telemetry import TelemetrySnapshot
from app.telemetry.event_detector import _player_in_pits, _under_yellow


def _valid_lap_time(value: float | None) -> float | None:
    return value if value is not None and 40.0 <= value <= 900.0 else None


class FuelModel:
    def __init__(self, assumptions: StrategyAssumptions):
        self.assumptions = assumptions
        self._lap_start_fuel: float | None = None
        self._last_lap: int | None = None
        self._valid_usage: deque[float] = deque(maxlen=5)
        self._last_lap_usage: float | None = None
        self._was_in_pits = False

    def _clear_stint_usage(self) -> None:
        self._valid_usage.clear()
        self._last_lap_usage = None

    def _reset_stint(self, lap: int, fuel_liters: float) -> None:
        self._last_lap = lap
        self._lap_start_fuel = fuel_liters
        self._clear_stint_usage()

    def update(self, snapshot: TelemetrySnapshot) -> FuelState:
        player = snapshot.player
        if not player or player.fuel_liters is None:
            return FuelState(confidence="low")
        lap = player.lap_number or 0
        in_pits = _player_in_pits(snapshot)
        if in_pits and not self._was_in_pits:
            self._clear_stint_usage()
        if self._was_in_pits and not in_pits:
            self._reset_stint(lap, player.fuel_liters)
        self._was_in_pits = in_pits
        if self._last_lap is None:
            self._last_lap = lap
            self._lap_start_fuel = player.fuel_liters
        elif lap > self._last_lap:
            if self._lap_start_fuel is not None:
                used = self._lap_start_fuel - player.fuel_liters
                if used > 0 and not _player_in_pits(snapshot) and not _under_yellow(snapshot) and not player.lap_invalidated:
                    self._last_lap_usage = used
                    self._valid_usage.append(used)
            self._last_lap = lap
            self._lap_start_fuel = player.fuel_liters

        fuel_per_lap = (sum(self._valid_usage) / len(self._valid_usage)) if self._valid_usage else None
        estimated_laps = None
        normal_lap_time = self._normal_lap_time(snapshot)
        if snapshot.session and snapshot.session.time_remaining and normal_lap_time:
            estimated_laps = snapshot.session.time_remaining / normal_lap_time
        if not fuel_per_lap:
            return FuelState(
                estimated_laps_remaining=estimated_laps,
                stint_laps_observed=len(self._valid_usage),
                confidence="low",
            )
        fuel_laps = player.fuel_liters / fuel_per_lap
        required = ((estimated_laps or 0) * fuel_per_lap) + self.assumptions.fuel_safety_margin_liters
        delta = player.fuel_liters - required
        save = abs(delta) / estimated_laps if delta < 0 and estimated_laps else None
        confidence = "high" if len(self._valid_usage) >= 3 else "medium" if len(self._valid_usage) >= 2 else "low"
        return FuelState(
            last_lap_fuel_used_liters=round(self._last_lap_usage, 3) if self._last_lap_usage is not None else None,
            fuel_per_lap_liters=round(fuel_per_lap, 3),
            fuel_laps_remaining=round(fuel_laps, 2),
            estimated_laps_remaining=round(estimated_laps, 2) if estimated_laps is not None else None,
            required_fuel_to_finish=round(required, 2),
            fuel_delta_to_finish=round(delta, 2),
            recommended_fuel_save_per_lap=round(save, 3) if save else None,
            stint_laps_observed=len(self._valid_usage),
            confidence=confidence,
        )

    def _normal_lap_time(self, snapshot: TelemetrySnapshot) -> float | None:
        player_car = next((car for car in snapshot.competitors if car.is_player), None)
        for value in (
            _valid_lap_time(player_car.last_lap_time if player_car else None),
            _valid_lap_time(player_car.estimated_lap_time if player_car else None),
            _valid_lap_time(player_car.best_lap_time if player_car else None),
        ):
            if value is not None:
                return value
        field_times = sorted(
            value
            for car in snapshot.competitors
            for value in [_valid_lap_time(car.last_lap_time), _valid_lap_time(car.estimated_lap_time), _valid_lap_time(car.best_lap_time)]
            if value is not None
        )
        if field_times:
            return field_times[len(field_times) // 2]
        return _valid_lap_time(self.assumptions.normal_lap_time)
