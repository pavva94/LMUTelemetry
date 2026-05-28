import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { SectionTitle } from "../components/SectionTitle";
import { formatRaceTime } from "../lib/timeFormat";
import type { StrategyState } from "../types/strategy";
import type { TelemetrySnapshot } from "../types/telemetry";

type Risk = "low" | "medium" | "high" | "unknown";

type StrategyPlan = {
  name: string;
  stops: number | string;
  time: number;
  risk: Risk;
  why: string[];
  action: string;
};

type FormState = {
  race_duration_minutes: number;
  pit_loss_seconds: number;
  fuel_safety_margin_liters: number;
  max_tyre_wear: number;
  normal_lap_time: number;
  pit_stationary_seconds: number;
  safety_car_pit_loss_seconds: number;
  fuel_safety_margin_laps: number;
};

type RaceModel = {
  raceLaps: number | null;
  fuelPerLap: number | null;
  tankLiters: number | null;
  tankSource: string;
  tankLaps: number | null;
  requiredFuel: number | null;
  minStops: number | null;
  currentFuel: number | null;
  currentFuelLaps: number | null;
};

const fmt = (value: number | null | undefined, digits = 1, suffix = "") =>
  value == null || !Number.isFinite(value) ? "--" : `${value.toFixed(digits)}${suffix}`;

function validLapTime(value?: number | null) {
  return value != null && Number.isFinite(value) && value >= 40 && value <= 900 ? value : null;
}

function liveNormalLapTime(telemetry?: TelemetrySnapshot | null, fallback?: number | null) {
  const playerCar = telemetry?.competitors.find((car) => car.is_player);
  const direct = validLapTime(playerCar?.last_lap_time) ?? validLapTime(playerCar?.estimated_lap_time) ?? validLapTime(playerCar?.best_lap_time);
  if (direct != null) return { value: direct, source: playerCar?.last_lap_time ? "player last lap" : playerCar?.estimated_lap_time ? "player estimated lap" : "player best lap" };
  const fieldTimes = (telemetry?.competitors || [])
    .flatMap((car) => [validLapTime(car.last_lap_time), validLapTime(car.estimated_lap_time), validLapTime(car.best_lap_time)])
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b);
  if (fieldTimes.length) return { value: fieldTimes[Math.floor(fieldTimes.length / 2)], source: "field median live lap" };
  return { value: fallback && fallback > 0 ? fallback : null, source: "manual fallback" };
}

function riskBadge(risk: Risk) {
  if (risk === "high") return "red";
  if (risk === "medium") return "amber";
  if (risk === "low") return "green";
  return "blue";
}

function buildRaceModel(strategy: StrategyState | null, telemetry: TelemetrySnapshot | null | undefined, form: FormState, normalLapTime: number | null): RaceModel {
  const fuelPerLapValue = Number(strategy?.fuel.fuel_per_lap_liters);
  const fuelPerLap = Number.isFinite(fuelPerLapValue) && fuelPerLapValue > 0 ? fuelPerLapValue : null;
  const liveCapacityValue = Number(telemetry?.player?.fuel_capacity_liters);
  const apiCapacityValue = Number(strategy?.fuel.fuel_capacity_liters);
  const currentFuelValue = Number(telemetry?.player?.fuel_liters);
  const currentFuel = Number.isFinite(currentFuelValue) && currentFuelValue > 0 ? currentFuelValue : null;
  const liveCapacity = Number.isFinite(liveCapacityValue) && liveCapacityValue > 0 ? liveCapacityValue : null;
  const apiCapacity = Number.isFinite(apiCapacityValue) && apiCapacityValue > 0 ? apiCapacityValue : null;
  const tankLiters = liveCapacity ?? apiCapacity ?? currentFuel;
  const tankSource = liveCapacity != null ? "live telemetry API" : apiCapacity != null ? "strategy API" : currentFuel != null ? "current fuel fallback" : "not available";
  const raceLaps = normalLapTime && normalLapTime > 0 ? (form.race_duration_minutes * 60) / normalLapTime : null;
  const requiredFuel = raceLaps != null && fuelPerLap != null ? raceLaps * fuelPerLap + form.fuel_safety_margin_liters : null;
  const tankLaps = tankLiters != null && fuelPerLap != null ? tankLiters / fuelPerLap : null;
  const minStops = requiredFuel != null && tankLiters != null ? Math.max(0, Math.ceil(requiredFuel / tankLiters) - 1) : null;
  return {
    raceLaps,
    fuelPerLap,
    tankLiters,
    tankSource,
    tankLaps,
    requiredFuel,
    minStops,
    currentFuel,
    currentFuelLaps: currentFuel != null && fuelPerLap != null ? currentFuel / fuelPerLap : null,
  };
}

