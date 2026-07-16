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
    # Pace spread is a property of the observed laps, not of a user-provided
    # baseline override. Centre it on the observed median so an override does
    # not accidentally inflate variability by its offset from the session.
    observed_median = statistics.median(times)
    residual_sigma = max((_mad(times, observed_median) * 1.4826), 0.08)
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
    # Use positive lap-to-lap increments. A tyre change resets the recorded
    # wear and must not flatten the rate across the whole session.
    wear_increments = [current - previous for previous, current in zip(wear_end, wear_end[1:]) if 0 < current - previous <= 0.2]
    derived_wear_rate = statistics.median(wear_increments) if wear_increments else 0.008
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
                       "tyre_wear_rate": "user_configured" if request.tyre_wear_rate_per_lap is not None else ("session_derived" if wear_increments else "default_fallback"),
                       "pit_loss": pit_source, "lap_variability": "robust_estimate"},
    }


def generate_strategies(model: dict[str, Any], request: RaceSimulationRequest, tank: float) -> tuple[int, list[SimulationStrategy]]:
    """Infer race distance and viable stint plans from duration, fuel and tyre evidence."""
    race_laps = max(2, math.ceil(request.race_duration_minutes * 60 / model["baseline"]))
    fuel_laps = max(1, math.floor((tank - request.finish_reserve_liters) / model["fuel_per_lap"]))
    start_wear = 0.0 if request.race_start_new_tyres else request.used_tyre_wear
    tyre_laps = max(1, math.floor(max(0.0, request.tyre_wear_limit - start_wear) / model["wear_rate"]))
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
    for stint_count in range(minimum_stints, min(minimum_stints + 3, 25, race_laps + 1)):
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


def _synthetic_field(model: dict[str, Any], request: RaceSimulationRequest, rng: random.Random) -> list[float]:
    """Generate one transparent, pace-relative opponent field for a run."""
    total = max(0, request.field_size - 1)
    requested = request.same_class_cars + request.faster_class_cars + request.slower_class_cars
    same = min(total, request.same_class_cars)
    faster = min(total - same, request.faster_class_cars)
    slower = min(total - same - faster, request.slower_class_cars)
    # Unspecified cars are comparable same-class opponents, never hidden defaults.
    same += max(0, total - requested)
    spread = request.opponent_pace_spread_seconds
    return (
        [rng.gauss(0, spread) for _ in range(same)]
        + [rng.gauss(-request.faster_class_delta_seconds, spread) for _ in range(faster)]
        + [rng.gauss(request.slower_class_delta_seconds, spread) for _ in range(slower)]
    )


def _traffic_event(opponents: list[float], lap_number: int, after_pit: bool, request: RaceSimulationRequest, rng: random.Random) -> tuple[float, float, float, str | None]:
    """Return time, extra wear factor, fuel multiplier and an encounter type.

    This is deliberately a field-density approximation: no opponent telemetry is
    claimed, but each run gets a seeded synthetic field relative to the user.
    """
    if len(opponents) == 0 or request.traffic_preset == "clear":
        return 0.0, 0.0, 0.0, None
    severity = {"clear": 0.0, "light": 0.55, "typical": 1.0, "heavy": 1.55}[request.traffic_preset]
    opening = 1.7 if lap_number <= 2 else 1.0
    rejoin = 1.45 if after_pit else 1.0
    position = min(request.field_size, request.starting_position or max(1, math.ceil(request.field_size / 2)))
    grid_density = 1 + .35 * (1 - abs(2 * (position - 1) / max(1, request.field_size - 1) - 1))
    comparable = sum(abs(delta) <= request.opponent_pace_spread_seconds for delta in opponents)
    faster = sum(delta < -request.opponent_pace_spread_seconds for delta in opponents)
    slower = sum(delta > request.opponent_pace_spread_seconds for delta in opponents)
    chance = min(0.9, severity * opening * rejoin * grid_density * (0.006 * len(opponents) + 0.012 * comparable + 0.003 * (faster + slower)))
    if rng.random() >= chance:
        return 0.0, 0.0, 0.0, None
    weights = [max(1, comparable), max(1, faster), max(1, slower)]
    event = rng.choices(["same_class", "faster_class", "slower_class"], weights=weights, k=1)[0]
    event_factor = {"same_class": 1.25, "faster_class": 0.65, "slower_class": 1.0}[event]
    aggression = {"conservative": (0.8, 0.7), "normal": (1.0, 1.0), "aggressive": (0.82, 1.45)}[request.traffic_aggression]
    loss = max(0.0, rng.gauss(request.traffic_loss_seconds * event_factor * aggression[0], max(0.1, request.traffic_loss_seconds * .45)))
    return loss, request.traffic_wear_multiplier * aggression[1], request.traffic_fuel_multiplier * aggression[1], event


