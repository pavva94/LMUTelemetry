import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { SectionTitle } from "../components/SectionTitle";
import { average, toFiniteNumber, validSessionLaps } from "../lib/sessionAnalysis";
import { simulateStrategies, type StrategyCandidate, type StrategyRisk } from "../lib/strategySimulation";
import { formatRaceTime } from "../lib/timeFormat";
import type { SavedSession, SessionReview } from "../types/session";
import type { StrategyState } from "../types/strategy";
import type { TelemetrySnapshot } from "../types/telemetry";

type Wheel = "fl" | "fr" | "rl" | "rr";

type FormState = {
  race_duration_minutes: number;
  normal_lap_time: number;
  race_start_fuel_liters: number;
  race_start_new_tyres: boolean;
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

type NumericFormKey = Exclude<keyof FormState, "race_start_new_tyres">;
type ModelSource = "live" | "session";

type PlannerModel = {
  label: string;
  source: ModelSource;
  normalLapTime: number | null;
  fuelPerLap: number | null;
  fuelObservedLaps: number;
  fuelRequiredLaps: number;
  tankCapacityLiters: number | null;
  currentTyreWear: number | null;
  currentTyreWearByWheel: Partial<Record<Wheel, number | null>>;
  tyreWearRatePerLap: number | null;
};

const fmt = (value: number | null | undefined, digits = 1, suffix = "") =>
  value == null || !Number.isFinite(value) ? "--" : `${value.toFixed(digits)}${suffix}`;
const pct = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "--" : `${Math.round(value * 100)}%`;
const DEFAULT_TANK_CAPACITY_LITERS = 90;
const wheels: Wheel[] = ["fl", "fr", "rl", "rr"];
const wheelLabels: Record<Wheel, string> = { fl: "FL", fr: "FR", rl: "RL", rr: "RR" };

function validLapTime(value?: number | null) {
  return value != null && Number.isFinite(value) && value >= 40 && value <= 900 ? value : null;
}

function liveNormalLapTime(telemetry?: TelemetrySnapshot | null, fallback?: number | null) {
  const player = telemetry?.player;
  const playerCar = telemetry?.competitors.find((car) => car.is_player);
  const direct =
    validLapTime(player?.last_lap_time) ??
    validLapTime(playerCar?.last_lap_time) ??
    validLapTime(playerCar?.estimated_lap_time) ??
    validLapTime(player?.best_lap_time) ??
    validLapTime(playerCar?.best_lap_time);
  if (direct != null) {
    const source =
      validLapTime(player?.last_lap_time) != null || validLapTime(playerCar?.last_lap_time) != null
        ? "player last lap"
        : validLapTime(playerCar?.estimated_lap_time) != null
          ? "player estimate"
          : "player best lap";
    return { value: direct, source };
  }
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

function positiveNumberFrom(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function booleanFrom(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.toLowerCase() === "true" || value === "1";
  return fallback;
}

function parseRaceTimeInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.includes(":")) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }
  const [minutesText, secondsText] = trimmed.split(":");
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || minutes < 0 || seconds < 0 || seconds >= 60) return null;
  return minutes * 60 + seconds;
}

function formatTimeInput(value?: number | null) {
  return value != null && Number.isFinite(value) ? formatRaceTime(value) : "";
}

function tyreWearUsedFraction(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value >= 0 && value <= 1) return value;
  if (value > 1 && value <= 100) return 1 - value / 100;
  return null;
}

function tyreWearText(values?: Record<Wheel, number> | null) {
  if (!values) return "--";
  return wheels.map((wheel) => `${wheelLabels[wheel]} ${pct(values[wheel])}`).join(" / ");
}