function liveRaceDurationMinutes(telemetry?: TelemetrySnapshot | null) {
  const endTime = Number(telemetry?.session?.end_time);
  if (Number.isFinite(endTime) && endTime > 0) return endTime / 60;
  const currentTime = Number(telemetry?.session?.current_time);
  const remaining = Number(telemetry?.session?.time_remaining);
  if (Number.isFinite(currentTime) && Number.isFinite(remaining) && currentTime >= 0 && remaining > 0) {
    return (currentTime + remaining) / 60;
  }
  return null;
}

function liftCoastAnalysis(model: RaceModel, normalLapTime: number, targetStops?: number) {
  const availableFuel = model.tankLiters != null && targetStops != null ? model.tankLiters * (targetStops + 1) : null;
  const shortage = model.requiredFuel != null && availableFuel != null ? model.requiredFuel - availableFuel : null;
  const savePerLap = shortage != null && shortage > 0 && model.raceLaps ? shortage / model.raceLaps : 0;
  const savePercent = model.fuelPerLap ? (savePerLap / model.fuelPerLap) * 100 : null;
  const timeLossMin = savePercent != null ? (savePercent / 100) * normalLapTime * 0.12 : null;
  const timeLossMax = savePercent != null ? (savePercent / 100) * normalLapTime * 0.30 : null;
  let status = "Not enough fuel model data";
  let risk: Risk = "unknown";
  let action = "Complete representative green-flag laps and make sure fuel capacity is available.";
  if (shortage != null && shortage <= 0) {
    status = "No fuel save required for this stop count";
    risk = "low";
    action = "The chosen stop count has enough fuel on the current model, including safety margin.";
  } else if (savePercent != null) {
    if (savePercent <= 2) {
      status = "Lift-and-coast is very realistic";
      risk = "low";
      action = "Short lifts before heavy braking zones should usually cover this without giving up a stop.";
    } else if (savePercent <= 5) {
      status = "Lift-and-coast is possible";
      risk = "medium";
      action = "Use disciplined lift points and monitor lap-time loss; avoid defending too hard while saving.";
    } else if (savePercent <= 8) {
      status = "Lift-and-coast is aggressive";
      risk = "high";
      action = "Only commit if avoiding a pit stop saves more than the expected pace loss and traffic risk.";
    } else {
      status = "Fuel save is probably not enough";
      risk = "high";
      action = "Plan the pit stop unless safety car, rain, or major traffic changes the race shape.";
    }
  }
  return { status, risk, action, savePerLap, savePercent, timeLossMin, timeLossMax, shortage };
}

function riskForStopCount(strategy: StrategyState | null, model: RaceModel, stops: number): Risk {
  const fuelSets = model.tankLiters != null ? model.tankLiters * (stops + 1) : null;
  const fuelMargin = model.requiredFuel != null && fuelSets != null ? fuelSets - model.requiredFuel : null;
  const tyreRisk = strategy?.tyres.tyre_risk_level || "unknown";
  const trafficHigh = strategy?.pit_window.traffic_risk_after_stop === "high";
  if (fuelMargin == null) return "unknown";
  if (fuelMargin < 0) return "high";
  if (fuelMargin < (model.fuelPerLap || 0) * 0.5 || tyreRisk === "high" || trafficHigh) return "medium";
  return "low";
}

function buildPlan(strategy: StrategyState | null, form: FormState, model: RaceModel, stops: number, label: string, normalLapTime: number | null): StrategyPlan {
  const fuelSets = model.tankLiters != null ? model.tankLiters * (stops + 1) : null;
  const fuelMargin = model.requiredFuel != null && fuelSets != null ? fuelSets - model.requiredFuel : null;
  const stintLaps = model.raceLaps != null ? model.raceLaps / (stops + 1) : null;
  const tyreLife = strategy?.tyres.estimated_remaining_tyre_life_laps;
  const tyreRisk = strategy?.tyres.tyre_risk_level || "unknown";
  const risk = riskForStopCount(strategy, model, stops);
  return {
    name: label,
    stops,
    time: form.race_duration_minutes * 60 + stops * form.pit_loss_seconds,
    risk,
    why: [
      `Race estimate ${fmt(model.raceLaps, 1, " laps")} at ${formatRaceTime(normalLapTime)} per lap.`,
      `One tank range ${fmt(model.tankLaps, 1, " laps")} from ${fmt(model.tankLiters, 1, " L")} (${model.tankSource}) and ${fmt(model.fuelPerLap, 3, " L/lap")}.`,
      fuelMargin != null ? `Fuel margin with ${stops} stops is ${fmt(fuelMargin, 2, " L")}.` : "Fuel margin cannot be calculated yet.",
      stintLaps != null ? `Average stint length ${fmt(stintLaps, 1, " laps")}; tyre life ${fmt(tyreLife, 1, " laps")} (${tyreRisk}).` : `Tyre risk is ${tyreRisk}.`,
    ],
    action: risk === "high"
      ? "This plan is not safe on the current fuel/tyre model without major saving or neutralization."
      : risk === "medium"
        ? "Possible, but monitor fuel margin, tyres, and traffic before committing."
        : "This is safe on the current fuel model; compare pace and traffic before choosing it.",
  };
}

