# Page And Graph Calculations

This file maps frontend pages and graphs to the data and formulas behind them.

## Live Dashboard

Source: WebSocket telemetry and strategy state.

- Main driving display: speed, gear, RPM ratio, throttle, brake, steering, and clutch from `player`.
- RPM bar: `rpm / max(max_rpm, 1)`, capped to `1`; default max RPM is `9000` if missing.
- Input bars: input value times `100`, clamped to `0-100%`.
- Fuel & Pit card: current fuel and virtual energy from telemetry, plus per-lap rates, range, and the inferred fuel/virtual-energy load ratio from `strategy.fuel` and `strategy.energy`.
- Needed clean fuel laps: `valid_laps_required - valid_laps_observed`, floored at zero.
- Tyre life limit lap: `floor(current_lap + estimated_remaining_tyre_life_laps)`.
- Tyre wear display formats `0-1` wear as percent.
- Brakes, ABS/TC, and tyres are direct telemetry fields.

## Race Info

Source: current live telemetry, strategy, plus recent saved review samples.

- Fuel, tyre risk, current stint, and pit call are direct strategy-model outputs.
- Front/rear tyre balance uses averages of FL/FR and RL/RR wear.
- Left/right balance uses averages of FL/RL and FR/RR wear.
- Recent trend charts use the latest review samples plus one appended live sample.

## Strategy Planner

Source: strategy state, live telemetry, and editable assumptions.

Normal lap time priority:

1. Player last lap between `40s` and `900s`.
2. Player estimated lap.
3. Player best lap.
4. Field median of valid last/estimated/best laps.
5. Manual fallback.

Race model:

- `raceLaps = race_duration_minutes * 60 / normalLapTime`.
- `fuelPerLap` comes from live strategy fuel model when positive.
- Tank capacity priority: live player capacity, strategy capacity, current fuel.
- Pace priority: backend `strategy.pace.weighted_recent_pace`, then recent 7/10-lap windows, then manual/assumption lap time.
- Strategy cards show the selected simulator breakdown: base driving time, pit/service time, recent pace trend loss, tyre degradation loss, lift/coast loss, traffic loss, fuel margin, and confidence.
- `requiredFuel = raceLaps * fuelPerLap + fuel_safety_margin_liters`.
- Candidate stop counts are simulated from zero stops through the configured maximum.
- `stintLaps = raceLaps / (stops + 1)`.
- Each stop subtracts stint fuel, checks the safety margin, and only adds fuel that fits in the remaining tank space.

Plan cards:

- `estimated total = base driving time + measured/configured pit service time`. Lift/coast time loss remains `0` until a measured pace-cost model is supplied.
- Pit service time is pit lane loss plus tyre service and continuous refuel service. No fixed stationary overhead is added.
- `fuelMargin = finishFuelRemaining - fuel_safety_margin_liters`.
- Risk is medium if the fuel margin is below half a lap of fuel or the source data is still below the required valid laps; tyre risk can also raise the risk.

Lift-and-coast:

- The model first checks total fuel shortage, then simulates each stint.
- If a stop count fails because a stint or refuel would not fit the tank, the model binary-searches the minimum save per lap up to `8%`.
- `savePercent = savePerLap / fuelPerLap * 100`.
- Pace cost is not inferred from fuel saving; it remains unavailable (`0` in totals) until measured or explicitly configured.
- Risk bands: `<=2%` low, `<=5%` medium, `<=8%` high but possible, above `8%` high and likely not enough.

## Pit Window

Source: `strategy.pit_window`.

- Live pit options use the shared strategy simulator with backend pace evidence, current fuel, current virtual energy, measured fuel/energy rates, the fuel/virtual-energy load ratio, tank capacity, tyre wear by wheel, wear rate, pit service assumptions, safety-car pit loss, and traffic risk.
- The first live stint is constrained by both resources currently on board. Later stints restore virtual energy to `100%`; physical fuel load is capped by the measured ratio and physical tank capacity. Stops expose fuel remaining/added/on-exit and virtual energy remaining/restored/on-exit.
- The page displays the pace model and live calculation breakdown so the optimal call can be audited from the exact inputs and penalties.

- Earliest, latest, optimal, traffic risk, and rejoin position are backend outputs. Rejoin requires real competitor gaps; otherwise it is unavailable. No illustrative time/position penalties are added by the frontend.

## Session Review

Source: `/api/session/review/{id}`.

Summary:

- Laps: eligible count and all detected groups, displayed as `valid / detected`.
- Samples: count of returned samples.
- Average lap: lap-weighted mean of eligible completed laps.
- Best lap: minimum eligible completed lap.
- Top speed: max lap `top_speed`, falling back to max sample `speed_kph`.
- Fuel used: sum of non-negative `fuel_used` on eligible clean laps.

Charts:

- Lap Times: `lap_time` by `lap_number`.
- Lap Fuel: `fuel_used` and `fuel_added` by `lap_number`.
- Speed and RPM: `speed_kph` and `rpm` by `game_time`.
- Driver Inputs: `throttle`, `brake`, `steering` by `game_time`.
- Tyre Wear: FL/FR/RL/RR wear by `game_time`.
- Tyre Temperatures, Brake Temperatures, Ride Heights: per-corner values by `game_time`.

