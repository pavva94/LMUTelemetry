import { formatRaceGap, formatRaceTime } from "./timeFormat";

export type FieldKind = "race-time" | "gap" | "percent" | "temperature" | "pressure" | "speed" | "fuel" | "rpm" | "number";

const raceTimeFields = new Set([
  "lap_time",
  "last_lap_time",
  "best_lap_time",
  "current_lap_time",
  "estimated_lap_time",
  "expected_lap_time",
  "normal_lap_time",
  "fastest_lap",
  "average_lap",
  "median_lap",
  "first_half_average",
  "second_half_average",
  "degradation_per_lap",
  "start_time",
  "end_time",
  "duration",
  "game_time",
  "current_time",
  "time_remaining",
  "pit_loss_seconds",
  "pit_stationary_seconds",
  "safety_car_pit_loss_seconds",
  "stationary_time",
  "total_pit_loss",
]);

const gapFields = new Set([
  "gap",
  "delta",
  "delta_best",
  "time_behind_next",
  "time_behind_leader",
  "gap_to_player",
  "gap_car_ahead",
  "gap_car_behind",
  "gap_place_ahead",
  "gap_place_behind",
]);

export function normalizeFieldName(field: string) {
  return field.replace(/\s+B$/, "").replace(/ B$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function fieldKind(field: string): FieldKind {
  const key = normalizeFieldName(field);
  if (raceTimeFields.has(key) || key.endsWith("_time") || key.endsWith("_duration")) return "race-time";
  if (gapFields.has(key) || key.includes("gap") || key.includes("delta") || key.includes("behind")) return "gap";
  if (key.includes("percent") || key.includes("fraction") || key.includes("wetness") || key.includes("wear")) return "percent";
  if (key.includes("temp")) return "temperature";
  if (key.includes("pressure")) return "pressure";
  if (key.includes("speed")) return "speed";
  if (key.includes("fuel")) return "fuel";
  if (key.includes("rpm")) return "rpm";
  return "number";
}

export function isRaceTimeField(field: string) {
  return fieldKind(field) === "race-time" || fieldKind(field) === "gap";
}

export function formatTelemetryValue(value: unknown, field: string, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value == null || value === "" ? "--" : String(value);
  const kind = fieldKind(field);
  if (kind === "race-time") return formatRaceTime(numeric);
  if (kind === "gap") return formatRaceGap(numeric);
  if (kind === "percent") return Math.abs(numeric) <= 1 ? `${Math.round(numeric * 100)}%` : `${numeric.toFixed(digits)}%`;
  if (kind === "temperature") return `${numeric.toFixed(digits)} C`;
  if (kind === "speed") return `${numeric.toFixed(0)} km/h`;
  if (kind === "fuel") return `${numeric.toFixed(field.includes("per") ? 3 : 2)} L`;
  if (kind === "rpm") return numeric.toFixed(0);
  return numeric.toFixed(digits);
}

export function chartValueFormatter(value: unknown, name: unknown) {
  return formatTelemetryValue(value, String(name));
}

export function chartLabelFormatter(value: unknown, field: string) {
  return formatTelemetryValue(value, field);
}
