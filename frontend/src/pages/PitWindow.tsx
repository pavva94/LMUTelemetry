import { useMemo, useState } from "react";
import { SectionTitle } from "../components/SectionTitle";
import { StatusBadge } from "../components/StatusBadge";
import { simulateStrategies, type PaceEvidence, type StrategyCandidate, type StrategyRisk, type Wheel } from "../lib/strategySimulation";
import { formatDuration, formatRaceTime } from "../lib/timeFormat";
import type { StrategyState } from "../types/strategy";
import type { TelemetrySnapshot } from "../types/telemetry";

const fmt = (value: number | null | undefined, digits = 1, suffix = "") =>
  value == null || !Number.isFinite(value) ? "--" : `${value.toFixed(digits)}${suffix}`;
const pct = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "--" : `${Math.round(value * 100)}%`;
const text = (value?: string | number | boolean | null) => (value == null || value === "" ? "--" : String(value));
const wheels: Wheel[] = ["fl", "fr", "rl", "rr"];
const wheelLabels: Record<Wheel, string> = { fl: "FL", fr: "FR", rl: "RL", rr: "RR" };

function validLapTime(value?: number | null) {
  return value != null && Number.isFinite(value) && value >= 40 && value <= 900 ? value : null;
}

function liveNormalLapTime(telemetry?: TelemetrySnapshot | null, fallback?: number | null, pace?: StrategyState["pace"]) {
  if (validLapTime(pace?.weighted_recent_pace) != null) return { value: pace?.weighted_recent_pace ?? null, source: "weighted recent pace" };
  const playerCar = telemetry?.competitors.find((car) => car.is_player);
  const direct = validLapTime(playerCar?.last_lap_time) ?? validLapTime(playerCar?.estimated_lap_time) ?? validLapTime(playerCar?.best_lap_time);
  if (direct != null) return { value: direct, source: playerCar?.last_lap_time ? "player last lap" : playerCar?.estimated_lap_time ? "player estimate" : "player best lap" };
  return { value: fallback && fallback > 0 ? fallback : null, source: "strategy assumption" };
}

function paceEvidenceFromStrategy(strategy: StrategyState | null, fallback: number | null): PaceEvidence {
  const pace = strategy?.pace;
  return {
    lastLapTime: validLapTime(pace?.last_lap_time),
    last7LapAverage: validLapTime(pace?.last_7_lap_average),
    last10LapAverage: validLapTime(pace?.last_10_lap_average),
    weightedRecentPace: validLapTime(pace?.weighted_recent_pace) ?? validLapTime(fallback),
    paceTrendSecondsPerLap: Number.isFinite(pace?.pace_trend_seconds_per_lap) ? pace?.pace_trend_seconds_per_lap : null,
    paceDegradationPerLap: Number.isFinite(pace?.pace_degradation_per_lap) ? pace?.pace_degradation_per_lap : null,
    sampleLaps: pace?.sample_laps ?? 0,
    confidence: pace?.confidence || "low",
    source: pace?.weighted_recent_pace ? "live clean lap history" : "strategy assumption",
  };
}

function liveRemainingSeconds(telemetry: TelemetrySnapshot | null | undefined, lapTime: number | null, fallbackMinutes?: number) {
  const remaining = Number(telemetry?.session?.time_remaining);
  if (Number.isFinite(remaining) && remaining > 0) return { value: remaining, source: "session timer" };

  const current = Number(telemetry?.session?.current_time);
  const end = Number(telemetry?.session?.end_time);
  if (Number.isFinite(current) && Number.isFinite(end) && end > current) return { value: end - current, source: "session end time" };

  const currentLap = Number(telemetry?.player?.lap_number ?? telemetry?.session?.current_lap);
  const maxLaps = Number(telemetry?.session?.max_laps);
  if (lapTime != null && Number.isFinite(currentLap) && Number.isFinite(maxLaps) && maxLaps > currentLap) {
    return { value: (maxLaps - currentLap) * lapTime, source: "lap limit" };
  }

  return { value: fallbackMinutes && fallbackMinutes > 0 ? fallbackMinutes * 60 : null, source: "strategy assumption" };
}

function riskBadge(risk: StrategyRisk) {
  if (risk === "high") return "red";
  if (risk === "medium") return "amber";
  return "green";
}

