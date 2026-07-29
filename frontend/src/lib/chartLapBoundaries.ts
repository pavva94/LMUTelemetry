export type LapBoundary = {
  lap: number;
  x: number;
  showLabel: boolean;
};

export function buildLapBoundaries(
  data: Array<Record<string, unknown>>,
  xKey: string,
  maxLabels = 10,
): LapBoundary[] {
  const firstXByLap = new Map<number, number>();

  for (const row of data) {
    const lapValue = row.lap_number;
    const xValue = row[xKey];
    if (lapValue == null || lapValue === "" || xValue == null || xValue === "") continue;
    const lap = Number(lapValue);
    const x = Number(xValue);
    if (!Number.isInteger(lap) || !Number.isFinite(x)) continue;
    const existing = firstXByLap.get(lap);
    if (existing == null || x < existing) firstXByLap.set(lap, x);
  }

  const starts = Array.from(firstXByLap, ([lap, x]) => ({ lap, x }))
    .sort((left, right) => left.x - right.x);
  if (starts.length < 2) return [];

  const boundaries = starts.slice(1);
  const labelCount = Math.min(boundaries.length, Math.max(1, Math.floor(maxLabels)));
  const labelIndexes = new Set(
    labelCount === 1
      ? [boundaries.length - 1]
      : Array.from({ length: labelCount }, (_, index) =>
        Math.round(index * (boundaries.length - 1) / (labelCount - 1))),
  );

  return boundaries.map((boundary, index) => ({
    ...boundary,
    showLabel: labelIndexes.has(index),
  }));
}
