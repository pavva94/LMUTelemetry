"""Transparent, deterministic clear-air race strategy Monte Carlo model."""
from __future__ import annotations

import math
import random
import statistics
from collections import Counter
from typing import Any, Callable

from app.schemas.race_simulation import RaceSimulationRequest, SimulationStrategy, SimulationStint

Progress = Callable[[str, str, int, int, int], None]


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) and math.isfinite(float(value)) else None


def _quantile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * q
    low, high = math.floor(position), math.ceil(position)
    return ordered[low] if low == high else ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def _mad(values: list[float], median: float) -> float:
    return _quantile([abs(value - median) for value in values], 0.5) or 0.0


def _robust_values(laps: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], Counter[str]]:
    reasons: Counter[str] = Counter()
    preliminary: list[dict[str, Any]] = []
    for index, lap in enumerate(laps):
        time = _number(lap.get("lap_time"))
        if not lap.get("valid_lap"):
            reasons["source_or_shared_quality_rejection"] += 1
        elif lap.get("in_pit"):
            reasons["pit_lap"] += 1
        elif time is None or not 40 <= time <= 900:
            reasons["implausible_or_missing_lap_time"] += 1
        elif index == 0:
            reasons["first_lap_excluded"] += 1
        else:
            preliminary.append(lap)
    times = [_number(lap.get("lap_time")) for lap in preliminary]
    clean_times = [value for value in times if value is not None]
    if len(clean_times) >= 5:
        median = statistics.median(clean_times)
        scale = max(_mad(clean_times, median) * 1.4826, 0.15)
        accepted = []
        for lap in preliminary:
            value = _number(lap.get("lap_time"))
            if value is not None and abs(value - median) > 4 * scale:
                reasons["robust_pace_outlier"] += 1
            else:
                accepted.append(lap)
        preliminary = accepted
    return preliminary, reasons


def derive_model(review: dict[str, Any], request: RaceSimulationRequest) -> dict[str, Any]:
    accepted, reasons = _robust_values(review.get("laps") or [])
    times = [_number(lap.get("lap_time")) for lap in accepted]
    times = [value for value in times if value is not None]
    if len(times) < 3:
        raise ValueError("At least three clean, representative laps are required for simulation.")
    baseline = request.normal_lap_time if request.normal_lap_time is not None else statistics.median(times)
    residuals = [value - baseline for value in times]
    residual_sigma = max((_mad(residuals, 0) * 1.4826), 0.08)
    fuel = [_number(lap.get("fuel_used")) for lap in accepted]
    fuel = [value for value in fuel if value is not None and 0 < value < 30]
    fuel_per_lap = request.fuel_per_lap_liters if request.fuel_per_lap_liters is not None else (statistics.median(fuel) if fuel else 2.5)
    fuel_source = "user_configured" if request.fuel_per_lap_liters is not None else ("session_derived" if len(fuel) >= 3 else "default_fallback")
    fuel_sigma = max((_mad(fuel, fuel_per_lap) * 1.4826), 0.01) if fuel else 0.08
    wear_end = []
    for lap in accepted:
        values = [_number(lap.get(f"tyre_wear_end_{wheel}")) for wheel in ("fl", "fr", "rl", "rr")]
        values = [value for value in values if value is not None and 0 <= value <= 1]
        if values:
            wear_end.append(sum(values) / len(values))
    derived_wear_rate = max((wear_end[-1] - wear_end[0]) / max(1, len(wear_end) - 1), 0.001) if len(wear_end) >= 2 else 0.008
    wear_rate = request.tyre_wear_rate_per_lap if request.tyre_wear_rate_per_lap is not None else derived_wear_rate
    pit_losses = [_number(event.get("total_pit_loss")) for event in review.get("pit_events") or []]
    pit_losses = [value for value in pit_losses if value is not None and 1 <= value <= 180]
    pit_loss = request.pit_loss_seconds if request.pit_loss_seconds is not None else (statistics.median(pit_losses) if pit_losses else 25.0)
    pit_source = "user_configured" if request.pit_loss_seconds is not None else ("session_derived" if pit_losses else "default_fallback")
    return {
        "baseline": baseline, "residual_sigma": residual_sigma, "fuel_per_lap": fuel_per_lap,
        "fuel_sigma": fuel_sigma, "wear_rate": wear_rate, "pit_loss": pit_loss,
        "accepted": len(accepted), "total": len(review.get("laps") or []), "reasons": dict(reasons),
        "provenance": {"baseline_pace": "robust_estimate", "fuel_per_lap": fuel_source,
                       "tyre_wear_rate": "user_configured" if request.tyre_wear_rate_per_lap is not None else ("session_derived" if len(wear_end) >= 2 else "default_fallback"),
                       "pit_loss": pit_source, "lap_variability": "robust_estimate"},
    }