function tyreWearText(values?: Record<Wheel, number> | null) {
  if (!values) return "--";
  return wheels.map((wheel) => `${wheelLabels[wheel]} ${pct(values[wheel])}`).join(" / ");
}

function tyreChangeWearText(stop: StrategyCandidate["stopsDetail"][number]) {
  if (!stop.tyresToChange.length) return "None";
  return stop.tyresToChange
    .map((wheel) => {
      const wear = stop.tyreWearBeforeStop?.[wheel];
      return wear == null ? wheelLabels[wheel] : `${wheelLabels[wheel]} ${pct(wear)}`;
    })
    .join(" / ");
}

function absoluteStopLap(currentLap: number | null, stopLap: number) {
  return currentLap == null ? stopLap : Math.max(currentLap, Math.round(currentLap + stopLap));
}

function tyreLife(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? null : Math.max(0, Math.min(1, 1 - value));
}

function tyreLifeTone(value: number | null) {
  if (value == null) return "unknown";
  if (value <= 0.25) return "critical";
  if (value <= 0.5) return "warning";
  return "healthy";
}

function TyreLifeIndicator({ wheel, wear, change }: { wheel: Wheel; wear: number | null | undefined; change: boolean }) {
  const life = tyreLife(wear);
  const lifePercent = life == null ? 0 : Math.round(life * 100);
  return (
    <div className={`tyre-life ${tyreLifeTone(life)}${change ? " change" : ""}`}>
      <div className="tyre-life-heading">
        <strong>{wheelLabels[wheel]}</strong>
        <span>{life == null ? "--" : `${lifePercent}%`}</span>
      </div>
      <div className="tyre-life-shape" aria-hidden="true">
        <span style={{ height: `${lifePercent}%` }} />
      </div>
      <small>{change ? "Change" : "Keep"}</small>
    </div>
  );
}

