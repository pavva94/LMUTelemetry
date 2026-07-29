export function completedLapDuration(previousLapStart?: number | null, currentLapStart?: number | null) {
  if (
    previousLapStart == null ||
    currentLapStart == null ||
    !Number.isFinite(previousLapStart) ||
    !Number.isFinite(currentLapStart)
  ) return undefined;

  const duration = currentLapStart - previousLapStart;
  return duration > 20 && duration < 1200 ? duration : undefined;
}
