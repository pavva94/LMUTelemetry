export type LapInputPoint = {
  distance: number;
  throttle: number;
  brake: number;
  elapsedTime?: number;
};

export type LapInputTrace = {
  lap: number;
  lapTime?: number;
  invalidated?: boolean;
  points: LapInputPoint[];
};

export type LapInputChartRow = {
  progress: number;
  [key: string]: number;
};

export type LapTimeDeltaRow = {
  progress: number;
  delta: number;
};

export function appendLapInputPoint(points: LapInputPoint[], point: LapInputPoint) {
  if (!points.length) return [point];
  const last = points[points.length - 1];
  if (Math.abs(point.distance - last.distance) < 2) return [...points.slice(0, -1), point];
  return [...points, point].slice(-2_000);
}

export function bestLapInputTrace(traces: LapInputTrace[]) {
  return traces
    .filter((trace) => !trace.invalidated && trace.points.length > 1 && trace.lapTime != null && Number.isFinite(trace.lapTime) && trace.lapTime > 20)
    .sort((left, right) => (left.lapTime ?? Infinity) - (right.lapTime ?? Infinity))[0];
}

export function buildLapInputChartData(series: Array<{ id: string; trace?: LapInputTrace }>, trackLength?: number) {
  const available = series.filter((item): item is { id: string; trace: LapInputTrace } => Boolean(item.trace?.points.length));
  const observedLength = Math.max(0, ...available.flatMap((item) => item.trace.points.map((point) => point.distance)));
  const length = trackLength != null && Number.isFinite(trackLength) && trackLength > 0 ? trackLength : observedLength;
  if (!(length > 0)) return [];

  const rows = new Map<number, LapInputChartRow>();
  available.forEach(({ id, trace }) => {
    trace.points.forEach((point) => {
      const bucket = Math.max(0, Math.min(200, Math.round((point.distance / length) * 200)));
      const row = rows.get(bucket) || { progress: bucket / 2 };
      row[`${id}Throttle`] = Math.max(0, Math.min(1, point.throttle));
      row[`${id}Brake`] = Math.max(0, Math.min(1, point.brake));
      rows.set(bucket, row);
    });
  });
  return [...rows.values()].sort((left, right) => left.progress - right.progress);
}

function elapsedAtDistance(points: LapInputPoint[], distance: number) {
  const timed = points
    .filter((point) => Number.isFinite(point.distance) && point.elapsedTime != null && Number.isFinite(point.elapsedTime))
    .sort((left, right) => left.distance - right.distance);
  if (!timed.length || distance < timed[0].distance || distance > timed[timed.length - 1].distance) return null;
  const upperIndex = timed.findIndex((point) => point.distance >= distance);
  if (upperIndex <= 0) return timed[0].elapsedTime as number;
  const lower = timed[upperIndex - 1];
  const upper = timed[upperIndex];
  const span = upper.distance - lower.distance;
  if (span <= 0) return upper.elapsedTime as number;
  const ratio = (distance - lower.distance) / span;
  return (lower.elapsedTime as number) + ((upper.elapsedTime as number) - (lower.elapsedTime as number)) * ratio;
}

/** Returns comparison-minus-reference elapsed time at each half-percent of lap distance. */
export function buildLapTimeDeltaData(reference?: LapInputTrace, comparison?: LapInputTrace, trackLength = 1): LapTimeDeltaRow[] {
  if (!reference?.points.length || !comparison?.points.length || !(trackLength > 0)) return [];
  const rows: LapTimeDeltaRow[] = [];
  for (let bucket = 0; bucket <= 200; bucket += 1) {
    const distance = trackLength * bucket / 200;
    const referenceTime = elapsedAtDistance(reference.points, distance);
    const comparisonTime = elapsedAtDistance(comparison.points, distance);
    if (referenceTime != null && comparisonTime != null) rows.push({ progress: bucket / 2, delta: comparisonTime - referenceTime });
  }
  return rows;
}
