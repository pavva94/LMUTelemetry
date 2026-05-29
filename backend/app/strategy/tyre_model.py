from __future__ import annotations

from app.schemas.strategy import StrategyAssumptions, TyreStrategyState
from app.schemas.telemetry import TelemetrySnapshot
from app.telemetry.event_detector import _player_in_pits


class TyreModel:
    LAPS_REQUIRED = 3

    def __init__(self, assumptions: StrategyAssumptions):
        self.assumptions = assumptions
        self._last_lap: int | None = None
        self._last_wear: float | None = None
        self._wear_rates: list[float] = []
        self._was_in_pits = False

    def _reset_stint(self, lap: int | None, avg_wear: float) -> None:
        self._last_lap = lap
        self._last_wear = avg_wear

    def update(self, snapshot: TelemetrySnapshot) -> TyreStrategyState:
        player = snapshot.player
        tyre = player.tyre_state if player else None
        avg_wear = tyre.average_wear if tyre else None
        lap = player.lap_number if player else None
        reason_codes: list[str] = []
        if avg_wear is None:
            return TyreStrategyState(laps_required=self.LAPS_REQUIRED, reason_codes=["tyre_wear_unavailable"])
        in_pits = _player_in_pits(snapshot)
        if self._was_in_pits and not in_pits:
            self._reset_stint(lap, avg_wear)
        self._was_in_pits = in_pits
        if lap is not None and self._last_lap is None:
            self._last_lap = lap
            self._last_wear = avg_wear
        elif lap is not None and self._last_lap is not None and lap > self._last_lap and self._last_wear is not None:
            rate = (avg_wear - self._last_wear) / max(1, lap - self._last_lap)
            if 0 < rate < 0.2:
                self._wear_rates.append(rate)
            self._last_lap = lap
            self._last_wear = avg_wear
        wear_rate = sum(self._wear_rates) / len(self._wear_rates) if self._wear_rates else None
        observed_laps = len(self._wear_rates)
        confidence = "high" if observed_laps >= self.LAPS_REQUIRED else "medium" if observed_laps >= 2 else "low"
        remaining = (self.assumptions.max_tyre_wear - avg_wear) / wear_rate if wear_rate else None
        if avg_wear >= self.assumptions.max_tyre_wear:
            risk = "high"
            reason_codes.append("tyre_wear_above_limit")
        elif remaining is not None and remaining <= 3:
            risk = "high"
            reason_codes.append("tyre_life_below_three_laps")
        elif remaining is not None and remaining <= 7:
            risk = "medium"
            reason_codes.append("tyre_life_below_seven_laps")
        else:
            risk = "low" if wear_rate is not None else "unknown"
            reason_codes.append("tyre_state_stable" if risk == "low" else "insufficient_tyre_history")
        avg_temp = tyre.average_temp_c if tyre else None
        if avg_temp is not None and (avg_temp < 65 or avg_temp > 105):
            reason_codes.append("tyre_temperature_outside_nominal_window")
            risk = "high" if risk == "medium" else risk
        return TyreStrategyState(
            average_wear=round(avg_wear, 3),
            wear_rate_per_lap=round(wear_rate, 4) if wear_rate else None,
            estimated_remaining_tyre_life_laps=round(remaining, 1) if remaining is not None else None,
            pace_degradation_per_lap=round((wear_rate or 0) * 18.0, 3) if wear_rate else None,
            tyre_risk_level=risk,
            confidence=confidence,
            observed_laps=observed_laps,
            laps_required=self.LAPS_REQUIRED,
            reason_codes=reason_codes,
        )
