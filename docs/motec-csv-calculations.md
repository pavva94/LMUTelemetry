# MoTeC / CSV Calculations

CSV analysis is offline and deterministic. Imported samples are stored in SQLite and retrieved in decimated form for frontend worksheets.

## Channel Registry

Each channel gets:

- Original/display name.
- Unit.
- Category.
- Type: `marker`, `lap`, `gps`, `perWheel`, or `scalar`.
- Wheel position when channel name contains `FL`, `FR`, `RL`, or `RR`.
- Default precision.
- Default graph type: `step` for `Gear`, otherwise `line`.
- Default scale for percent, gear, G-force, and ground speed.

## Derived Channels

Average channels:

- `Front Brake Temp Avg = avg(Brake Temp FL, Brake Temp FR)`
- `Rear Brake Temp Avg = avg(Brake Temp RL, Brake Temp RR)`
- `Front Tyre Pressure Avg = avg(Tyre Pressure FL, Tyre Pressure FR)`
- `Rear Tyre Pressure Avg = avg(Tyre Pressure RL, Tyre Pressure RR)`
- `Front Ride Height Avg = avg(Ride Height FL, Ride Height FR)`
- `Rear Ride Height Avg = avg(Ride Height RL, Ride Height RR)`
- `Tyre Temp Avg FL/FR/RL/RR = avg(Outer, Centre, Inner)`
- `Front/Rear/Left/Right Tyre Wear Avg = mean of the relevant corner wear channels`

Other derived channels:

- `Rake = Rear Ride Height Avg - Front Ride Height Avg`
- `Brake/Throttle Overlap = Brake Pos > 5 and Throttle Pos > 5`
- `Front Ride Height Min = min(Ride Height FL, Ride Height FR)`
- `Rear Ride Height Min = min(Ride Height RL, Ride Height RR)`
- `Combined G = hypot(G Force Lat, G Force Long)`
- `Lap-relative time = Time - first Time seen for that lap`

## Lap Accumulation

During import, rows are grouped by `Lap Number`.

Per-lap values:

- `start_time` and `end_time`: min/max of `Time`, falling back to `Session Elapsed Time`.
- `duration = end_time - start_time`.
- `max_speed = max(Ground Speed)`.
- `min_corner_speed = min(Min Corner Speed)`.
- `max_rpm = max(Engine RPM)`.
- `fuel_start = first Fuel Level`.
- `fuel_end = last Fuel Level`.
- `distance_km += previous_speed * delta_time / 3600` for `0 < delta_time <= 120`.
- `average_speed = distance_km / (duration / 3600)`.
- Tyre wear and pressure keep the latest value in the lap.
- Brake and engine temperatures keep the maximum value in the lap.
- Track and ambient temperature are averaged.

## Fuel Worksheet

Fuel lap rows are built from imported lap summaries:

- `refill_from_previous = lap.fuelStart - previous_lap.fuelEnd`.
- `refill_inside_lap = lap.fuelEnd - lap.fuelStart`.
- `fuelAdded = max(refill_from_previous, refill_inside_lap, 0)`.
- `pitStop = fuelAdded > 2 L`.
- A detected pit stop increments the stint number.
- `fuelUsed = lap.fuelStart - lap.fuelEnd` only when end fuel is not greater than start fuel.
- `averageFuel = mean(valid fuelUsed values)`.
- `estimated_laps_remaining = currentFuel / averageFuel`.

Graphs:

- Fuel trace: `Fuel Level` over `Session Elapsed Time`.
- Fuel Used Per Lap: bars for `fuelUsed` and `fuelAdded`.
- Fuel By Lap: lines for `fuelStart` and `fuelEnd`.

## Race Engineer Rules

The Race Engineer worksheet is rules-first and does not use an LLM.

### Driving

- If selected lap is slower than reference by more than `0.15s`, create a slower-lap hint.
  - More than `1.0s` is critical.
  - Otherwise warning.
- Delta loss checks `Delta Best` or `Realtime Loss`.
  - If worst delta minus first delta is more than `0.2s`, create a time-loss-zone hint.
  - More than `0.7s` is critical.
- If reference minimum speed is more than `4 km/h` faster than selected minimum speed, warn about low minimum speed.
- If reference average throttle is more than `4` channel units above selected average throttle, warn about weaker throttle application.
- Brake/throttle overlap ratio is `overlap_samples / selected_samples`.
  - More than `3%` warns.
  - More than `8%` is critical.
- Average absolute steering above `35` channel units warns about high steering demand.

### Setup

- Tyre shoulder imbalance:
  - `inner - outer` above `8 C` absolute warns.
  - Above `15 C` absolute is critical.
- Tyre centre balance:
  - `centre - average(inner, outer)` above `6 C` absolute warns.
- Pressure spread above `8 kPa` warns.
- Brake temperature spread above `80 C` warns.
- Bottoming risk is critical if front or rear minimum ride height is below `15 mm`.
- Average rake above `25 mm` absolute creates an informational hint.

### Strategy

- Fuel baseline reports average, min, max fuel use, and current fuel.
- Fuel variation warns when `maxFuel - minFuel > avgFuel * 0.12`.
- Fuel range estimates `currentFuel / avgFuel`.
- Pit stops are detected only from fuel increases greater than `2 L`; stops without refuelling are not detected by this rule.

### Stints

Stint summaries use fuel-based pit detection.

- Lap times include every lap with positive duration.
- First half and second half averages split lap times at `ceil(lap_count / 2)`.
- `degradationPerLap = (second_half_avg - first_half_avg) / max(lap_count / 2, 1)`.
- Fuel variance is population variance of valid `fuelUsed`.
- Tyre wear delta is average wear at last stint sample minus average wear at first stint sample.

Stint hints:

- `degradationPerLap > 0.12s/lap` warns.
- `degradationPerLap > 0.25s/lap` is critical.
- Fuel standard deviation above `averageFuelPerLap * 0.08` warns.
- Tyre wear delta above `8%` warns.
- Tyre wear delta above `15%` is critical.
- Stints with `<= 2` laps are marked as very short.
- Average pace spread between stints above `0.5s` warns.