function tyreRemainingText(values?: Record<Wheel, number> | null) {
  if (!values) return "--";
  return wheels.map((wheel) => `${wheelLabels[wheel]} ${fmt(values[wheel] * 100, 0, "%")}`).join(" / ");
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

function seededForm(strategy: StrategyState | null, telemetry?: TelemetrySnapshot | null, current?: FormState): FormState {
  const fallbackTank = positiveNumberFrom(current?.tank_capacity_liters, DEFAULT_TANK_CAPACITY_LITERS);
  const tank = positiveNumberFrom(telemetry?.player?.fuel_capacity_liters ?? strategy?.fuel.fuel_capacity_liters, fallbackTank);
  const assumptions = strategy?.assumptions || {};
  return {
    race_duration_minutes: liveRaceDurationMinutes(telemetry) ?? numberFrom(assumptions.race_duration_minutes, current?.race_duration_minutes ?? 120),
    normal_lap_time: numberFrom(assumptions.normal_lap_time, current?.normal_lap_time ?? 214),
    race_start_fuel_liters: positiveNumberFrom(assumptions.race_start_fuel_liters, tank),
    race_start_new_tyres: booleanFrom(assumptions.race_start_new_tyres, current?.race_start_new_tyres ?? true),
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

function modelFromLive(strategy: StrategyState | null, telemetry?: TelemetrySnapshot | null, current?: FormState): PlannerModel {
  const liveLap = liveNormalLapTime(telemetry, current?.normal_lap_time ?? strategy?.assumptions?.normal_lap_time as number | undefined);
  const fuelPerLap = Number(strategy?.fuel.fuel_per_lap_liters);
  const rawCurrentWear = Number(strategy?.tyres.average_wear ?? telemetry?.player?.tyre_state?.average_wear);
  const wearRate = Number(strategy?.tyres.wear_rate_per_lap);
  const observedWearLaps = Number(strategy?.tyres.observed_laps || 0);
  const currentWear = Number.isFinite(rawCurrentWear) && rawCurrentWear > 0
    ? rawCurrentWear
    : Number.isFinite(wearRate) && wearRate > 0 && observedWearLaps > 0
      ? wearRate * observedWearLaps
      : rawCurrentWear;
  const tyreState = telemetry?.player?.tyre_state;
  const wheelWearFallback = Number.isFinite(currentWear) ? currentWear : null;
  return {
    label: liveLap.source,
    source: "live",
    normalLapTime: liveLap.value,
    fuelPerLap: Number.isFinite(fuelPerLap) && fuelPerLap > 0 ? fuelPerLap : null,
    fuelObservedLaps: Number(strategy?.fuel.valid_laps_observed || 0),
    fuelRequiredLaps: Number(strategy?.fuel.valid_laps_required || 3),
    tankCapacityLiters: positiveNumberFrom(
      telemetry?.player?.fuel_capacity_liters ?? strategy?.fuel.fuel_capacity_liters,
      positiveNumberFrom(current?.tank_capacity_liters, DEFAULT_TANK_CAPACITY_LITERS),
    ),
    currentTyreWear: Number.isFinite(currentWear) ? currentWear : null,
    currentTyreWearByWheel: {
      fl: tyreState?.wear_fl && tyreState.wear_fl > 0 ? tyreState.wear_fl : wheelWearFallback,
      fr: tyreState?.wear_fr && tyreState.wear_fr > 0 ? tyreState.wear_fr : wheelWearFallback,
      rl: tyreState?.wear_rl && tyreState.wear_rl > 0 ? tyreState.wear_rl : wheelWearFallback,
      rr: tyreState?.wear_rr && tyreState.wear_rr > 0 ? tyreState.wear_rr : wheelWearFallback,
    },
    tyreWearRatePerLap: Number.isFinite(wearRate) && wearRate > 0 ? wearRate : null,
  };
}

function modelFromSession(review: SessionReview | null, sessionLabel: string, current?: FormState): PlannerModel | null {
  if (!review) return null;
  const cleanLaps = validSessionLaps(review);
  const lapTimes = cleanLaps.map((lap) => toFiniteNumber(lap.lap_time)).filter((value): value is number => value != null);
  const fuelValues = cleanLaps.map((lap) => toFiniteNumber(lap.fuel_used)).filter((value): value is number => value != null && value > 0);
  const sampleTank = average(review.telemetry_samples.map((sample) => toFiniteNumber(sample.fuel_capacity_liters)).filter((value): value is number => value != null && value > 0));
  const wheelWear: Partial<Record<Wheel, number | null>> = {};
  const wheelRates: number[] = [];
  for (const wheel of wheels) {
    const ends = cleanLaps
      .map((lap) => tyreWearUsedFraction(toFiniteNumber(lap[`tyre_wear_end_${wheel}`]) ?? toFiniteNumber(lap.tyre_wear_end)))
      .filter((value): value is number => value != null);
    wheelWear[wheel] = ends[ends.length - 1] ?? null;
    for (const [previous, currentWear] of ends.slice(1).map((value, index) => [ends[index], value] as const)) {
      const delta = currentWear - previous;
      if (delta > 0 && delta < 0.2) wheelRates.push(delta);
    }
  }
  const wheelWearValues = wheels.map((wheel) => wheelWear[wheel]).filter((value): value is number => value != null);
  const averageWear = wheelWearValues.length ? average(wheelWearValues) : tyreWearUsedFraction(toFiniteNumber(review.summary?.average_tyre_wear));
  return {
    label: sessionLabel,
    source: "session",
    normalLapTime: average(lapTimes),
    fuelPerLap: average(fuelValues),
    fuelObservedLaps: fuelValues.length,
    fuelRequiredLaps: 3,
    tankCapacityLiters: sampleTank ?? DEFAULT_TANK_CAPACITY_LITERS,
    currentTyreWear: averageWear,
    currentTyreWearByWheel: wheelWear,
    tyreWearRatePerLap: average(wheelRates),
  };
}

function PlanCard({ plan, index, selected, onSelect }: { plan: StrategyCandidate; index: number; selected: boolean; onSelect: () => void }) {
  return (
    <section className={`card span-4 strategy-card${selected ? " selected" : ""}`}>
      <div className="row">
        <span className="badge blue">Choice {index + 1}</span>
        <span className={`badge ${riskBadge(plan.risk)}`}>{plan.risk} risk</span>
      </div>
      <h2>{plan.label}</h2>
      <div className="strategy-card-main">
        <strong>{formatRaceTime(plan.totalTimeSeconds)}</strong>
        <span>{plan.stops} stop{plan.stops === 1 ? "" : "s"} - up to {plan.maxTyresChangedPerStop} tyre{plan.maxTyresChangedPerStop === 1 ? "" : "s"} when needed</span>
      </div>
      <div className="header-grid two">
        <div><span className="label">Pit time</span><strong>{fmt(plan.pitTimeSeconds, 1, " s")}</strong></div>
        <div><span className="label">Stint</span><strong>{fmt(plan.stintLaps, 1, " laps")}</strong></div>
        <div><span className="label">Fuel margin</span><strong>{fmt(plan.fuelMarginLiters, 1, " L")}</strong></div>
        <div><span className="label">Finish fuel</span><strong>{fmt(plan.finishFuelRemainingLiters, 1, " L")}</strong></div>
        <div><span className="label">Start fuel needed</span><strong>{fmt(plan.recommendedStartFuelLiters, 1, " L")}</strong><span className="subvalue">{plan.startFuelIsFullTank ? "full tank" : `${fmt(plan.firstStintFuelNeedLiters, 1, " L")} stint + margin`}</span></div>
        <div><span className="label">Lift/coast</span><strong>{fmt(plan.liftCoastSavePercent, 1, "%")}</strong></div>
        <div><span className="label">Max tyre wear</span><strong>{pct(plan.projectedTyreWear)}</strong></div>
        <div><span className="label">Lowest remaining</span><strong>{fmt(plan.lowestRemainingTyreWear == null ? null : plan.lowestRemainingTyreWear * 100, 0, "%")}</strong></div>
      </div>
      {plan.stopsDetail.length > 0 && (
        <div className="metric compact">
          <span className="label">Tyre calls</span>
          {plan.stopsDetail.map((stop) => (
            <span className="subvalue" key={stop.lap}>Lap {stop.lap}: {tyreChangeWearText(stop)}, {fmt(stop.fuelRemainingLiters, 1, " L")} remaining</span>
          ))}
        </div>
      )}
      <div className="metric compact">
        <span className="label">Why this is shown</span>
        {plan.reasons.map((reason) => <span className="subvalue" key={reason}>{reason}</span>)}
      </div>
      <button className={`strategy-select${selected ? " active-control" : ""}`} type="button" onClick={onSelect}>
        {selected ? "Selected strategy" : "Select strategy"}
      </button>
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
            <small>{fmt(stop.fuelRemainingLiters, 1, " L")} left - add {fmt(stop.fuelAddedLiters, 1, " L")} - {tyreChangeWearText(stop)} - {fmt(stop.stopTimeSeconds, 1, " s")}</small>
          </span>
        ))}
      </div>
      <div className="strategy-summary-line">
        <span>Race {fmt(plan.raceLaps, 1, " laps")}</span>
        <span>Start fuel {fmt(plan.recommendedStartFuelLiters, 1, " L")} {plan.startFuelIsFullTank ? "(full tank)" : "(less than full)"}</span>
        <span>Finish fuel {fmt(plan.finishFuelRemainingLiters, 1, " L")}</span>
        <span>{plan.liftCoastSavePercent > 0 ? `Lift/coast ${fmt(plan.liftCoastSaveLitersPerLap, 3, " L/lap")}` : "No fuel save required"}</span>
        <span>Final wear {tyreWearText(plan.projectedTyreWearByWheel)}</span>
      </div>
      {plan.stintWear.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Stint</th><th>Laps</th><th>Start wear</th><th>End wear</th><th>Wear remaining</th></tr></thead>
            <tbody>
              {plan.stintWear.map((stint) => (
                <tr key={stint.stint}>
                  <td>{stint.stint}</td>
                  <td>{stint.startLap}-{stint.endLap}</td>
                  <td>{tyreWearText(stint.startWear)}</td>
                  <td>{tyreWearText(stint.endWear)}</td>
                  <td>{tyreRemainingText(stint.remainingWear)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function StrategyPlanner({ strategy, telemetry }: { strategy: StrategyState | null; telemetry?: TelemetrySnapshot | null }) {
  const seededSession = useRef<string | null>(null);
  const appliedSessionModel = useRef<string | null>(null);
  const appliedLiveModel = useRef<string | null>(null);
  const [form, setForm] = useState<FormState>(() => seededForm(strategy, telemetry));
  const [manualLapText, setManualLapText] = useState(() => formatTimeInput(seededForm(strategy, telemetry).normal_lap_time));
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [sessionReview, setSessionReview] = useState<SessionReview | null>(null);
  const [modelSource, setModelSource] = useState<ModelSource>("live");
  const [dirtyFields, setDirtyFields] = useState<Set<keyof FormState>>(() => new Set());
  const [sourceStatus, setSourceStatus] = useState("Live data");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  useEffect(() => {
    api.lmuDuckdbSessions(250)
      .then((payload) => {
        setSessions(payload.sessions);
        setSourceStatus(payload.total ? "DuckDB sessions loaded" : "No synced DuckDB sessions");
      })
      .catch(() => setSourceStatus("DuckDB sessions unavailable; sync the folder in User Profile"));
  }, []);

  useEffect(() => {
    const sessionKey = `${telemetry?.session?.track_name || ""}:${telemetry?.session?.session_type || ""}:${telemetry?.session?.end_time || ""}`;
    if (!sessionKey.trim() || seededSession.current === sessionKey) return;
    if (modelSource === "live" && dirtyFields.size === 0) {
      const next = seededForm(strategy, telemetry, form);
      setForm(next);
      setManualLapText(formatTimeInput(next.normal_lap_time));
    }
    seededSession.current = sessionKey;
  }, [dirtyFields.size, form, modelSource, strategy, telemetry]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionReview(null);
      setModelSource("live");
      appliedSessionModel.current = null;
      return;
    }
    let cancelled = false;
    setSessionReview(null);
    appliedSessionModel.current = null;
    setModelSource("session");
    setSourceStatus("Loading DuckDB session");
    api.reviewCachedLmuDuckdbSession(selectedSessionId)
      .then((review) => {
        if (!cancelled) {
          setSessionReview(review);
          setSourceStatus("DuckDB session loaded");
        }
      })
      .catch((exc) => !cancelled && setSourceStatus(exc instanceof Error ? exc.message : "Could not load DuckDB session"));
    return () => {
      cancelled = true;
    };
  }, [selectedSessionId]);

  const update = (key: NumericFormKey, value: string) => {
    const numeric = Number(value);
    setDirtyFields((current) => new Set(current).add(key));
    setForm((current) => ({ ...current, [key]: Number.isFinite(numeric) ? numeric : current[key] }));
  };
  const updateBoolean = (key: keyof FormState, value: boolean) => {
    setDirtyFields((current) => new Set(current).add(key));
    setForm((current) => ({ ...current, [key]: value }));
  };
  const updateLapTime = (value: string) => {
    setManualLapText(value);
    const seconds = parseRaceTimeInput(value);
    setDirtyFields((current) => new Set(current).add("normal_lap_time"));
    if (seconds != null) setForm((current) => ({ ...current, normal_lap_time: seconds }));
  };
  const liveModel = useMemo(() => modelFromLive(strategy, telemetry, form), [strategy, telemetry, form]);
  const selectedSession = sessions.find((session) => session.id === selectedSessionId);
  const sessionModel = useMemo(() => modelFromSession(sessionReview, selectedSession ? `${selectedSession.session_type || "Session"} - ${selectedSession.track_name || "Unknown track"}` : "DuckDB session", form), [form, sessionReview, selectedSession]);
  const activeModel = modelSource === "session" && sessionModel ? sessionModel : liveModel;

  const applyModelToForm = (model: PlannerModel, clearDirty: boolean) => {
    setForm((current) => {
      const next = { ...current };
      const canSet = (key: keyof FormState) => clearDirty || !dirtyFields.has(key);
      if (canSet("normal_lap_time") && model.normalLapTime != null) next.normal_lap_time = model.normalLapTime;
      if (canSet("tank_capacity_liters") && model.tankCapacityLiters != null) next.tank_capacity_liters = model.tankCapacityLiters;
      if (canSet("race_start_fuel_liters") && model.tankCapacityLiters != null) next.race_start_fuel_liters = model.tankCapacityLiters;
      setManualLapText(formatTimeInput(next.normal_lap_time));
      return next;
    });
    if (clearDirty) setDirtyFields(new Set());
  };
  const useLiveData = () => {
    setModelSource("live");
    const next = seededForm(strategy, telemetry);
    setForm(next);
    setManualLapText(formatTimeInput(next.normal_lap_time));
    setDirtyFields(new Set());
    appliedLiveModel.current = null;
    setSourceStatus("Using live data directly");
  };
  const useSelectedSession = () => {
    if (!sessionModel) {
      setSourceStatus("Select a DuckDB session with valid laps first");
      return;
    }
    setModelSource("session");
    applyModelToForm(sessionModel, false);
    setSourceStatus(`Using ${sessionModel.label}`);
  };

  useEffect(() => {
    if (modelSource !== "session" || !selectedSessionId || !sessionModel) return;
    const signature = `${selectedSessionId}:${sessionModel.normalLapTime ?? ""}:${sessionModel.fuelPerLap ?? ""}`;
    if (appliedSessionModel.current === signature) return;
    applyModelToForm(sessionModel, true);
    appliedSessionModel.current = signature;
    setSourceStatus(`Using ${sessionModel.label}`);
  }, [modelSource, selectedSessionId, sessionModel]);

  useEffect(() => {
    if (modelSource !== "live" || dirtyFields.size > 0) return;
    const signature = `${liveModel.normalLapTime ?? ""}:${liveModel.fuelPerLap ?? ""}:${liveModel.tankCapacityLiters ?? ""}:${liveModel.currentTyreWear ?? ""}:${liveModel.tyreWearRatePerLap ?? ""}`;
    if (appliedLiveModel.current === signature) return;
    applyModelToForm(liveModel, false);
    appliedLiveModel.current = signature;
  }, [dirtyFields.size, liveModel, modelSource]);

  const fuelPerLap = activeModel.fuelPerLap;
  const currentWear = activeModel.currentTyreWear;
  const wearRate = activeModel.tyreWearRatePerLap;
  const tyreWearByWheel = activeModel.currentTyreWearByWheel;
  const fuelSafetyMarginLiters = fuelPerLap != null && Number.isFinite(fuelPerLap) && fuelPerLap > 0
    ? fuelPerLap * Math.max(0, form.fuel_safety_margin_laps)
    : 0;
  const raceStartWear = form.race_start_new_tyres
    ? { fl: 0, fr: 0, rl: 0, rr: 0 }
    : { fl: tyreWearByWheel.fl, fr: tyreWearByWheel.fr, rl: tyreWearByWheel.rl, rr: tyreWearByWheel.rr };
  const plans = useMemo(() => simulateStrategies({
    raceDurationMinutes: form.race_duration_minutes,
    normalLapTime: form.normal_lap_time,
    fuelPerLap: fuelPerLap != null && Number.isFinite(fuelPerLap) && fuelPerLap > 0 ? fuelPerLap : null,
    fuelObservedLaps: activeModel.fuelObservedLaps,
    fuelRequiredLaps: activeModel.fuelRequiredLaps,
    tankCapacityLiters: form.tank_capacity_liters > 0 ? form.tank_capacity_liters : null,
    raceStartFuelLiters: form.race_start_fuel_liters > 0 ? Math.min(form.race_start_fuel_liters, form.tank_capacity_liters) : null,
    raceStartNewTyres: form.race_start_new_tyres,
    fuelSafetyMarginLiters: fuelSafetyMarginLiters,
    pitLaneLossSeconds: form.pit_loss_seconds,
    tyreChangeSecondsPerTyre: form.tyre_change_seconds_per_tyre,
    refuelSecondsPer5Liters: form.refuel_seconds_per_5_liters,
    currentTyreWear: form.race_start_new_tyres ? 0 : Number.isFinite(currentWear) ? currentWear : null,
    currentTyreWearByWheel: raceStartWear,
    tyreWearRatePerLap: wearRate != null && Number.isFinite(wearRate) && wearRate > 0 ? wearRate : null,
    maxTyreWear: form.max_tyre_wear,
  }), [activeModel.fuelObservedLaps, activeModel.fuelRequiredLaps, currentWear, form, fuelPerLap, fuelSafetyMarginLiters, raceStartWear.fl, raceStartWear.fr, raceStartWear.rl, raceStartWear.rr, wearRate]);
  const missingPlanInputs = [
    fuelPerLap == null || !Number.isFinite(fuelPerLap) || fuelPerLap <= 0 ? "fuel per lap" : null,
    form.tank_capacity_liters <= 0 ? "tank capacity" : null,
    form.race_start_fuel_liters <= 0 ? "race start fuel" : null,
    form.normal_lap_time <= 0 ? "normal lap time" : null,
    form.race_duration_minutes <= 0 ? "race duration" : null,
  ].filter((item): item is string => item != null);
  const bestPlan = plans[0];
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? bestPlan;
  const activePlanId = selectedPlan?.id ?? null;
  const inputFields: Array<[NumericFormKey, string, string, number]> = [
    ["race_duration_minutes", "Race duration", "min", 1],
    ["race_start_fuel_liters", "Race start fuel", "L", 0.1],
    ["tank_capacity_liters", "Tank capacity", "L", 0.1],
    ["fuel_safety_margin_laps", "Fuel margin", "laps", 0.1],
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
          <label>
            <span className="label">Model source</span>
            <select value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.target.value)}>
              <option value="">Live/current session</option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.session_type || "Session"} - {session.track_name || "Unknown track"} - {session.vehicle_model || session.vehicle_name || "Unknown car"} - {session.created_at || session.id}
                </option>
              ))}
            </select>
            <span className="subvalue">{sourceStatus}</span>
          </label>
          <label>
            <span className="label">Manual lap time</span>
            <input value={manualLapText} onChange={(event) => updateLapTime(event.target.value)} placeholder="03:34.000" />
            <span className="subvalue">mm:ss.mmm</span>
          </label>
          {inputFields.map(([key, label, unit, step]) => (
            <label key={key}>
              <span className="label">{label}</span>
              <input type="number" step={step} value={form[key]} onChange={(event) => update(key, event.target.value)} />
              <span className="subvalue">{unit}</span>
            </label>
          ))}
          <label>
            <span className="label">Start tyre set</span>
            <span className="toggle-line">
              <input type="checkbox" checked={form.race_start_new_tyres} onChange={(event) => updateBoolean("race_start_new_tyres", event.target.checked)} />
              <span>New tyres</span>
            </span>
            <span className="subvalue">race start assumption</span>
          </label>
          <label>
            <span className="label">Active normal lap</span>
            <input value={`${formatRaceTime(form.normal_lap_time)} (${activeModel.source === "session" ? "DuckDB session/manual" : activeModel.label})`} readOnly />
            <span className="subvalue">used by strategy model</span>
          </label>
        </div>
        <p className="control-row">
          <button type="button" onClick={useLiveData}>Use live data</button>
          <button type="button" onClick={useSelectedSession}>Use selected DuckDB session</button>
          <button className="primary" onClick={() => void api.updateAssumptions({
          race_duration_minutes: form.race_duration_minutes,
          normal_lap_time: form.normal_lap_time,
          race_start_fuel_liters: form.race_start_fuel_liters,
          race_start_new_tyres: form.race_start_new_tyres,
          pit_loss_seconds: form.pit_loss_seconds,
          pit_stationary_seconds: form.pit_stationary_seconds,
          tyre_change_seconds_per_tyre: form.tyre_change_seconds_per_tyre,
          refuel_seconds_per_5_liters: form.refuel_seconds_per_5_liters,
          safety_car_pit_loss_seconds: form.safety_car_pit_loss_seconds,
          fuel_safety_margin_liters: fuelSafetyMarginLiters,
          fuel_safety_margin_laps: form.fuel_safety_margin_laps,
          max_tyre_wear: form.max_tyre_wear,
        })}>Save assumptions</button>
        </p>
      </section>

      <section className="card span-12">
        <SectionTitle title="Model Status" help="Summarizes the live data feeding the race simulation. More valid fuel and tyre laps improve confidence." />
        <div className="motec-value-grid">
          <div><span className="label">Model source</span><strong>{activeModel.source === "session" ? "DuckDB session" : "Live"}</strong><span className="subvalue">{activeModel.label}</span></div>
          <div><span className="label">Fuel use</span><strong>{fmt(Number.isFinite(fuelPerLap ?? NaN) ? fuelPerLap : null, 3, " L/lap")}</strong><span className="subvalue">{activeModel.fuelObservedLaps}/{activeModel.fuelRequiredLaps} valid laps</span></div>
          <div><span className="label">Fuel margin</span><strong>{fmt(form.fuel_safety_margin_laps, 1, " laps")}</strong><span className="subvalue">{fmt(fuelSafetyMarginLiters, 2, " L")} from model fuel use</span></div>
          <div><span className="label">Tyre wear</span><strong>{pct(Number.isFinite(currentWear) ? currentWear : null)}</strong><span className="subvalue">{fmt(wearRate != null && Number.isFinite(wearRate) ? wearRate * 100 : null, 2, "% / lap")}</span></div>
          <div><span className="label">Race start fuel</span><strong>{fmt(Math.min(form.race_start_fuel_liters, form.tank_capacity_liters), 1, " L")}</strong><span className="subvalue">editable, capped by tank</span></div>
          <div><span className="label">Race start tyres</span><strong>{form.race_start_new_tyres ? "New set" : "Observed wear"}</strong><span className="subvalue">{form.race_start_new_tyres ? "starts projection at 0%" : "uses model wear"}</span></div>
          <div><span className="label">Service model</span><strong>{fmt(form.pit_loss_seconds, 1, " s")}</strong><span className="subvalue">+ tyres + fuel</span></div>
        </div>
      </section>

      {plans.length ? plans.map((plan, index) => (
        <PlanCard
          plan={plan}
          index={index}
          selected={plan.id === activePlanId}
          onSelect={() => setSelectedPlanId(plan.id)}
          key={plan.id}
        />
      )) : (
        <section className="card span-12"><div className="empty-state"><strong>No viable strategy yet</strong><span>{missingPlanInputs.length ? `Missing ${missingPlanInputs.join(", ")}.` : "Try more stops, more start fuel, or a longer fuel-saving strategy."}</span></div></section>
      )}

      <section className="card span-12">
        <SectionTitle title="Pit Strategy Visualization" help="Shows the selected plan as stint blocks with stop lap, remaining fuel, fuel load, tyre count, and stop time." />
        <StrategyTimeline plan={selectedPlan} />
      </section>
    </div>
  );
}
