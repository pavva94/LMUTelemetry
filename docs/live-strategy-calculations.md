# Live Strategy Calculations

Live strategy is deterministic. It does not call an LLM for decisions. The assistant text is only an explanation layer on top of the rule-based recommendation.

## Assumptions

Defaults come from `config/default_strategy.yaml` and `StrategyAssumptions`:

- Race duration: `120 min`
- Pit loss: `28.0 s`
- Stationary pit time: `12.0 s`
- Safety-car pit loss: `16.0 s`
- Fuel safety margin: `2.0 L`
- Fuel safety margin laps: `1.0 lap`
- Maximum tyre wear: `0.75`
- Normal lap time fallback: `214.0 s`

`POST /api/strategy/assumptions` updates the live model assumptions in memory.

## Fuel Model

Valid fuel laps require:

- Player fuel is available.
- Lap counter increases.
- Fuel used is positive.
- Player is not in pits.
- Session is not under yellow or safety car.
- Lap is not invalidated.

Fuel model formulas:

- `lap_usage = lap_start_fuel - current_fuel` at a lap increment.
- `fuel_per_lap = average(valid_lap_usages)`.
- `normal_lap_time` priority:
  1. Player last lap, if `40s <= value <= 900s`.
  2. Player estimated lap.
  3. Player best lap.
  4. Median valid field lap time.
  5. Assumption fallback.
- `estimated_laps_remaining = session.time_remaining / normal_lap_time`.
- `fuel_laps_remaining = current_fuel / fuel_per_lap`.
- `required_fuel_to_finish = estimated_laps_remaining * fuel_per_lap + fuel_safety_margin_liters`.
- `fuel_delta_to_finish = current_fuel - required_fuel_to_finish`.
- `recommended_fuel_save_per_lap = abs(delta) / estimated_laps_remaining` when delta is negative.

Confidence:

- Less than 3 valid laps: low, and finish calculations are not trusted.
- 3 or more valid laps: high in the live model.

## Tyre Model

Tyre wear uses player average tyre wear. A stint reset happens when the car leaves pit lane.

Per-lap wear rate:

- On a lap increment, `rate = abs(avg_wear_now - previous_avg_wear) / lap_delta`.
- Rates are accepted only when `0 < rate < 0.2`.
- `wear_rate_per_lap = average(accepted_rates)`.

Tyre life:

- `remaining_life_laps = (max_tyre_wear - current_avg_wear) / wear_rate_per_lap`.
- `pace_degradation_per_lap = wear_rate_per_lap * 18.0`.

Risk:

- High when current wear is at or above `max_tyre_wear`.
- High when remaining life is `<= 3 laps`.
- Medium when remaining life is `<= 7 laps`.
- Low when a stable wear rate exists and limits are not close.
- Unknown when wear history is insufficient.

Temperature rule:

- If average tyre temperature is below `65 C` or above `105 C`, add `tyre_temperature_outside_nominal_window`.
- This can lift a medium tyre risk to high.

Confidence:

- 0-1 observed wear laps: low.
- 2 observed wear laps: medium.
- 3+ observed wear laps: high.

## Pace Model

Live pace uses completed lap summaries from the event detector. Accepted pace laps require:

- Lap time is between `40s` and `900s`.
- Lap is marked valid.
- Player was not in pit lane.
- Session was not under yellow, FCY, or safety-car state.
- Lap is not a major outlier versus recent clean laps.

Pace fields:

- `last_lap_time`: most recent accepted clean lap.
- `last_7_lap_average`: average of the latest 7 accepted clean laps, or fewer until 7 exist.
- `last_10_lap_average`: average of the latest 10 accepted clean laps, or fewer until 10 exist.
- `weighted_recent_pace`: 60% last-7 average, 30% last-10 average, and 10% last clean lap once 10 laps exist. With 7-9 laps, it uses 75% last-7 average and 25% last lap. Before that it uses available clean-lap average or the normal-lap assumption fallback.
- `pace_trend_seconds_per_lap`: recent window minus longer window. Positive means recent pace is slower.
- `pace_degradation_per_lap`: positive trend only, used as an extra degradation signal.

Confidence:

- 0-6 clean laps: low.
- 7-9 clean laps: medium.
- 10+ clean laps: high.

## Stint Model

The stint model tracks pit transitions:

- Entering pits marks stint inactive.
- Leaving pits sets `last_pit_lap = current_lap` and starts a new stint.
- `current_stint_lap = current_lap - last_pit_lap` while active.

Projected stint limits:

- `fuel_limited_stint_end_lap = floor(current_lap + fuel_laps_remaining)`.
- `tyre_limited_stint_end_lap = floor(current_lap + remaining_tyre_life_laps)`.
- `recommended_stint_end_lap = min(available fuel/tyre end laps)`.

## Pit Window Model

Pit window formulas:

- `latest_safe_pit_lap = min(fuel_limited_end, tyre_limited_end) - 1`.
- `earliest_viable_pit_lap = current_lap` only if fuel range is greater than `fuel_safety_margin_laps`.
- `optimal_pit_lap = max(earliest, min(latest, current_lap + 2))` when both earliest and latest exist.
- `projected_rejoin_position = current_position + max(1, floor(pit_loss_seconds / 8))`.

Traffic:

- Nearby cars are competitors with `time_behind_next < 2.0s`.
- 3 or more nearby cars: high traffic risk.
- 1-2 nearby cars: medium.
- None: low.

Targets:

- Undercut targets are the first 3 non-player competitors with `time_behind_next < 5s`.
- Overcut targets are the first 3 non-player competitors that have already made at least one pit stop.

Safety-car pit recommendation is true when yellow/safety-car/FCY text is detected, earliest is available, and current lap is not later than latest.

## Competitor Model

Player:

- Strategy group: `ON_SAME_STRATEGY`.
- Threat level: low.

Non-player strategy group:

- `PITTED_EARLY` if currently in pits.
- `UNKNOWN` if pit stop count is unavailable.
- `NOT_STOPPED` if pit stop count is zero.
- `UNDERCUT_THREAT` if last lap is within `1.0s` of best lap after stopping.
- Otherwise `ON_SAME_STRATEGY`.

Threat level:

- High if positional distance from player is `<= 1` and gap is `< 5s`.
- Medium if positional distance is `<= 3` and gap is `< 12s`.
- Otherwise low.

## Recommendation Engine

The engine first checks whether fuel, tyres, and pit window are trusted.

Fuel is ready when:

- Fuel laps remaining and fuel per lap exist.
- Valid fuel laps observed is at least required laps.
- Confidence is not low.

Tyres are ready when:

- Remaining tyre life exists.
- Observed tyre laps is at least required laps.
- Confidence is not low.

Pit window is ready when:

- Latest safe pit lap exists.
- Fuel or tyre model is ready.

Recommendation priority order:

1. **Fuel critical**: fuel range is inside `fuel_safety_margin_laps + 0.5`.
   - Type is `SAVE_FUEL` if rejoin traffic risk is high.
   - Otherwise type is `PIT_NOW`.
2. **Pit this lap**: current lap is at or beyond latest safe pit lap.
3. **Box under safety car**: verified pit window is open and FCY/safety-car condition is active.
4. **Manage tyres**: tyre model is ready and risk is high.
5. **Cover competitor**: high-threat competitor exists, pit window is ready, and rejoin traffic is not high.
6. **Hold strategy**: no verified trigger requires action.

Duplicate suppression:

- If the same action type was issued on the current or previous lap, the engine returns hold strategy with `action_recently_issued`.
