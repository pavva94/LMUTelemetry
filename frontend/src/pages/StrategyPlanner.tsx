import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { SectionTitle } from "../components/SectionTitle";
import { simulateStrategies, type StrategyCandidate, type StrategyRisk } from "../lib/strategySimulation";
import { formatRaceTime } from "../lib/timeFormat";
import type { StrategyState } from "../types/strategy";
import type { TelemetrySnapshot } from "../types/telemetry";

type FormState = {
  race_duration_minutes: number;
  normal_lap_time: number;
  race_start_fuel_liters: number;
  tank_capacity_liters: number;
  fuel_safety_margin_liters: number;
  pit_loss_seconds: number;
  tyre_change_seconds_per_tyre: number;
  refuel_seconds_per_5_liters: number;
  max_tyre_wear: number;
  pit_stationary_seconds: number;
  safety_car_pit_loss_seconds: number;
  fuel_safety_margin_laps: number;
};

const fmt = (value: number | null | undefined, digits = 1, suffix = "") =>
  value == null || !Number.isFinite(value) ? "--" : `${value.toFixed(digits)}${suffix}`;
const pct = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "--" : `${Math.round(value * 100)}%`;

function validLapTime(value?: number | null) {
  return value != null && Number.isFinite(value) && value >= 40 && value <= 900 ? value : null;
}

function liveNormalLapTime(telemetry?: TelemetrySnapshot | null, fallback?: number | null) {
  const playerCar = telemetry?.competitors.find((car) => car.is_player);
  const direct = validLapTime(playerCar?.last_lap_time) ?? validLapTime(playerCar?.estimated_lap_time) ?? validLapTime(playerCar?.best_lap_time);
  if (direct != null) return { value: direct, source: playerCar?.last_lap_time ? "player last lap" : playerCar?.estimated_lap_time ? "player estimate" : "player best lap" };
  return { value: fallback && fallback > 0 ? fallback : null, source: "manual input" };
}

function liveRaceDurationMinutes(telemetry?: TelemetrySnapshot | null) {
  const endTime = Number(telemetry?.session?.end_time);
  if (Number.isFinite(endTime) && endTime > 0) return endTime / 60;
  const currentTime = Number(telemetry?.session?.current_time);
  const remaining = Number(telemetry?.session?.time_remaining);
  if (Number.isFinite(currentTime) && Number.isFinite(remaining) && currentTime >= 0 && remaining > 0) return (currentTime + remaining) / 60;
  return null;
}

function riskBadge(risk: StrategyRisk) {
  if (risk === "high") return "red";
  if (risk === "medium") return "amber";
  return "green";
}