def generate_strategies(model: dict[str, Any], request: RaceSimulationRequest, tank: float) -> tuple[int, list[SimulationStrategy]]:
    """Infer race distance and viable stint plans from duration, fuel and tyre evidence."""
    race_laps = max(2, math.ceil(request.race_duration_minutes * 60 / model["baseline"]))
    fuel_laps = max(1, math.floor((tank - request.finish_reserve_liters) / model["fuel_per_lap"]))
    tyre_laps = max(1, math.floor(request.tyre_wear_limit / model["wear_rate"]))
    max_stint = max(1, min(fuel_laps, tyre_laps))
    minimum_stints = max(1, math.ceil(race_laps / max_stint))
    candidates: list[SimulationStrategy] = []

    def late_stints(count: int) -> list[int]:
        remaining = race_laps
        lengths: list[int] = []
        for index in range(count):
            later = count - index - 1
            laps = min(max_stint, max(1, remaining - later))
            lengths.append(laps)
            remaining -= laps
        return lengths

    def make_strategy(name: str, lengths: list[int]) -> SimulationStrategy:
        return SimulationStrategy(
            name=name,
            # Each stint carries only the fuel it needs plus reserve. The
            # first value is also the calculated short-fill start target.
            stints=[SimulationStint(laps=length, fuel_added_liters=min(tank, length * model["fuel_per_lap"] + request.finish_reserve_liters)) for length in lengths],
        )
    # Endurance races frequently require more than four stints. Generate the
    # minimum feasible plan plus nearby alternatives, bounded only to protect
    # the UI and runtime from unrealistic inputs.
    for stint_count in range(minimum_stints, min(minimum_stints + 3, 25)):
        base, remainder = divmod(race_laps, stint_count)
        lengths = [base + (1 if index < remainder else 0) for index in range(stint_count)]
        if any(length > max_stint for length in lengths):
            continue
        candidates.append(make_strategy(f"{stint_count - 1}-stop late pit", late_stints(stint_count)))
        if lengths != late_stints(stint_count):
            candidates.append(make_strategy(f"{stint_count - 1}-stop balanced", lengths))
    if not candidates:
        raise ValueError("The duration cannot be covered within derived fuel and tyre constraints; configure a larger tank or tyre-wear limit.")
    return race_laps, candidates


