from __future__ import annotations

import math
import statistics
from collections import Counter
from itertools import combinations
from typing import Any

from app.analysis.lap_quality import apply_lap_quality
from app.reports.models import Confidence, Finding, Recommendation, ReportAnalysis


WHEELS = ("fl", "fr", "rl", "rr")


def number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    return None


def median(values: list[float]) -> float | None:
    return statistics.median(values) if values else None


def mad(values: list[float]) -> float | None:
    center = median(values)
    return median([abs(value - center) for value in values]) if center is not None else None


def trimmed_mean(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    trim = int(len(ordered) * 0.1) if len(ordered) >= 10 else 0
    kept = ordered[trim:len(ordered) - trim] if trim else ordered
    return statistics.fmean(kept)


def theil_sen(points: list[tuple[float, float]]) -> float | None:
    """Robust median pairwise slope; deterministic cap avoids quadratic endurance costs."""
    if len(points) < 3:
        return None
    if len(points) > 80:
        step = (len(points) - 1) / 79
        points = [points[round(index * step)] for index in range(80)]
    slopes = [(yb - ya) / (xb - xa) for (xa, ya), (xb, yb) in combinations(points, 2) if abs(xb - xa) > 1e-9]
    return median(slopes)


def confidence(valid_count: int, completeness: float = 1.0, comparable: int | None = None) -> Confidence:
    count = min(valid_count, comparable) if comparable is not None else valid_count
    if count <= 0 or completeness <= 0:
        return "unavailable"
    if count >= 10 and completeness >= 0.85:
        return "high"
    if count >= 5 and completeness >= 0.6:
        return "medium"
    return "low"


class SessionTypeAnalyzer:
    @staticmethod
    def analyze(session: dict[str, Any]) -> tuple[str, str]:
        raw = str(session.get("session_type") or "unknown").strip().lower()
        if any(token in raw for token in ("qual", "quali")):
            return "qualifying", "qualifying_execution"
        if any(token in raw for token in ("race", "gara")):
            return "race", "race_progression"
        if any(token in raw for token in ("practice", "warm", "test", "prove", "free")):
            return "practice", "practice_development"
        return "practice", "practice_development"


class LapDetailAnalyzer:
    """Enrich cached lap summaries from the already-cleaned review sample stream."""
    @staticmethod
    def _transition_count(rows: list[dict[str, Any]], key: str) -> int:
        count, previous = 0, False
        for row in rows:
            current = bool(row.get(key))
            if current and not previous:
                count += 1
            previous = current
        return count

    def enrich(self, review: dict[str, Any]) -> list[dict[str, Any]]:
        grouped: dict[str, list[dict[str, Any]]] = {}
        for sample in review.get("telemetry_samples") or []:
            lap_number = sample.get("lap_number")
            if lap_number is not None:
                grouped.setdefault(str(lap_number), []).append(sample)
        result: list[dict[str, Any]] = []
        for source in review.get("laps") or []:
            lap = dict(source)
            rows = grouped.get(str(lap.get("lap_number")), [])
            if not rows:
                result.append(lap); continue
            def values(key: str) -> list[float]:
                return [value for row in rows if (value := number(row.get(key))) is not None]
            def first(key: str) -> float | None:
                return next((value for row in rows if (value := number(row.get(key))) is not None), None)
            def last(key: str) -> float | None:
                return next((value for row in reversed(rows) if (value := number(row.get(key))) is not None), None)
            def wheel_values(prefix: str) -> list[float]:
                return [value for row in rows for wheel in WHEELS if (value := number(row.get(f"{prefix}_{wheel}"))) is not None]
            compound = next((row.get(f"tyre_compound_{wheel}") for row in rows for wheel in WHEELS if row.get(f"tyre_compound_{wheel}") is not None), None)
            gaps = values("time_behind_next")
            gap_semantics_reliable = bool(gaps) and all(value >= 0 for value in gaps)
            traffic_gap = median(gaps) if gap_semantics_reliable else None
            traffic = "unknown" if traffic_gap is None else "heavy" if traffic_gap < .5 else "moderate" if traffic_gap < 1 else "light" if traffic_gap < 2 else "clear"
            offtrack = sum(any(number(row.get(f"surface_type_{wheel}")) in {2, 3, 4} for wheel in WHEELS) for row in rows)
            # YellowFlagState is defined by LMU. Sector flag values are coded
            # states and must not be treated as booleans without a verified map.
            yellow_affected = any((number(row.get("yellow_flag_state")) or 0) in {1, 2, 3, 4} for row in rows)
            lap.update({
                "soc_start": first("soc"), "soc_end": last("soc"), "virtual_energy_start": first("virtual_energy"), "virtual_energy_end": last("virtual_energy"),
                "virtual_energy_used": (first("virtual_energy") - last("virtual_energy")) if first("virtual_energy") is not None and last("virtual_energy") is not None else None,
                "tyre_compound": compound, "minimum_speed": min(values("speed_kph"), default=None), "top_speed": max(values("speed_kph"), default=number(lap.get("top_speed"))),
                "average_speed": trimmed_mean(values("speed_kph")), "max_lateral_g": max((abs(value) for value in values("g_force_lat")), default=None),
                "max_longitudinal_g": max((abs(value) for value in values("g_force_long")), default=None), "max_brake_force": max(wheel_values("brake_force"), default=None),
                "max_brake_temp": max(wheel_values("brake_temp"), default=None), "max_tyre_temp": max(wheel_values("tyre_temp"), default=None),
                "average_tyre_pressure": trimmed_mean(wheel_values("tyre_pressure")), "tc_interventions": self._transition_count(rows, "tc_active"),
                "abs_interventions": self._transition_count(rows, "abs_active"), "yellow_affected": yellow_affected, "under_yellow": bool(lap.get("under_yellow")) or yellow_affected,
                "speed_limiter_affected": any(bool(row.get("speed_limiter")) for row in rows), "traffic_status": traffic, "time_behind_next": traffic_gap,
                "offtrack_samples": offtrack, "impact_magnitude": max(values("last_impact_magnitude"), default=None),
                "anti_stall": any(bool(row.get("anti_stall_active")) for row in rows), "overheating": any((number(row.get("overheating_state")) or 0) > 0 for row in rows),
                "track_temp": trimmed_mean(values("track_temp")), "ambient_temp": trimmed_mean(values("ambient_temp")),
            })
            result.append(lap)
        previous_impact: float | None = None
        for lap in result:
            impact = number(lap.get("impact_magnitude"))
            if impact is not None and impact == previous_impact:
                lap["impact_magnitude"] = None
            elif impact is not None:
                previous_impact = impact
        result.sort(key=lambda row: (number(row.get("lap_number")) is None, number(row.get("lap_number")) or math.inf))
        return result


class SessionDataValidator:
    REQUIRED = ("lap_number", "lap_time", "valid_lap")
    OPTIONAL_SAMPLE = ("game_time", "speed_kph", "fuel_liters", "throttle", "brake", "steering", "position")

    def analyze(self, review: dict[str, Any]) -> dict[str, Any]:
        laps = [dict(lap) for lap in review.get("laps") or []]
        apply_lap_quality(laps)
        samples = review.get("telemetry_samples") or []
        duplicates = 0
        discontinuities = 0
        impossible_samples = 0
        seen: set[tuple[Any, Any]] = set()
        previous_time: float | None = None
        sample_lap_flags: Counter[int] = Counter()
        for sample in samples:
            timestamp = number(sample.get("game_time"))
            key = (timestamp, sample.get("lap_number"))
            if timestamp is not None and key in seen:
                duplicates += 1
            seen.add(key)
            if timestamp is not None and previous_time is not None and (timestamp < previous_time or timestamp - previous_time > 30):
                discontinuities += 1
            if timestamp is not None:
                previous_time = timestamp
            speed = number(sample.get("speed_kph"))
            fuel = number(sample.get("fuel_liters"))
            acceleration = number(sample.get("g_force_lat"))
            anomalous = (speed is not None and not 0 <= speed <= 500) or (fuel is not None and not 0 <= fuel <= 500) or (acceleration is not None and abs(acceleration) > 10)
            if anomalous:
                impossible_samples += 1
                lap_number = number(sample.get("lap_number"))
                if lap_number is not None:
                    sample_lap_flags[int(lap_number)] += 1

        included: list[dict[str, Any]] = []
        excluded: list[dict[str, Any]] = []
        impacts = [value for lap in laps if (value := number(lap.get("impact_magnitude"))) is not None and value > 0]
        impact_center, impact_mad = median(impacts), mad(impacts)
        for lap in laps:
            lap_number = int(number(lap.get("lap_number")) or 0)
            reasons = list(lap.get("invalid_reasons") or [])
            if number(lap.get("lap_number")) is None: reasons.append("lap_number_unavailable")
            if lap.get("speed_limiter_affected") and not lap.get("in_pit"): reasons.append("speed_limiter_activation")
            if (number(lap.get("offtrack_samples")) or 0) > 0: reasons.append("off_track_surface")
            impact = number(lap.get("impact_magnitude"))
            severe_impact = impact is not None and impact_center is not None and impact > impact_center + max((impact_mad or 0) * 3, impact_center * .5)
            if severe_impact: reasons.append("large_impact")
            if lap.get("anti_stall"): reasons.append("anti_stall_activation")
            if lap.get("traffic_status") == "heavy": reasons.append("strong_traffic_effect")
            if sample_lap_flags[lap_number]:
                reasons.append("sensor_anomaly")
            if reasons:
                lap["valid_lap"] = False
                lap["invalid_reasons"] = list(dict.fromkeys(reasons))
            row = {"lap_number": lap_number, "reasons": list(dict.fromkeys(reasons))}
            if reasons or lap.get("valid_lap") is not True:
                excluded.append(row)
            else:
                included.append(row)

        sample_fields = {key for sample in samples for key, value in sample.items() if value is not None}
        missing = [field for field in self.OPTIONAL_SAMPLE if field not in sample_fields]
        sample_completeness = 0.0 if not samples else sum(field in sample_fields for field in self.OPTIONAL_SAMPLE) / len(self.OPTIONAL_SAMPLE)
        overall = confidence(len(included), sample_completeness if samples else 0.45)
        return {
            "laps": laps,
            "included_laps": included,
            "excluded_laps": excluded,
            "filters": ["shared lap-quality contract", "finite timing 40-900 s", "pit/yellow/incomplete exclusion", "sensor anomaly audit"],
            "duplicate_samples": duplicates,
            "timestamp_discontinuities": discontinuities,
            "impossible_samples": impossible_samples,
            "missing_channels": missing,
            "warnings": list(review.get("warnings") or []),
            "sample_count_analyzed": len(samples),
            "sample_completeness": sample_completeness,
            "overall_confidence": overall,
            "classification": {
                "valid_timed": len(included), "excluded": len(excluded),
                "pit": sum(bool(lap.get("in_pit")) for lap in laps),
                "incomplete": sum("incomplete_lap" in (lap.get("invalid_reasons") or []) for lap in laps),
                "formation": "unavailable: no explicit formation-lap marker",
                "cooldown": "unavailable: cooldown intent is not recorded",
                "traffic_affected": "unavailable unless opponent gap evidence exists",
            },
        }


class LapAnalyzer:
    def analyze(self, laps: list[dict[str, Any]]) -> dict[str, Any]:
        clean = [lap for lap in laps if lap.get("valid_lap") is True and not lap.get("in_pit") and number(lap.get("lap_time")) is not None]
        times = [number(lap["lap_time"]) for lap in clean]
        valid_times = [value for value in times if value is not None]
        best_lap = min(clean, key=lambda lap: number(lap.get("lap_time")) or math.inf) if clean else None
        sectors = {
            key: min((number(lap.get(key)) for lap in clean if number(lap.get(key)) is not None), default=None)
            for key in ("sector1", "sector2", "sector3")
        }
        theoretical = sum(sectors.values()) if all(value is not None for value in sectors.values()) else None
        trend = theil_sen([(float(index), value) for index, value in enumerate(valid_times, 1)])
        typical = median(valid_times)
        dispersion = mad(valid_times)
        within = None
        if typical and valid_times:
            within = sum(abs(value - typical) <= 0.005 * typical for value in valid_times) / len(valid_times)
        def best_consecutive(size: int) -> float | None:
            candidates = []
            for index in range(len(clean) - size + 1):
                window = clean[index:index + size]
                lap_numbers = [int(number(row.get("lap_number")) or -1000) for row in window]
                if all(lap_numbers[i + 1] == lap_numbers[i] + 1 for i in range(size - 1)):
                    candidates.append(statistics.fmean(number(row["lap_time"]) for row in window))
            return min(candidates, default=None)
        q1, q3 = (statistics.quantiles(valid_times, n=4, method="inclusive")[0], statistics.quantiles(valid_times, n=4, method="inclusive")[2]) if len(valid_times) >= 2 else (None, None)
        return {
            "timeline": [{"lap_number": lap.get("lap_number"), "lap_time": number(lap.get("lap_time")), "valid": lap.get("valid_lap") is True, "in_pit": bool(lap.get("in_pit"))} for lap in laps],
            "clean_laps": clean,
            "valid_count": len(clean),
            "best_lap": number(best_lap.get("lap_time")) if best_lap else None,
            "best_lap_number": best_lap.get("lap_number") if best_lap else None,
            "median_pace": typical,
            "trimmed_mean_pace": trimmed_mean(valid_times),
            "standard_deviation": statistics.pstdev(valid_times) if len(valid_times) >= 2 else None,
            "mad": dispersion,
            "pace_range": max(valid_times) - min(valid_times) if len(valid_times) >= 2 else None,
            "within_half_percent": within,
            "interquartile_range": q3 - q1 if q1 is not None and q3 is not None else None,
            "best_three_lap_average": best_consecutive(3), "best_five_lap_average": best_consecutive(5),
            "total_improvement": valid_times[0] - valid_times[-1] if len(valid_times) >= 2 else None,
            "trend_seconds_per_lap": trend,
            "theoretical_best": theoretical,
            "best_sectors": sectors,
            "theoretical_gap": (number(best_lap.get("lap_time")) - theoretical) if best_lap and theoretical is not None else None,
            "realistic_potential": theoretical if theoretical is not None and len(clean) >= 3 else (number(best_lap.get("lap_time")) if best_lap else None),
            "potential_note": "compatible-sector composite" if theoretical is not None and len(clean) >= 3 else "best actual lap; sector compatibility unavailable",
            "confidence": confidence(len(clean), 1.0),
        }


class StintAnalyzer:
    def analyze(self, laps: list[dict[str, Any]]) -> list[dict[str, Any]]:
        groups: list[list[dict[str, Any]]] = []
        current: list[dict[str, Any]] = []
        for lap in laps:
            boundary = bool(lap.get("in_pit")) or (number(lap.get("fuel_added")) or 0) > 0.5
            if boundary and current:
                groups.append(current)
                current = []
            if not lap.get("in_pit"):
                current.append(lap)
        if current:
            groups.append(current)
        results = []
        for index, group in enumerate(groups, 1):
            clean = [lap for lap in group if lap.get("valid_lap") is True and number(lap.get("lap_time")) is not None]
            times = [number(lap["lap_time"]) for lap in clean]
            values = [value for value in times if value is not None]
            fuel = [number(lap.get("fuel_used")) for lap in clean]
            tyre_end = [median([value for wheel in WHEELS if (value := number(lap.get(f"tyre_wear_end_{wheel}"))) is not None]) for lap in clean]
            tyre_points = [(float(i), value) for i, value in enumerate(tyre_end, 1) if value is not None]
            results.append({
                "stint": index,
                "start_lap": group[0].get("lap_number"),
                "end_lap": group[-1].get("lap_number"),
                "lap_count": len(group),
                "clean_laps": len(clean),
                "initial_fuel": number(group[0].get("fuel_start")),
                "final_fuel": number(group[-1].get("fuel_end")),
                "fuel_used": sum(value for value in fuel if value is not None) or None,
                "fuel_per_lap": median([value for value in fuel if value is not None and value > 0]),
                "best_lap": min(values) if values else None,
                "median_pace": median(values),
                "average_clean_pace": trimmed_mean(values),
                "pace_variability": mad(values),
                "standard_deviation": statistics.pstdev(values) if len(values) >= 2 else None,
                "best_three_lap_average": min((statistics.fmean(values[i:i + 3]) for i in range(len(values) - 2)), default=None),
                "raw_trend": theil_sen([(float(i), value) for i, value in enumerate(values, 1)]),
                "tyre_wear_trend": theil_sen(tyre_points),
                "traffic_exposure": None,
                "confidence": confidence(len(clean), 0.85),
            })
        return results


class FuelAnalyzer:
    def analyze(self, clean: list[dict[str, Any]], stints: list[dict[str, Any]]) -> dict[str, Any]:
        consumptions = [value for lap in clean if (value := number(lap.get("fuel_used"))) is not None and value > 0]
        comparable = [(fuel, time) for lap in clean if (fuel := number(lap.get("fuel_start"))) is not None and (time := number(lap.get("lap_time"))) is not None]
        slope = theil_sen(sorted(comparable)) if len(comparable) >= 6 else None
        reset_count = sum(1 for lap in clean if (number(lap.get("fuel_added")) or 0) > 0.5)
        return {
            "available": bool(consumptions),
            "start_fuel": next((number(lap.get("fuel_start")) for lap in clean if number(lap.get("fuel_start")) is not None), None),
            "end_fuel": next((number(lap.get("fuel_end")) for lap in reversed(clean) if number(lap.get("fuel_end")) is not None), None),
            "total_used": sum(consumptions) if consumptions else None,
            "mean_per_lap": trimmed_mean(consumptions),
            "median_per_lap": median(consumptions),
            "variability": mad(consumptions),
            "lap_time_effect_seconds_per_liter": slope,
            "effect_note": "robust pairwise estimate; fuel remains correlated with tyre age and track evolution" if slope is not None else "unavailable: fewer than six comparable fuel-and-pace laps",
            "resets_or_refuels": reset_count,
            "confidence": confidence(len(consumptions), 0.8, len(comparable)) if consumptions else "unavailable",
            "by_stint": [{key: stint.get(key) for key in ("stint", "initial_fuel", "final_fuel", "fuel_used", "fuel_per_lap")} for stint in stints],
        }


class TyreAnalyzer:
    def analyze(self, clean: list[dict[str, Any]], stints: list[dict[str, Any]], fuel: dict[str, Any]) -> dict[str, Any]:
        wear_rows = []
        for lap in clean:
            values = [value for wheel in WHEELS if (value := number(lap.get(f"tyre_wear_end_{wheel}"))) is not None]
            if values:
                wear_rows.append({"lap": lap.get("lap_number"), "wear": median(values), "wheels": values})
        raw_slopes = [number(stint.get("raw_trend")) for stint in stints if stint.get("clean_laps", 0) >= 5 and number(stint.get("raw_trend")) is not None]
        degradation = median([value for value in raw_slopes if value is not None])
        return {
            "available": bool(wear_rows),
            "wear_by_lap": wear_rows,
            "degradation_seconds_per_lap": degradation,
            "degradation_inferred": degradation is not None,
            "degradation_note": "inferred from within-stint clean-pace trend; fuel, traffic and track evolution cannot be fully separated" if degradation is not None else "unavailable: no stint has at least five comparable clean laps",
            "confidence": confidence(sum(1 for stint in stints if stint.get("clean_laps", 0) >= 5), 0.6) if degradation is not None else "unavailable",
            "temperature_available": any(any(number(lap.get(f"tyre_temp_{wheel}")) is not None for wheel in WHEELS) for lap in clean),
            "pressure_available": any(any(number(lap.get(f"tyre_pressure_{wheel}")) is not None for wheel in WHEELS) for lap in clean),
        }


class PitStopAnalyzer:
    def analyze(self, events: list[dict[str, Any]]) -> dict[str, Any]:
        rows = []
        for index, event in enumerate(events, 1):
            total = number(event.get("total_pit_loss"))
            rows.append({"stop": index, "lap": event.get("lap_number"), "total_duration": total, "stationary_time": number(event.get("stationary_time")), "confidence": "high" if total is not None else "low"})
        return {"count": len(rows), "events": rows, "position_effect_available": False, "position_effect_note": "opponent pit-cycle state is not recorded reliably"}


class TrafficAnalyzer:
    def analyze(self, laps: list[dict[str, Any]], available_fields: dict[str, Any]) -> dict[str, Any]:
        has_position = bool(available_fields.get("position")) and any(number(lap.get("position")) is not None for lap in laps)
        if not has_position:
            return {"available": False, "events": [], "note": "opponent gaps, identifiers and reliable position data are unavailable"}
        events = []
        previous = None
        for lap in laps:
            position = number(lap.get("position"))
            if previous is not None and position is not None and position != previous:
                events.append({"lap": lap.get("lap_number"), "change": int(previous - position), "type": "uncertain position change", "confidence": "low", "evidence": "player position changed; pit-cycle and retirement causes cannot be separated"})
            if position is not None:
                previous = position
        return {"available": True, "events": events, "note": "position changes are not classified as overtakes without opponent gap and pit-state evidence"}


class RaceProgressAnalyzer:
    def analyze(self, laps: list[dict[str, Any]], session: dict[str, Any]) -> dict[str, Any]:
        positions = [{"lap": lap.get("lap_number"), "position": int(value)} for lap in laps if (value := number(lap.get("position"))) is not None]
        start = positions[0]["position"] if positions else None
        finish = number(session.get("final_position"))
        if finish is None and positions:
            finish = float(positions[-1]["position"])
        return {
            "available": bool(positions), "positions": positions, "start_position": start,
            "finish_position": int(finish) if finish is not None else None,
            "best_position": min((row["position"] for row in positions), default=None),
            "worst_position": max((row["position"] for row in positions), default=None),
            "positions_gained": (start - int(finish)) if start is not None and finish is not None else None,
            "note": "position progression is measured; causes of changes remain uncertain without opponent pit-state evidence" if positions else "position channel unavailable",
        }


class QualifyingAnalyzer:
    def analyze(self, laps: list[dict[str, Any]], lap: dict[str, Any], tyre: dict[str, Any]) -> dict[str, Any]:
        sequences = []
        for row in laps:
            role = "push" if row.get("valid_lap") is True else "pit/out/cooldown or invalid"
            sequences.append({"lap": row.get("lap_number"), "role": role, "lap_time": number(row.get("lap_time"))})
        return {"sequences": sequences, "preparation_confidence": "low", "tyre_readiness_available": tyre.get("temperature_available", False), "realistic_potential": lap.get("realistic_potential"), "note": "push candidates use lap validity and pace; exact preparation intent is not recorded"}


class PracticeAnalyzer:
    def analyze(self, stints: list[dict[str, Any]], lap: dict[str, Any]) -> dict[str, Any]:
        phases = []
        for stint in stints:
            count = int(stint.get("lap_count") or 0)
            label = "longer run pattern" if count >= 8 else "short run pattern"
            phases.append({"stint": stint.get("stint"), "pattern": label, "confidence": "medium" if count >= 3 else "low"})
        return {"phases": phases, "pace_development": lap.get("trend_seconds_per_lap"), "note": "run patterns are detected from stint length and fuel boundaries; setup intent is not claimed"}


class CornerAnalyzer:
    def analyze(self, samples: list[dict[str, Any]]) -> dict[str, Any]:
        has_distance = any(number(row.get("lap_distance")) is not None for row in samples)
        return {"available": False, "sections": [], "note": "no shared corner map and compatible reference-lap segmentation are available" if has_distance else "lap-distance/corner-map data are unavailable"}


class LapComparisonAnalyzer:
    def analyze(self, clean: list[dict[str, Any]], samples: list[dict[str, Any]]) -> dict[str, Any]:
        if not clean:
            return {"available": False, "laps": [], "note": "no valid laps"}
        ordered = sorted(clean, key=lambda row: number(row.get("lap_time")) or math.inf)
        typical = median([number(row.get("lap_time")) for row in clean if number(row.get("lap_time")) is not None])
        representative = min(clean, key=lambda row: abs((number(row.get("lap_time")) or math.inf) - (typical or 0)))
        selected = list(dict.fromkeys([ordered[0].get("lap_number"), representative.get("lap_number"), ordered[-1].get("lap_number")]))
        distance = any(number(row.get("lap_distance")) is not None for row in samples)
        traces = []
        if distance:
            for lap_number in selected:
                rows = [row for row in samples if str(row.get("lap_number")) == str(lap_number) and number(row.get("lap_distance")) is not None]
                if len(rows) > 250:
                    step = (len(rows) - 1) / 249
                    rows = [rows[round(index * step)] for index in range(250)]
                traces.append({"lap": lap_number, "points": [{key: number(row.get(key)) for key in ("lap_distance", "speed_kph", "throttle", "brake", "gear", "steering", "rpm", "g_force_long", "g_force_lat")} for row in rows]})
        return {"available": distance and len(selected) >= 2, "laps": selected, "traces": traces, "note": "traces synchronized by lap distance" if distance else "lap-distance samples are unavailable; trace comparison omitted"}


class SessionOverviewAnalyzer:
    def analyze(self, review: dict[str, Any], laps: list[dict[str, Any]], lap: dict[str, Any], stints: list[dict[str, Any]], fuel: dict[str, Any], pits: dict[str, Any]) -> dict[str, Any]:
        session, summary = review.get("session") or {}, review.get("summary") or {}
        samples = review.get("telemetry_samples") or []
        def first_sample(key: str) -> float | None: return next((value for row in samples if (value := number(row.get(key))) is not None), None)
        def last_sample(key: str) -> float | None: return next((value for row in reversed(samples) if (value := number(row.get(key))) is not None), None)
        compounds = list(dict.fromkeys(str(row.get("tyre_compound")) for row in laps if row.get("tyre_compound") is not None))
        soc_values = [(number(row.get("soc_start")), number(row.get("soc_end"))) for row in laps]
        fastest_stint = min((row for row in stints if row.get("median_pace") is not None), key=lambda row: row["median_pace"], default=None)
        return {
            "duration_seconds": number(summary.get("duration_seconds")) or ((number(session.get("ended_at_game_time")) or 0) - (number(session.get("started_at_game_time")) or 0) or None),
            "completed_laps": len(laps), "valid_laps": lap.get("valid_count"), "total_distance_km": number(summary.get("total_distance_km")),
            "pit_entries": pits.get("count", 0), "pit_exits": sum(event.get("total_duration") is not None for event in pits.get("events") or []),
            "starting_compound": compounds[0] if compounds else None, "compounds_used": compounds,
            "starting_fuel": first_sample("fuel_liters") if first_sample("fuel_liters") is not None else fuel.get("start_fuel"), "ending_fuel": last_sample("fuel_liters") if last_sample("fuel_liters") is not None else fuel.get("end_fuel"),
            "starting_soc": first_sample("soc") if first_sample("soc") is not None else next((start for start, _end in soc_values if start is not None), None), "ending_soc": last_sample("soc") if last_sample("soc") is not None else next((end for _start, end in reversed(soc_values) if end is not None), None),
            "finish_status": session.get("classified_status") or session.get("finish_status"), "final_position": session.get("final_position"), "final_class_position": session.get("final_class_position"),
            "fastest_sustained_stint": fastest_stint.get("stint") if fastest_stint else None, "fastest_sustained_pace": fastest_stint.get("median_pace") if fastest_stint else None,
        }


class SystemAnalyzer:
    def analyze(self, samples: list[dict[str, Any]], laps: list[dict[str, Any]]) -> dict[str, Any]:
        def values(key: str) -> list[float]: return [value for row in samples if (value := number(row.get(key))) is not None]
        def wheel_values(prefix: str) -> list[float]: return [value for row in samples for wheel in WHEELS if (value := number(row.get(f"{prefix}_{wheel}"))) is not None]
        def span(key: str) -> dict[str, Any]:
            rows = values(key); return {"available": bool(rows), "start": rows[0] if rows else None, "end": rows[-1] if rows else None, "minimum": min(rows) if rows else None, "maximum": max(rows) if rows else None, "change": rows[-1] - rows[0] if rows else None}
        tyre = wheel_values("tyre_temp"); brakes = wheel_values("brake_temp")
        return {
            "energy": {"soc": span("soc"), "virtual_energy": span("virtual_energy"), "regen_rate": span("regen_rate"), "note": "Observed states only; deployment targets require vehicle-specific configuration."},
            "thermal": {"tyre_peak": max(tyre, default=None), "brake_peak": max(brakes, default=None), "oil": span("engine_oil_temp"), "water": span("engine_water_temp"), "note": "Observed extremes; no ideal or warning threshold is claimed without vehicle-specific targets."},
            "environment": {key: span(key) for key in ("track_temp", "ambient_temp", "wind_speed", "wind_heading", "minimum_path_wetness", "offpath_wetness", "cloud_darkness")},
            "platform": {"front_ride_height": span("front_ride_height"), "rear_ride_height": span("rear_ride_height"), "vertical_g": span("g_force_vert"), "note": "Absolute aero coefficients and bottoming thresholds are unavailable without vehicle definitions."},
        }


class EventAnalyzer:
    def analyze(self, samples: list[dict[str, Any]], laps: list[dict[str, Any]], pits: dict[str, Any], audit: dict[str, Any]) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        for event in pits.get("events") or []:
            events.append({"lap": event.get("lap"), "type": "pit transit", "severity": "information", "evidence": f"entry-to-exit {event.get('total_duration')} s", "confidence": event.get("confidence")})
        previous_impact: float | None = None
        for lap in laps:
            lap_number = lap.get("lap_number")
            impact = number(lap.get("impact_magnitude"))
            for condition, event_type, evidence in [
                ((number(lap.get("offtrack_samples")) or 0) > 0, "off-track surface", f"{lap.get('offtrack_samples')} sampled contacts"),
                (impact is not None and impact > 0 and impact != previous_impact, "impact", f"magnitude {lap.get('impact_magnitude')}"),
                (bool(lap.get("anti_stall")), "anti-stall", "anti-stall channel active"), (bool(lap.get("overheating")), "overheating state", "overheating channel active"),
                (bool(lap.get("yellow_affected")), "flag affected", "yellow or sector flag active"),
            ]:
                if condition:
                    events.append({"lap": lap_number, "type": "observed impact signal" if event_type == "impact" else event_type, "severity": "information" if event_type == "impact" else "warning", "evidence": evidence, "confidence": "medium" if event_type == "impact" else "high"})
            if impact is not None:
                previous_impact = impact
        if audit.get("timestamp_discontinuities"):
            events.append({"lap": None, "type": "telemetry dropout", "severity": "data quality", "evidence": f"{audit['timestamp_discontinuities']} timestamp discontinuities", "confidence": "high"})
        return events


class ChannelAvailabilityAnalyzer:
    def analyze(self, review: dict[str, Any]) -> list[dict[str, Any]]:
        rows = []
        for channel in review.get("channel_manifest") or []:
            mapped = channel.get("mapped_fields") or []
            rows.append({"channel": channel.get("table"), "frequency": channel.get("frequency"), "row_count": channel.get("row_count"), "unit": channel.get("unit"), "mapped_fields": ", ".join(mapped), "usage": "direct/derived" if mapped else "not used", "coverage": "indexed" if channel.get("row_count") else "empty", "filter": "full resolution for source metrics; downsampled only for presentation"})
        return rows


class LapTableBuilder:
    def build(self, laps: list[dict[str, Any]], lap_analysis: dict[str, Any], stints: list[dict[str, Any]]) -> list[dict[str, Any]]:
        best, typical = number(lap_analysis.get("best_lap")), number(lap_analysis.get("median_pace"))
        stint_by_lap: dict[str, int] = {}
        for stint in stints:
            start, end = int(number(stint.get("start_lap")) or 0), int(number(stint.get("end_lap")) or 0)
            for value in range(start, end + 1): stint_by_lap[str(value)] = int(stint["stint"])
        rows = []
        for source in laps:
            time = number(source.get("lap_time")); reasons = list(source.get("invalid_reasons") or [])
            labels = ["valid representative" if source.get("valid_lap") is True else "excluded"] + reasons
            for flag, label in [(source.get("in_pit"), "pit"), (source.get("yellow_affected"), "yellow"), ((number(source.get("offtrack_samples")) or 0) > 0, "off-track"), (source.get("traffic_status") in {"moderate", "heavy"}, "traffic")]:
                if flag: labels.append(label)
            rows.append({
                "lap": source.get("lap_number"), "lap_time": time, "gap_best": time - best if time is not None and best is not None else None, "gap_median": time - typical if time is not None and typical is not None else None,
                "sector1": number(source.get("sector1")), "sector2": number(source.get("sector2")), "sector3": number(source.get("sector3")), "classification": ", ".join(dict.fromkeys(labels)), "stint": stint_by_lap.get(str(source.get("lap_number"))),
                "compound": source.get("tyre_compound"), "fuel_start": number(source.get("fuel_start")), "fuel_end": number(source.get("fuel_end")), "fuel_used": number(source.get("fuel_used")),
                "soc_start": number(source.get("soc_start")), "soc_end": number(source.get("soc_end")), "energy_used": number(source.get("virtual_energy_used")), "top_speed": number(source.get("top_speed")), "average_speed": number(source.get("average_speed")),
                "minimum_speed": number(source.get("minimum_speed")), "max_lateral_g": number(source.get("max_lateral_g")), "max_longitudinal_g": number(source.get("max_longitudinal_g")), "max_brake_temp": number(source.get("max_brake_temp")), "max_tyre_temp": number(source.get("max_tyre_temp")),
                "average_tyre_pressure": number(source.get("average_tyre_pressure")), "tc": source.get("tc_interventions"), "abs": source.get("abs_interventions"), "traffic": source.get("traffic_status"), "offtrack": source.get("offtrack_samples"), "impact": number(source.get("impact_magnitude")),
            })
        return rows


class RecommendationSelector:
    def select(self, session_type: str, lap: dict[str, Any], fuel: dict[str, Any], tyre: dict[str, Any], pits: dict[str, Any], traffic: dict[str, Any]) -> list[Recommendation]:
        rows: list[Recommendation] = []
        if session_type == "practice":
            if tyre.get("confidence") in {"unavailable", "low"}:
                rows.append(Recommendation(1, "Confirm long-run degradation", tyre.get("degradation_note", "Insufficient comparable laps"), "Run at least eight clean consecutive laps with unchanged tyres and record fuel.", "Separates tyre trend from noise; no numerical gain can be supported yet.", "high", "Compare fuel-corrected early and late laps in the repeated run."))
            else:
                rows.append(Recommendation(1, "Validate the observed stint trend", f"Inferred change {tyre.get('degradation_seconds_per_lap'):.3f} s/lap.", "Repeat the same fuel and tyre-age window in a clean stint.", "Confirms whether the observed pace trend is repeatable.", tyre["confidence"], "Require a second comparable stint before changing setup."))
            rows.append(Recommendation(2, "Improve the evidence baseline", f"{lap.get('valid_count', 0)} representative laps passed validation.", "Prioritize a controlled run with consistent preparation and minimal traffic.", "Higher-confidence setup and driver conclusions.", lap.get("confidence", "low"), "Target ten valid comparable laps."))
        elif session_type == "qualifying":
            gap = lap.get("theoretical_gap")
            evidence = f"Best-to-theoretical gap is {gap:.3f} s." if gap is not None else "Sector splits are unavailable, so the remaining sector opportunity cannot be quantified."
            rows.append(Recommendation(1, "Standardize push-lap preparation", evidence, "Repeat the preparation sequence and preserve a clear gap before the push lap.", "More repeatable peak-lap execution; benefit unavailable without compatible sectors.", "medium" if gap is not None else "low", "Compare tyre state and first-sector time across two push attempts."))
            rows.append(Recommendation(2, "Protect valid peak attempts", f"{lap.get('valid_count', 0)} valid timed laps were available.", "Favor a repeatable first push before increasing aggression on the later attempt.", "Reduces the risk of ending without a representative lap.", "medium", "Track valid push rate and best-lap delta next qualifying session."))
        else:
            if pits.get("count"):
                durations = [row["total_duration"] for row in pits["events"] if row.get("total_duration") is not None]
                evidence = f"{len(durations)} timed pit transits were detected." if durations else "Pit passages were detected but timing is incomplete."
                rows.append(Recommendation(1, "Review pit execution", evidence, "Compare entry-to-exit phases and rehearse the slowest repeatable phase.", "Potential benefit cannot be isolated without stationary timing.", "medium" if len(durations) >= 2 else "low", "Record stationary phase and pit-cycle position state in the next race."))
            rows.append(Recommendation(1 if not rows else 2, "Stabilize representative race pace", f"Robust lap-time MAD is {lap['mad']:.3f} s." if lap.get("mad") is not None else "Too few clean laps for robust dispersion.", "Use clean-air laps as the pace baseline and flag traffic/pit laps separately.", "A clearer strategy baseline; numerical gain is not supportable from current data.", lap.get("confidence", "low"), "Compare the next race stint at similar fuel and tyre age."))
        return rows[:3]


class SessionAnalysisPipeline:
    METHODOLOGY_VERSION = "1.0"

    def analyze(self, review: dict[str, Any]) -> ReportAnalysis:
        session = dict(review.get("session") or {})
        session_type, structure = SessionTypeAnalyzer.analyze(session)
        enriched_review = dict(review)
        enriched_review["laps"] = LapDetailAnalyzer().enrich(review)
        audit = SessionDataValidator().analyze(enriched_review)
        laps = audit.pop("laps")
        lap = LapAnalyzer().analyze(laps)
        stints = StintAnalyzer().analyze(laps)
        fuel = FuelAnalyzer().analyze(lap["clean_laps"], stints)
        tyre = TyreAnalyzer().analyze(lap["clean_laps"], stints, fuel)
        pits = PitStopAnalyzer().analyze(review.get("pit_events") or [])
        traffic = TrafficAnalyzer().analyze(laps, review.get("available_fields") or {})
        race = RaceProgressAnalyzer().analyze(laps, session)
        qualifying = QualifyingAnalyzer().analyze(laps, lap, tyre)
        practice = PracticeAnalyzer().analyze(stints, lap)
        comparison = LapComparisonAnalyzer().analyze(lap["clean_laps"], review.get("telemetry_samples") or [])
        corners = CornerAnalyzer().analyze(review.get("telemetry_samples") or [])
        overview = SessionOverviewAnalyzer().analyze(review, laps, lap, stints, fuel, pits)
        systems = SystemAnalyzer().analyze(review.get("telemetry_samples") or [], laps)
        events = EventAnalyzer().analyze(review.get("telemetry_samples") or [], laps, pits, audit)
        channels = ChannelAvailabilityAnalyzer().analyze(review)
        lap_table = LapTableBuilder().build(laps, lap, stints)
        findings = self._findings(session_type, lap, fuel, tyre, race, pits)
        recommendations = RecommendationSelector().select(session_type, lap, fuel, tyre, pits, traffic)
        lap_public = {key: value for key, value in lap.items() if key != "clean_laps"}
        return ReportAnalysis(
            session=session, session_type=session_type, structure=structure, audit=audit, lap=lap_public,
            stints=stints, fuel=fuel, tyre=tyre, pits=pits, traffic=traffic, race_progress=race,
            qualifying=qualifying, practice=practice, comparison=comparison, corners=corners,
            overview=overview, systems=systems, lap_table=lap_table, events=events, channels=channels,
            findings=findings, recommendations=recommendations,
            methodology={"version": self.METHODOLOGY_VERSION, "statistics": ["median", "trimmed mean", "MAD", "Theil-Sen pairwise slope"], "principle": "Measured values and labeled inferences only; no external LLM."},
        )

    @staticmethod
    def _findings(session_type: str, lap: dict[str, Any], fuel: dict[str, Any], tyre: dict[str, Any], race: dict[str, Any], pits: dict[str, Any]) -> list[Finding]:
        rows = [Finding("representative_pace", lap.get("median_pace"), "s", lap.get("confidence", "low"), f"Median of {lap.get('valid_count', 0)} clean valid laps.", False)]
        if lap.get("trend_seconds_per_lap") is not None:
            rows.append(Finding("pace_trend", lap["trend_seconds_per_lap"], "s/lap", lap.get("confidence", "low"), "Theil-Sen trend across clean laps."))
        rows.append(Finding("fuel_effect", fuel.get("lap_time_effect_seconds_per_liter"), "s/L", fuel.get("confidence", "unavailable"), fuel.get("effect_note", "")))
        rows.append(Finding("tyre_degradation", tyre.get("degradation_seconds_per_lap"), "s/lap", tyre.get("confidence", "unavailable"), tyre.get("degradation_note", "")))
        if session_type == "race" and race.get("positions_gained") is not None:
            rows.append(Finding("positions_gained", race["positions_gained"], None, "medium", race["note"], False))
        elif session_type == "qualifying":
            rows.append(Finding("realistic_potential", lap.get("realistic_potential"), "s", lap.get("confidence", "low"), lap.get("potential_note", "")))
        elif pits.get("count"):
            rows.append(Finding("pit_stops", pits["count"], None, "high", "Detected from native pit-state transitions.", False))
        return rows[:5]