function buildPlans(strategy: StrategyState | null, form: FormState, model: RaceModel, normalLapTime: number | null): StrategyPlan[] {
  if (model.minStops == null) return [buildPlan(strategy, form, model, 0, "Need fuel data", normalLapTime)];
  const stopCounts = Array.from(new Set([Math.max(0, model.minStops - 1), model.minStops, model.minStops + 1])).sort((a, b) => a - b);
  return stopCounts.map((stops) => {
    if (stops < model.minStops!) return buildPlan(strategy, form, model, stops, `Fuel-save ${stops} stop`, normalLapTime);
    if (stops === model.minStops) return buildPlan(strategy, form, model, stops, `Minimum ${stops} stop`, normalLapTime);
    return buildPlan(strategy, form, model, stops, `Conservative ${stops} stop`, normalLapTime);
  });
}

export function StrategyPlanner({ strategy, telemetry }: { strategy: StrategyState | null; telemetry?: TelemetrySnapshot | null }) {
  const seededSession = useRef<string | null>(null);
  const [form, setForm] = useState<FormState>({
    race_duration_minutes: Number(strategy?.assumptions.race_duration_minutes || 120),
    pit_loss_seconds: Number(strategy?.assumptions.pit_loss_seconds || 28),
    fuel_safety_margin_liters: Number(strategy?.assumptions.fuel_safety_margin_liters || 2),
    max_tyre_wear: Number(strategy?.assumptions.max_tyre_wear || 0.75),
    normal_lap_time: Number(strategy?.assumptions.normal_lap_time || 214),
    pit_stationary_seconds: Number(strategy?.assumptions.pit_stationary_seconds || 12),
    safety_car_pit_loss_seconds: Number(strategy?.assumptions.safety_car_pit_loss_seconds || 16),
    fuel_safety_margin_laps: Number(strategy?.assumptions.fuel_safety_margin_laps || 1),
  });
  useEffect(() => {
    const sessionKey = `${telemetry?.session?.track_name || ""}:${telemetry?.session?.session_type || ""}:${telemetry?.session?.end_time || ""}`;
    if (!sessionKey.trim() || seededSession.current === sessionKey) return;
    const liveDuration = liveRaceDurationMinutes(telemetry);
    setForm((current) => ({
      ...current,
      race_duration_minutes: liveDuration ?? Number(strategy?.assumptions.race_duration_minutes || current.race_duration_minutes),
      pit_loss_seconds: Number(strategy?.assumptions.pit_loss_seconds || current.pit_loss_seconds),
      fuel_safety_margin_liters: Number(strategy?.assumptions.fuel_safety_margin_liters || current.fuel_safety_margin_liters),
      max_tyre_wear: Number(strategy?.assumptions.max_tyre_wear || current.max_tyre_wear),
      normal_lap_time: Number(strategy?.assumptions.normal_lap_time || current.normal_lap_time),
      pit_stationary_seconds: Number(strategy?.assumptions.pit_stationary_seconds || current.pit_stationary_seconds),
      safety_car_pit_loss_seconds: Number(strategy?.assumptions.safety_car_pit_loss_seconds || current.safety_car_pit_loss_seconds),
      fuel_safety_margin_laps: Number(strategy?.assumptions.fuel_safety_margin_laps || current.fuel_safety_margin_laps),
    }));
    seededSession.current = sessionKey;
  }, [strategy, telemetry]);
  const update = (key: keyof FormState, value: string) => setForm({ ...form, [key]: Number(value) });
  const liveLap = liveNormalLapTime(telemetry, form.normal_lap_time);
  const model = buildRaceModel(strategy, telemetry, form, liveLap.value);
  const plans = buildPlans(strategy, form, model, liveLap.value);
  const liftTargetStops = model.minStops != null ? Math.max(0, model.minStops - 1) : undefined;
  const lift = liftCoastAnalysis(model, liveLap.value || form.normal_lap_time, liftTargetStops);

  return (
    <div className="page grid">
      <section className="card span-12">
        <SectionTitle title="Assumptions" help="Sets the race model used for strategy estimates. Use realistic pit loss, lap time, and fuel margin so the plan matches race conditions." />
        <div className="input-grid">
          {Object.entries(form).filter(([key]) => key !== "normal_lap_time").slice(0, 5).map(([key, value]) => (
            <label key={key}><span className="label">{key.replace(/_/g, " ")}</span><input type="number" step="0.1" value={value} onChange={(event) => update(key as keyof FormState, event.target.value)} /></label>
          ))}
          <label><span className="label">normal lap time from live data</span><input value={`${formatRaceTime(liveLap.value)} (${liveLap.source})`} readOnly /></label>
        </div>
        <p><button className="primary" onClick={() => void api.updateAssumptions({ ...form, normal_lap_time: liveLap.value || form.normal_lap_time })}>Apply assumptions</button></p>
      </section>

      <section className="card span-12">
        <SectionTitle title="Race Fuel Model" help="Calculates race laps, tank range, required fuel, and minimum stops from the entered race duration and live fuel usage." />
        <div className="motec-value-grid">
          <div><span className="label">Race duration</span><strong>{formatRaceTime(form.race_duration_minutes * 60)}</strong></div>
          <div><span className="label">Live normal lap</span><strong>{formatRaceTime(liveLap.value)}</strong><span className="subvalue">{liveLap.source}</span></div>
          <div><span className="label">Estimated race laps</span><strong>{fmt(model.raceLaps, 1)}</strong></div>
          <div><span className="label">Fuel per lap</span><strong>{fmt(model.fuelPerLap, 3, " L")}</strong></div>
          <div><span className="label">Tank capacity</span><strong>{fmt(model.tankLiters, 1, " L")}</strong><span className="subvalue">{model.tankSource}</span></div>
          <div><span className="label">One tank range</span><strong>{fmt(model.tankLaps, 1, " laps")}</strong></div>
          <div><span className="label">Fuel needed</span><strong>{fmt(model.requiredFuel, 1, " L")}</strong></div>
          <div><span className="label">Minimum stops</span><strong>{model.minStops ?? "--"}</strong></div>
          <div><span className="label">Current fuel range</span><strong>{fmt(model.currentFuelLaps, 1, " laps")}</strong><span className="subvalue">{fmt(model.currentFuel, 1, " L")} now</span></div>
        </div>
      </section>

      {plans.map((plan) => (
        <section className="card span-4" key={plan.name}>
          <SectionTitle title={plan.name} help="Compares a candidate stop count. Lower time is attractive, but tyre, fuel, and traffic risk decide whether it is usable." />
          <div className="metric"><span className="label">Stops</span><span className="value">{plan.stops}</span></div>
          <div className="metric"><span className="label">Estimated total including pit loss</span><span className="value">{formatRaceTime(Number(plan.time))}</span></div>
          <div className="row"><span className={`badge ${riskBadge(plan.risk)}`}>Risk {plan.risk}</span></div>
          <div className="metric compact"><span className="label">Why</span>{plan.why.map((line) => <span className="subvalue" key={line}>{line}</span>)}</div>
          <div className="metric compact"><span className="label">Engineer call</span><span className="subvalue">{plan.action}</span></div>
        </section>
      ))}

      <section className="card span-12">
        <SectionTitle title="Lift-And-Coast To Avoid One Stop" help="Estimates whether fuel saving can remove one pit stop. Small per-lap saving is usually realistic; large saving can cost more lap time than stopping." />
        <div className="motec-value-grid">
          <div><span className="label">Target stop count</span><strong>{liftTargetStops ?? "--"}</strong></div>
          <div><span className="label">Fuel shortfall</span><strong>{fmt(lift.shortage && lift.shortage > 0 ? lift.shortage : 0, 2, " L")}</strong></div>
          <div><span className="label">Required save</span><strong>{fmt(lift.savePerLap, 3, " L/lap")}</strong><span className="subvalue">{fmt(lift.savePercent, 1, "% per lap")}</span></div>
          <div><span className="label">Estimated pace cost</span><strong>{lift.timeLossMin != null && lift.timeLossMax != null ? `${fmt(lift.timeLossMin, 1)}-${fmt(lift.timeLossMax, 1)} s/lap` : "--"}</strong></div>
        </div>
        <p className="muted"><strong>{lift.status}.</strong> {lift.action}</p>
      </section>
    </div>
  );
}