def _strategy_plan(strategy: SimulationStrategy, request: RaceSimulationRequest, model: dict[str, Any], tank: float) -> dict[str, Any]:
    """Return the nominal, driver-readable execution plan before run variance."""
    start_fuel = request.starting_fuel_liters if request.starting_fuel_liters is not None else strategy.stints[0].fuel_added_liters
    fuel = start_fuel
    completed_laps = 0
    pits: list[dict[str, Any]] = []
    for index, stint in enumerate(strategy.stints[:-1]):
        completed_laps += stint.laps
        fuel = max(0.0, fuel - stint.laps * model["fuel_per_lap"])
        next_stint = strategy.stints[index + 1]
        target_fuel = min(tank, next_stint.fuel_added_liters)
        fuel_to_add = max(0.0, target_fuel - fuel)
        pits.append({"pit_lap": completed_laps, "next_stint_laps": next_stint.laps, "change_tyres": next_stint.change_tyres, "fuel_to_add_liters": round(fuel_to_add, 2), "target_fuel_liters": round(target_fuel, 2), "pace_mode": next_stint.pace_mode})
        fuel = min(tank, fuel + fuel_to_add)
    return {"initial_fuel_liters": round(start_fuel, 2), "start_new_tyres": request.race_start_new_tyres, "stints": len(strategy.stints), "pits": pits}


