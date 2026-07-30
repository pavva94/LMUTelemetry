import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { PageSection } from "../components/PageSection";
import { SearchableSessionPicker } from "../components/SearchableSessionPicker";
import { useDuckdbJob } from "../hooks/useDuckdbJob";
import { SectionTitle } from "../components/SectionTitle";
import { useT } from "../i18n/I18nProvider";
import { duckdbSessionParts } from "../lib/lmuDuckdbSession";
import { average, median, standardDeviation, toFiniteNumber, validSessionLaps } from "../lib/sessionAnalysis";
import { calibrateLiftCoast } from "../lib/liftCoastCalibration";
import { calibrateStintPace } from "../lib/stintCalibration";
import { explainNoViableStrategies, simulateStrategies, type EmpiricalStintPaceModel, type LiftCoastPaceModel, type PaceEvidence, type StrategyCandidate, type StrategyRisk, type StrategySimulationInput } from "../lib/strategySimulation";
import { formatDuration, formatRaceTime } from "../lib/timeFormat";
import { MonteCarloStrategyPanel } from "./RaceSimulation";
import type { LmuDuckdbScanResponse, LmuDuckdbSession } from "../types/lmuDuckdb";
import type { SessionReview } from "../types/session";
import type { StrategyState } from "../types/strategy";
import type { TelemetrySnapshot } from "../types/telemetry";

type Wheel = "fl" | "fr" | "rl" | "rr";

type FormState = {
  race_duration_minutes: number;
  normal_lap_time: number;
  race_start_new_tyres: boolean;
  tank_capacity_liters: number;
  fuel_safety_margin_liters: number;
  pit_loss_seconds: number;
  tyre_change_seconds_per_tyre: number;
  refuel_seconds_per_5_liters: number;
  max_tyre_wear: number;
  max_tyres_available: number;
  lift_coast_mode: "inferred" | "fixed";
  lift_coast_target_percent: number;
  safety_car_pit_loss_seconds: number;
  fuel_safety_margin_laps: number;
};

type NumericFormKey = Exclude<keyof FormState, "race_start_new_tyres" | "lift_coast_mode">;
type ModelSource = "live" | "session";
type PaceBasis = "median" | "trimmed" | "percentile";

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
  tyreWearRateByWheel: Partial<Record<Wheel, number | null>>;
  tyrePaceDegradationPerLap: number | null;
  tyreConfidence: string;
  fuelUseStdDevLiters: number | null;
  fuelConfidence: string;
  paceEvidence: PaceEvidence;
  empiricalStintPace: EmpiricalStintPaceModel | null;
  liftCoastPace: LiftCoastPaceModel | null;
};

const fmt = (value: number | null | undefined, digits = 1, suffix = "") =>
  value == null || !Number.isFinite(value) ? "--" : `${value.toFixed(digits)}${suffix}`;
const pct = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "--" : `${Math.round(value * 100)}%`;
const signedSeconds = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "--" : `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)} s`;
const paceEffectTone = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) || Math.abs(value) < 0.05 ? "neutral" : value > 0 ? "loss" : "gain";
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

function livePaceEvidence(strategy: StrategyState | null, fallback?: number | null): PaceEvidence {
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
    source: pace?.weighted_recent_pace ? "live clean lap history" : "manual input",
    method: "robust recent-window model",
    foundLaps: pace?.sample_laps ?? 0,
  };
}

function sessionPaceEvidence(lapTimes: number[], fallback?: number | null): PaceEvidence {
  const lastLap = lapTimes[lapTimes.length - 1] ?? null;
  const last7 = average(lapTimes.slice(-7));
  const last10 = average(lapTimes.slice(-10));
  const weighted = lapTimes.length >= 10 && last7 != null && last10 != null && lastLap != null
    ? last7 * 0.6 + last10 * 0.3 + lastLap * 0.1
    : lapTimes.length >= 7 && last7 != null && lastLap != null
      ? last7 * 0.75 + lastLap * 0.25
      : last7 ?? last10 ?? lastLap ?? fallback ?? null;
  const trendWindow = lapTimes.slice(-10);
  const trend = trendWindow.length >= 4
    ? (() => {
        const xMean = (trendWindow.length - 1) / 2;
        const yMean = average(trendWindow) ?? 0;
        const denominator = trendWindow.reduce((sum, _, index) => sum + (index - xMean) ** 2, 0);
        return denominator > 0
          ? trendWindow.reduce((sum, value, index) => sum + (index - xMean) * (value - yMean), 0) / denominator
          : null;
      })()
    : null;
  return {
    lastLapTime: lastLap,
    last7LapAverage: last7,
    last10LapAverage: last10,
    weightedRecentPace: weighted,
    paceTrendSecondsPerLap: trend,
    paceDegradationPerLap: trend == null ? null : Math.max(0, trend),
    sampleLaps: lapTimes.length,
    confidence: lapTimes.length >= 10 ? "high" : lapTimes.length >= 7 ? "medium" : "low",
    source: "Saved-session clean lap history",
  };
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

function tyreLife(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? null : Math.max(0, Math.min(1, 1 - value));
}

function tyreLifeTone(value: number | null) {
  if (value == null) return "unknown";
  if (value <= 0.25) return "critical";
  if (value <= 0.5) return "warning";
  return "healthy";
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

export function seededForm(strategy: StrategyState | null, telemetry?: TelemetrySnapshot | null, current?: FormState): FormState {
  const fallbackTank = positiveNumberFrom(current?.tank_capacity_liters, DEFAULT_TANK_CAPACITY_LITERS);
  const tank = positiveNumberFrom(telemetry?.player?.fuel_capacity_liters ?? strategy?.fuel.fuel_capacity_liters, fallbackTank);
  const assumptions = strategy?.assumptions || {};
  return {
    race_duration_minutes: numberFrom(current?.race_duration_minutes, numberFrom(assumptions.race_duration_minutes, 120)),
    normal_lap_time: numberFrom(assumptions.normal_lap_time, current?.normal_lap_time ?? 214),
    race_start_new_tyres: booleanFrom(assumptions.race_start_new_tyres, current?.race_start_new_tyres ?? true),
    tank_capacity_liters: tank,
    fuel_safety_margin_liters: numberFrom(assumptions.fuel_safety_margin_liters, current?.fuel_safety_margin_liters ?? 2),
    pit_loss_seconds: numberFrom(assumptions.pit_loss_seconds, current?.pit_loss_seconds ?? 28),
    tyre_change_seconds_per_tyre: numberFrom(assumptions.tyre_change_seconds_per_tyre, current?.tyre_change_seconds_per_tyre ?? 3),
    refuel_seconds_per_5_liters: numberFrom(assumptions.refuel_seconds_per_5_liters, current?.refuel_seconds_per_5_liters ?? 1.2),
    max_tyre_wear: numberFrom(assumptions.max_tyre_wear, current?.max_tyre_wear ?? 0.75),
    max_tyres_available: numberFrom(assumptions.max_tyres_available, current?.max_tyres_available ?? 24),
    lift_coast_mode: assumptions.lift_coast_mode === "fixed" || assumptions.lift_coast_mode === "inferred" ? assumptions.lift_coast_mode : current?.lift_coast_mode ?? "fixed",
    lift_coast_target_percent: numberFrom(assumptions.lift_coast_target_percent, current?.lift_coast_target_percent ?? 3),
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
    tyreWearRateByWheel: {},
    tyrePaceDegradationPerLap: Number(strategy?.tyres.pace_degradation_per_lap) || null,
    tyreConfidence: strategy?.tyres.confidence || "low",
    fuelUseStdDevLiters: strategy?.fuel.fuel_use_stddev_liters ?? null,
    fuelConfidence: strategy?.fuel.confidence || "low",
    paceEvidence: livePaceEvidence(strategy, liveLap.value),
    empiricalStintPace: null,
    liftCoastPace: null,
  };
}

function robustPace(values: number[], basis: PaceBasis) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  if (basis === "median") return median(ordered);
  if (basis === "percentile") return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.6))];
  const trim = ordered.length >= 10 ? Math.floor(ordered.length * 0.1) : 0;
  return average(trim ? ordered.slice(trim, -trim) : ordered);
}

