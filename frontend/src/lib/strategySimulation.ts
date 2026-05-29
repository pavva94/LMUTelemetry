export type StrategyRisk = "low" | "medium" | "high";

export type StrategySimulationInput = {
  raceDurationMinutes: number;
  normalLapTime: number;
  fuelPerLap: number | null;
  fuelObservedLaps: number;
  fuelRequiredLaps: number;
  tankCapacityLiters: number | null;
  raceStartFuelLiters: number | null;
  fuelSafetyMarginLiters: number;
  pitLaneLossSeconds: number;
  tyreChangeSecondsPerTyre: number;
  refuelSecondsPer5Liters: number;
  currentTyreWear: number | null;
  tyreWearRatePerLap: number | null;
  maxTyreWear: number;
  maxStops?: number;
};

export type StrategyStop = {
  lap: number;
  fuelAddedLiters: number;
  tyresChanged: number;
  stopTimeSeconds: number;
};

export type StrategyCandidate = {
  id: string;
  label: string;
  stops: number;
  tyresChangedPerStop: number;
  raceLaps: number;
  stintLaps: number;
  totalTimeSeconds: number;
  pitTimeSeconds: number;
  liftCoastSavePercent: number;
  liftCoastSaveLitersPerLap: number;
  fuelMarginLiters: number;
  projectedTyreWear: number | null;
  risk: StrategyRisk;
  reasons: string[];
  stopsDetail: StrategyStop[];
};

const round = (value: number, digits = 3) => Number(value.toFixed(digits));

export function stopServiceTime(input: {
  pitLaneLossSeconds: number;
  tyresChanged: number;
  tyreChangeSecondsPerTyre: number;
  fuelAddedLiters: number;
  refuelSecondsPer5Liters: number;
}) {
  return (
    input.pitLaneLossSeconds +
    input.tyresChanged * input.tyreChangeSecondsPerTyre +
    Math.ceil(Math.max(0, input.fuelAddedLiters) / 5) * input.refuelSecondsPer5Liters
  );
}

function liftCoastRisk(savePercent: number): StrategyRisk {
  if (savePercent <= 2) return "low";
  if (savePercent <= 5) return "medium";
  return "high";
}

function riskRank(risk: StrategyRisk) {
  return risk === "low" ? 0 : risk === "medium" ? 1 : 2;
}

function projectedWear(input: StrategySimulationInput, stintLaps: number, tyresChanged: number) {
  if (input.currentTyreWear == null || input.tyreWearRatePerLap == null) return null;
  const startWearAfterStop = tyresChanged > 0 ? Math.max(0, input.currentTyreWear * (1 - tyresChanged / 4)) : input.currentTyreWear;
  return startWearAfterStop + stintLaps * input.tyreWearRatePerLap;
}

function candidateLabel(stops: number, tyres: number, liftSavePercent: number) {
  const stopText = stops === 1 ? "1 stop" : `${stops} stops`;
  const tyreText = stops === 0 ? "no tyre service" : tyres === 0 ? "fuel only" : `${tyres} tyre${tyres === 1 ? "" : "s"}`;
  const liftText = liftSavePercent > 0 ? " + lift/coast" : "";
  return `${stopText}, ${tyreText}${liftText}`;
}

