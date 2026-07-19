export type EnvironmentTrendDirection = "up" | "down" | "steady" | "unavailable";
export type TrackWetnessState = "dry" | "slightlyDamp" | "wet" | "veryWet" | "saturated" | "unavailable";

export function environmentTrendDirection(values: Array<number | null | undefined>, deadband: number): EnvironmentTrendDirection {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (valid.length < 2) return "unavailable";
  const change = valid[valid.length - 1] - valid[0];
  if (change > deadband) return "up";
  if (change < -deadband) return "down";
  return "steady";
}

export function trackWetnessState(value?: number | null): TrackWetnessState {
  if (value == null || !Number.isFinite(value)) return "unavailable";
  if (value <= 0.05) return "dry";
  if (value <= 0.20) return "slightlyDamp";
  if (value <= 0.50) return "wet";
  if (value <= 0.80) return "veryWet";
  return "saturated";
}
