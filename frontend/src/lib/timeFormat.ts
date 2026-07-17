export function formatRaceTime(value?: number | null, precision = 3) {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) return "--";
  const sign = value < 0 ? "-" : "";
  const scale = 10 ** precision;
  const absolute = Math.round(Math.abs(value) * scale) / scale;
  const minutes = Math.floor(absolute / 60);
  const seconds = absolute - minutes * 60;
  const secondText = seconds.toFixed(precision).padStart(precision + 3, "0");
  const minuteText = String(minutes).padStart(2, "0");
  return `${sign}${minuteText}:${secondText}`;
}

export function formatDuration(value?: number | null, precision = 3) {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) return "--";
  if (Math.abs(value) < 3600) return formatRaceTime(value, precision);
  const sign = value < 0 ? "-" : "";
  const scale = 10 ** precision;
  const absolute = Math.round(Math.abs(value) * scale) / scale;
  const hours = Math.floor(absolute / 3600);
  const remainder = absolute - hours * 3600;
  const minutes = Math.floor(remainder / 60);
  const seconds = remainder - minutes * 60;
  return `${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${seconds.toFixed(precision).padStart(precision + 3, "0")}`;
}

/** Formats a race total with an hours field, even for durations below one hour. */
export function formatTotalTime(value?: number | null, precision = 3) {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) return "--";
  const sign = value < 0 ? "-" : "";
  const scale = 10 ** precision;
  const units = Math.round(Math.abs(value) * scale);
  const hours = Math.floor(units / (3600 * scale));
  const minutes = Math.floor(units / (60 * scale)) % 60;
  const seconds = (units % (60 * scale)) / scale;
  return `${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${seconds.toFixed(precision).padStart(precision + 3, "0")}`;
}

export function formatRaceGap(value?: number | null) {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${formatRaceTime(value)}`;
}
