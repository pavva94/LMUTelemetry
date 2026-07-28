import type { SessionReview } from "../types/session";
import { median, toFiniteNumber, validSessionLaps } from "./sessionAnalysis";
import type { EmpiricalStintPaceModel, LiftCoastPaceModel, StrategyConfidence } from "./strategySimulation";

const wheels = ["fl", "fr", "rl", "rr"] as const;

function normalizedPedal(value: number | null) {
  if (value == null || value < 0) return null;
  return value > 1.5 ? Math.min(1, value / 100) : Math.min(1, value);
}

function usedWear(value: number | null) {
  if (value == null) return null;
  if (value >= 0 && value <= 1) return value;
  if (value > 1 && value <= 100) return 1 - value / 100;
  return null;
}

function quantile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const position = (ordered.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower);
}

function correlation(left: number[], right: number[]) {
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  const covariance = left.reduce((sum, value, index) => sum + (value - leftMean) * (right[index] - rightMean), 0);
  const leftScale = Math.sqrt(left.reduce((sum, value) => sum + (value - leftMean) ** 2, 0));
  const rightScale = Math.sqrt(right.reduce((sum, value) => sum + (value - rightMean) ** 2, 0));
  return leftScale > 0 && rightScale > 0 ? covariance / (leftScale * rightScale) : 0;
}

function robustSigma(values: number[]) {
  const center = median(values) ?? 0;
  return Math.max(0.05, (median(values.map((value) => Math.abs(value - center))) ?? 0) * 1.4826);
}

function weightedLine(x: number[], y: number[], weights: number[]) {
  const weight = weights.reduce((sum, value) => sum + value, 0);
  if (weight <= 0) return null;
  const xMean = x.reduce((sum, value, index) => sum + weights[index] * value, 0) / weight;
  const yMean = y.reduce((sum, value, index) => sum + weights[index] * value, 0) / weight;
  const denominator = x.reduce((sum, value, index) => sum + weights[index] * (value - xMean) ** 2, 0);
  if (denominator < 1e-9) return null;
  const slope = x.reduce((sum, value, index) => sum + weights[index] * (value - xMean) * (y[index] - yMean), 0) / denominator;
  return { intercept: yMean - slope * xMean, slope };
}

/**
 * Fits lap-time cost per percentage point of fuel saved. The fit is accepted
 * only when denser throttle/brake samples confirm that more coasting coincides
 * with lower fuel use. The existing stint model removes fuel-load, tyre-wear,
 * and warm-up effects before the robust line is fitted.
 */
export function calibrateLiftCoast(review: SessionReview, stintModel: EmpiricalStintPaceModel | null): LiftCoastPaceModel | null {
  if (!stintModel) return null;
  const samplesByLap = new Map<number, { total: number; coast: number }>();
  for (const sample of review.telemetry_samples ?? []) {
    const lapNumber = toFiniteNumber(sample.lap_number);
    const throttle = normalizedPedal(toFiniteNumber(sample.throttle));
    const brake = normalizedPedal(toFiniteNumber(sample.brake));
    const speed = toFiniteNumber(sample.speed_kph);
    if (lapNumber == null || throttle == null || brake == null || (speed != null && speed < 30)) continue;
    const bucket = samplesByLap.get(lapNumber) ?? { total: 0, coast: 0 };
    bucket.total += 1;
    if (throttle <= 0.08 && brake <= 0.03) bucket.coast += 1;
    samplesByLap.set(lapNumber, bucket);
  }

  const clean = new Set(validSessionLaps(review));
  const observations: Array<{ pace: number; fuelUsed: number; coast: number; fuel: number; wear: number; age: number }> = [];
  let age = 0;
  let previousLap: number | null = null;
  for (const lap of review.laps ?? []) {
    const lapNumber = toFiniteNumber(lap.lap_number);
    if (lapNumber != null && previousLap != null && lapNumber <= previousLap) age = 0;
    if (lapNumber != null) previousLap = lapNumber;
    if (lap.in_pit === true) { age = 0; continue; }
    age += 1;
    if (!clean.has(lap) || lapNumber == null) continue;
    const sample = samplesByLap.get(lapNumber);
    const pace = toFiniteNumber(lap.lap_time);
    const fuelUsed = toFiniteNumber(lap.fuel_used);
    const fuel = toFiniteNumber(lap.fuel_start);
    const wearValues = wheels.map((wheel) => usedWear(toFiniteNumber(lap[`tyre_wear_end_${wheel}`]) ?? toFiniteNumber(lap.tyre_wear_end)));
    if (!sample || sample.total < 15 || pace == null || fuelUsed == null || fuelUsed <= 0 || fuel == null || wearValues.some((value) => value == null)) continue;
    observations.push({ pace, fuelUsed, coast: sample.coast / sample.total, fuel, wear: wearValues.reduce<number>((sum, value) => sum + (value ?? 0), 0) / wheels.length, age });
  }
  if (observations.length < 12) return null;

  const referenceFuelUse = median(observations.map((row) => row.fuelUsed));
  if (referenceFuelUse == null || referenceFuelUse <= 0) return null;
  const saving = observations.map((row) => (referenceFuelUse - row.fuelUsed) / referenceFuelUse * 100);
  const coast = observations.map((row) => row.coast);
  const savingRange = quantile(saving, 0.9) - quantile(saving, 0.1);
  const coastRange = (quantile(coast, 0.9) - quantile(coast, 0.1)) * 100;
  const coastCorrelation = correlation(saving, coast);
  if (savingRange < 0.75 || coastRange < 0.5 || coastCorrelation < 0.2) return null;

  const adjustedPace = observations.map((row) => row.pace
    - stintModel.fuelCoefficientSecondsPerLiter * (row.fuel - row.fuelUsed / 2 - stintModel.referenceFuelLiters)
    - stintModel.tyreWearCoefficientSecondsPerFraction * (row.wear - stintModel.referenceTyreWear)
    - stintModel.warmupLossSeconds * (Math.exp(-(row.age - 1) / 2) - stintModel.referenceWarmup));
  let weights = observations.map(() => 1);
  let fit = weightedLine(saving, adjustedPace, weights);
  if (!fit) return null;
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const residuals = adjustedPace.map((pace, index) => pace - fit!.intercept - fit!.slope * saving[index]);
    const sigma = robustSigma(residuals);
    weights = residuals.map((residual) => Math.min(1, 1.345 * sigma / Math.max(Math.abs(residual), 1e-9)));
    fit = weightedLine(saving, adjustedPace, weights);
    if (!fit) return null;
  }
  if (fit.slope <= 0.01 || fit.slope > 2.5) return null;
  const confidence: StrategyConfidence = observations.length >= 30 && coastCorrelation >= 0.35 ? "high" : "medium";
  return {
    sampleLaps: observations.length,
    secondsPerPercentPerLap: fit.slope,
    fuelSavingCoastCorrelation: coastCorrelation,
    observedSavingRangePercent: savingRange,
    observedCoastRangePercent: coastRange,
    confidence,
  };
}
