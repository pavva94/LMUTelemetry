# Page And Graph Calculations

This file maps frontend pages and graphs to the data and formulas behind them.

## Live Dashboard

Source: WebSocket telemetry and strategy state.

- Main driving display: speed, gear, RPM ratio, throttle, brake, steering, and clutch from `player`.
- RPM bar: `rpm / max(max_rpm, 1)`, capped to `1`; default max RPM is `9000` if missing.
- Input bars: input value times `100`, clamped to `0-100%`.
- Fuel card: current fuel from telemetry, model values from `strategy.fuel`.
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

- `estimated total = race_duration_seconds + pit service time + lift/coast time loss`.
- Pit service time is pit lane loss plus tyre service and rounded 5 L refuel service.
- `fuelMargin = finishFuelRemaining - fuel_safety_margin_liters`.
- Risk is medium if the fuel margin is below half a lap of fuel or the source data is still below the required valid laps; tyre risk can also raise the risk.

Lift-and-coast:

- The model first checks total fuel shortage, then simulates each stint.
- If a stop count fails because a stint or refuel would not fit the tank, the model binary-searches the minimum save per lap up to `8%`.
- `savePercent = savePerLap / fuelPerLap * 100`.
- Pace cost estimate is `savePercent / 100 * normalLapTime * 0.2 * raceLaps`.
- Risk bands: `<=2%` low, `<=5%` medium, `<=8%` high but possible, above `8%` high and likely not enough.

## Pit Window

Source: `strategy.pit_window`.

- Live pit options use the shared strategy simulator with backend pace evidence, current fuel, tank capacity, tyre wear by wheel, wear rate, pit service assumptions, safety-car pit loss, and traffic risk.
- The page displays the pace model and live calculation breakdown so the optimal call can be audited from the exact inputs and penalties.

- Earliest, latest, optimal, traffic risk, and rejoin position are backend model outputs.
- Possible pit-lap table shows 8 candidate laps beginning at current stint lap.
- Candidate risk values are illustrative frontend values:
  - Can pit if candidate lap is not greater than latest safe lap.
  - Fuel risk is high after latest safe lap.
  - Rejoin position increments by one per displayed future lap.
  - Delta is `i * 1.7s`.
- Pit Lap Risk chart:
  - 8 points beginning at current stint lap.
  - Risk is `9` after latest safe lap.
  - Otherwise risk is `max(1, i + 3)` when traffic is high, or `max(1, i)` when not.

## Session Review

Source: `/api/session/review/{id}`.

Summary:

- Laps: count of lap rows.
- Samples: count of returned samples.
- Average lap: mean of finite `lap_time`.
- Best lap: minimum finite `lap_time`.
- Top speed: max lap `top_speed`, falling back to max sample `speed_kph`.
- Fuel used: sum of finite lap `fuel_used`.

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

Source: `/api/profile/summary` and `/api/profile/best-laps`, combining live SQLite sessions and imported CSV/MoTeC sessions.

Career totals:

- Total distance is the sum of per-session integrated distance.
- Live distance integrates `speed_kph * delta_game_time / 3600` for valid `0 < delta <= 120s`.
- CSV distance uses imported lap `distance_km`.
- Total driving time is the sum of lap times across all profile laps.
- Total sessions is the larger of sessions represented by laps and persisted live/CSV session counts.
- Valid laps come from profile lap-quality rules.
- Average session duration, distance, and laps divide totals by total session count.
- Wins, podiums, top 10, and DNF/DNS/DQ are counted only for sessions whose type contains `race`.

Lap quality:

- For each session, expected normal lap time is a robust median of lap times above `40s`.
- Values outside `0.70x` to `1.35x` of the preliminary median are removed before final normal time.
- Expected distance is the same robust median process for distances above `0.5 km`.
- A lap is invalid if it was recorded invalid, is a pit lap, lacks lap time, is below `0.75x` normal time, above `1.80x` normal time, or below `0.75x` normal distance.

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

- Per-corner wear start/end are first and last sample values.
- Wear delta is absolute end-start.
- Per-lap wear is delta divided by valid lap count.
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

## MoTeC Workspace

Common chart behavior:

- Lap selectors choose primary and optional compare lap.
- `ChartBlock` loads selected channels for lap A and lap B, uses `Lap-relative time` as default X, and overlays lap B with dashed lines.
- Cursor value selects `round(cursor_percent / 100 * (sample_count - 1))`.
- Key values show min, max, average, and count for selected channels.

Worksheets:

- Compare: Ground Speed, Throttle/Brake, Gear, Delta.
- Driver: speed, inputs, steering, FFB, RPM, gear, G-force.
- Tyre Temperature: outer/centre/inner per corner plus average temperature cards.
- Tyre Pressure/Wear: per-corner pressure and wear plus front/rear averages.
- Brakes: brake position, per-axle brake temperatures, speed, longitudinal G.
- Ride Height/Platform: front/rear ride height, speed, inputs, longitudinal G, rake/min height cards.
- G-Force: G channels, G-G scatter where X is lateral G and Y is longitudinal G.
- Map/GPS: scales longitude and latitude into an SVG viewport; color intensity is selected channel divided by `100` and clamped to `0-1`.
- Histograms: 20 bins from min to max of the selected channel.
- X-Y: scatter of selected numeric X and Y channels.
- Powertrain, Wheel Speeds, Environment, Speed/Delta, Inputs: direct channel plots plus summary cards where available.