## Competitors

Source: live telemetry competitors, with `/api/competitors` as a periodic fallback.

- Search filters by driver, car, and class text.
- Sorting is client-side on the selected table column.
- Strings sort case-insensitively.
- Booleans sort as `1` for true and `0` for false.
- Missing values sort as positive infinity.
- Lap times and gaps are formatted only; threat level and estimated strategy group are produced by the backend competitor model.

## User Profile

Source: `/api/profile/summary` and `/api/profile/best-laps`, derived from the active native LMU DuckDB cache.

Career totals:

- Total distance is the sum of per-session integrated distance.
- Distance integrates adjacent speeds with the trapezoidal rule for finite `0 < delta <= 5s`; longer recording gaps are ignored.
- Completed driving time sums laps numbered 1 or greater with 40-900 s duration and absent or at least 0.5 km recorded distance. Detected and ranking-valid lap counts are shown separately.
- Total sessions is the larger of sessions represented by laps and persisted live/CSV session counts.
- Valid laps come from profile lap-quality rules.
- Average session duration, distance, and laps divide totals by total session count.
- Wins, podiums, top 10, and DNF/DNS/DQ require actual classification/status evidence; otherwise the values are unavailable.

Lap quality:

- For each session, expected normal lap time is a robust median of laps numbered 1 or greater between `40s` and `900s`.
- Values outside `0.85x` to `1.35x` of the preliminary median are removed before final normal time.
- Expected distance is the same robust median process for distances above `0.5 km`.
- A ranking lap is invalid if its number is below 1, time is outside `0.85x-1.35x` normal time, or recorded distance is below `0.5 km`.

Tables:

- Distance by class groups laps by car class and reports distance, sessions, laps, and percent of total distance.
- Most used cars group by car, sorted by distance.
- Most driven tracks group by track, sorted by distance, with best valid lap and most-used car.
- Best laps keep the fastest valid lap for each track/layout/car/class tuple.
- Best lap table sorting is client-side for displayed rows.

## Race Prep Report

Source: selected saved session review plus user options.

Valid laps:

- Lap time exists and is `40-900s`.
- `valid_lap !== false`.
- `in_pit !== true`.
- `fuel_added <= 2 L`.
- After median lap is known, lap time must be between `median * 0.75` and `median * 1.8`.

Pace:

- Best/worst/average/median/spread/std-dev are computed on valid laps.
- Delta rows are `lap_time - bestLap`.
- Consistency is high when std-dev `<=0.35s`, medium when `<=0.9s`, otherwise low.
- Trend splits lap times in half. If second-half average is lower by more than `0.25s`, trend is improving; higher by more than `0.25s`, degrading.

Fuel:

- Average/min/max per lap use valid positive `fuel_used`.
- Start/end fuel come from first/last sample fuel, falling back to lap fuel start/end.
- Tank capacity uses manual override if positive, otherwise max positive sampled capacity.
- Race laps priority: manual race laps, manual race duration, default strategy duration.
- `estimatedRaceFuel = raceLaps * averageFuelPerLap`.
- `fuelStops = max(0, ceil(estimatedRaceFuel / tankCapacity) - 1)`.
- `totalStints = fuelStops + 1`.
- `fuelMargin = tankCapacity * totalStints - estimatedRaceFuel`.
- Full-tank laps and stint length are `tankCapacity / averageFuelPerLap`.

Tyres:

- Per-corner wear uses positive clean-lap deltas below `0.2` and averages those lap deltas; pit/refuel/invalid laps are excluded.
- Front/rear balance is rear delta average minus front delta average.
- Left/right balance is right delta average minus left delta average.
- Temperature and pressure summaries include average/min/max and split-half trend.

Execution:

- Tyres available defaults to at least `4`, then full sets are `floor(tyresAvailable / 4)`.
- Tyre life estimate uses a `0.75` wear limit if wear rises over the run.
- Fresh tyres every stint are recommended when estimated tyre life is less than `averageRaceStintLaps * 1.15`.
- One-stop-less fuel saving is based on `estimatedRaceFuel - tankCapacity * max(1, fuelStops)`.
- Lift-and-coast options show 0%, 1-2%, 3-5%, and 6-8% saving bands.

## Race Engineering Live Pages

Common helpers:

- `validPaceRows` keeps laps with `40-900s` lap time, not invalid, not in pit, then removes laps outside `median * 0.75` to `median * 1.8`.
- `averageLapDelta` splits rows in half and returns second average minus first average.
- `numericSampleFields` discovers numeric fields for custom plots, with preferred telemetry fields first.
- `buildStints` splits saved laps whenever a lap has `in_pit === true`.

Examples:

- Circle/track maps normalize `lap_distance` by the maximum visible lap distance.
- Field spread and standings sort/filter competitor rows by selected fields.
- Lap compare and race history use saved lap rows and recent samples to plot pace, fuel, tyre, and event trends.
- X-Y Plotter computes min, max, average, population standard deviation, and sample count for the selected Y channel.
- Stint History computes fastest lap, average valid lap, fuel used, fuel per lap, tyre wear delta, and top speed per stint.
