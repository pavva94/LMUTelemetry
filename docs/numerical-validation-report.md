# Numerical Validation Report

Audit completed: 2026-06-20. Scope: every non-graph numerical surface in the LMU Telemetry Dashboard. Graph rendering was not redesigned; its source rows were checked where they also feed summaries.

## Evidence baseline

- Initial live-store snapshot: `data/sessions/lmu_strategy.sqlite3` — 90,424 samples, 263 detected laps, 22 finalized aggregates, 64 sessions. The final running-app snapshot contained 91,867 samples, 278 laps, 24 aggregates, and 68 sessions after normal collector startup/finalization during validation.
- Final native LMU cache/folder snapshot: 619 active DuckDB sessions and 4,019 cached detected laps (611 / 3,975 at the initial inventory; newer files were synced during validation).
- Repeatable read-only harness: `backend/.venv/Scripts/python.exe backend/scripts/audit_real_data.py --app-metrics [--duckdb-file FILE]`.
- Regression verification: 79 backend tests and 36 frontend tests passed; the production frontend build passed.

The initial recomputation found 21 of 22 stored live aggregates disagreed with clean-lap recomputation. Every one of the 263 old lap rows was marked valid despite 50 times outside 40–900 seconds, 67 pit laps, and a range of -1 to 2,816.7 seconds. Pit/refuel laps produced false 50–87 L consumption values. Historical review responses now reclassify laps and recalculate headline lap/fuel metrics on read; telemetry databases are not rewritten.

## Metric contract and result

| Surface | Definition and weighting | Eligibility / unavailable rule | Unit | Result |
| --- | --- | --- | --- | --- |
| Completed lap time | Official preceding-lap time when coherent with the boundary (within 2 s), otherwise boundary delta. Final open group is partial. | Finite 40–900 s; no pit, yellow, partial, or source-invalid lap; after 3 candidates require 0.75×–1.8× session median. | s | Corrected and shared by live/history/native paths. |
| Best / average lap | Minimum / arithmetic mean of eligible laps; lap-weighted. | No eligible laps → unavailable. | s | Corrected, including old stored aggregates on read. |
| Lap count | Completed-valid, pace-clean, and all detected groups are distinct. Native pace summaries may additionally apply an IQR filter without changing completed validity. | Invalid rows remain visible with reasons; pace-clean sample size is displayed beside its average. | laps | UI now says “Valid / detected laps” and identifies pace-clean count. |
| Clean-lap fuel | Non-negative endpoint reduction on completed-valid laps; sum for total, outlier-filtered average for native review, recent up-to-5 arithmetic mean for strategy. | Pit/refuel/partial/invalid excluded; a pace outlier is not silently removed from total fuel. Strategy requires 3 laps (medium), 5 (high). | L, L/lap | False 50–87 L values removed; population σ exposed. |
| Fuel range | Current fuel / recent clean-lap mean. | Unavailable with fewer than 3 eligible fuel laps or non-positive rate. | laps | Corrected; reason codes explain insufficiency. |
| Tyre wear | Canonical internal scale is fraction used (0–1). Native LMU `% remaining` becomes `(100-value)/100`. Summary is sample-weighted and explicitly labelled. | Trend uses positive eligible-lap deltas <0.2 and resets after a pit/tyre change; no trend → unavailable. | %, fraction/lap | Corrected across live, native cache, profile, Race Prep, and UI. |
| Tyre life | `(configured wear limit - current used fraction) / recent wear rate`. | Requires an eligible post-stop trend; no fabricated pace penalty. | laps | Corrected. |
| Distance | Trapezoidal integration of adjacent speed samples; accept finite `0 < Δt ≤ 5 s`. Native lap distance is integrated the same way. | Gaps >5 s and negative/non-finite speeds are ignored. | km | Corrected; independent of chart downsampling. |
| Top speed | Maximum finite mapped speed sample. | No speed samples → unavailable. | km/h | Verified against native channel maximum. |
| Recent pace | OLS slope in seconds/lap over up to 10 eligible laps; recent pace is arithmetic mean of the last five eligible laps. | Fewer than required observations → unavailable/reduced confidence. | s, s/lap | Corrected; no average-of-overlapping-averages. |
| Pit rejoin | Count competitors with a real `gap_to_player` inside predicted pit-loss interval. | Missing field gaps → unknown; no fabricated field-size divisor. | position | Corrected. |
| Pit/strategy totals | Explicit driving time + measured/configured pit service. Fuel feasibility simulates tank capacity and safety margin per stint. | Traffic penalty, tyre pace loss, and lift/coast pace cost are zero/unavailable unless measured or explicitly configured. | s, L | Removed fixed 8/4 s traffic and 0.2× lift/coast inventions. |
| Profile totals | Native cache sessions/laps; distance includes actual recorded travel. Completed driving time includes lap number ≥1, 40–900 s, and absent or ≥0.5 km distance; ranking records use the stricter eligibility rule. | Detected, broadly completed, and ranking-valid lap counts are shown separately. Classification counts are unavailable without evidence, not zero. | km, s, laps, sessions | Corrected numeric-string parsing, 19.4 h of partial/corrupt duration inflation, and false stationary “best laps”. |
| Profile rankings | Group by track/layout/car/class; fastest eligible lap per key. | Lap number ≥1, time 40–900 s and 0.85×–1.35× robust session median, distance absent or ≥0.5 km. | s | Corrected. |
| Formatting | Round milliseconds before carrying seconds/minutes; durations ≥1 h use `h:mm:ss.mmm`. | Null, empty string, and booleans are unavailable, never numeric zero. | display | Corrected across profile/session/strategy surfaces. |

