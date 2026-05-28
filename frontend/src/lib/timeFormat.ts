export function formatRaceTime(value?: number | null, precision = 3) {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) return "--";
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const minutes = Math.floor(absolute / 60);
  const seconds = absolute - minutes * 60;
  const secondText = seconds.toFixed(precision).padStart(precision + 3, "0");
  const minuteText = String(minutes).padStart(2, "0");
  return `${sign}${minuteText}:${secondText}`;
}

export function formatRaceGap(value?: number | null) {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${formatRaceTime(value)}`;
}
