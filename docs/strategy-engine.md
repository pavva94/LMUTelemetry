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

Stored fuel uses the robust median of positive `fuel_used` values from valid laps. Live fuel is supplied by the backend fuel model, which rejects pit/refuel boundaries, missing transitions, and outliers. Standard deviation is retained for uncertainty and the safety policy adjusts the planning rate and reserve transparently.

Tyre wear is derived independently for each corner from positive consecutive wear deltas below 0.20 per lap. The scalar median is a fallback only. Tyre degradation time is unavailable unless a measured pace-versus-wear slope is supplied; wear rate is never converted into an invented time penalty.

## Simulation

For each candidate stop count, the engine:

1. Estimates the timed-race lap count, then divides integer laps into balanced stints.
2. Calculates per-corner wear through every stint and applies the selected tyre policy.
3. Uses `planning fuel rate × stint laps + reserve` to calculate start fuel and each stop load. Every load must fit the tank and fuel may never become negative.
4. Calculates stationary service as base overhead plus tyre and fuel work. Sequential service sums both jobs; parallel service takes the slower job. Pit-lane driving loss is separate.
5. Simulates laps and pit events in chronological elapsed time. A lap that starts before the duration target is completed; pit, trend, measured degradation, calibrated lift-and-coast, and traffic costs advance the same clock.
6. Repeats until the completed-lap count stabilizes.

Fuel saving is searched only when a lower-stop plan is otherwise infeasible, up to 8% of normal consumption. If no calibrated seconds-per-percent cost exists, feasibility is shown but pace cost is explicitly unavailable.

## Strategy selection and confidence

The result set contains distinct outcomes where feasible: fastest projected, balanced, conservative, alternative stop count, and fuel-save contingency. Ranking first maximizes completed laps, then minimizes elapsed completion time and risk.

Plan confidence is the lowest of pace, fuel, tyre, and risk confidence. High risk includes explicit no-change tyre threshold violations or fuel saving above 5%. Medium risk includes fuel saving or a finish margin below half a normal lap. Missing fuel, pace, tank, or duration inputs return no strategy instead of guessed values.

## Limitations

- Comparable history currently matches exact normalized car and track labels available in cached session metadata; weather and compound filters are not available in all source schemas.
- Live per-corner wear rate depends on backend fields; the scalar live rate is used only when corner rates are absent.
- Traffic, safety-car pit loss, and lift-and-coast pace cost are scenario assumptions, not inferred facts.
- Timed-race finish rules vary by event. The engine uses the common rule that a lap started before time expires is completed.