export function modelFromSession(review: SessionReview | null, sessionLabel: string, current?: FormState, paceBasis: PaceBasis = "median"): PlannerModel | null {
  if (!review) return null;
  const cleanLaps = validSessionLaps(review);
  const lapTimes = cleanLaps.map((lap) => toFiniteNumber(lap.lap_time)).filter((value): value is number => value != null);
  const fuelValues = cleanLaps.map((lap) => toFiniteNumber(lap.fuel_used)).filter((value): value is number => value != null && value > 0);
  const sampleTank = average(review.telemetry_samples.map((sample) => toFiniteNumber(sample.fuel_capacity_liters)).filter((value): value is number => value != null && value > 0));
  const wheelWear: Partial<Record<Wheel, number | null>> = {};
  const wheelRates: number[] = [];
  const wheelRateMap: Partial<Record<Wheel, number | null>> = {};
  for (const wheel of wheels) {
    const ends = cleanLaps
      .map((lap) => tyreWearUsedFraction(toFiniteNumber(lap[`tyre_wear_end_${wheel}`]) ?? toFiniteNumber(lap.tyre_wear_end)))
      .filter((value): value is number => value != null);
    wheelWear[wheel] = ends[ends.length - 1] ?? null;
    const rates: number[] = [];
    for (const [previous, currentWear] of ends.slice(1).map((value, index) => [ends[index], value] as const)) {
      const delta = currentWear - previous;
      if (delta > 0 && delta < 0.2) { wheelRates.push(delta); rates.push(delta); }
    }
    wheelRateMap[wheel] = median(rates);
  }
  const wheelWearValues = wheels.map((wheel) => wheelWear[wheel]).filter((value): value is number => value != null);
  const averageWear = wheelWearValues.length ? average(wheelWearValues) : tyreWearUsedFraction(toFiniteNumber(review.summary?.average_tyre_wear));
  const wearRate = average(wheelRates);
  const baselinePace = robustPace(lapTimes, paceBasis);
  const sessionEvidence = sessionPaceEvidence(lapTimes, current?.normal_lap_time);
  const empiricalStintPace = calibrateStintPace(review);
  return {
    label: sessionLabel,
    source: "session",
    normalLapTime: baselinePace,
    fuelPerLap: median(fuelValues),
    fuelObservedLaps: fuelValues.length,
    fuelRequiredLaps: 3,
    tankCapacityLiters: sampleTank ?? DEFAULT_TANK_CAPACITY_LITERS,
    currentTyreWear: averageWear,
    currentTyreWearByWheel: wheelWear,
    tyreWearRatePerLap: wearRate,
    tyreWearRateByWheel: wheelRateMap,
    tyrePaceDegradationPerLap: null,
    tyreConfidence: wheelRates.length >= 3 ? "high" : wheelRates.length >= 2 ? "medium" : "low",
    fuelUseStdDevLiters: standardDeviation(fuelValues),
    fuelConfidence: fuelValues.length >= 3 ? "high" : "low",
    paceEvidence: { ...sessionEvidence, weightedRecentPace: baselinePace, source: "Saved-session robust baseline", method: paceBasis === "trimmed" ? "10% trimmed mean" : paceBasis === "percentile" ? "60th percentile" : "median", spreadSeconds: standardDeviation(lapTimes), foundLaps: review.laps.length },
    empiricalStintPace,
    liftCoastPace: calibrateLiftCoast(review, empiricalStintPace),
  };
}

