# Monte Carlo race simulation

## Purpose and scope

The simulator compares feasible fuel-and-tyre stint plans for a configured race duration. It calibrates a transparent model from one saved LMU session, runs seeded stochastic trials for every candidate strategy, and ranks the results by the selected objective.

It is a planning model, not a vehicle-dynamics or race-control simulator. Opponents and traffic are synthetic. Safety cars, penalties, collisions, mechanical failures, weather evolution, and live opponent telemetry are not modelled.

## End-to-end process

1. Load up to 5,000 laps from the selected saved session.
2. Reject invalid laps, pit laps, the first recorded lap, times outside 40–900 seconds, and robust pace outliers.
3. Derive baseline pace, lap-time spread, fuel consumption, tyre-wear rate, and pit-lane loss. User overrides take precedence.
4. Estimate distance as `ceil(duration_seconds / baseline_lap_time)`.
5. Calculate the maximum stint allowed by usable fuel and the tyre-wear limit.
6. Generate the minimum-stop plan and up to two additional stint-count alternatives, using balanced and late-stop layouts when distinct.
7. Run every strategy `simulation_count` times. Trial `i` uses `random_seed + i`, giving strategies a common scenario stream and making results reproducible.
8. Aggregate time quantiles and risks, then rank the strategies.

## Session-derived variables

A lap is accepted only when `valid_lap` is true, `in_pit` is false, and lap time is finite and in range. With at least five preliminary laps, values farther than four robust standard deviations from the median are rejected. Robust spread is `1.4826 × MAD`, with a 0.15-second outlier-detection floor. At least three accepted laps are required.

| Value | Derivation | Fallback / override |
| --- | --- | --- |
| Baseline lap time | Median accepted time | `normal_lap_time` overrides |
| Lap-time sigma | `1.4826 × MAD` around observed median | 0.08 s minimum |
| Fuel per lap | Median valid `fuel_used` in `(0, 30)` L | 2.5 L/lap; override wins |
| Fuel sigma | `1.4826 × MAD` around fuel-per-lap | 0.01 L minimum; 0.08 L without evidence |
| Tyre wear per lap | Median positive consecutive mean-four-tyre wear increment; increments over 0.20 excluded | 0.008/lap; override wins |
| Pit-lane loss | Median `total_pit_loss` in `[1, 180]` s | 25 s; override wins |

Tyre-reset drops are excluded from wear derivation. The response reports each value's provenance (`session_derived`, `robust_estimate`, `user_configured`, or `default_fallback`) and every lap-rejection count.

## Strategy generation

`fuel_laps = floor((tank_capacity - finish_reserve) / fuel_per_lap)`

`tyre_laps = floor((tyre_wear_limit - starting_tyre_wear) / tyre_wear_rate)`

Maximum stint length is the smaller positive value; minimum stint count is `ceil(race_laps / maximum_stint)`. Candidate generation is capped at 24 stints. A nominal stint receives `stint_laps × fuel_per_lap + finish_reserve`, capped by tank capacity.

The tank defaults to 90 L when omitted. Configured starting fuel overrides the first-stint load. Starting fuel cannot exceed the tank, and finish reserve must be smaller than the tank.

## One simulation trial

Each lap uses:

`lap_time = baseline + fuel_effect + warmup + tyre_effect + pace_mode + temperature_bias + traffic_loss + pace_error`

- Fuel effect: `0.025 s × current fuel litres`.
- Warm-up: 0.35 s on the first lap of a tyre stint, then zero.
- Tyre time: `0.018 × tyre_age + 0.002 × tyre_age² × stint_wear_bias + 1.5 × initial_wear` seconds.
- Pace mode: push −0.28 s, normal 0, conserve +0.32 s.
- Temperature bias: one `Normal(0, 0.10 s)` draw per trial.
- Pace error: `Normal(0, lap_sigma × pace_variability_multiplier)` per lap.

Fuel use is normal around derived consumption, adjusted by pace mode (push ×1.015, conserve ×0.985) and traffic, with derived sigma and a 0.01 L lower bound.

Tyre wear accumulates from `wear_rate × stint_wear_bias` every lap; push multiplies it by 1.08. `stint_wear_bias` is `Normal(1, tyre_wear_variability)`, clamped to at least 0.05. Traffic multiplies that lap's increment, affecting both reported extra wear and actual risk. A tyre change resets age and wear.

At a stop, refuelling time is `fuel_added / 5 × refuel_seconds_per_5_liters`; tyre service is `4 × tyre_change_seconds_per_tyre`. Parallel service uses the larger duration; sequential service sums them. Pit time adds pit-lane loss plus service and normal pit-loss variation. A run below zero fuel before a stop is marked fuel-risk; its deficit is never counted as fuel added.

## Synthetic field and traffic

The field contains `field_size - 1` opponents. Same-class cars are centred on user pace; faster and slower classes use their configured deltas. Every opponent gets a normal pace offset using `opponent_pace_spread_seconds`. Unallocated slots become same-class cars.

Encounter probability depends on traffic preset, opening laps, pit rejoin, grid density, field size, and opponent mix. Loss is a non-negative normal draw modified by class and aggression. Cars do not have track positions, gaps, or overtaking state: this is explicitly a density approximation.

## Parameters

| Group | Parameters |
| --- | --- |
| Run | `session_id`, `race_duration_minutes`, `simulation_count`, `random_seed` |
| Fuel | `starting_fuel_liters`, `fuel_tank_capacity_liters`, `finish_reserve_liters`, `fuel_per_lap_liters` |
| Pace/tyre | `normal_lap_time`, `tyre_wear_rate_per_lap`, `race_start_new_tyres`, `used_tyre_wear`, `tyre_wear_limit`, `tyre_wear_variability`, `pace_variability_multiplier` |
| Pit | `pit_loss_seconds`, `tyre_change_seconds_per_tyre`, `refuel_seconds_per_5_liters`, `service_model`, `pit_variability_multiplier` |
| Field | `field_size`, three class counts, `starting_position`, pace spread, faster/slower deltas |
| Traffic | `traffic_preset`, `traffic_aggression`, `traffic_loss_seconds`, `traffic_wear_multiplier`, `traffic_fuel_multiplier` |
| Ranking | `objective`: expected time, median time, downside risk (P90), fastest probability, or balanced |

Exact API bounds and defaults live in `backend/app/schemas/race_simulation.py`. The UI currently submits the balanced objective.

## Outputs and risk definitions

Each strategy contains mean, median, population standard deviation, P5 and P90 time; expected finish fuel, maximum wear, pit time and traffic effects; a six-point distribution; and a nominal service plan.

- Fuel risk: trials that go below zero at any point or finish below reserve.
- Tyre risk: trials whose maximum wear exceeds the limit.
- Fastest probability: paired trial indices where the strategy has lowest total time.
- Balanced score: mean time plus five seconds per unit of summed fuel and tyre risk probability.

The representative trace is trial zero; it is explanatory, not the mean or median run.

## Interpretation

Probabilities are conditional on this model and its inputs, not calibrated real-world incident probabilities. Prefer representative long-run reference data and event-specific pit inputs. Check sensitivity by varying pace, consumption, traffic, and wear before using the recommendation.