export function simulateStrategies(input: StrategySimulationInput): StrategyCandidate[] {
  if (
    !input.fuelPerLap ||
    !input.tankCapacityLiters ||
    !input.raceStartFuelLiters ||
    input.normalLapTime <= 0 ||
    input.raceDurationMinutes <= 0
  ) {
    return [];
  }

  const raceLaps = input.raceDurationMinutes * 60 / input.normalLapTime;
  const baseFuelNeed = raceLaps * input.fuelPerLap + input.fuelSafetyMarginLiters;
  const maxStops = input.maxStops ?? Math.min(6, Math.max(2, Math.ceil(raceLaps / 12)));
  const candidates: StrategyCandidate[] = [];

  for (let stops = 0; stops <= maxStops; stops += 1) {
    const stints = stops + 1;
    const stintLaps = raceLaps / stints;

    for (let tyres = 0; tyres <= 4; tyres += 1) {
      const fuelCapacityAvailable = input.raceStartFuelLiters + stops * input.tankCapacityLiters;
      const shortage = Math.max(0, baseFuelNeed - fuelCapacityAvailable);
      const liftSavePerLap = shortage > 0 ? shortage / raceLaps : 0;
      const liftSavePercent = input.fuelPerLap > 0 ? liftSavePerLap / input.fuelPerLap * 100 : 0;
      if (liftSavePercent > 8) continue;

      const effectiveFuelPerLap = input.fuelPerLap - liftSavePerLap;
      if (effectiveFuelPerLap <= 0) continue;
      const firstStintFuelNeed = stintLaps * effectiveFuelPerLap;
      if (firstStintFuelNeed > input.raceStartFuelLiters + 0.01) continue;
      const requiredAfterStart = Math.max(0, raceLaps * effectiveFuelPerLap + input.fuelSafetyMarginLiters - input.raceStartFuelLiters);
      const fuelAddedPerStop = stops > 0 ? requiredAfterStart / stops : 0;
      if (fuelAddedPerStop > input.tankCapacityLiters + 0.01) continue;

      const tyreWear = projectedWear(input, stintLaps, tyres);
      const tyreOverLimit = tyreWear != null && tyreWear > input.maxTyreWear;
      if (tyreOverLimit && tyreWear > input.maxTyreWear + 0.12) continue;

      const stopsDetail = Array.from({ length: stops }, (_, index) => {
        const lap = Math.round(stintLaps * (index + 1));
        const stopTimeSeconds = stopServiceTime({
          pitLaneLossSeconds: input.pitLaneLossSeconds,
          tyresChanged: tyres,
          tyreChangeSecondsPerTyre: input.tyreChangeSecondsPerTyre,
          fuelAddedLiters: fuelAddedPerStop,
          refuelSecondsPer5Liters: input.refuelSecondsPer5Liters,
        });
        return { lap, fuelAddedLiters: round(fuelAddedPerStop, 2), tyresChanged: tyres, stopTimeSeconds: round(stopTimeSeconds, 2) };
      });
      const pitTimeSeconds = stopsDetail.reduce((sum, stop) => sum + stop.stopTimeSeconds, 0);
      const liftTimeLoss = liftSavePercent > 0 ? (liftSavePercent / 100) * input.normalLapTime * 0.2 * raceLaps : 0;
      const totalTimeSeconds = input.raceDurationMinutes * 60 + pitTimeSeconds + liftTimeLoss;
      const fuelUsed = raceLaps * effectiveFuelPerLap + input.fuelSafetyMarginLiters;
      const fuelMarginLiters = fuelCapacityAvailable - fuelUsed;
      const risks: StrategyRisk[] = [];
      if (liftSavePercent > 0) risks.push(liftCoastRisk(liftSavePercent));
      if (tyreOverLimit) risks.push("high");
      else if (tyreWear != null && tyreWear > input.maxTyreWear - 0.08) risks.push("medium");
      if (fuelMarginLiters < input.fuelPerLap * 0.5) risks.push("medium");
      if (input.fuelObservedLaps < input.fuelRequiredLaps) risks.push("medium");
      const risk = risks.sort((a, b) => riskRank(b) - riskRank(a))[0] ?? "low";
      const reasons = [
        `${round(stintLaps, 1)} lap average stint`,
        stops > 0 ? `${round(fuelAddedPerStop, 1)} L fuel added per stop` : "no scheduled fuel stop",
        tyreWear == null ? "tyre projection needs more wear data" : `projected stint tyre wear ${round(tyreWear * 100, 0)}%`,
        liftSavePercent > 0 ? `${round(liftSavePercent, 1)}% lift-and-coast fuel save required` : `${round(fuelMarginLiters, 1)} L fuel margin`,
      ];

      candidates.push({
        id: `${stops}-${tyres}-${round(liftSavePercent, 2)}`,
        label: candidateLabel(stops, tyres, liftSavePercent),
        stops,
        tyresChangedPerStop: tyres,
        raceLaps: round(raceLaps, 2),
        stintLaps: round(stintLaps, 2),
        totalTimeSeconds: round(totalTimeSeconds, 2),
        pitTimeSeconds: round(pitTimeSeconds, 2),
        liftCoastSavePercent: round(liftSavePercent, 2),
        liftCoastSaveLitersPerLap: round(liftSavePerLap, 3),
        fuelMarginLiters: round(fuelMarginLiters, 2),
        projectedTyreWear: tyreWear == null ? null : round(tyreWear, 3),
        risk,
        reasons,
        stopsDetail,
      });
    }
  }

  return candidates
    .sort((a, b) => a.totalTimeSeconds - b.totalTimeSeconds || riskRank(a.risk) - riskRank(b.risk))
    .slice(0, 3);
}
