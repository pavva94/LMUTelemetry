from __future__ import annotations

from statistics import median, pstdev

from app.schemas.strategy import EnergyState, FuelState
from app.schemas.telemetry import TelemetrySnapshot
from app.telemetry.event_detector import _player_in_pits, _under_yellow


class EnergyModel:
    """Learns the WEC virtual-energy budget as a first-class stint resource."""

    VALID_LAPS_REQUIRED = 3

    def __init__(self) -> None:
        self._lap_start_energy: float | None = None
        self._last_lap: int | None = None
        self._valid_usage: list[float] = []
        self._last_lap_usage: float | None = None
        self._was_in_pits = False
        self._ratio_samples: list[float] = []

    def _reset_stint(self, lap: int, energy: float) -> None:
        self._last_lap = lap
        self._lap_start_energy = energy

    def update(self, snapshot: TelemetrySnapshot, fuel_state: FuelState) -> EnergyState:
        player = snapshot.player
        energy = player.hybrid_state.virtual_energy_fraction if player and player.hybrid_state else None
        if player is None or energy is None:
            return EnergyState(valid_laps_required=self.VALID_LAPS_REQUIRED, reason_codes=["virtual_energy_unavailable"])

        reason_codes: list[str] = []
        lap = player.lap_number or 0
        in_pits = _player_in_pits(snapshot)
        if self._was_in_pits and not in_pits:
            self._reset_stint(lap, energy)
        self._was_in_pits = in_pits

        capacity = fuel_state.fuel_capacity_liters
        if capacity and capacity > 0 and player.fuel_liters is not None and energy > 0.05:
            ratio = (player.fuel_liters / capacity) / energy
            if 0.1 <= ratio <= 1.5:
                self._ratio_samples.append(ratio)
                self._ratio_samples = self._ratio_samples[-200:]

        if self._last_lap is None:
            self._reset_stint(lap, energy)
        elif lap > self._last_lap:
            if self._lap_start_energy is not None:
                used = self._lap_start_energy - energy
                if used > 0 and not in_pits and not _under_yellow(snapshot) and not player.lap_invalidated:
                    baseline = median(self._valid_usage[-10:]) if len(self._valid_usage) >= 3 else None
                    if baseline is not None and not baseline * 0.5 <= used <= baseline * 1.5:
                        reason_codes.append("virtual_energy_lap_rejected_outlier")
                    else:
                        self._last_lap_usage = used
                        self._valid_usage.append(used)
                        reason_codes.append("virtual_energy_lap_accepted")
                else:
                    reason_codes.append("virtual_energy_lap_rejected_invalid_or_pit")
            self._reset_stint(lap, energy)

        recent = self._valid_usage[-5:]
        per_lap = sum(recent) / len(recent) if recent else None
        observed = len(self._valid_usage)
        ratio = median(self._ratio_samples) if self._ratio_samples else None
        common = dict(
            current_virtual_energy_fraction=round(energy, 4),
            last_lap_virtual_energy_used=round(self._last_lap_usage, 4) if self._last_lap_usage is not None else None,
            fuel_to_virtual_energy_ratio=round(ratio, 3) if ratio is not None else None,
            valid_laps_observed=observed,
            valid_laps_required=self.VALID_LAPS_REQUIRED,
        )
        if not per_lap or observed < self.VALID_LAPS_REQUIRED:
            return EnergyState(**common, reason_codes=reason_codes + ["virtual_energy_history_below_three_laps"])

        estimated_laps = fuel_state.estimated_laps_remaining
        required = estimated_laps * per_lap if estimated_laps is not None else None
        delta = energy - required if required is not None else None
        stddev = pstdev(recent) if len(recent) >= 2 else None
        return EnergyState(
            **common,
            virtual_energy_per_lap=round(per_lap, 5),
            virtual_energy_use_stddev=round(stddev, 5) if stddev is not None else None,
            virtual_energy_laps_remaining=round(energy / per_lap, 2),
            full_virtual_energy_stint_laps=round(1 / per_lap, 2),
            required_virtual_energy_to_finish=round(required, 4) if required is not None else None,
            virtual_energy_delta_to_finish=round(delta, 4) if delta is not None else None,
            confidence="high" if observed >= 5 else "medium",
            reason_codes=reason_codes + ["virtual_energy_recent_five_lap_mean"],
        )
