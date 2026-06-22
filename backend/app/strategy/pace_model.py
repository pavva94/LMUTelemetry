from __future__ import annotations

from statistics import median

from app.schemas.session import LapSummary
from app.schemas.strategy import PaceState, StrategyAssumptions


class PaceModel:
    def __init__(self, assumptions: StrategyAssumptions) -> None:
        self.assumptions = assumptions
        self._clean_lap_times: list[float] = []

    def update(self, completed_lap: LapSummary | None = None) -> PaceState:
        reason_codes: list[str] = []
        if completed_lap is not None:
            accepted, reason = self._accept_lap(completed_lap)
            reason_codes.append(reason)
            if accepted is not None:
                self._clean_lap_times.append(accepted)
                self._clean_lap_times = self._clean_lap_times[-30:]

        laps = self._clean_lap_times
        if not laps:
            fallback = self._valid_lap_time(self.assumptions.normal_lap_time)
            return PaceState(
                weighted_recent_pace=round(fallback, 3) if fallback is not None else None,
                confidence="low",
                reason_codes=reason_codes + ["pace_assumption_fallback"],
            )

        last_lap = laps[-1]
        last_7 = self._average(laps[-7:])
        last_10 = self._average(laps[-10:])
        weighted = self._weighted_recent_pace(last_lap, last_7, last_10, len(laps))
        trend = self._trend(laps, last_7, last_10)
        confidence = "high" if len(laps) >= 10 else "medium" if len(laps) >= 7 else "low"

        if len(laps) < 7:
            reason_codes.append("pace_history_below_seven_laps")
        elif len(laps) < 10:
            reason_codes.append("pace_history_below_ten_laps")
        else:
            reason_codes.append("pace_history_ready")
        if trend is not None and trend > 0.15:
            reason_codes.append("recent_pace_slower_than_long_window")

        return PaceState(
            last_lap_time=round(last_lap, 3),
            last_7_lap_average=round(last_7, 3) if last_7 is not None else None,
            last_10_lap_average=round(last_10, 3) if last_10 is not None else None,
            weighted_recent_pace=round(weighted, 3) if weighted is not None else None,
            pace_trend_seconds_per_lap=round(trend, 3) if trend is not None else None,
            pace_degradation_per_lap=round(max(0.0, trend or 0.0), 3),
            sample_laps=len(laps),
            confidence=confidence,
            reason_codes=reason_codes,
        )

    def _accept_lap(self, lap: LapSummary) -> tuple[float | None, str]:
        if lap.valid_lap is False:
            return None, "pace_lap_rejected_invalid"
        if lap.in_pit:
            return None, "pace_lap_rejected_pit"
        if lap.under_yellow:
            return None, "pace_lap_rejected_yellow"
        lap_time = self._valid_lap_time(lap.lap_time)
        if lap_time is None:
            return None, "pace_lap_rejected_time"
        if len(self._clean_lap_times) >= 3:
            baseline = median(self._clean_lap_times[-10:])
            if baseline and (lap_time < baseline * 0.75 or lap_time > baseline * 1.35):
                return None, "pace_lap_rejected_outlier"
        return lap_time, "pace_lap_accepted"

    @staticmethod
    def _valid_lap_time(value: float | None) -> float | None:
        return value if value is not None and 40.0 <= value <= 900.0 else None

    @staticmethod
    def _average(values: list[float]) -> float | None:
        return sum(values) / len(values) if values else None

    @staticmethod
    def _weighted_recent_pace(last_lap: float, last_7: float | None, last_10: float | None, sample_laps: int) -> float | None:
        if sample_laps >= 10 and last_7 is not None and last_10 is not None:
            return last_7 * 0.6 + last_10 * 0.3 + last_lap * 0.1
        if sample_laps >= 7 and last_7 is not None:
            return last_7 * 0.75 + last_lap * 0.25
        return last_7 or last_10 or last_lap

    @staticmethod
    def _trend(laps: list[float], last_7: float | None, last_10: float | None) -> float | None:
        window = laps[-10:]
        if len(window) < 4:
            return None
        x_mean = (len(window) - 1) / 2
        y_mean = sum(window) / len(window)
        denominator = sum((index - x_mean) ** 2 for index in range(len(window)))
        if denominator <= 0:
            return None
        return sum((index - x_mean) * (value - y_mean) for index, value in enumerate(window)) / denominator
