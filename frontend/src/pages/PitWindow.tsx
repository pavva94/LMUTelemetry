import { useMemo, useState } from "react";
import { SectionTitle } from "../components/SectionTitle";
import { StatusBadge } from "../components/StatusBadge";
import { simulateStrategies, type StrategyCandidate, type StrategyRisk, type Wheel } from "../lib/strategySimulation";
import { formatRaceTime } from "../lib/timeFormat";
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

function liveNormalLapTime(telemetry?: TelemetrySnapshot | null, fallback?: number | null) {
  const playerCar = telemetry?.competitors.find((car) => car.is_player);
  const direct = validLapTime(playerCar?.last_lap_time) ?? validLapTime(playerCar?.estimated_lap_time) ?? validLapTime(playerCar?.best_lap_time);
  if (direct != null) return { value: direct, source: playerCar?.last_lap_time ? "player last lap" : playerCar?.estimated_lap_time ? "player estimate" : "player best lap" };
  return { value: fallback && fallback > 0 ? fallback : null, source: "strategy assumption" };
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

function LivePlanCard({
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
    <section className={`card span-4 strategy-card${selected ? " selected" : ""}`}>
      <div className="row">
        <span className="badge blue">Live option {index + 1}</span>
        <span className={`badge ${riskBadge(plan.risk)}`}>{plan.risk} risk</span>
      </div>
      <h2>{firstStop ? `Pit lap ${absoluteStopLap(currentLap, firstStop.lap)}` : "Run to finish"}</h2>
      <div className="strategy-card-main">
        <strong>{formatRaceTime(plan.totalTimeSeconds)}</strong>
        <span>{plan.stops} stop{plan.stops === 1 ? "" : "s"} from now - up to {plan.maxTyresChangedPerStop} tyre{plan.maxTyresChangedPerStop === 1 ? "" : "s"} when needed</span>
      </div>
      <div className="header-grid two">
        <div><span className="label">Next stop</span><strong>{firstStop ? `Lap ${absoluteStopLap(currentLap, firstStop.lap)}` : "None"}</strong><span className="subvalue">{firstStop ? `in ${firstStop.lap} lap${firstStop.lap === 1 ? "" : "s"}` : "fuel and tyres can finish"}</span></div>
        <div><span className="label">Pit time</span><strong>{fmt(plan.pitTimeSeconds, 1, " s")}</strong></div>
        <div><span className="label">Fuel to add</span><strong>{firstStop ? fmt(firstStop.fuelAddedLiters, 1, " L") : "0 L"}</strong><span className="subvalue">{firstStop ? `${fmt(firstStop.fuelRemainingLiters, 1, " L")} left before stop` : `${fmt(plan.finishFuelRemainingLiters, 1, " L")} at finish`}</span></div>
        <div><span className="label">Tyres</span><strong>{firstStop ? tyreChangeWearText(firstStop) : "None"}</strong></div>
        <div><span className="label">Finish fuel</span><strong>{fmt(plan.finishFuelRemainingLiters, 1, " L")}</strong></div>
        <div><span className="label">Lift/coast</span><strong>{fmt(plan.liftCoastSavePercent, 1, "%")}</strong></div>
      </div>
      <div className="metric compact">
        <span className="label">Live reasoning</span>
        {plan.reasons.map((reason) => <span className="subvalue" key={reason}>{reason}</span>)}
      </div>
      <button className={`strategy-select${selected ? " active-control" : ""}`} type="button" onClick={onSelect}>
        {selected ? "Selected live strategy" : "Select live strategy"}
      </button>
    </section>
  );
}

function LiveStrategyTimeline({ plan, currentLap }: { plan?: StrategyCandidate; currentLap: number | null }) {
  if (!plan) {
    return <div className="empty-state"><strong>No live strategy yet</strong><span>Need live fuel, lap time, tank capacity, and tyre data to calculate options.</span></div>;
  }
  return (
    <div className="strategy-timeline">
      <div className="strategy-track">
        {Array.from({ length: plan.stops + 1 }, (_, index) => (
          <span className="strategy-stint" key={index} style={{ width: `${100 / (plan.stops + 1)}%` }}>
            Stint {index + 1}
          </span>
        ))}
        {plan.stopsDetail.map((stop, index) => (
          <span
            className="strategy-marker"
            key={`${stop.lap}-${index}`}
            style={{ left: `${Math.min(98, Math.max(2, (stop.lap / plan.raceLaps) * 100))}%` }}
          >
            <strong>Lap {absoluteStopLap(currentLap, stop.lap)}</strong>
            <small>{fmt(stop.fuelRemainingLiters, 1, " L")} left - add {fmt(stop.fuelAddedLiters, 1, " L")} - {tyreChangeWearText(stop)} - {fmt(stop.stopTimeSeconds, 1, " s")}</small>
          </span>
        ))}
      </div>
      <div className="strategy-summary-line">
        <span>Remaining {fmt(plan.raceLaps, 1, " laps")}</span>
        <span>Finish fuel {fmt(plan.finishFuelRemainingLiters, 1, " L")}</span>
        <span>{plan.liftCoastSavePercent > 0 ? `Lift/coast ${fmt(plan.liftCoastSaveLitersPerLap, 3, " L/lap")}` : "No fuel save required"}</span>
        <span>Final wear {tyreWearText(plan.projectedTyreWearByWheel)}</span>
      </div>
      {plan.stintWear.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Stint</th><th>Live laps</th><th>Start wear</th><th>End wear</th><th>Wear remaining</th></tr></thead>
            <tbody>
              {plan.stintWear.map((stint) => (
                <tr key={stint.stint}>
                  <td>{stint.stint}</td>
                  <td>{stint.startLap}-{stint.endLap}</td>
                  <td>{tyreWearText(stint.startWear)}</td>
                  <td>{tyreWearText(stint.endWear)}</td>
                  <td>{tyreWearText(stint.remainingWear)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
  const lapTime = liveNormalLapTime(telemetry, Number(assumptions.normal_lap_time));
  const remaining = liveRemainingSeconds(telemetry, lapTime.value, Number(assumptions.race_duration_minutes));
  const fuelPerLap = Number(strategy?.fuel.fuel_per_lap_liters);
  const currentWear = Number(strategy?.tyres.average_wear ?? tyres?.average_wear);
  const wearRate = Number(strategy?.tyres.wear_rate_per_lap);
  const tankCapacity = Number(player?.fuel_capacity_liters ?? strategy?.fuel.fuel_capacity_liters);
  const currentFuel = Number(player?.fuel_liters);

  const plans = useMemo(() => simulateStrategies({
    raceDurationMinutes: remaining.value != null ? remaining.value / 60 : 0,
    normalLapTime: lapTime.value || Number(assumptions.normal_lap_time) || 0,
    fuelPerLap: Number.isFinite(fuelPerLap) && fuelPerLap > 0 ? fuelPerLap : null,
    fuelObservedLaps: Number(strategy?.fuel.valid_laps_observed || 0),
    fuelRequiredLaps: Number(strategy?.fuel.valid_laps_required || 3),
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
    maxTyreWear: Number(assumptions.max_tyre_wear ?? 0.75),
  }), [
    assumptions.fuel_safety_margin_liters,
    assumptions.max_tyre_wear,
    assumptions.normal_lap_time,
    assumptions.pit_loss_seconds,
    assumptions.refuel_seconds_per_5_liters,
    assumptions.tyre_change_seconds_per_tyre,
    currentFuel,
    currentWear,
    fuelPerLap,
    lapTime.value,
    remaining.value,
    strategy?.fuel.valid_laps_observed,
    strategy?.fuel.valid_laps_required,
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
    <div className="page grid">
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
          <div><span className="label">Remaining</span><strong>{formatRaceTime(remaining.value)}</strong><span className="subvalue">{remaining.source}</span></div>
          <div><span className="label">Live lap</span><strong>{formatRaceTime(lapTime.value)}</strong><span className="subvalue">{lapTime.source}</span></div>
        </div>
      </section>

      <section className="card span-12">
        <SectionTitle title="Live Model Inputs" help="Summarizes the live data feeding the strategy options. Confidence improves as fuel and tyre samples accumulate." />
        <div className="motec-value-grid">
          <div><span className="label">Current lap</span><strong>{text(absoluteCurrentLap)}</strong><span className="subvalue">absolute race lap</span></div>
          <div><span className="label">Current fuel</span><strong>{fmt(currentFuel, 1, " L")}</strong><span className="subvalue">{fmt(tankCapacity, 1, " L")} tank</span></div>
          <div><span className="label">Fuel use</span><strong>{fmt(Number.isFinite(fuelPerLap) ? fuelPerLap : null, 3, " L/lap")}</strong><span className="subvalue">{strategy?.fuel.valid_laps_observed ?? 0}/{strategy?.fuel.valid_laps_required ?? 3} valid laps</span></div>
          <div><span className="label">Tyre wear</span><strong>{pct(Number.isFinite(currentWear) ? currentWear : null)}</strong><span className="subvalue">{fmt(Number.isFinite(wearRate) ? wearRate * 100 : null, 2, "% / lap")}</span></div>
          <div><span className="label">Fuel margin now</span><strong>{fmt(strategy?.fuel.fuel_delta_to_finish, 1, " L")}</strong><span className="subvalue">{strategy?.fuel.confidence || "low"} confidence</span></div>
          <div><span className="label">Traffic risk</span><strong>{text(pit?.traffic_risk_after_stop)}</strong><span className="subvalue">rejoin P{pit?.projected_rejoin_position ?? "--"}</span></div>
        </div>
      </section>

      {plans.length ? plans.map((plan, index) => (
        <LivePlanCard
          plan={plan}
          index={index}
          currentLap={absoluteCurrentLap}
          selected={plan.id === activePlanId}
          onSelect={() => setSelectedPlanId(plan.id)}
          key={plan.id}
        />
      )) : (
        <section className="card span-12"><div className="empty-state"><strong>No live strategy yet</strong><span>Need live fuel, lap time, tank capacity, and tyre/fuel model data before the pit call can be simulated.</span></div></section>
      )}

      <section className="card span-12">
        <SectionTitle title="Live Pit Strategy Visualization" help="Shows the selected live plan with stop lap, fuel remaining, fuel load, tyre wear at change, and stop time." />
        <LiveStrategyTimeline plan={selectedPlan} currentLap={absoluteCurrentLap} />
      </section>
    </div>
  );
}
