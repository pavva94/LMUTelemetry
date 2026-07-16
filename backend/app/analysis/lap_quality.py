from __future__ import annotations

import math
import statistics
from typing import Any


# A missed invalidation can make a reset or a cut look like a remarkably quick
# completed lap.  Ten percent still leaves room for a genuine step forward,
# while rejecting the discontinuities that otherwise poison pace, coaching and
# personal-best calculations.  Do not derive this from the candidate lap.
FAST_LAP_RATIO = 0.90
# Slow incident, recovery and unobserved pit laps can be just as harmful to
# coaching comparisons.  This remains deliberately wider than the fast-side
# guard: a driver can lose meaningful time and still have a useful clean lap.
SLOW_LAP_RATIO = 1.20


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
        elif normal is not None and not normal * FAST_LAP_RATIO <= float(value) <= normal * SLOW_LAP_RATIO:
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
