export type LapInputPoint = {
  distance: number;
  throttle: number;
  brake: number;
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