def run_simulation(review: dict[str, Any], request: RaceSimulationRequest, progress: Progress | None = None) -> dict[str, Any]:
    model = derive_model(review, request)
    tank = request.fuel_tank_capacity_liters or max(20.0, request.starting_fuel_liters or 0, 90.0)
    if request.starting_fuel_liters is not None and request.starting_fuel_liters > tank:
        raise ValueError("Starting fuel exceeds tank capacity.")
    if request.finish_reserve_liters >= tank:
        raise ValueError("Finish reserve must be smaller than tank capacity.")
    race_laps, strategies = generate_strategies(model, request, tank)
    strategy_runs: dict[str, list[dict[str, float]]] = {strategy.name: [] for strategy in strategies}
    representative: dict[str, list[dict[str, float | int | str | bool]]] = {}
    total = request.simulation_count * len(strategies)
    done = 0
    for strategy in strategies:
        for run_index in range(request.simulation_count):
            # Re-seeding each strategy/run pair gives strategies the same
            # scenario stream for a fairer paired comparison while preserving
            # complete reproducibility from the configured seed.
            rng = random.Random(request.random_seed + run_index)
            # Avoid carrying a full tank by default: load only enough for the
            # opening stint and reserve, then short-fill the following stint.
            starting_fuel = request.starting_fuel_liters if request.starting_fuel_liters is not None else strategy.stints[0].fuel_added_liters
            fuel, minimum_fuel, total_time, max_wear, pit_time = starting_fuel, starting_fuel, 0.0, 0.0, 0.0
            traffic_time, traffic_wear, traffic_events = 0.0, 0.0, 0
            opponents = _synthetic_field(model, request, rng)
            laps: list[dict[str, float | int | str | bool]] = []
            race_temperature_bias = rng.gauss(0, 0.10)
            stint_index, tyre_age = 0, 0
            initial_wear = 0.0 if request.race_start_new_tyres else request.used_tyre_wear
            current_wear = initial_wear
            stint_wear_bias = max(0.05, rng.gauss(1, request.tyre_wear_variability))
            after_pit = False
            for lap_number in range(1, race_laps + 1):
                stint = strategy.stints[stint_index]
                tyre_age += 1
                pace_effect = {"push": -0.28, "normal": 0.0, "conserve": 0.32}[stint.pace_mode]
                fuel_effect = max(fuel, 0) * 0.025
                warmup = max(0, 2 - tyre_age) * 0.35
                tyre_effect = 0.018 * tyre_age + 0.002 * tyre_age * tyre_age * stint_wear_bias + initial_wear * 1.5
                traffic_loss, wear_factor, fuel_factor, encounter = _traffic_event(opponents, lap_number, after_pit, request, rng)
                lap_time = model["baseline"] + fuel_effect + warmup + tyre_effect + pace_effect + race_temperature_bias + traffic_loss + rng.gauss(0, model["residual_sigma"] * request.pace_variability_multiplier)
                fuel_used = max(0.01, rng.gauss(model["fuel_per_lap"] * (1.015 if stint.pace_mode == "push" else 0.985 if stint.pace_mode == "conserve" else 1) * (1 + fuel_factor), model["fuel_sigma"]))
                fuel -= fuel_used
                minimum_fuel = min(minimum_fuel, fuel)
                base_wear = model["wear_rate"] * stint_wear_bias * (1.08 if stint.pace_mode == "push" else 1)
                current_wear = min(1.5, current_wear + base_wear * (1 + wear_factor))
                wear = current_wear
                max_wear = max(max_wear, wear)
                total_time += lap_time
                traffic_time += traffic_loss; traffic_wear += base_wear * wear_factor; traffic_events += int(encounter is not None)
                pit = lap_number < race_laps and tyre_age == stint.laps
                if pit:
                    next_stint = strategy.stints[stint_index + 1]
                    # A negative fuel balance means this run starved before
                    # reaching the pits. Do not count that deficit as fuel
                    # physically added during service.
                    fuel_added = max(0.0, next_stint.fuel_added_liters - max(0.0, fuel))
                    fuel_service = fuel_added / 5 * request.refuel_seconds_per_5_liters
                    tyre_service = 4 * request.tyre_change_seconds_per_tyre if strategy.stints[stint_index + 1].change_tyres else 0
                    stationary = max(fuel_service, tyre_service) if request.service_model == "parallel" else fuel_service + tyre_service
                    pit_component = max(1, rng.gauss(model["pit_loss"] + stationary, max(0.5, model["pit_loss"] * 0.06 * request.pit_variability_multiplier)))
                    total_time += pit_component; pit_time += pit_component
                    fuel = min(tank, max(0.0, fuel) + fuel_added)
                    stint_index += 1
                    if strategy.stints[stint_index].change_tyres:
                        tyre_age = 0
                        initial_wear = 0.0
                        current_wear = 0.0
                    stint_wear_bias = max(0.05, rng.gauss(1, request.tyre_wear_variability))
                after_pit = pit
                laps.append({"lap": lap_number, "lap_time": lap_time, "fuel": max(0, fuel), "wear": wear, "stint": stint_index + 1, "pit": pit, "traffic_loss": traffic_loss, "traffic_event": encounter or "clear"})
            strategy_runs[strategy.name].append({"time": total_time, "fuel": fuel, "minimum_fuel": minimum_fuel, "wear": max_wear, "pit_time": pit_time, "traffic_time": traffic_time, "traffic_wear": traffic_wear, "traffic_events": traffic_events})
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
        summaries.append({"name": strategy.name, "mean_time": mean, "median_time": _quantile(times, .5), "std_dev": statistics.pstdev(times), "p5": _quantile(times, .05), "p90": _quantile(times, .90), "fastest_probability": wins[strategy.name] / request.simulation_count, "fuel_risk_probability": sum(run["minimum_fuel"] < 0 or run["fuel"] < request.finish_reserve_liters for run in runs) / len(runs), "tyre_risk_probability": sum(run["wear"] > request.tyre_wear_limit for run in runs) / len(runs), "expected_finish_fuel": statistics.fmean(run["fuel"] for run in runs), "expected_max_wear": statistics.fmean(run["wear"] for run in runs), "expected_pit_time": statistics.fmean(run["pit_time"] for run in runs), "expected_traffic_loss": statistics.fmean(run["traffic_time"] for run in runs), "p90_traffic_loss": _quantile([run["traffic_time"] for run in runs], .9), "expected_traffic_events": statistics.fmean(run["traffic_events"] for run in runs), "expected_traffic_wear": statistics.fmean(run["traffic_wear"] for run in runs), "stops": len(strategy.stints) - 1, "plan": _strategy_plan(strategy, request, model, tank), "distribution": [_quantile(times, q) for q in (.05, .25, .5, .75, .9, .95)]})
    key = {"expected_time": "mean_time", "median_time": "median_time", "downside_risk": "p90", "fastest_probability": "fastest_probability", "balanced": "mean_time"}[request.objective]
    summaries.sort(key=lambda item: -item[key] if request.objective == "fastest_probability" else item[key] + (item["fuel_risk_probability"] + item["tyre_risk_probability"]) * (5 if request.objective == "balanced" else 0))
    best = summaries[0]
    explanation = f"Recommended because it has the {'highest fastest-strategy probability' if request.objective == 'fastest_probability' else 'best configured race-time score'} and is fastest in {best['fastest_probability']:.0%} of simulations."
    model["estimated_race_laps"] = race_laps
    model["derived_max_stint_laps"] = max(stint.laps for strategy in strategies for stint in strategy.stints)
    model["provenance"].update({"opponent_field": "user_configured_synthetic", "traffic": "estimated_from_synthetic_field", "tyre_variability": "user_configured"})
    return {"session_id": request.session_id, "config": request.model_dump(), "model": model, "summaries": summaries, "recommended": best["name"], "explanation": explanation, "representative_laps": representative, "limitations": ["Opponent pace and traffic are estimated from the configured synthetic field, not observed opponent telemetry. No safety cars, penalties, collisions, or reliability failures are simulated."]}
