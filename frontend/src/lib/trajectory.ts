export type GpsPoint = {
  lap: string;
  lapLabel: string;
  progress: number;
  x: number;
  y: number;
  lat: number;
  lon: number;
  throttle: number | null;
  brake: number | null;
  speed: number | null;
  time: number | null;
  lapDistance: number | null;
};

export type TrackSegment = { from: GpsPoint; to: GpsPoint; color: string; delta: number | null };

type LapSummary = {
  lap_number?: number | string | null;
  lap_time?: number | string | null;
  in_pit?: boolean | number | string | null;
  valid_lap?: boolean | number | string | null;
};

const DELTA_COLOR_STOPS: Array<{ delta: number; rgb: [number, number, number] }> = [
  { delta: -1.5, rgb: [7, 81, 46] },
  { delta: -0.75, rgb: [12, 127, 72] },
  { delta: -0.3, rgb: [32, 173, 104] },
  { delta: -0.1, rgb: [85, 202, 136] },
  { delta: -0.05, rgb: [104, 198, 164] },
  { delta: 0, rgb: [95, 159, 255] },
  { delta: 0.05, rgb: [212, 155, 169] },
  { delta: 0.1, rgb: [255, 138, 127] },
  { delta: 0.3, rgb: [239, 91, 85] },
  { delta: 0.75, rgb: [200, 50, 67] },
  { delta: 1.5, rgb: [115, 19, 41] },
];

function isTruthyTelemetryFlag(value: LapSummary["in_pit"]) {
  return value === true || value === 1 || (typeof value === "string" && ["true", "1", "yes"].includes(value.toLowerCase()));
}

export function selectFastestLapNumbers(laps: LapSummary[], limit = 2) {
  return laps
    .map((lap) => ({
      lap: String(lap.lap_number ?? ""),
      time: Number(lap.lap_time),
      inPit: isTruthyTelemetryFlag(lap.in_pit),
      invalid: lap.valid_lap != null && !isTruthyTelemetryFlag(lap.valid_lap),
    }))
    .filter((lap) => lap.lap && Number.isFinite(lap.time) && lap.time > 0 && !lap.inPit && !lap.invalid)
    .sort((a, b) => a.time - b.time)
    .slice(0, limit)
    .map((lap) => lap.lap);
}

function nearestByProgress(points: GpsPoint[], target: GpsPoint) {
  if (!points.length) return null;
  return points.reduce((best, point) => Math.abs(point.progress - target.progress) < Math.abs(best.progress - target.progress) ? point : best, points[0]);
}

export function pointDistance(a: GpsPoint, b: GpsPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function shouldCloseLap(points: GpsPoint[]) {
  if (points.length < 3) return false;
  const first = points[0];
  const last = points[points.length - 1];
  const bounds = points.reduce((acc, point) => ({
    minX: Math.min(acc.minX, point.x),
    maxX: Math.max(acc.maxX, point.x),
    minY: Math.min(acc.minY, point.y),
    maxY: Math.max(acc.maxY, point.y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const diagonal = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  return pointDistance(first, last) <= Math.max(24, diagonal * 0.12);
}

export function pathSegments(points: GpsPoint[]) {
  const segments: Array<{ from: GpsPoint; to: GpsPoint }> = [];
  for (let index = 0; index < points.length - 1; index += 1) segments.push({ from: points[index], to: points[index + 1] });
  if (shouldCloseLap(points)) segments.push({ from: points[points.length - 1], to: points[0] });
  return segments;
}

export function lapElapsed(point: GpsPoint, lapStart: number | null) {
  return point.time != null && lapStart != null ? point.time - lapStart : null;
}

export function deltaColor(delta: number | null) {
  if (delta == null || !Number.isFinite(delta)) return "#5f9fff";
  const value = Math.max(DELTA_COLOR_STOPS[0].delta, Math.min(DELTA_COLOR_STOPS[DELTA_COLOR_STOPS.length - 1].delta, delta));
  const upperIndex = DELTA_COLOR_STOPS.findIndex((stop) => stop.delta >= value);
  if (upperIndex <= 0) {
    const [r, g, b] = DELTA_COLOR_STOPS[0].rgb;
    return `rgb(${r}, ${g}, ${b})`;
  }
  const lower = DELTA_COLOR_STOPS[upperIndex - 1];
  const upper = DELTA_COLOR_STOPS[upperIndex];
  const mix = (value - lower.delta) / (upper.delta - lower.delta);
  const [r, g, b] = lower.rgb.map((channel, index) => Math.round(channel + (upper.rgb[index] - channel) * mix));
  return `rgb(${r}, ${g}, ${b})`;
}

export function deltaSegments(primary: GpsPoint[], comparison: GpsPoint[]): TrackSegment[] {
  const primaryStart = primary[0]?.time ?? null;
  const comparisonStart = comparison[0]?.time ?? null;
  return pathSegments(primary).map((segment) => {
    const matched = nearestByProgress(comparison, segment.from);
    const primaryElapsed = lapElapsed(segment.from, primaryStart);
    const comparisonElapsed = matched ? lapElapsed(matched, comparisonStart) : null;
    const delta = primaryElapsed != null && comparisonElapsed != null ? primaryElapsed - comparisonElapsed : null;
    return { ...segment, color: deltaColor(delta), delta };
  });
}

export { nearestByProgress };