Sample-derived temperature, pressure, brake temperature, and tyre-wear cards are labelled “Sample avg” to make their weighting explicit. Tyre pressure is labelled kPa. Time tables retain full numeric precision internally and round only at display.

## Real-session proof

Native file `Silverstone Circuit_P_2026-06-19T19_36_08Z.duckdb` was parsed through the application code and checked against raw channel tables:

| Metric | Application result | Independent/raw evidence |
| --- | ---: | --- |
| Laps | 7 valid / 9 detected; 6 pace-clean | Lap boundaries 8–16; lap 8 pit, lap 16 partial; slow lap 9 excluded only from IQR pace summary |
| Best lap | 105.754150390625 s | Raw `Best LapTime` final value 105.754150390625 |
| Average lap | 106.76542317708333 s | Mean of 7 eligible laps |
| Recent 5-lap pace | 106.5705078125 s | Mean of last 5 eligible laps |
| Fuel used | 20.661762237548828 L | Sum of 7 completed-valid positive endpoint reductions |
| Average fuel/lap | 2.9516803196498325 L | Arithmetic mean of the 7 eligible positive reductions (outlier filter retained all seven) |
| Top speed | 290.5185852050781 km/h | Maximum mapped `Ground Speed` |
| Distance | 47.616515185949645 km | Trapezoidal speed/time integration |
| Tyre wear used | 5.6257113396298415% | Raw `Tyres Wear` is percent remaining |
| Tyre life remaining | 94.37428866037015% | 100 − used percent |
| Tyre pressure | 153.32377955075893 kPa | Raw channel metadata unit `kPa` |

## Page audit disposition

Live Dashboard, Race Info, Strategy Planner, Pit Window, Session Review, User Profile, Race Prep, Race Engineering pages, and native DuckDB review were traced through API/parser → calculation → formatter. Competitor values remain direct telemetry/model outputs; missing gaps/results remain unavailable. All user-facing derived values now have either an auditable formula above, a direct-source definition, or an explicit unavailable state.

## Known limitations

- Old databases are corrected at read time, not destructively migrated. Lifetime counters already persisted from historical sessions remain historical counters.
- Sample-weighted thermal/pressure summaries can differ from lap-weighted summaries by design; labels now state the weighting.
- Strategy cannot truthfully estimate unmeasured tyre pace loss, traffic time, or lift/coast time cost. Those components remain zero/unavailable until a measured/configured model exists.
- Native files without the expected timing/channel schema remain visible with warnings but do not produce invented summaries.
