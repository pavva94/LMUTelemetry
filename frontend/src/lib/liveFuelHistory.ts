type CompletedLapFuelInput = {
  lapStartFuel?: number;
  currentFuel?: number;
  observedFromBoundary: boolean;
  fallbackFuelUsed?: number;
};

const usable = (value?: number): value is number => value != null && Number.isFinite(value) && value > 0;

export function completedLapFuelUsed({ lapStartFuel, currentFuel, observedFromBoundary, fallbackFuelUsed }: CompletedLapFuelInput) {
  if (observedFromBoundary && usable(lapStartFuel) && currentFuel != null && Number.isFinite(currentFuel) && lapStartFuel >= currentFuel) {
    const measured = lapStartFuel - currentFuel;
    if (measured > 0) return measured;
  }
  return usable(fallbackFuelUsed) ? fallbackFuelUsed : undefined;
}

export function currentLapFuelUsed(lapStartFuel?: number, currentFuel?: number) {
  if (lapStartFuel == null || currentFuel == null || !Number.isFinite(lapStartFuel) || !Number.isFinite(currentFuel) || currentFuel > lapStartFuel) return 0;
  return lapStartFuel - currentFuel;
}
