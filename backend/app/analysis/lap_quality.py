from __future__ import annotations

import math
import statistics
from typing import Any


def apply_lap_quality(laps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Apply the shared completed-lap eligibility contract in place."""
    candidates: list[float] = []
    for lap in laps:
        value = lap.get("lap_time")
        if (
            isinstance(value, (int, float))
            and math.isfinite(float(value))
            and 40.0 <= float(value) <= 900.0
            and not lap.get("in_pit")
            and not lap.get("under_yellow")
            and lap.get("valid_lap") is not False
            and lap.get("timing_source") != "partial_samples"
        ):
            candidates.append(float(value))
    normal = statistics.median(candidates) if len(candidates) >= 3 else None

    for lap in laps:
        reasons: list[str] = []
        value = lap.get("lap_time")
        if not isinstance(value, (int, float)) or not math.isfinite(float(value)):
            reasons.append("lap_time_unavailable")
        elif not 40.0 <= float(value) <= 900.0:
            reasons.append("lap_time_outside_40_900_seconds")
        elif normal is not None and not normal * 0.75 <= float(value) <= normal * 1.8:
            reasons.append("lap_time_outside_session_pace_band")
        if lap.get("timing_source") == "partial_samples":
            reasons.append("incomplete_lap")
        if lap.get("in_pit"):
            reasons.append("pit_lap")
        if lap.get("under_yellow"):
            reasons.append("yellow_flag_lap")
        if lap.get("valid_lap") is False and not reasons:
            reasons.append("source_marked_invalid")
        lap["valid_lap"] = not reasons
        lap["invalid_reasons"] = reasons
    return laps