function PlanCard({ plan, index, selected, onSelect }: { plan: StrategyCandidate; index: number; selected: boolean; onSelect: () => void }) {
  const tyrePaceEffect = plan.tyreDegradationLossSeconds;
  const fuelPaceEffect = plan.stintPace.reduce((sum, stint) => sum + stint.fuelLoadLossSeconds, 0);
  const warmupOrTrendEffect = plan.projectedPaceLossSeconds - fuelPaceEffect;
  const liftCoastEffect = plan.liftCoastLossSeconds ?? 0;
  const netPaceEffect = plan.projectedPaceLossSeconds + (tyrePaceEffect ?? 0) + liftCoastEffect;
  const empiricalPace = plan.calculationBreakdown.paceModelSource === "empirical stint regression";
  return (
    <section className={`card span-4 strategy-card${selected ? " selected" : ""}`}>
      <header className="strategy-card-header">
        <div>
          <div className="strategy-card-badges">
            <span className="badge blue">#{index + 1} · {plan.category}</span>
            <span className={`badge ${riskBadge(plan.risk)}`}>{plan.risk} risk</span>
          </div>
          <h2>{plan.label}</h2>
        </div>
        <span className="strategy-confidence">{plan.confidence} confidence</span>
      </header>

      <div className="strategy-outcome">
        <span className="eyebrow">PROJECTED RACE TIME</span>
        <strong>{formatDuration(plan.totalTimeSeconds)}</strong>
        <div className="strategy-outcome-facts">
          <span><b>{plan.raceLaps}</b> laps</span>
          <span><b>{plan.stops}</b> stop{plan.stops === 1 ? "" : "s"}</span>
          <span><b>{fmt(plan.stintLaps, 1)}</b> laps / stint</span>
        </div>
      </div>

      <section className="strategy-time-block">
        <div className="strategy-section-heading">
          <div><span className="eyebrow">WHERE THE TIME GOES</span><strong>Race-time breakdown</strong></div>
          <span className="strategy-reference-pace">Reference pace {formatRaceTime(plan.calculationBreakdown.simulationPaceSeconds)}</span>
        </div>
        <div className="strategy-time-rows">
          <div><span>Reference driving time<small>{plan.raceLaps} laps at baseline pace</small></span><strong>{formatDuration(plan.baseRaceTimeSeconds)}</strong></div>
          <div><span>Pace effects<small>Fuel, warm-up, tyres{plan.liftCoastSavePercent > 0 ? ", and lift-and-coast" : ""}</small></span><strong className={paceEffectTone(netPaceEffect)}>{signedSeconds(netPaceEffect)}</strong></div>
          <div><span>Pit lane &amp; service<small>{plan.stops} complete pit visit{plan.stops === 1 ? "" : "s"}</small></span><strong>+{fmt(plan.pitTimeSeconds, 1, " s")}</strong></div>
          {plan.trafficLossSeconds > 0 && <div><span>Traffic allowance</span><strong>+{fmt(plan.trafficLossSeconds, 1, " s")}</strong></div>}
        </div>
        <div className="pace-effect-summary">
          <div className="pace-effect-heading">
            <span><span className="label">PACE EFFECTS VS REFERENCE</span><small>Negative values recover time; positive values add time.</small></span>
            <strong className={`pace-effect-total ${paceEffectTone(netPaceEffect)}`}>{fmt(Math.abs(netPaceEffect), 1, " s")} {netPaceEffect >= 0 ? "slower" : "faster"}</strong>
          </div>
          <div className="pace-effect-breakdown">
            <span><span>Fuel carried</span><strong className={paceEffectTone(fuelPaceEffect)}>{signedSeconds(fuelPaceEffect)}</strong><small>Changes with stint length</small></span>
            <span><span>{empiricalPace ? "Tyre warm-up" : "Recent pace trend"}</span><strong className={paceEffectTone(warmupOrTrendEffect)}>{signedSeconds(warmupOrTrendEffect)}</strong><small>{empiricalPace ? "Resets after tyre service" : "Bounded projection"}</small></span>
            <span><span>Tyre wear</span><strong className={paceEffectTone(tyrePaceEffect)}>{signedSeconds(tyrePaceEffect)}</strong><small>{tyrePaceEffect == null ? "Not available" : "Measured wear effect"}</small></span>
            {plan.liftCoastSavePercent > 0 && <span><span>Lift-and-coast</span><strong className={paceEffectTone(liftCoastEffect)}>{plan.liftCoastLossSeconds == null ? "Uncalibrated" : signedSeconds(liftCoastEffect)}</strong><small>{fmt(plan.liftCoastSavePercent, 1, "% fuel saving")}</small></span>}
          </div>
        </div>
      </section>

      <section className="strategy-resource-block">
        <div className="strategy-section-heading"><div><span className="eyebrow">RACE LIMITS</span><strong>Fuel &amp; tyres</strong></div></div>
        <div className="strategy-resource-grid">
          <div><span>Start fuel</span><strong>{fmt(plan.recommendedStartFuelLiters, 1, " L")}</strong><small>{plan.startFuelIsFullTank ? "Full tank" : `${fmt(plan.firstStintFuelNeedLiters, 1, " L")} stint requirement`}</small></div>
          <div><span>Fuel at finish</span><strong>{fmt(plan.finishFuelRemainingLiters, 1, " L")}</strong><small>{fmt(plan.fuelMarginLiters, 1, " L")} above reserve</small></div>
          <div><span>Peak tyre wear</span><strong>{pct(plan.projectedTyreWear)}</strong><small>{fmt(plan.lowestRemainingTyreWear == null ? null : plan.lowestRemainingTyreWear * 100, 0, "% life remaining")}</small></div>
          <div><span>Tyre allocation</span><strong>{plan.tyresUsed} / {plan.tyresAvailable ?? "Unlimited"}</strong><small>{plan.tyresRemaining == null ? "No allocation configured" : `${plan.tyresRemaining} unused · starting four included`}</small></div>
          <div><span>Fuel saving</span><strong>{plan.liftCoastSavePercent > 0 ? fmt(plan.liftCoastSavePercent, 1, "%") : "Not required"}</strong><small>{plan.liftCoastSavePercent > 0 ? `${fmt(plan.liftCoastSaveLitersPerLap, 3, " L/lap")} target` : "Run normal consumption"}</small></div>
        </div>
      </section>

      {plan.stopsDetail.length > 0 && (
        <section className="strategy-stop-block">
          <div className="strategy-section-heading"><div><span className="eyebrow">PIT PLAN</span><strong>{plan.stops} scheduled stop{plan.stops === 1 ? "" : "s"}</strong></div></div>
          <div className="strategy-stop-list">
          {plan.stopsDetail.map((stop) => (
            <div key={stop.lap}>
              <strong>Lap {stop.lap}</strong>
              <span>Fuel +{fmt(stop.fuelAddedLiters, 1, " L")}</span>
              <span>Tyres: {tyreChangeWearText(stop)}</span>
              <small>{fmt(stop.stopTimeSeconds, 1, " s")} total</small>
            </div>
          ))}
          </div>
        </section>
      )}
      {plan.warnings.length > 0 && <div className="metric compact strategy-warning"><span className="label">Model warnings</span>{plan.warnings.map((warning) => <span className="subvalue" key={warning}>{warning}</span>)}</div>}
      <details className="strategy-rationale">
        <summary>Why this strategy is ranked #{index + 1}</summary>
        <ul>{plan.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      </details>
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
            <small>{formatDuration(stop.raceTimeRemainingAtPitSeconds)} remaining</small>
            <small>{fmt(stop.fuelRemainingLiters, 1, " L")} left · add {fmt(stop.fuelAddedLiters, 1, " L")} · {tyreChangeWearText(stop)} · {fmt(stop.stopTimeSeconds, 1, " s")}</small>
            <small>{stop.reason}</small>
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
            <thead><tr><th>Stint</th><th>Laps</th><th>Fuel start → end</th><th>Start wear</th><th>End wear</th><th>Wear margin</th></tr></thead>
            <tbody>
              {plan.stintWear.map((stint) => (
                <tr key={stint.stint}>
                  <td>{stint.stint}</td>
                  <td>{stint.startLap}-{stint.endLap}</td>
                  <td>{fmt(stint.startFuelLiters, 1, " L")} → {fmt(stint.endFuelLiters, 1, " L")}</td>
                  <td>{tyreWearText(stint.startWear)}</td>
                  <td>{tyreWearText(stint.endWear)}</td>
                  <td>{tyreRemainingText(stint.remainingWear)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {plan.stintPace.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Stint pace</th><th>Laps</th><th>Start → average → end</th><th>Fuel-load loss</th><th>Tyre loss</th><th>Recent-trend loss</th></tr></thead>
            <tbody>
              {plan.stintPace.map((stint) => (
                <tr key={stint.stint}>
                  <td>Stint {stint.stint}</td>
                  <td>{stint.startLap}-{stint.endLap}</td>
                  <td>{formatRaceTime(stint.startPaceSeconds)} → {formatRaceTime(stint.averagePaceSeconds)} → {formatRaceTime(stint.endPaceSeconds)}</td>
                  <td>{fmt(stint.fuelLoadLossSeconds, 1, " s")}</td>
                  <td>{stint.tyreDegradationLossSeconds == null ? "Unavailable" : fmt(stint.tyreDegradationLossSeconds, 1, " s")}</td>
                  <td>{fmt(stint.recentTrendLossSeconds, 1, " s")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
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

function LiveStyleStrategyTimeline({ plan }: { plan?: StrategyCandidate }) {
  if (!plan) {
    return <div className="empty-state"><strong>No strategy yet</strong><span>Collect valid fuel data or edit assumptions to create a race plan.</span></div>;
  }
  return (
    <div className="strategy-timeline live-style-strategy-timeline">
      <div className="strategy-visual-summary">
        <div><span className="label">Selected plan</span><strong>{formatDuration(plan.totalTimeSeconds)}</strong></div>
        <div><span className="label">Stops planned</span><strong>{plan.stops}</strong></div>
        <div><span className="label">Race plan</span><strong>{fmt(plan.raceLaps, 1, " laps")}</strong></div>
        <div><span className="label">Fuel at finish</span><strong>{fmt(plan.finishFuelRemainingLiters, 1, " L")}</strong></div>
      </div>
      <div className="strategy-track-rail">
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
              <strong>Lap {stop.lap}</strong>
              <small>Pit {index + 1} · {formatDuration(stop.raceTimeRemainingAtPitSeconds)} left</small>
            </span>
          ))}
        </div>
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
                    <span className="label">Stint {stint.stint} - {stintLaps} laps</span>
                    <strong>{stop ? `Pit stop ${index + 1} - Lap ${stop.lap}` : "Finish"}</strong>
                  </div>
                  {stop && <span className="badge amber">{fmt(stop.stopTimeSeconds, 1, " s")} stop</span>}
                </header>
                {plan.stintPace[index] && <span className="subvalue">Projected average pace {formatRaceTime(plan.stintPace[index].averagePaceSeconds)} · {formatRaceTime(plan.stintPace[index].startPaceSeconds)} → {formatRaceTime(plan.stintPace[index].endPaceSeconds)}</span>}
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

export function StrategyPlanner({ strategy, telemetry }: { strategy: StrategyState | null; telemetry?: TelemetrySnapshot | null }) {
  const t = useT();
  const { run: runDuckdbJob, progress: duckdbProgress } = useDuckdbJob();
  const seededSession = useRef<string | null>(null);
  const appliedSessionModel = useRef<string | null>(null);
  const appliedLiveModel = useRef<string | null>(null);
  const [form, setForm] = useState<FormState>(() => seededForm(strategy, telemetry));
  const [manualLapText, setManualLapText] = useState(() => formatTimeInput(seededForm(strategy, telemetry).normal_lap_time));
  const [sessions, setSessions] = useState<LmuDuckdbSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [sessionReview, setSessionReview] = useState<SessionReview | null>(null);
  const [paceBasis, setPaceBasis] = useState<PaceBasis>("median");
  const [safetyPolicy, setSafetyPolicy] = useState<"aggressive" | "balanced" | "conservative">("balanced");
  const [serviceModel, setServiceModel] = useState<"sequential" | "parallel">("sequential");
  const [tyrePolicy, setTyrePolicy] = useState<"automatic" | "all" | "never">("automatic");
  const [reserveUnit, setReserveUnit] = useState<"laps" | "liters">("laps");
  const [modelSource, setModelSource] = useState<ModelSource>("live");
  const [strategyMethod, setStrategyMethod] = useState<"heuristic" | "monte-carlo">("heuristic");
  const [dirtyFields, setDirtyFields] = useState<Set<keyof FormState>>(() => new Set());
  const [sourceStatus, setSourceStatus] = useState("Live data");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [sessionListLoading, setSessionListLoading] = useState(true);
  const [sessionLoading, setSessionLoading] = useState(false);

  useEffect(() => {
    setSessionListLoading(true);
    runDuckdbJob<LmuDuckdbScanResponse>(() => api.startDuckdbSessionsJob(250))
      .then((payload) => {
        setSessions(payload.sessions);
        setSourceStatus(payload.total ? "Saved sessions loaded" : "No synced sessions");
      })
      .catch(() => setSourceStatus("Saved sessions unavailable; sync the folder in User Profile"))
      .finally(() => setSessionListLoading(false));
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
      setSessionLoading(false);
      return;
    }
    let cancelled = false;
    setSessionReview(null);
    appliedSessionModel.current = null;
    setModelSource("session");
    setSessionLoading(true);
    setSourceStatus("Loading saved session");
    runDuckdbJob<SessionReview>(() => api.startDuckdbReviewJob(selectedSessionId))
      .then((review) => {
        if (!cancelled) {
          setSessionReview(review);
          setSourceStatus("Saved session loaded");
        }
      })
      .catch((exc) => !cancelled && setSourceStatus(exc instanceof Error ? exc.message : "Could not load saved session"))
      .finally(() => {
        if (!cancelled) setSessionLoading(false);
      });
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
    if (!value.trim()) {
      setDirtyFields((current) => {
        const next = new Set(current);
        next.delete("normal_lap_time");
        return next;
      });
      setForm((current) => ({ ...current, normal_lap_time: activeModel.normalLapTime ?? current.normal_lap_time }));
      setManualLapText(formatTimeInput(activeModel.normalLapTime));
      return;
    }
    setManualLapText(value);
    const seconds = parseRaceTimeInput(value);
    setDirtyFields((current) => new Set(current).add("normal_lap_time"));
    if (seconds != null) setForm((current) => ({ ...current, normal_lap_time: seconds }));
  };
  const liveModel = useMemo(() => modelFromLive(strategy, telemetry, form), [strategy, telemetry, form]);
  const selectedSession = sessions.find((session) => session.id === selectedSessionId);
  const sessionModel = useMemo(() => {
    const parts = duckdbSessionParts(selectedSession);
    return modelFromSession(sessionReview, selectedSession ? `${parts.sessionType} - ${parts.track}` : "Saved session", form, paceBasis);
  }, [form, paceBasis, sessionReview, selectedSession]);
  const activeModel = modelSource === "session" && sessionModel ? sessionModel : liveModel;

  const applyModelToForm = (model: PlannerModel, clearDirty: boolean) => {
    setForm((current) => {
      const next = { ...current };
      const canSet = (key: keyof FormState) => clearDirty || !dirtyFields.has(key);
      if (canSet("normal_lap_time") && model.normalLapTime != null) next.normal_lap_time = model.normalLapTime;
      if (canSet("tank_capacity_liters") && model.tankCapacityLiters != null) next.tank_capacity_liters = model.tankCapacityLiters;
      setManualLapText(formatTimeInput(next.normal_lap_time));
      return next;
    });
    if (clearDirty) setDirtyFields(new Set());
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
  const fuelSafetyMarginLiters = reserveUnit === "liters"
    ? Math.max(0, form.fuel_safety_margin_liters)
    : fuelPerLap != null && Number.isFinite(fuelPerLap) && fuelPerLap > 0
      ? fuelPerLap * Math.max(0, form.fuel_safety_margin_laps)
      : 0;
  const raceStartWear = form.race_start_new_tyres
    ? { fl: 0, fr: 0, rl: 0, rr: 0 }
    : { fl: tyreWearByWheel.fl, fr: tyreWearByWheel.fr, rl: tyreWearByWheel.rl, rr: tyreWearByWheel.rr };
  const paceEvidence = dirtyFields.has("normal_lap_time")
    ? { ...activeModel.paceEvidence, weightedRecentPace: form.normal_lap_time, source: "manual lap-time override" }
    : activeModel.paceEvidence;
  const strategyEvaluation = useMemo(() => {
    const input: StrategySimulationInput = {
    raceDurationMinutes: form.race_duration_minutes,
    normalLapTime: form.normal_lap_time,
    paceEvidence,
    fuelPerLap: fuelPerLap != null && Number.isFinite(fuelPerLap) && fuelPerLap > 0 ? fuelPerLap : null,
    fuelObservedLaps: activeModel.fuelObservedLaps,
    fuelRequiredLaps: activeModel.fuelRequiredLaps,
    fuelUseStdDevLiters: activeModel.fuelUseStdDevLiters,
    fuelConfidence: activeModel.fuelConfidence,
    tankCapacityLiters: form.tank_capacity_liters > 0 ? form.tank_capacity_liters : null,
    raceStartNewTyres: form.race_start_new_tyres,
    fuelSafetyMarginLiters: fuelSafetyMarginLiters,
    safetyPolicy,
    pitLaneLossSeconds: form.pit_loss_seconds,
    tyreChangeSecondsPerTyre: form.tyre_change_seconds_per_tyre,
    refuelSecondsPer5Liters: form.refuel_seconds_per_5_liters,
    serviceModel,
    currentTyreWear: form.race_start_new_tyres ? 0 : Number.isFinite(currentWear) ? currentWear : null,
    currentTyreWearByWheel: raceStartWear,
    tyreWearRatePerLap: wearRate != null && Number.isFinite(wearRate) && wearRate > 0 ? wearRate : null,
    tyreWearRateByWheel: activeModel.tyreWearRateByWheel,
    tyrePaceDegradationPerLap: activeModel.tyrePaceDegradationPerLap,
    tyreConfidence: activeModel.tyreConfidence,
    maxTyreWear: form.max_tyre_wear,
    maxTyresAvailable: Math.max(4, Math.floor(form.max_tyres_available)),
    tyreChangePolicy: tyrePolicy,
    safetyCarPitLossSeconds: form.safety_car_pit_loss_seconds,
    empiricalStintPace: activeModel.empiricalStintPace,
    liftCoastSecondsPerPercentPerLap: activeModel.liftCoastPace?.secondsPerPercentPerLap ?? null,
    liftCoastMode: form.lift_coast_mode,
    liftCoastTargetPercent: Math.min(12, Math.max(0.5, form.lift_coast_target_percent)),
    };
    const generatedPlans = simulateStrategies(input);
    return { plans: generatedPlans, reasons: generatedPlans.length ? [] : explainNoViableStrategies(input) };
  }, [activeModel.empiricalStintPace, activeModel.fuelConfidence, activeModel.fuelObservedLaps, activeModel.fuelRequiredLaps, activeModel.fuelUseStdDevLiters, activeModel.liftCoastPace, activeModel.tyreConfidence, activeModel.tyrePaceDegradationPerLap, activeModel.tyreWearRateByWheel, currentWear, form, fuelPerLap, fuelSafetyMarginLiters, paceEvidence, raceStartWear.fl, raceStartWear.fr, raceStartWear.rl, raceStartWear.rr, safetyPolicy, serviceModel, tyrePolicy, wearRate]);
  const { plans, reasons: noStrategyReasons } = strategyEvaluation;
  const bestPlan = plans[0];
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? bestPlan;
  const activePlanId = selectedPlan?.id ?? null;
  const plannedHours = form.race_duration_minutes / 60;
  const estimatedPlanLaps = paceEvidence.weightedRecentPace && paceEvidence.weightedRecentPace > 0
    ? Math.ceil(form.race_duration_minutes * 60 / paceEvidence.weightedRecentPace)
    : null;

  return (
    <div className="page grid">
      <LoadingOverlay show={sessionListLoading || sessionLoading} title={duckdbProgress?.phase || (sessionLoading ? "Loading saved session" : "Loading session list")} detail={duckdbProgress?.message || (sessionLoading ? "Reading the selected session and calculating strategy inputs." : "Loading saved sessions for the planner.")} percentage={duckdbProgress?.percentage} error={duckdbProgress?.error} />
      <section className="card span-12 strategy-source-panel">
        <div>
          <span className="eyebrow">PRE-RACE ENGINEERING</span>
          <h1>Strategy Planner</h1>
          <p className="muted">Build a fuel, tyre, pace, and pit plan from measured telemetry. Every result below is tied to its source and constraints.</p>
        </div>
        <div className="strategy-source-identity">
          <span className={`badge ${modelSource === "live" ? "green" : "blue"}`}>{modelSource === "live" ? "Live" : "Selected session"}</span>
          <strong>{modelSource === "live" ? `${telemetry?.session?.session_type || "Current session"} · ${telemetry?.session?.track_name || "Track unavailable"}` : activeModel.label}</strong>
          <span className="subvalue">{selectedSession?.vehicle_name || selectedSession?.vehicle_model || telemetry?.player?.vehicle_name || "Car unavailable"}</span>
          <span className="subvalue">{paceEvidence.foundLaps ?? paceEvidence.sampleLaps ?? 0} complete laps found · {paceEvidence.sampleLaps ?? 0} valid race-pace laps used</span>
        </div>
      </section>
      <PageSection number="01" title="Race Plan" description="Set the race target and evidence source. Open advanced settings only when you need to tune the model.">
      <section className="card span-12">
        <SectionTitle title={t("strategyPlanner.raceAssumptions")} help={t("strategyPlanner.raceAssumptionsHelp")} />
        <div className="strategy-assumption-layout">
          <div className="strategy-plan-target">
            <span className="eyebrow">PLAN TARGET</span>
            <h3>{t("strategyPlanner.howLongRace")}</h3>
            <p>Enter the total scheduled duration. This manual target stays unchanged when you switch telemetry sources.</p>
            <label className="strategy-duration-field">
              <span className="label">{t("strategyPlanner.raceDuration")}</span>
              <span className="strategy-duration-control">
                <input type="number" min="1" step="1" inputMode="numeric" value={form.race_duration_minutes} onChange={(event) => update("race_duration_minutes", event.target.value)} />
                <strong>minutes</strong>
              </span>
            </label>
            <label className="strategy-duration-field">
              <span className="label">Strategy method</span>
              <select value={strategyMethod} onChange={(event) => setStrategyMethod(event.target.value as "heuristic" | "monte-carlo")}>
                <option value="heuristic">Heuristic planner</option>
                <option value="monte-carlo">Monte Carlo simulation</option>
              </select>
              <span className="subvalue">Both methods use this page's reference session and race assumptions.</span>
            </label>
            <div className="strategy-target-summary">
              <span>{fmt(plannedHours, plannedHours % 1 === 0 ? 0 : 2, " hours")}</span>
              <span>{estimatedPlanLaps == null ? "Laps calculated when pace is available" : `About ${estimatedPlanLaps} laps before pit losses`}</span>
            </div>
          </div>

          <div className="strategy-assumption-groups">
            <fieldset className="strategy-assumption-group strategy-evidence-group">
              <legend>Evidence source</legend>
              <div className="strategy-source-picker">
                <span className="label">Reference session</span>
                <SearchableSessionPicker
                  sessions={sessions}
                  selectedId={selectedSessionId}
                  liveValue=""
                  status={sourceStatus}
                  onSelect={setSelectedSessionId}
                  searchAriaLabel="Search reference sessions"
                  listAriaLabel="Reference sessions"
                />
                <span className="subvalue">{sourceStatus} · {selectedSession ? "Saved reference selected" : "Using live/current session"}</span>
              </div>
              <label><span className="label">{t("strategyPlanner.activeNormalLap")}</span><input value={`${formatRaceTime(form.normal_lap_time)} (${activeModel.source === "session" ? t("strategyPlanner.savedSessionManual") : activeModel.label})`} readOnly /><span className="subvalue">{t("strategyPlanner.usedByStrategyModel")}</span></label>
            </fieldset>

            <fieldset className="strategy-assumption-group strategy-tyres-available">
              <legend>Tyres available</legend>
              <label><span className="label">Tyres available for race</span><input type="number" min="4" max="200" step="1" value={form.max_tyres_available} onChange={(event) => update("max_tyres_available", event.target.value)} /><span className="subvalue">Individual tyres · includes the four fitted at the start</span></label>
            </fieldset>

            <details className="strategy-advanced-settings">
              <summary>
                <span><strong>Advanced settings</strong><small>Pace basis, fuel reserve, pit service, and tyre plan</small></span>
                <span className="strategy-advanced-toggle" aria-hidden="true">+</span>
              </summary>
              <div className="strategy-advanced-grid">
                <fieldset className="strategy-assumption-group">
                  <legend>Pace basis</legend>
                  <label><span className="label">{t("strategyPlanner.paceBasis")}</span><select value={paceBasis} onChange={(event) => setPaceBasis(event.target.value as PaceBasis)}><option value="median">{t("strategyPlanner.medianValidLap")}</option><option value="trimmed">{t("strategyPlanner.trimmedMean")}</option><option value="percentile">{t("strategyPlanner.percentileRacePace")}</option></select><span className="subvalue">{t("strategyPlanner.calculatedFromReference")}</span></label>
                  <label><span className="label">Manual lap time</span><input value={manualLapText} onChange={(event) => updateLapTime(event.target.value)} placeholder="03:34.000" /><span className="subvalue">Optional override · mm:ss.mmm</span></label>
                </fieldset>

                <fieldset className="strategy-assumption-group">
                  <legend>Fuel & reserve</legend>
                  <label><span className="label">Tank capacity</span><input type="number" min="0" step="0.1" value={form.tank_capacity_liters} onChange={(event) => update("tank_capacity_liters", event.target.value)} /><span className="subvalue">litres</span></label>
                  <label><span className="label">Safety reserve policy</span><select value={safetyPolicy} onChange={(event) => setSafetyPolicy(event.target.value as typeof safetyPolicy)}><option value="conservative">Conservative</option><option value="balanced">Balanced</option><option value="aggressive">Aggressive</option></select><span className="subvalue">Adjusts planning rate and reserve</span></label>
                  <label><span className="label">Finish reserve</span><span className="strategy-inline-fields"><select value={reserveUnit} onChange={(event) => setReserveUnit(event.target.value as typeof reserveUnit)}><option value="laps">Equivalent laps</option><option value="liters">Litres</option></select><input type="number" min="0" step="0.1" value={reserveUnit === "laps" ? form.fuel_safety_margin_laps : form.fuel_safety_margin_liters} onChange={(event) => update(reserveUnit === "laps" ? "fuel_safety_margin_laps" : "fuel_safety_margin_liters", event.target.value)} /></span><span className="subvalue">{fmt(fuelSafetyMarginLiters, 2, " L")} before policy adjustment</span></label>
                  <label><span className="label">Lift-and-coast target</span><select value={form.lift_coast_mode} onChange={(event) => { const value = event.target.value as FormState["lift_coast_mode"]; setDirtyFields((current) => new Set(current).add("lift_coast_mode")); setForm((current) => ({ ...current, lift_coast_mode: value })); }}><option value="inferred">Infer saving needed</option><option value="fixed">Use selected percentage</option></select><span className="subvalue">Inference searches for the saving needed to extend a stint or remove a stop</span></label>
                  <label><span className="label">Selected lift-and-coast</span><input type="number" min="0.5" max="12" step="0.5" value={form.lift_coast_target_percent} onChange={(event) => update("lift_coast_target_percent", event.target.value)} disabled={form.lift_coast_mode !== "fixed"} /><span className="subvalue">Fuel saving target · defaults to 3%</span></label>
                </fieldset>

                <fieldset className="strategy-assumption-group">
                  <legend>Pit service</legend>
                  <label><span className="label">Pit lane driving loss</span><input type="number" min="0" step="0.1" value={form.pit_loss_seconds} onChange={(event) => update("pit_loss_seconds", event.target.value)} /><span className="subvalue">seconds per stop</span></label>
                  <label><span className="label">Load 5 L fuel</span><input type="number" min="0" step="0.1" value={form.refuel_seconds_per_5_liters} onChange={(event) => update("refuel_seconds_per_5_liters", event.target.value)} /><span className="subvalue">seconds</span></label>
                  <label><span className="label">Change one tyre</span><input type="number" min="0" step="0.1" value={form.tyre_change_seconds_per_tyre} onChange={(event) => update("tyre_change_seconds_per_tyre", event.target.value)} /><span className="subvalue">seconds</span></label>
                  <label><span className="label">Service timing</span><select value={serviceModel} onChange={(event) => setServiceModel(event.target.value as typeof serviceModel)}><option value="sequential">Sequential: fuel + tyres</option><option value="parallel">Parallel: slower job wins</option></select><span className="subvalue">How fuel and tyre work overlap</span></label>
                </fieldset>

                <fieldset className="strategy-assumption-group">
                  <legend>Tyre plan</legend>
                  <label><span className="label">Maximum tyre wear</span><input type="number" min="0" max="1" step="0.01" value={form.max_tyre_wear} onChange={(event) => update("max_tyre_wear", event.target.value)} /><span className="subvalue">fraction · 0.75 means 75%</span></label>
                  <label><span className="label">Tyre change policy</span><select value={tyrePolicy} onChange={(event) => setTyrePolicy(event.target.value as typeof tyrePolicy)}><option value="automatic">Automatic by corner</option><option value="all">All four at every stop</option><option value="never">Never (exploration)</option></select><span className="subvalue">Automatic changes threshold crossings</span></label>
                  <label><span className="label">{t("strategyPlanner.startTyreSet")}</span><span className="toggle-line"><input type="checkbox" checked={form.race_start_new_tyres} onChange={(event) => updateBoolean("race_start_new_tyres", event.target.checked)} /><span>{t("strategyPlanner.startOnNewTyres")}</span></span><span className="subvalue">{t("strategyPlanner.otherwiseReferenceWear")}</span></label>
                </fieldset>
              </div>
            </details>
          </div>
        </div>
      </section>
      </PageSection>

      {strategyMethod === "monte-carlo" ? <PageSection number="02" title="Race Simulation" description="Stress-test the plan across pace variation, fuel risk, tyre life, traffic, and pit outcomes."><MonteCarloStrategyPanel sessionId={selectedSessionId} assumptions={{
        raceDurationMinutes: form.race_duration_minutes,
        tankCapacityLiters: form.tank_capacity_liters,
        finishReserveLiters: fuelSafetyMarginLiters,
        pitLossSeconds: form.pit_loss_seconds,
        tyreWearLimit: form.max_tyre_wear,
        maxTyresAvailable: Math.max(4, Math.floor(form.max_tyres_available)),
        tyreChangeSecondsPerTyre: form.tyre_change_seconds_per_tyre,
        refuelSecondsPer5Liters: form.refuel_seconds_per_5_liters,
        serviceModel,
        normalLapTime: form.normal_lap_time,
        fuelPerLapLiters: fuelPerLap,
        tyreWearRatePerLap: wearRate,
      }} /></PageSection> : <>
      <PageSection number="02" title="Model Evidence" description="Review the measured inputs, confidence, and calculation factors behind the strategy ranking.">
      <section className="card span-12">
        <SectionTitle title="Model Status" help="Summarizes the live data feeding the race simulation. More valid fuel and tyre laps improve confidence." />
        <div className="analysis-value-grid">
          <div><span className="label">Model source</span><strong>{activeModel.source === "session" ? "Saved session" : "Live"}</strong><span className="subvalue">{activeModel.label}</span></div>
          <div><span className="label">Pace model</span><strong>{formatRaceTime(paceEvidence.weightedRecentPace)}</strong><span className="subvalue">{paceEvidence.method || paceBasis} · {paceEvidence.source}</span></div>
          <div><span className="label">Pace windows</span><strong>{formatRaceTime(paceEvidence.last7LapAverage)} / {formatRaceTime(paceEvidence.last10LapAverage)}</strong><span className="subvalue">7-lap / 10-lap averages</span></div>
          <div><span className="label">Pace trend / spread</span><strong>{fmt(paceEvidence.paceTrendSecondsPerLap, 3, " s/lap")}</strong><span className="subvalue">spread {fmt(paceEvidence.spreadSeconds, 3, " s")} · {paceEvidence.confidence || "low"} confidence</span></div>
          <div><span className="label">Stint pace model</span><strong>{activeModel.empiricalStintPace ? "Empirical regression" : "Fallback heuristic"}</strong><span className="subvalue">{activeModel.empiricalStintPace ? `${activeModel.empiricalStintPace.sampleLaps} laps · ${activeModel.empiricalStintPace.observedStints} stints · residual σ ${fmt(activeModel.empiricalStintPace.residualStdDevSeconds, 2, " s")}` : "Needs at least 12 laps with fuel and tyre wear"}</span></div>
          {activeModel.empiricalStintPace && <div><span className="label">Measured stint effects</span><strong>{fmt(activeModel.empiricalStintPace.fuelCoefficientSecondsPerLiter, 3, " s/L")} · {fmt(activeModel.empiricalStintPace.tyreWearCoefficientSecondsPerFraction, 1, " s/full wear")}</strong><span className="subvalue">warm-up {fmt(activeModel.empiricalStintPace.warmupLossSeconds, 2, " s")} · observed through lap {activeModel.empiricalStintPace.maxObservedStintLaps}</span></div>}
          <div><span className="label">Lift-and-coast calibration</span><strong>{activeModel.liftCoastPace ? fmt(activeModel.liftCoastPace.secondsPerPercentPerLap, 3, " s / 1% / lap") : "Unavailable"}</strong><span className="subvalue">{activeModel.liftCoastPace ? `${activeModel.liftCoastPace.sampleLaps} comparable laps · coast/fuel correlation ${fmt(activeModel.liftCoastPace.fuelSavingCoastCorrelation, 2)} · ${activeModel.liftCoastPace.confidence} confidence` : "Needs clean laps with fuel, wear, throttle, and brake samples"}</span></div>
          <div><span className="label">Lift-and-coast strategy</span><strong>{form.lift_coast_mode === "fixed" ? `${fmt(form.lift_coast_target_percent, 1, "%")} fixed target` : "Infer required saving"}</strong><span className="subvalue">Default selected target is 3%</span></div>
          <div><span className="label">Fuel use</span><strong>{fmt(Number.isFinite(fuelPerLap ?? NaN) ? fuelPerLap : null, 3, " L/lap")}</strong><span className="subvalue">{activeModel.fuelObservedLaps}/{activeModel.fuelRequiredLaps} valid laps</span></div>
          <div><span className="label">Fuel variance</span><strong>{fmt(activeModel.fuelUseStdDevLiters, 3, " L")}</strong><span className="subvalue">{activeModel.fuelConfidence} confidence · cumulative σ√laps allowance</span></div>
          <div><span className="label">Fuel margin</span><strong>{fmt(form.fuel_safety_margin_laps, 1, " laps")}</strong><span className="subvalue">{fmt(fuelSafetyMarginLiters, 2, " L")} from model fuel use</span></div>
          <div><span className="label">Tyre wear</span><strong>{pct(Number.isFinite(currentWear) ? currentWear : null)}</strong><span className="subvalue">{fmt(wearRate != null && Number.isFinite(wearRate) ? wearRate * 100 : null, 2, "% / lap")}</span></div>
          <div><span className="label">Calculated start fuel</span><strong>{fmt(selectedPlan?.recommendedStartFuelLiters, 1, " L")}</strong><span className="subvalue">first stint + configured reserve, capped by tank</span></div>
          <div><span className="label">Race start tyres</span><strong>{form.race_start_new_tyres ? "New set" : "Observed wear"}</strong><span className="subvalue">{form.race_start_new_tyres ? "starts projection at 0%" : "uses model wear"}</span></div>
          <div><span className="label">Service model</span><strong>{fmt(form.pit_loss_seconds, 1, " s")}</strong><span className="subvalue">+ tyres + fuel</span></div>
        </div>
      </section>

      {selectedPlan && (
        <section className="card span-12">
          <SectionTitle title="Calculation Inputs" help="Shows the selected strategy inputs and time penalties used to rank the plan." />
          <div className="table-wrap">
            <table>
              <thead><tr><th>Input / derived factor</th><th>Value</th><th>Source / formula</th><th>Used for</th></tr></thead>
              <tbody>
                <tr><td>Active normal lap</td><td>{formatRaceTime(selectedPlan.calculationBreakdown.simulationPaceSeconds)}</td><td>{paceEvidence.method || paceBasis} of {paceEvidence.sampleLaps ?? 0} valid laps</td><td>Base pace</td></tr>
                <tr><td>Stint pace model</td><td>{selectedPlan.calculationBreakdown.paceModelSource}</td><td>Fuel load + tyre wear + warm-up, robustly fitted when available</td><td>Lap-by-lap pace</td></tr>
                <tr><td>Pace variability / P90</td><td>{fmt(selectedPlan.calculationBreakdown.paceVariabilitySecondsPerLap, 2, " s/lap")} / {formatDuration(selectedPlan.calculationBreakdown.p90TotalTimeSeconds)}</td><td>Robust residual variance propagated as σ√laps</td><td>Downside range</td></tr>
                <tr><td>Race duration</td><td>{fmt(form.race_duration_minutes, 0, " min")}</td><td>User assumption</td><td>Elapsed-time target</td></tr>
                <tr><td>Completed laps</td><td>{selectedPlan.raceLaps}</td><td>Event simulation including pit/service time</td><td>Fuel and stint plan</td></tr>
                <tr><td>Fuel use</td><td>{fmt(selectedPlan.calculationBreakdown.fuelUseLitersPerLap, 3, " L/lap")}</td><td>Robust measured rate + safety policy</td><td>Stint fuel</td></tr>
                <tr><td>Finish reserve</td><td>{fmt(selectedPlan.finishFuelRemainingLiters, 1, " L")}</td><td>Configured target + variance policy</td><td>Fuel safety</td></tr>
                <tr><td>Pit lane / stationary</td><td>{fmt(selectedPlan.calculationBreakdown.pitLaneTimeSeconds, 1, " s")} / {fmt(selectedPlan.calculationBreakdown.stationaryServiceTimeSeconds, 1, " s")}</td><td>User service assumptions</td><td>Every stop</td></tr>
                <tr><td>Tyre degradation loss</td><td>{selectedPlan.tyreDegradationLossSeconds == null ? "Unavailable" : fmt(selectedPlan.tyreDegradationLossSeconds, 1, " s")}</td><td>{selectedPlan.tyreDegradationLossSeconds == null ? "Insufficient measured pace/wear relationship" : "Measured pace/wear slope"}</td><td>Pace projection</td></tr>
                <tr><td>Confidence</td><td>{selectedPlan.confidence}</td><td>Minimum of pace, fuel, tyre, and risk confidence</td><td>Decision quality</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
      </PageSection>

      <PageSection number="03" title="Strategy Options" description="Compare viable stop plans, projected race time, resource use, and risk before selecting a strategy.">
      {plans.length ? plans.map((plan, index) => (
        <PlanCard
          plan={plan}
          index={index}
          selected={plan.id === activePlanId}
          onSelect={() => setSelectedPlanId(plan.id)}
          key={plan.id}
        />
      )) : (
        <section className="card span-12"><div className="empty-state"><strong>No viable strategy</strong><span>The current assumptions block every simulated plan:</span><ul>{noStrategyReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div></section>
      )}
      </PageSection>

      <PageSection number="04" title="Pit Plan" description="Follow the selected strategy stint by stint, including pit timing, fuel service, and tyre life.">
      <section className="card span-12 pit-strategy-visualization">
        <SectionTitle title="Live Pit Strategy Visualization" help="Shows the selected plan as a stint timeline, then details tyre life and fuel service at every pit stop." />
        <LiveStyleStrategyTimeline plan={selectedPlan} />
      </section>
      </PageSection>
      </>}
    </div>
  );
}
