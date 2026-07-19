# Strategy engine

The Strategy Planner is a pre-race projection tool. It reads live strategy state or completed-session lap records, builds an evidence model, and passes explicit assumptions to `frontend/src/lib/strategySimulation.ts`. Calculated start fuel, lap count, pit laps, stop fuel, tyre calls, finish reserve, and elapsed time are outputs; they are never primary user inputs.

## Units and conventions

- Time is seconds internally; race duration is entered in minutes.
- Fuel is litres and fuel rate is litres per lap.
- Tyre wear is a used fraction: `0` is new and `1` is fully worn. UI percentages multiply this value by 100.
- Wear margin is `permitted wear - projected wear`; negative values are threshold violations.
- Per-corner order is FL, FR, RL, RR.

## Raw sources and filtering

Live data comes from `StrategyState` and `TelemetrySnapshot`. Stored data comes from `SessionReview.laps` and `telemetry_samples`, loaded through the cached LMU DuckDB review API. Comparable history combines reviews that match the selected session's car and track.

`validSessionLaps` rejects missing or implausible lap times (outside 40–900 seconds), invalidated laps, pit laps, laps with more than 2 L added, and lap-time outliers outside 0.75–1.8 times the candidate median. The UI reports complete laps found separately from valid laps used.

Stored-session pace uses the selected robust basis: median, 10% trimmed mean (when the sample is large enough), or the 60th percentile. Manual pace replaces only the active pace and leaves the measured source visible. Spread is the population standard deviation; trend is calculated separately from recent windows.

Stored fuel uses the robust median of positive `fuel_used` values from valid laps. Live fuel is supplied by the backend fuel model, which rejects pit/refuel boundaries, missing transitions, and outliers. Standard deviation is retained for cumulative uncertainty, and the safety policy selects its confidence multiplier and adjusts the explicit reserve transparently.

When a saved session contains at least 12 valid laps with fuel level and four-corner tyre wear, the planner fits a robust Huber stint regression. Pit laps, fuel resets, and lap-number restarts delimit observed stints. The regression separates fuel-load effect, average tyre-wear effect, and the short warm-up/out-lap effect; extreme laps are down-weighted rather than allowed to determine the curve. The robust residual standard deviation is reported as pace variability and propagated to a P90 race-time range with `sigma * sqrt(laps)`. Short or incomplete sessions continue to use the transparent fallback heuristic.

Tyre wear is derived independently for each corner from positive consecutive wear deltas below 0.20 per lap. The scalar median is a fallback only. Tyre degradation time is unavailable unless a measured pace-versus-wear slope is supplied; wear rate is never converted into an invented time penalty.

The tyre allocation is entered as a count of individual tyres and includes the four fitted at race start. Automatic corner-by-corner calls consume one tyre per changed corner; full-set calls consume four. Any candidate whose starting tyres plus planned replacements exceed the allocation is rejected. The plan card reports used and remaining tyres so the constraint is auditable.

## Simulation

For each candidate stop count, the engine:

1. Estimates the timed-race lap count, then divides integer laps into balanced stints.
2. Calculates per-corner wear through every stint and applies the selected tyre policy.
3. Uses expected stint fuel plus a cumulative uncertainty allowance and the configured reserve to calculate start fuel and each stop load. Uncertainty scales with the square root of stint length instead of being charged as a full penalty on every lap. Every load must fit the tank and fuel may never become negative.
4. Calculates stationary service as base overhead plus tyre and fuel work. Sequential service sums both jobs; parallel service takes the slower job. Pit-lane driving loss is separate.
5. Simulates laps and pit events in chronological elapsed time. A lap that starts before the duration target is completed; pit, trend, measured degradation, calibrated lift-and-coast, and traffic costs advance the same clock.
6. Repeats until the completed-lap count stabilizes.
7. Rejects a final fuel-only stop when the preceding stint can absorb the remaining laps within its fuel and virtual-energy limits. This prevents dominated plans such as `46 / 46 / 46 / 46 / 34 / 1` when `46 / 46 / 46 / 46 / 35` is feasible.

The planner ranks feasible non-saving candidates by completed timed-race laps and then elapsed time. Its default selection is the actual highest-ranked candidate. A lift-and-coast candidate is always presented separately: it preferentially shows a lower-stop solution when saving can remove a stop, otherwise it shows how saving extends the planned stints. When no measured lift-and-coast pace-cost model exists, that option remains a clearly warned contingency and is not promoted over the normal fastest plan.

Lift-and-coast can be configured as `inferred` or `fixed`. Inferred mode searches for the fuel-saving percentage needed to extend the stint or remove a stop. Fixed mode applies the selected percentage to every lift-and-coast candidate; the saved default is 3%.

For a selected saved session, the pace cost is calibrated only when at least 12 comparable clean laps contain fuel use, fuel load, four-corner wear, and at least 15 usable throttle/brake samples per lap. Coast time is detected where throttle is at most 8%, brake at most 3%, and speed at least 30 km/h. The calibration first requires a positive relationship between additional coasting and fuel saved. It then removes the fitted fuel-load, tyre-wear, and warm-up effects and robustly estimates seconds lost per lap for each percentage point of fuel saved. The model is rejected when saving range, coast range, correlation, sample size, or fitted direction is insufficient.

Fuel saving is searched only when a lower-stop plan is otherwise infeasible, up to 8% of normal consumption. If no calibrated seconds-per-percent cost exists, feasibility is shown but pace cost is explicitly unavailable.

## Strategy selection and confidence

The result set contains distinct outcomes where feasible: fastest projected, balanced, conservative, alternative stop count, and fuel-save contingency. Ranking first maximizes completed laps, then minimizes elapsed completion time and risk.

Plan confidence is the lowest of pace, fuel, tyre, and risk confidence. High risk includes explicit no-change tyre threshold violations or fuel saving above 5%. Medium risk includes fuel saving or a finish margin below half a normal lap. Missing fuel, pace, tank, or duration inputs return no strategy instead of guessed values.

## Limitations

- Comparable history currently matches exact normalized car and track labels available in cached session metadata; weather and compound filters are not available in all source schemas.
- Live per-corner wear rate depends on backend fields; the scalar live rate is used only when corner rates are absent.
- Traffic, safety-car pit loss, and lift-and-coast pace cost are scenario assumptions, not inferred facts.
- Timed-race finish rules vary by event. The engine uses the common rule that a lap started before time expires is completed.
