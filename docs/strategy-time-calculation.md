# Strategy elapsed-time calculation

The Pit Window and Strategy Planner use the same simulator in `frontend/src/lib/strategySimulation.ts`. This document describes how each candidate's final time is calculated and compared.

## Candidate structure

For a candidate with `S` pit stops, the race is split into `S + 1` stints. Integer laps are distributed as evenly as possible, with any remainder assigned to the earlier stints.

The simulator starts with an estimated lap count from:

`estimated laps = ceil(race duration seconds / simulation pace seconds)`

It then simulates every lap and stop in chronological order. If pit losses make fewer laps fit into the timed race, the lap count is reduced and simulated again until stable.

## Driving time

The simulation pace uses the first valid positive value in this order:

1. Weighted recent pace.
2. Seven-lap average.
3. Ten-lap average.
4. Last lap.
5. Configured normal lap time.

Each simulated lap contains:

`lap time = simulation pace + recent pace trend loss + tyre degradation loss + lift-and-coast loss`

Only positive recent pace trends are projected. A negative trend is not treated as a guaranteed future gain. The positive slope is weighted by evidence confidence (high 100%, medium 65%, low 35%). When a measured tyre-degradation slope is also available, it is removed from the recent trend before projection so the same pace loss is not counted twice.

Because the trend is measured from a recent window of at most ten laps, its pace offset follows a bounded saturation curve:

`trend offset = residual trend × 10 × (1 - exp(-completed laps / 10))`

The offset therefore approaches `residual trend × 10` instead of growing without bound through an endurance race.

## Stint pace projection

Every stint is simulated lap by lap. The projected pace for each lap is:

`lap pace = baseline pace + bounded recent-trend offset + measured tyre-age loss + fuel-load loss + calibrated lift-and-coast loss`

Fuel-load loss is recalculated from the actual fuel carried at the start of each lap and falls as fuel is consumed. Tyre loss uses average equivalent age across all four corners, and only serviced corners reset at a stop. The planner exposes start, average, and end pace for each stint together with cumulative fuel, tyre, and trend losses.

For a sufficiently complete saved session, the fuel, tyre, and warm-up terms come from a robust multivariable stint regression rather than fixed generic coefficients. The fitted curve is centered on the selected median, trimmed-mean, or percentile baseline. The residual sigma describes lap-to-lap variation left unexplained by fuel, wear, and warm-up. This produces a P90 total-time range without inventing a permanent per-lap slowdown.

## Tyre degradation

When a measured tyre pace-degradation slope is available, each wheel has a tyre age measured in equivalent laps. For a used starting set, initial age is inferred independently per wheel:

`initial tyre age = current tyre wear / measured wear per lap`

The degradation added on a lap is:

`tyre degradation loss = measured degradation seconds per lap × average tyre age across four wheels`

Tyre age increases by one after each completed lap. At a pit stop, age resets to zero only for tyres actually changed. Refuelling without changing tyres does not reset degradation. If no measured degradation slope exists, tyre degradation time is unavailable and contributes zero to ranking.

## Pit-stop time

Every stop always includes the configured pit-lane driving loss, regardless of fuel quantity or tyre work:

`pit lane total = number of stops × pit lane loss per stop`

Fuel time is continuous rather than rounded to 5-litre blocks:

`fuel service time = fuel added / 5 × refuel seconds per 5 litres`

Tyre time is:

`tyre service time = tyres changed × seconds per tyre`

For sequential service:

`stop time = pit lane loss + fuel service time + tyre service time`

For parallel service:

`stop time = pit lane loss + max(fuel service time, tyre service time)`

There is no fixed 12-second stationary overhead. The legacy `pit_stationary_seconds` assumption is not used by either page's strategy calculation.

Under an active safety-car pit recommendation, the configured safety-car pit-lane loss replaces the normal pit-lane loss for each simulated stop.

## Fuel calculation

The planning fuel rate starts with robust measured fuel use. Each stint must fit within tank capacity and retain the required finish reserve. Fuel variance is accumulated statistically:

`fuel uncertainty = policy z-score * per-lap fuel sigma * sqrt(stint laps)`

At a stop, the simulator adds expected fuel, cumulative uncertainty, and reserve:

`fuel added = max(0, next stint expected fuel + uncertainty + reserve - fuel at pit entry)`

Less fuel at an individual stop reduces only refuelling time. It never reduces or removes the fixed pit-lane driving loss for that stop.

Stop-count feasibility is recalculated using the laps actually completed after pit/service time, rather than only the no-stop lap estimate. A candidate is discarded if its final fuel-only stop can be removed by merging its last two stints within the applicable fuel and virtual-energy range. Lift-and-coast candidates re-run the same stint partitioning with the reduced consumption rate, allowing the planner to show when saving can genuinely skip a stop rather than merely adding finish fuel.

## Final candidate time

The displayed final time is the sum of:

`base driving time`

`+ recent pace trend loss`

`+ tyre degradation loss when measured`

`+ lift-and-coast loss when calibrated`

`+ pit-lane loss for every stop`

`+ actual tyre and refuelling service`

`+ configured traffic penalty, currently zero on the live Pit Window`

Strategies are ranked first by laps completed, then by lowest final elapsed time, then by risk. Therefore a strategy completing fewer laps is never ranked ahead solely because its displayed elapsed time is shorter.