def run_simulation(review: dict[str, Any], request: RaceSimulationRequest, progress: Progress | None = None) -> dict[str, Any]:
    model = derive_model(review, request)
    tank = request.fuel_tank_capacity_liters or max(20.0, request.starting_fuel_liters or 0, 90.0)
    race_laps, strategies = generate_strategies(model, request, tank)
    if request.starting_fuel_liters is not None and request.starting_fuel_liters > tank:
        raise ValueError("Starting fuel exceeds tank capacity.")
    rng = random.Random(request.random_seed)
    strategy_runs: dict[str, list[dict[str, float]]] = {strategy.name: [] for strategy in strategies}
    representative: dict[str, list[dict[str, float | int | str | bool]]] = {}
    total = request.simulation_count * len(strategies)
    done = 0
    for strategy in strategies:
        for run_index in range(request.simulation_count):
            # Avoid carrying a full tank by default: load only enough for the
            # opening stint and reserve, then short-fill the following stint.
            starting_fuel = request.starting_fuel_liters if request.starting_fuel_liters is not None else strategy.stints[0].fuel_added_liters
            fuel, total_time, max_wear, pit_time = starting_fuel, 0.0, 0.0, 0.0
            laps: list[dict[str, float | int | str | bool]] = []
            race_temperature_bias = rng.gauss(0, 0.10)
            stint_index, tyre_age = 0, 0
            stint_wear_bias = rng.gauss(1, 0.12)
            for lap_number in range(1, race_laps + 1):
                stint = strategy.stints[stint_index]
                tyre_age += 1
                pace_effect = {"push": -0.28, "normal": 0.0, "conserve": 0.32}[stint.pace_mode]
                fuel_effect = max(fuel, 0) * 0.025
                warmup = max(0, 2 - tyre_age) * 0.35
                tyre_effect = 0.018 * tyre_age + 0.002 * tyre_age * tyre_age * stint_wear_bias
                lap_time = model["baseline"] + fuel_effect + warmup + tyre_effect + pace_effect + race_temperature_bias + rng.gauss(0, model["residual_sigma"])
                fuel_used = max(0.01, rng.gauss(model["fuel_per_lap"] * (1.015 if stint.pace_mode == "push" else 0.985 if stint.pace_mode == "conserve" else 1), model["fuel_sigma"]))
                fuel -= fuel_used
                wear = min(1.5, tyre_age * model["wear_rate"] * stint_wear_bias * (1.08 if stint.pace_mode == "push" else 1))
                max_wear = max(max_wear, wear)
                total_time += lap_time
                pit = lap_number < race_laps and tyre_age == stint.laps
                if pit:
                    next_stint = strategy.stints[stint_index + 1]
                    fuel_added = max(0.0, next_stint.fuel_added_liters - fuel)
                    fuel_service = fuel_added / 5 * request.refuel_seconds_per_5_liters
                    tyre_service = 4 * request.tyre_change_seconds_per_tyre if strategy.stints[stint_index + 1].change_tyres else 0
                    stationary = max(fuel_service, tyre_service) if request.service_model == "parallel" else fuel_service + tyre_service
                    pit_component = max(1, rng.gauss(model["pit_loss"] + stationary, max(0.5, model["pit_loss"] * 0.06)))
                    total_time += pit_component; pit_time += pit_component
                    fuel = min(tank, fuel + fuel_added)
                    stint_index += 1
                    if strategy.stints[stint_index].change_tyres:
                        tyre_age = 0
                    stint_wear_bias = rng.gauss(1, 0.12)
                laps.append({"lap": lap_number, "lap_time": lap_time, "fuel": max(0, fuel), "wear": wear, "stint": stint_index + 1, "pit": pit})
            strategy_runs[strategy.name].append({"time": total_time, "fuel": fuel, "wear": max_wear, "pit_time": pit_time})
            if run_index == 0:
                representative[strategy.name] = laps
            done += 1
            if progress and (done % max(1, total // 100) == 0 or done == total):
                progress("Simulating strategies", f"{strategy.name}: {run_index + 1}/{request.simulation_count}", done, total, 35 + round(done / total * 60))
    wins = Counter()
    for index in range(request.simulation_count):
        fastest = min(strategies, key=lambda item: strategy_runs[item.name][index]["time"]).name
        wins[fastest] += 1
    summaries = []
    for strategy in strategies:
        runs = strategy_runs[strategy.name]
        times = [run["time"] for run in runs]
        mean = statistics.fmean(times)
        summaries.append({"name": strategy.name, "mean_time": mean, "median_time": _quantile(times, .5), "std_dev": statistics.pstdev(times), "p5": _quantile(times, .05), "p90": _quantile(times, .90), "fastest_probability": wins[strategy.name] / request.simulation_count, "fuel_risk_probability": sum(run["fuel"] < request.finish_reserve_liters for run in runs) / len(runs), "tyre_risk_probability": sum(run["wear"] > request.tyre_wear_limit for run in runs) / len(runs), "expected_finish_fuel": statistics.fmean(run["fuel"] for run in runs), "expected_max_wear": statistics.fmean(run["wear"] for run in runs), "expected_pit_time": statistics.fmean(run["pit_time"] for run in runs), "stops": len(strategy.stints) - 1, "distribution": [_quantile(times, q) for q in (.05, .25, .5, .75, .9, .95)]})
    key = {"expected_time": "mean_time", "median_time": "median_time", "downside_risk": "p90", "fastest_probability": "fastest_probability", "balanced": "mean_time"}[request.objective]
    summaries.sort(key=lambda item: -item[key] if request.objective == "fastest_probability" else item[key] + (item["fuel_risk_probability"] + item["tyre_risk_probability"]) * (5 if request.objective == "balanced" else 0))
    best = summaries[0]
    explanation = f"Recommended because it has the {'highest fastest-strategy probability' if request.objective == 'fastest_probability' else 'best configured race-time score'} and is fastest in {best['fastest_probability']:.0%} of simulations."
    model["estimated_race_laps"] = race_laps
    model["derived_max_stint_laps"] = max(stint.laps for strategy in strategies for stint in strategy.stints)
    return {"session_id": request.session_id, "config": request.model_dump(), "model": model, "summaries": summaries, "recommended": best["name"], "explanation": explanation, "representative_laps": representative, "limitations": ["Clear-air target-car model only: no safety cars, traffic, opponents, overtaking, weather transitions, or finishing positions."]}