function numberFrom(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function seededForm(strategy: StrategyState | null, telemetry?: TelemetrySnapshot | null, current?: FormState): FormState {
  const tank = numberFrom(telemetry?.player?.fuel_capacity_liters ?? strategy?.fuel.fuel_capacity_liters, current?.tank_capacity_liters ?? 90);
  const assumptions = strategy?.assumptions || {};
  return {
    race_duration_minutes: liveRaceDurationMinutes(telemetry) ?? numberFrom(assumptions.race_duration_minutes, current?.race_duration_minutes ?? 120),
    normal_lap_time: numberFrom(assumptions.normal_lap_time, current?.normal_lap_time ?? 214),
    race_start_fuel_liters: numberFrom(assumptions.race_start_fuel_liters, tank),
    tank_capacity_liters: tank,
    fuel_safety_margin_liters: numberFrom(assumptions.fuel_safety_margin_liters, current?.fuel_safety_margin_liters ?? 2),
    pit_loss_seconds: numberFrom(assumptions.pit_loss_seconds, current?.pit_loss_seconds ?? 28),
    tyre_change_seconds_per_tyre: numberFrom(assumptions.tyre_change_seconds_per_tyre, current?.tyre_change_seconds_per_tyre ?? 3),
    refuel_seconds_per_5_liters: numberFrom(assumptions.refuel_seconds_per_5_liters, current?.refuel_seconds_per_5_liters ?? 1.2),
    max_tyre_wear: numberFrom(assumptions.max_tyre_wear, current?.max_tyre_wear ?? 0.75),
    pit_stationary_seconds: numberFrom(assumptions.pit_stationary_seconds, current?.pit_stationary_seconds ?? 12),
    safety_car_pit_loss_seconds: numberFrom(assumptions.safety_car_pit_loss_seconds, current?.safety_car_pit_loss_seconds ?? 16),
    fuel_safety_margin_laps: numberFrom(assumptions.fuel_safety_margin_laps, current?.fuel_safety_margin_laps ?? 1),
  };
}

function PlanCard({ plan, index }: { plan: StrategyCandidate; index: number }) {
  return (
    <section className="card span-4 strategy-card">
      <div className="row">
        <span className="badge blue">Choice {index + 1}</span>
        <span className={`badge ${riskBadge(plan.risk)}`}>{plan.risk} risk</span>
      </div>
      <h2>{plan.label}</h2>
      <div className="strategy-card-main">
        <strong>{formatRaceTime(plan.totalTimeSeconds)}</strong>
        <span>{plan.stops} stop{plan.stops === 1 ? "" : "s"} · {plan.tyresChangedPerStop} tyre{plan.tyresChangedPerStop === 1 ? "" : "s"} per stop</span>
      </div>
      <div className="header-grid two">
        <div><span className="label">Pit time</span><strong>{fmt(plan.pitTimeSeconds, 1, " s")}</strong></div>
        <div><span className="label">Stint</span><strong>{fmt(plan.stintLaps, 1, " laps")}</strong></div>
        <div><span className="label">Fuel margin</span><strong>{fmt(plan.fuelMarginLiters, 1, " L")}</strong></div>
        <div><span className="label">Lift/coast</span><strong>{fmt(plan.liftCoastSavePercent, 1, "%")}</strong></div>
      </div>
      <div className="metric compact">
        <span className="label">Why this is shown</span>
        {plan.reasons.map((reason) => <span className="subvalue" key={reason}>{reason}</span>)}
      </div>
    </section>
  );
}

function StrategyTimeline({ plan }: { plan?: StrategyCandidate }) {
  if (!plan) {
    return <div className="empty-state"><strong>No strategy yet</strong><span>Collect valid fuel data or edit assumptions to create a race plan.</span></div>;
  }
  const markers = plan.stopsDetail;
  return (
    <div className="strategy-timeline">
      <div className="strategy-track">
        {Array.from({ length: plan.stops + 1 }, (_, index) => (
          <span
            className="strategy-stint"
            key={index}
            style={{ width: `${100 / (plan.stops + 1)}%` }}
          >
            Stint {index + 1}
          </span>
        ))}
        {markers.map((stop, index) => (
          <span
            className="strategy-marker"
            key={`${stop.lap}-${index}`}
            style={{ left: `${Math.min(98, Math.max(2, (stop.lap / plan.raceLaps) * 100))}%` }}
          >
            <strong>Lap {stop.lap}</strong>
            <small>{fmt(stop.fuelAddedLiters, 1, " L")} · {stop.tyresChanged} tyres · {fmt(stop.stopTimeSeconds, 1, " s")}</small>
          </span>
        ))}
      </div>
      <div className="strategy-summary-line">
        <span>Race {fmt(plan.raceLaps, 1, " laps")}</span>
        <span>{plan.liftCoastSavePercent > 0 ? `Lift/coast ${fmt(plan.liftCoastSaveLitersPerLap, 3, " L/lap")}` : "No fuel save required"}</span>
        <span>Projected wear {pct(plan.projectedTyreWear)}</span>
      </div>
    </div>
  );
}

export function StrategyPlanner({ strategy, telemetry }: { strategy: StrategyState | null; telemetry?: TelemetrySnapshot | null }) {
  const seededSession = useRef<string | null>(null);
  const [form, setForm] = useState<FormState>(() => seededForm(strategy, telemetry));
  useEffect(() => {
    const sessionKey = `${telemetry?.session?.track_name || ""}:${telemetry?.session?.session_type || ""}:${telemetry?.session?.end_time || ""}`;
    if (!sessionKey.trim() || seededSession.current === sessionKey) return;
    setForm((current) => seededForm(strategy, telemetry, current));
    seededSession.current = sessionKey;
  }, [strategy, telemetry]);

  const update = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: Number(value) }));
  const liveLap = liveNormalLapTime(telemetry, form.normal_lap_time);
  const fuelPerLap = Number(strategy?.fuel.fuel_per_lap_liters);
  const currentWear = Number(strategy?.tyres.average_wear ?? telemetry?.player?.tyre_state?.average_wear);
  const wearRate = Number(strategy?.tyres.wear_rate_per_lap);
  const plans = useMemo(() => simulateStrategies({
    raceDurationMinutes: form.race_duration_minutes,
    normalLapTime: liveLap.value || form.normal_lap_time,
    fuelPerLap: Number.isFinite(fuelPerLap) && fuelPerLap > 0 ? fuelPerLap : null,
    fuelObservedLaps: Number(strategy?.fuel.valid_laps_observed || 0),
    fuelRequiredLaps: Number(strategy?.fuel.valid_laps_required || 3),
    tankCapacityLiters: form.tank_capacity_liters > 0 ? form.tank_capacity_liters : null,
    raceStartFuelLiters: form.race_start_fuel_liters > 0 ? Math.min(form.race_start_fuel_liters, form.tank_capacity_liters) : null,
    fuelSafetyMarginLiters: form.fuel_safety_margin_liters,
    pitLaneLossSeconds: form.pit_loss_seconds,
    tyreChangeSecondsPerTyre: form.tyre_change_seconds_per_tyre,
    refuelSecondsPer5Liters: form.refuel_seconds_per_5_liters,
    currentTyreWear: Number.isFinite(currentWear) ? currentWear : null,
    tyreWearRatePerLap: Number.isFinite(wearRate) && wearRate > 0 ? wearRate : null,
    maxTyreWear: form.max_tyre_wear,
  }), [currentWear, form, fuelPerLap, liveLap.value, strategy?.fuel.valid_laps_observed, strategy?.fuel.valid_laps_required, wearRate]);
  const bestPlan = plans[0];
  const inputFields: Array<[keyof FormState, string, string, number]> = [
    ["race_duration_minutes", "Race duration", "min", 1],
    ["normal_lap_time", "Manual lap time", "sec", 0.1],
    ["race_start_fuel_liters", "Race start fuel", "L", 0.1],
    ["tank_capacity_liters", "Tank capacity", "L", 0.1],
    ["fuel_safety_margin_liters", "Fuel margin", "L", 0.1],
    ["pit_loss_seconds", "Pit lane driving loss", "sec", 0.1],
    ["tyre_change_seconds_per_tyre", "Change one tyre", "sec", 0.1],
    ["refuel_seconds_per_5_liters", "Load 5L fuel", "sec", 0.1],
    ["max_tyre_wear", "Max tyre wear", "fraction", 0.01],
  ];

  return (
    <div className="page grid">
      <section className="card span-12">
        <SectionTitle title="Race Assumptions" help="Editable practice-to-race model. Pit lane driving loss excludes tyre and fuel service; tyre and refuel times are added separately." />
        <div className="input-grid strategy-input-grid">
          {inputFields.map(([key, label, unit, step]) => (
            <label key={key}>
              <span className="label">{label}</span>
              <input type="number" step={step} value={form[key]} onChange={(event) => update(key, event.target.value)} />
              <span className="subvalue">{unit}</span>
            </label>
          ))}
          <label>
            <span className="label">Live normal lap</span>
            <input value={`${formatRaceTime(liveLap.value)} (${liveLap.source})`} readOnly />
            <span className="subvalue">used when available</span>
          </label>
        </div>
        <p><button className="primary" onClick={() => void api.updateAssumptions({
          race_duration_minutes: form.race_duration_minutes,
          normal_lap_time: liveLap.value || form.normal_lap_time,
          race_start_fuel_liters: form.race_start_fuel_liters,
          pit_loss_seconds: form.pit_loss_seconds,
          pit_stationary_seconds: form.pit_stationary_seconds,
          tyre_change_seconds_per_tyre: form.tyre_change_seconds_per_tyre,
          refuel_seconds_per_5_liters: form.refuel_seconds_per_5_liters,
          safety_car_pit_loss_seconds: form.safety_car_pit_loss_seconds,
          fuel_safety_margin_liters: form.fuel_safety_margin_liters,
          fuel_safety_margin_laps: form.fuel_safety_margin_laps,
          max_tyre_wear: form.max_tyre_wear,
        })}>Apply assumptions</button></p>
      </section>

      <section className="card span-12">
        <SectionTitle title="Model Status" help="Summarizes the live data feeding the race simulation. More valid fuel and tyre laps improve confidence." />
        <div className="motec-value-grid">
          <div><span className="label">Fuel use</span><strong>{fmt(Number.isFinite(fuelPerLap) ? fuelPerLap : null, 3, " L/lap")}</strong><span className="subvalue">{strategy?.fuel.valid_laps_observed ?? 0}/{strategy?.fuel.valid_laps_required ?? 3} valid laps</span></div>
          <div><span className="label">Tyre wear</span><strong>{pct(Number.isFinite(currentWear) ? currentWear : null)}</strong><span className="subvalue">{fmt(Number.isFinite(wearRate) ? wearRate * 100 : null, 2, "% / lap")}</span></div>
          <div><span className="label">Race start fuel</span><strong>{fmt(Math.min(form.race_start_fuel_liters, form.tank_capacity_liters), 1, " L")}</strong><span className="subvalue">editable, capped by tank</span></div>
          <div><span className="label">Service model</span><strong>{fmt(form.pit_loss_seconds, 1, " s")}</strong><span className="subvalue">+ tyres + fuel</span></div>
        </div>
      </section>

      {plans.length ? plans.map((plan, index) => <PlanCard plan={plan} index={index} key={plan.id} />) : (
        <section className="card span-12"><div className="empty-state"><strong>No viable strategy yet</strong><span>Complete valid fuel laps or adjust race fuel, tank capacity, and lap time assumptions.</span></div></section>
      )}

      <section className="card span-12">
        <SectionTitle title="Pit Strategy Visualization" help="Shows the best current plan as stint blocks with stop lap, fuel load, tyre count, and stop time." />
        <StrategyTimeline plan={bestPlan} />
      </section>
    </div>
  );
}
