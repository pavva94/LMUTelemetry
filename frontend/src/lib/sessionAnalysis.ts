import type { SessionReview } from "../types/session";

export type AnalysisRow = Record<string, unknown>;

export function toFiniteNumber(value: unknown): number | null {
  if (value == null || typeof value === "boolean") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function average(values: Array<number | null | undefined>): number | null {
  const clean = values.filter((value): value is number => value != null && Number.isFinite(value));
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

export function median(values: Array<number | null | undefined>): number | null {
  const clean = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

export function minimum(values: Array<number | null | undefined>): number | null {
  const clean = values.filter((value): value is number => value != null && Number.isFinite(value));
  return clean.length ? Math.min(...clean) : null;
}

export function maximum(values: Array<number | null | undefined>): number | null {
  const clean = values.filter((value): value is number => value != null && Number.isFinite(value));
  return clean.length ? Math.max(...clean) : null;
}

export function standardDeviation(values: number[], mean = average(values)): number | null {
  if (!values.length || mean == null) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

export function splitTrend(values: number[], threshold: number): "rising" | "falling" | "stable" | "unavailable" {
  if (values.length < 4) return "unavailable";
  const split = Math.floor(values.length / 2);
  const first = average(values.slice(0, split));
  const second = average(values.slice(split));
  if (first == null || second == null) return "unavailable";
  const diff = second - first;
  if (Math.abs(diff) <= threshold) return "stable";
  return diff > 0 ? "rising" : "falling";
}

export function validSessionLaps(review: SessionReview): AnalysisRow[] {
  const candidates = (review.laps || []).filter((lap) => {
    const lapTime = toFiniteNumber(lap.lap_time);
    const fuelAdded = toFiniteNumber(lap.fuel_added) || 0;
    return lapTime != null && lapTime >= 40 && lapTime <= 900 && lap.valid_lap !== false && lap.in_pit !== true && fuelAdded <= 2;
  });
  const normal = median(candidates.map((lap) => toFiniteNumber(lap.lap_time)));
  return candidates.filter((lap) => {
    const lapTime = toFiniteNumber(lap.lap_time);
    return lapTime != null && (!normal || (lapTime >= normal * 0.75 && lapTime <= normal * 1.8));
  });
}
