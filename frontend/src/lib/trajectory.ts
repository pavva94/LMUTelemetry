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

function deltaColor(delta: number | null) {
  if (delta == null || !Number.isFinite(delta)) return "#6fa8ff";
  if (Math.abs(delta) <= 0.05) return "#6fa8ff";
  return delta < 0 ? "#69d28f" : "#ff6961";
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
