import type { SessionReview } from "../types/session";
import { median, toFiniteNumber, validSessionLaps } from "./sessionAnalysis";
import type { EmpiricalStintPaceModel, StrategyConfidence } from "./strategySimulation";

const wheels = ["fl", "fr", "rl", "rr"] as const;

function usedWear(value: number | null) {
  if (value == null) return null;
  if (value >= 0 && value <= 1) return value;
  if (value > 1 && value <= 100) return 1 - value / 100;
  return null;
}

function solve(matrix: number[][], vector: number[]) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    if (Math.abs(augmented[pivot][column]) < 1e-10) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let index = column; index <= size; index += 1) augmented[column][index] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = column; index <= size; index += 1) augmented[row][index] -= factor * augmented[column][index];
    }
  }
  return augmented.map((row) => row[size]);
}

function weightedRegression(features: number[][], targets: number[], weights: number[]) {
  const size = features[0].length;
  const matrix = Array.from({ length: size }, () => Array(size).fill(0));
  const vector = Array(size).fill(0);
  features.forEach((row, observation) => {
    for (let left = 0; left < size; left += 1) {
      vector[left] += weights[observation] * row[left] * targets[observation];
      for (let right = 0; right < size; right += 1) matrix[left][right] += weights[observation] * row[left] * row[right];
    }
  });
  return solve(matrix, vector);
}

function robustSigma(values: number[]) {
  const center = median(values) ?? 0;
  return Math.max(0.1, (median(values.map((value) => Math.abs(value - center))) ?? 0) * 1.4826);
}

export function calibrateStintPace(review: SessionReview): EmpiricalStintPaceModel | null {
  const clean = new Set(validSessionLaps(review));
  // Preserve source order so aggregated comparable sessions retain their
  // boundaries; a lap-number restart begins a new observed stint.
  const ordered = [...(review.laps ?? [])];
  const observations: Array<{ pace: number; fuel: number; wear: number; age: number }> = [];
  let age = 0;
  let observedStints = 0;
  let activeStint = false;
  let previousLapNumber: number | null = null;
  for (const lap of ordered) {
    const lapNumber = toFiniteNumber(lap.lap_number);
    if (lapNumber != null && previousLapNumber != null && lapNumber <= previousLapNumber) { age = 0; activeStint = false; }
    if (lapNumber != null) previousLapNumber = lapNumber;
    if (lap.in_pit === true) { age = 0; activeStint = false; continue; }
    age += 1;
    if (!clean.has(lap)) continue;
    const pace = toFiniteNumber(lap.lap_time);
    const fuel = toFiniteNumber(lap.fuel_start);
    const wearValues = wheels.map((wheel) => usedWear(toFiniteNumber(lap[`tyre_wear_end_${wheel}`]) ?? toFiniteNumber(lap.tyre_wear_end)));
    if (pace == null || fuel == null || wearValues.some((value) => value == null)) continue;
    if (!activeStint) { observedStints += 1; activeStint = true; }
    observations.push({ pace, fuel, wear: wearValues.reduce<number>((sum, value) => sum + (value ?? 0), 0) / wheels.length, age });
  }
  if (observations.length < 12) return null;
  const referenceFuel = median(observations.map((row) => row.fuel)) ?? 0;
  const referenceWear = median(observations.map((row) => row.wear)) ?? 0;
  const warmups = observations.map((row) => Math.exp(-(row.age - 1) / 2));
  const referenceWarmup = median(warmups) ?? 0;
  const features = observations.map((row, index) => [1, (row.fuel - referenceFuel) / 40, (row.wear - referenceWear) / 0.1, warmups[index] - referenceWarmup]);
  const targets = observations.map((row) => row.pace);
  let weights = observations.map(() => 1);
  let coefficients = weightedRegression(features, targets, weights);
  if (!coefficients) return null;
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const residuals = targets.map((target, index) => target - features[index].reduce((sum, value, feature) => sum + value * coefficients![feature], 0));
    const sigma = robustSigma(residuals);
    weights = residuals.map((residual) => Math.min(1, 1.345 * sigma / Math.max(Math.abs(residual), 1e-9)));
    coefficients = weightedRegression(features, targets, weights);
    if (!coefficients) return null;
  }
  const fittedResiduals = targets.map((target, index) => target - features[index].reduce((sum, value, feature) => sum + value * coefficients![feature], 0));
  const confidence: StrategyConfidence = observations.length >= 30 ? "high" : "medium";
  return {
    sampleLaps: observations.length,
    observedStints,
    maxObservedStintLaps: Math.max(...observations.map((row) => row.age)),
    fuelCoefficientSecondsPerLiter: Math.min(0.15, Math.max(0, coefficients[1] / 40)),
    tyreWearCoefficientSecondsPerFraction: Math.min(50, Math.max(0, coefficients[2] / 0.1)),
    warmupLossSeconds: Math.min(12, Math.max(0, coefficients[3])),
    residualStdDevSeconds: robustSigma(fittedResiduals),
    referenceFuelLiters: referenceFuel,
    referenceTyreWear: referenceWear,
    referenceWarmup,
    confidence,
  };
}