function LivePlanOption({
  plan,
  index,
  currentLap,
  selected,
  onSelect,
}: {
  plan: StrategyCandidate;
  index: number;
  currentLap: number | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const firstStop = plan.stopsDetail[0];
  return (
    <button
      className={`live-plan-option${selected ? " selected" : ""}`}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="live-plan-option-top">
        <b>Option {index + 1}</b>
        <i className={`badge ${riskBadge(plan.risk)}`}>{plan.risk}</i>
      </span>
      <strong>{firstStop ? `Pit lap ${absoluteStopLap(currentLap, firstStop.lap)}` : "Run to finish"}</strong>
      <span className="live-plan-option-time">{formatDuration(plan.totalTimeSeconds)}</span>
      <span>{plan.stops} stop{plan.stops === 1 ? "" : "s"} · {firstStop ? `add ${fmt(firstStop.fuelAddedLiters, 1, " L")}` : `${fmt(plan.finishFuelRemainingLiters, 1, " L")} finish fuel`}</span>
      <small>{firstStop?.tyresToChange.length ? `${firstStop.tyresToChange.map((wheel) => wheelLabels[wheel]).join(" + ")} tyres` : "No tyre change at next stop"}</small>
    </button>
  );
}

function LiveStrategyTimeline({ plan, currentLap }: { plan?: StrategyCandidate; currentLap: number | null }) {
  if (!plan) {
    return <div className="empty-state"><strong>No live strategy yet</strong><span>Need live fuel, lap time, tank capacity, and tyre data to calculate options.</span></div>;
  }
  return (
    <div className="strategy-timeline">
      <div className="strategy-visual-summary">
        <div><span className="label">Selected plan</span><strong>{formatDuration(plan.totalTimeSeconds)}</strong></div>
        <div><span className="label">Stops remaining</span><strong>{plan.stops}</strong></div>
        <div><span className="label">Race remaining</span><strong>{fmt(plan.raceLaps, 1, " laps")}</strong></div>
        <div><span className="label">Fuel at finish</span><strong>{fmt(plan.finishFuelRemainingLiters, 1, " L")}</strong></div>
      </div>
      <div className="strategy-track">
        {Array.from({ length: plan.stops + 1 }, (_, index) => {
          const stint = plan.stintWear[index];
          const stintLaps = stint ? stint.endLap - stint.startLap + 1 : plan.raceLaps / (plan.stops + 1);
          return (
          <span className="strategy-stint" key={index} style={{ width: `${(stintLaps / plan.raceLaps) * 100}%` }}>
            <strong>Stint {index + 1}</strong>
            <small>{Math.round(stintLaps)} laps</small>
          </span>
          );
        })}
        {plan.stopsDetail.map((stop, index) => (
          <span
            className="strategy-marker"
            key={`${stop.lap}-${index}`}
            style={{ left: `${Math.min(98, Math.max(2, (stop.lap / plan.raceLaps) * 100))}%` }}
          >
            <strong>Lap {absoluteStopLap(currentLap, stop.lap)}</strong>
            <small>Pit {index + 1}</small>
          </span>
        ))}
      </div>
      {plan.stintWear.length > 0 && (
        <div className="stint-service-list">
          {plan.stintWear.map((stint, index) => {
            const stop = plan.stopsDetail[index];
            const stintLaps = stint.endLap - stint.startLap + 1;
            return (
              <article className="stint-service" key={stint.stint}>
                <header>
                  <div>
                    <span className="label">Stint {stint.stint} · {stintLaps} laps</span>
                    <strong>{stop ? `Pit stop ${index + 1} · Lap ${absoluteStopLap(currentLap, stop.lap)}` : "Finish"}</strong>
                  </div>
                  {stop && <span className="badge amber">{fmt(stop.stopTimeSeconds, 1, " s")} stop</span>}
                </header>
                <div className="stint-service-body">
                  <div>
                    <span className="label">Tyre life at {stop ? "pit entry" : "finish"}</span>
                    <div className="tyre-life-set">
                      {wheels.map((wheel) => (
                        <TyreLifeIndicator
                          wheel={wheel}
                          wear={stint.endWear[wheel]}
                          change={Boolean(stop?.tyresToChange.includes(wheel))}
                          key={wheel}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="service-fuel">
                    <span className="label">Fuel service</span>
                    {stop ? (
                      <>
                        <strong>{fmt(stop.fuelRemainingLiters, 1, " L")} remaining</strong>
                        <b>+ {fmt(stop.fuelAddedLiters, 1, " L")} to add</b>
                      </>
                    ) : (
                      <>
                        <strong>{fmt(plan.finishFuelRemainingLiters, 1, " L")} remaining</strong>
                        <b>No service</b>
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PitWindow({ strategy, telemetry }: { strategy: StrategyState | null; telemetry?: TelemetrySnapshot | null }) {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const pit = strategy?.pit_window;
  const assumptions = strategy?.assumptions || {};
  const player = telemetry?.player;
  const tyres = player?.tyre_state;
  const currentLap = Number(player?.lap_number ?? telemetry?.session?.current_lap);
  const absoluteCurrentLap = Number.isFinite(currentLap) ? currentLap : null;
  const lapTime = liveNormalLapTime(telemetry, Number(assumptions.normal_lap_time), strategy?.pace);
  const paceEvidence = paceEvidenceFromStrategy(strategy, lapTime.value);
  const remaining = liveRemainingSeconds(telemetry, lapTime.value, Number(assumptions.race_duration_minutes));
  const fuelPerLap = Number(strategy?.fuel.fuel_per_lap_liters);
  const currentWear = Number(strategy?.tyres.average_wear ?? tyres?.average_wear);
  const wearRate = Number(strategy?.tyres.wear_rate_per_lap);
  const tankCapacity = Number(player?.fuel_capacity_liters ?? strategy?.fuel.fuel_capacity_liters);
  const currentFuel = Number(player?.fuel_liters);

  const plans = useMemo(() => simulateStrategies({
    raceDurationMinutes: remaining.value != null ? remaining.value / 60 : 0,
    normalLapTime: lapTime.value || Number(assumptions.normal_lap_time) || 0,
    paceEvidence,
    fuelPerLap: Number.isFinite(fuelPerLap) && fuelPerLap > 0 ? fuelPerLap : null,
    fuelObservedLaps: Number(strategy?.fuel.valid_laps_observed || 0),
    fuelRequiredLaps: Number(strategy?.fuel.valid_laps_required || 3),
    fuelConfidence: strategy?.fuel.confidence,
    tankCapacityLiters: Number.isFinite(tankCapacity) && tankCapacity > 0 ? tankCapacity : null,
    raceStartFuelLiters: Number.isFinite(currentFuel) && currentFuel > 0 ? currentFuel : null,
    fuelSafetyMarginLiters: Number(assumptions.fuel_safety_margin_liters ?? 2),
    pitLaneLossSeconds: Number(assumptions.pit_loss_seconds ?? 28),
    tyreChangeSecondsPerTyre: Number(assumptions.tyre_change_seconds_per_tyre ?? 3),
    refuelSecondsPer5Liters: Number(assumptions.refuel_seconds_per_5_liters ?? 1.2),
    currentTyreWear: Number.isFinite(currentWear) ? currentWear : null,
    currentTyreWearByWheel: {
      fl: tyres?.wear_fl,
      fr: tyres?.wear_fr,
      rl: tyres?.wear_rl,
      rr: tyres?.wear_rr,
    },
    tyreWearRatePerLap: Number.isFinite(wearRate) && wearRate > 0 ? wearRate : null,
    tyrePaceDegradationPerLap: Number(strategy?.tyres.pace_degradation_per_lap) || paceEvidence.paceDegradationPerLap,
    tyreConfidence: strategy?.tyres.confidence,
    maxTyreWear: Number(assumptions.max_tyre_wear ?? 0.75),
    // Traffic risk is shown categorically; no uncalibrated seconds penalty is
    // injected into strategy ranking.
    trafficPenaltySeconds: 0,
    safetyCarActive: Boolean(pit?.safety_car_pit_recommendation),
    safetyCarPitLossSeconds: Number(assumptions.safety_car_pit_loss_seconds ?? 16),
  }), [
    assumptions.fuel_safety_margin_liters,
    assumptions.max_tyre_wear,
    assumptions.normal_lap_time,
    assumptions.pit_loss_seconds,
    assumptions.refuel_seconds_per_5_liters,
    assumptions.safety_car_pit_loss_seconds,
    assumptions.tyre_change_seconds_per_tyre,
    currentFuel,
    currentWear,
    fuelPerLap,
    lapTime.value,
    paceEvidence.lastLapTime,
    paceEvidence.last7LapAverage,
    paceEvidence.last10LapAverage,
    paceEvidence.weightedRecentPace,
    paceEvidence.paceTrendSecondsPerLap,
    paceEvidence.paceDegradationPerLap,
    paceEvidence.sampleLaps,
    paceEvidence.confidence,
    pit?.safety_car_pit_recommendation,
    pit?.traffic_risk_after_stop,
    remaining.value,
    strategy?.fuel.valid_laps_observed,
    strategy?.fuel.valid_laps_required,
    strategy?.fuel.confidence,
    strategy?.tyres.confidence,
    strategy?.tyres.pace_degradation_per_lap,
    tankCapacity,
    tyres?.wear_fl,
    tyres?.wear_fr,
    tyres?.wear_rl,
    tyres?.wear_rr,
    wearRate,
  ]);
  const bestPlan = plans[0];
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? bestPlan;
  const activePlanId = selectedPlan?.id ?? null;
  const firstStop = selectedPlan?.stopsDetail[0];

  return (
    <div className="page grid pit-window-page">
      <section className="card span-12 pit-strategy-visualization">
        <SectionTitle title="Live Pit Strategy Visualization" help="Shows the selected live plan as a stint timeline, then details tyre life and fuel service at every pit stop." />
        <LiveStrategyTimeline plan={selectedPlan} currentLap={absoluteCurrentLap} />
      </section>

      <section className="card span-12 live-options-section">
        <SectionTitle title="Live Options" help="Compare every calculated strategy without losing sight of the selected race plan." />
        {plans.length ? (
          <div className="live-option-rail">
            {plans.map((plan, index) => (
              <LivePlanOption
                plan={plan}
                index={index}
                currentLap={absoluteCurrentLap}
                selected={plan.id === activePlanId}
                onSelect={() => setSelectedPlanId(plan.id)}
                key={plan.id}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state"><strong>No live strategy yet</strong><span>Need live fuel, lap time, tank capacity, and tyre/fuel model data before the pit call can be simulated.</span></div>
        )}
      </section>

      <section className="card span-5">
        <SectionTitle title="Live Pit Window" help="Combines the live pit-window model with strategy simulations from your current fuel, tyre wear, and remaining race distance." />
        <div className="metric"><span className="label">Earliest</span><span className="value">Lap {pit?.earliest_viable_pit_lap ?? "--"}</span></div>
        <div className="metric"><span className="label">Latest safe</span><span className="value">Lap {pit?.latest_safe_pit_lap ?? "--"}</span></div>
        <div className="metric"><span className="label">Optimal</span><span className="value">Lap {pit?.optimal_pit_lap ?? "--"}</span></div>
        <div className="row"><StatusBadge value={pit?.traffic_risk_after_stop} /><span className="subvalue">Rejoin P{pit?.projected_rejoin_position ?? "--"}</span></div>
      </section>

      <section className="card span-7">
        <SectionTitle title="Selected Live Call" help="Shows the currently selected strategy option translated into an actionable pit call." />
        <div className="header-grid">
          <div><span className="label">Call</span><strong>{firstStop ? `Pit lap ${absoluteStopLap(absoluteCurrentLap, firstStop.lap)}` : selectedPlan ? "Stay out" : "--"}</strong><span className="subvalue">{firstStop ? `in ${firstStop.lap} lap${firstStop.lap === 1 ? "" : "s"}` : "selected plan reaches finish"}</span></div>
          <div><span className="label">Fuel at stop</span><strong>{firstStop ? fmt(firstStop.fuelRemainingLiters, 1, " L") : fmt(currentFuel, 1, " L")}</strong><span className="subvalue">{firstStop ? `add ${fmt(firstStop.fuelAddedLiters, 1, " L")}` : `finish ${fmt(selectedPlan?.finishFuelRemainingLiters, 1, " L")}`}</span></div>
          <div><span className="label">Tyres to change</span><strong>{firstStop ? tyreChangeWearText(firstStop) : "None"}</strong></div>
          <div><span className="label">Stop time</span><strong>{firstStop ? fmt(firstStop.stopTimeSeconds, 1, " s") : "0 s"}</strong></div>
          <div><span className="label">Remaining</span><strong>{formatDuration(remaining.value)}</strong><span className="subvalue">{remaining.source}</span></div>
          <div><span className="label">Pace model</span><strong>{formatRaceTime(paceEvidence.weightedRecentPace)}</strong><span className="subvalue">{paceEvidence.source}</span></div>
        </div>
      </section>

      <section className="card span-12">
        <SectionTitle title="Pace Model" help="Shows the clean recent lap evidence used by the live strategy simulation." />
        <div className="motec-value-grid">
          <div><span className="label">Last clean lap</span><strong>{formatRaceTime(paceEvidence.lastLapTime)}</strong></div>
          <div><span className="label">Last 7 average</span><strong>{formatRaceTime(paceEvidence.last7LapAverage)}</strong></div>
          <div><span className="label">Last 10 average</span><strong>{formatRaceTime(paceEvidence.last10LapAverage)}</strong></div>
          <div><span className="label">Weighted pace</span><strong>{formatRaceTime(paceEvidence.weightedRecentPace)}</strong><span className="subvalue">{paceEvidence.source}</span></div>
          <div><span className="label">Trend</span><strong>{fmt(paceEvidence.paceTrendSecondsPerLap, 3, " s/lap")}</strong><span className="subvalue">positive means slowing</span></div>
          <div><span className="label">Confidence</span><strong>{paceEvidence.confidence || "low"}</strong><span className="subvalue">{paceEvidence.sampleLaps ?? 0} clean laps</span></div>
        </div>
      </section>

      <section className="card span-12">
        <SectionTitle title="Live Model Inputs" help="Summarizes the live data feeding the strategy options. Confidence improves as fuel and tyre samples accumulate." />
        <div className="motec-value-grid">
          <div><span className="label">Current lap</span><strong>{text(absoluteCurrentLap)}</strong><span className="subvalue">absolute race lap</span></div>
          <div><span className="label">Current fuel</span><strong>{fmt(currentFuel, 1, " L")}</strong><span className="subvalue">{fmt(tankCapacity, 1, " L")} tank</span></div>
          <div><span className="label">Fuel use</span><strong>{fmt(Number.isFinite(fuelPerLap) ? fuelPerLap : null, 3, " L/lap")}</strong><span className="subvalue">{strategy?.fuel.valid_laps_observed ?? 0}/{strategy?.fuel.valid_laps_required ?? 3} valid laps</span></div>
          <div><span className="label">Tyre wear</span><strong>{pct(Number.isFinite(currentWear) ? currentWear : null)}</strong><span className="subvalue">{tyreWearText({ fl: tyres?.wear_fl ?? currentWear, fr: tyres?.wear_fr ?? currentWear, rl: tyres?.wear_rl ?? currentWear, rr: tyres?.wear_rr ?? currentWear })}</span></div>
          <div><span className="label">Wear rate</span><strong>{fmt(Number.isFinite(wearRate) ? wearRate * 100 : null, 2, "% / lap")}</strong><span className="subvalue">max {pct(Number(assumptions.max_tyre_wear ?? 0.75))}</span></div>
          <div><span className="label">Pit model</span><strong>{fmt(Number(assumptions.pit_loss_seconds ?? 28), 1, " s")}</strong><span className="subvalue">tyre {fmt(Number(assumptions.tyre_change_seconds_per_tyre ?? 3), 1, " s")} / fuel {fmt(Number(assumptions.refuel_seconds_per_5_liters ?? 1.2), 1, " s per 5L")}</span></div>
          <div><span className="label">Safety car</span><strong>{pit?.safety_car_pit_recommendation ? "Active pit gain" : "Not applied"}</strong><span className="subvalue">{fmt(Number(assumptions.safety_car_pit_loss_seconds ?? 16), 1, " s")} pit loss if active</span></div>
          <div><span className="label">Fuel margin now</span><strong>{fmt(strategy?.fuel.fuel_delta_to_finish, 1, " L")}</strong><span className="subvalue">{strategy?.fuel.confidence || "low"} confidence</span></div>
          <div><span className="label">Traffic risk</span><strong>{text(pit?.traffic_risk_after_stop)}</strong><span className="subvalue">rejoin P{pit?.projected_rejoin_position ?? "--"}</span></div>
        </div>
      </section>

      {selectedPlan && (
        <section className="card span-12">
          <SectionTitle title="Live Calculation Breakdown" help="Shows every selected-plan input and penalty used to rank the live pit call." />
          <div className="table-wrap">
            <table>
              <thead><tr><th>Input</th><th>Value</th><th>Used for</th></tr></thead>
              <tbody>
                <tr><td>Weighted pace</td><td>{formatRaceTime(selectedPlan.calculationBreakdown.simulationPaceSeconds)}</td><td>Remaining laps and base driving time</td></tr>
                <tr><td>Remaining race laps</td><td>{fmt(selectedPlan.raceLaps, 2)}</td><td>Fuel and stint projection</td></tr>
                <tr><td>Base driving time</td><td>{formatDuration(selectedPlan.baseRaceTimeSeconds)}</td><td>Total time baseline</td></tr>
                <tr><td>Pit/service time</td><td>{fmt(selectedPlan.pitTimeSeconds, 1, " s")}</td><td>Pit lane, tyres, and refuelling</td></tr>
                <tr><td>Recent pace trend loss</td><td>{fmt(selectedPlan.projectedPaceLossSeconds, 1, " s")}</td><td>Linear projection of the recent 10-lap regression slope</td></tr>
                <tr><td>Tyre degradation loss</td><td>{fmt(selectedPlan.tyreDegradationLossSeconds, 1, " s")}</td><td>Applied only when a measured tyre/pace slope is supplied</td></tr>
                <tr><td>Lift/coast loss</td><td>{fmt(selectedPlan.liftCoastLossSeconds, 1, " s")}</td><td>Not monetized without a calibrated pace-cost assumption</td></tr>
                <tr><td>Traffic loss</td><td>{fmt(selectedPlan.trafficLossSeconds, 1, " s")}</td><td>Risk shown separately; no fixed seconds invented</td></tr>
                <tr><td>Fuel model</td><td>{fmt(selectedPlan.calculationBreakdown.fuelUseLitersPerLap, 3, " L/lap")}</td><td>Fuel range and stop fuel</td></tr>
                <tr><td>Finish fuel</td><td>{fmt(selectedPlan.finishFuelRemainingLiters, 1, " L")}</td><td>Reserve and risk</td></tr>
                <tr><td>Confidence</td><td>{selectedPlan.confidence}</td><td>Fuel, tyre, pace, and risk quality</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

    </div>
  );
}
