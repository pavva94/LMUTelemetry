export type StrategyRisk = "low" | "medium" | "high";
export type Wheel = "fl" | "fr" | "rl" | "rr";
export type WheelWear = Record<Wheel, number | null>;

export type StintWearProjection = {
  stint: number;
  startLap: number;
  endLap: number;
  startWear: Record<Wheel, number>;
  endWear: Record<Wheel, number>;
  remainingWear: Record<Wheel, number>;
};

export type StrategySimulationInput = {
  raceDurationMinutes: number;
  normalLapTime: number;
  fuelPerLap: number | null;
  fuelObservedLaps: number;
  fuelRequiredLaps: number;
  tankCapacityLiters: number | null;
  raceStartFuelLiters: number | null;
  raceStartNewTyres?: boolean;
  fuelSafetyMarginLiters: number;
  pitLaneLossSeconds: number;
  tyreChangeSecondsPerTyre: number;
  refuelSecondsPer5Liters: number;
  currentTyreWear: number | null;
  currentTyreWearByWheel?: Partial<WheelWear>;
  tyreWearRatePerLap: number | null;
  maxTyreWear: number;
  maxStops?: number;
};

export type StrategyStop = {
  lap: number;
  fuelRemainingLiters: number;
  fuelAddedLiters: number;
  tyresChanged: number;
  tyresToChange: Wheel[];
  stopTimeSeconds: number;
  tyreWearBeforeStop: Record<Wheel, number> | null;
  nextStintProjectedWear: Record<Wheel, number> | null;
};

export type StrategyCandidate = {
  id: string;
  label: string;
  stops: number;
  maxTyresChangedPerStop: number;
  tyresChangedPerStop: number;
  raceLaps: number;
  stintLaps: number;
  totalTimeSeconds: number;
  pitTimeSeconds: number;
  liftCoastSavePercent: number;
  liftCoastSaveLitersPerLap: number;
  fuelMarginLiters: number;
  finishFuelRemainingLiters: number;
  firstStintFuelNeedLiters: number;
  recommendedStartFuelLiters: number;
  startFuelIsFullTank: boolean;
  projectedTyreWear: number | null;
  projectedTyreWearByWheel: Record<Wheel, number> | null;
  lowestRemainingTyreWear: number | null;
  risk: StrategyRisk;
  reasons: string[];
  stopsDetail: StrategyStop[];
  stintWear: StintWearProjection[];
};

const round = (value: number, digits = 3) => Number(value.toFixed(digits));
const wheels: Wheel[] = ["fl", "fr", "rl", "rr"];
const wheelLabels: Record<Wheel, string> = { fl: "FL", fr: "FR", rl: "RL", rr: "RR" };

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

function currentTyreWearByWheel(input: StrategySimulationInput): Record<Wheel, number> | null {
  if (input.raceStartNewTyres) {
    return { fl: 0, fr: 0, rl: 0, rr: 0 };
  }
  const fallback = input.currentTyreWear;
  if (fallback == null || input.tyreWearRatePerLap == null) return null;
  return Object.fromEntries(wheels.map((wheel) => {
    const direct = input.currentTyreWearByWheel?.[wheel];
    return [wheel, direct != null && Number.isFinite(direct) ? Math.max(0, direct) : Math.max(0, fallback)];
  })) as Record<Wheel, number>;
}

function addWear(wear: Record<Wheel, number>, laps: number, rate: number) {
  return Object.fromEntries(wheels.map((wheel) => [wheel, wear[wheel] + laps * rate])) as Record<Wheel, number>;
}

function remainingWear(wear: Record<Wheel, number>, maxTyreWear: number) {
  return Object.fromEntries(wheels.map((wheel) => [wheel, maxTyreWear - wear[wheel]])) as Record<Wheel, number>;
}

function resetChangedTyres(wear: Record<Wheel, number>, tyres: Wheel[]) {
  const changed = new Set(tyres);
  return Object.fromEntries(wheels.map((wheel) => [wheel, changed.has(wheel) ? 0 : wear[wheel]])) as Record<Wheel, number>;
}

function tyresForNextStint(endWear: Record<Wheel, number>, rate: number, stintLaps: number, maxTyreWear: number, maxTyresToChange: number) {
  if (maxTyresToChange <= 0) return [];
  return wheels
    .map((wheel) => ({ wheel, nextEndWear: endWear[wheel] + stintLaps * rate }))
    .filter(({ nextEndWear }) => nextEndWear >= maxTyreWear)
    .sort((a, b) => b.nextEndWear - a.nextEndWear)
    .slice(0, maxTyresToChange)
    .map(({ wheel }) => wheel);
}

function tyreProjection(input: StrategySimulationInput, stops: number, stintLaps: number, maxTyresToChange: number) {
  const wearRate = input.tyreWearRatePerLap;
  const initialWear = currentTyreWearByWheel(input);
  if (wearRate == null || initialWear == null) return null;

  let startWear = initialWear;
  const stintWear: StintWearProjection[] = [];
  const stopTyres: Wheel[][] = [];
  const stopWearBefore: Array<Record<Wheel, number>> = [];
  let maxWear = 0;

  for (let stintIndex = 0; stintIndex < stops + 1; stintIndex += 1) {
    const endWear = addWear(startWear, stintLaps, wearRate);
    maxWear = Math.max(maxWear, ...wheels.map((wheel) => endWear[wheel]));
    stintWear.push({
      stint: stintIndex + 1,
      startLap: Math.round(stintLaps * stintIndex) + 1,
      endLap: Math.round(stintLaps * (stintIndex + 1)),
      startWear: Object.fromEntries(wheels.map((wheel) => [wheel, round(startWear[wheel], 3)])) as Record<Wheel, number>,
      endWear: Object.fromEntries(wheels.map((wheel) => [wheel, round(endWear[wheel], 3)])) as Record<Wheel, number>,
      remainingWear: Object.fromEntries(wheels.map((wheel) => [wheel, round(input.maxTyreWear - endWear[wheel], 3)])) as Record<Wheel, number>,
    });

    if (stintIndex < stops) {
      const tyresToChange = tyresForNextStint(endWear, wearRate, stintLaps, input.maxTyreWear, maxTyresToChange);
      stopTyres.push(tyresToChange);
      stopWearBefore.push(Object.fromEntries(wheels.map((wheel) => [wheel, round(endWear[wheel], 3)])) as Record<Wheel, number>);
      startWear = resetChangedTyres(endWear, tyresToChange);
    }
  }

  const finalWear = stintWear[stintWear.length - 1]?.endWear ?? null;
  const finalRemaining = finalWear ? remainingWear(finalWear, input.maxTyreWear) : null;
  return {
    projectedTyreWear: round(maxWear, 3),
    projectedTyreWearByWheel: finalWear,
    lowestRemainingTyreWear: finalRemaining == null ? null : round(Math.min(...wheels.map((wheel) => finalRemaining[wheel])), 3),
    stintWear,
    stopTyres,
    stopWearBefore,
  };
}

function tyreListText(tyres: Wheel[]) {
  return tyres.length ? tyres.map((wheel) => wheelLabels[wheel]).join("/") : "fuel only";
}

function candidateLabel(stops: number, maxTyres: number, liftSavePercent: number) {
  const stopText = stops === 1 ? "1 stop" : `${stops} stops`;
  const tyreText = stops === 0 ? "no tyre service" : maxTyres === 0 ? "fuel only" : `up to ${maxTyres} tyre${maxTyres === 1 ? "" : "s"} as needed`;
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
  const raceStartFuelLiters = input.raceStartFuelLiters;
  const maxStops = input.maxStops ?? Math.min(6, Math.max(2, Math.ceil(raceLaps / 12)));
  const candidates: StrategyCandidate[] = [];

  for (let stops = 0; stops <= maxStops; stops += 1) {
    const stints = stops + 1;
    const stintLaps = raceLaps / stints;

    for (let maxTyres = 0; maxTyres <= 4; maxTyres += 1) {
      const fuelCapacityAvailable = raceStartFuelLiters + stops * input.tankCapacityLiters;
      const shortage = Math.max(0, baseFuelNeed - fuelCapacityAvailable);
      const liftSavePerLap = shortage > 0 ? shortage / raceLaps : 0;
      const liftSavePercent = input.fuelPerLap > 0 ? liftSavePerLap / input.fuelPerLap * 100 : 0;
      if (liftSavePercent > 8) continue;

      const effectiveFuelPerLap = input.fuelPerLap - liftSavePerLap;
      if (effectiveFuelPerLap <= 0) continue;
      const firstStintFuelNeed = stintLaps * effectiveFuelPerLap;
      if (firstStintFuelNeed > raceStartFuelLiters + 0.01) continue;
      const recommendedStartFuel = Math.min(input.tankCapacityLiters, firstStintFuelNeed + input.fuelSafetyMarginLiters);
      const requiredAfterStart = Math.max(0, raceLaps * effectiveFuelPerLap + input.fuelSafetyMarginLiters - raceStartFuelLiters);
      const fuelAddedPerStop = stops > 0 ? requiredAfterStart / stops : 0;
      if (fuelAddedPerStop > input.tankCapacityLiters + 0.01) continue;

      const tyrePlan = tyreProjection(input, stops, stintLaps, maxTyres);
      const tyreWear = tyrePlan?.projectedTyreWear ?? null;
      const tyreOverLimit = tyreWear != null && tyreWear > input.maxTyreWear;
      if (tyreOverLimit && tyreWear > input.maxTyreWear + 0.12) continue;

      const stopsDetail = Array.from({ length: stops }, (_, index) => {
        const lap = Math.round(stintLaps * (index + 1));
        const fuelRemainingLiters = Math.max(
          0,
          raceStartFuelLiters + index * fuelAddedPerStop - stintLaps * effectiveFuelPerLap * (index + 1),
        );
        const tyresToChange = tyrePlan?.stopTyres[index] ?? [];
        const stopTimeSeconds = stopServiceTime({
          pitLaneLossSeconds: input.pitLaneLossSeconds,
          tyresChanged: tyresToChange.length,
          tyreChangeSecondsPerTyre: input.tyreChangeSecondsPerTyre,
          fuelAddedLiters: fuelAddedPerStop,
          refuelSecondsPer5Liters: input.refuelSecondsPer5Liters,
        });
        const nextStintProjectedWear = tyrePlan?.stintWear[index + 1]?.endWear ?? null;
        return {
          lap,
          fuelRemainingLiters: round(fuelRemainingLiters, 2),
          fuelAddedLiters: round(fuelAddedPerStop, 2),
          tyresChanged: tyresToChange.length,
          tyresToChange,
          stopTimeSeconds: round(stopTimeSeconds, 2),
          tyreWearBeforeStop: tyrePlan?.stopWearBefore[index] ?? null,
          nextStintProjectedWear,
        };
      });
      const pitTimeSeconds = stopsDetail.reduce((sum, stop) => sum + stop.stopTimeSeconds, 0);
      const liftTimeLoss = liftSavePercent > 0 ? (liftSavePercent / 100) * input.normalLapTime * 0.2 * raceLaps : 0;
      const totalTimeSeconds = input.raceDurationMinutes * 60 + pitTimeSeconds + liftTimeLoss;
      const fuelUsed = raceLaps * effectiveFuelPerLap + input.fuelSafetyMarginLiters;
      const fuelMarginLiters = fuelCapacityAvailable - fuelUsed;
      const finishFuelRemainingLiters = fuelMarginLiters + input.fuelSafetyMarginLiters;
      const risks: StrategyRisk[] = [];
      if (liftSavePercent > 0) risks.push(liftCoastRisk(liftSavePercent));
      if (tyreOverLimit) risks.push("high");
      else if (tyreWear != null && tyreWear > input.maxTyreWear - 0.08) risks.push("medium");
      if (fuelMarginLiters < input.fuelPerLap * 0.5) risks.push("medium");
      if (input.fuelObservedLaps < input.fuelRequiredLaps) risks.push("medium");
      const risk = risks.sort((a, b) => riskRank(b) - riskRank(a))[0] ?? "low";
      const reasons = [
        `${round(stintLaps, 1)} lap average stint`,
        `finish with ${round(finishFuelRemainingLiters, 1)} L fuel remaining`,
        stops > 0 ? `${round(fuelAddedPerStop, 1)} L fuel added per stop` : "no scheduled fuel stop",
        `${round(recommendedStartFuel, 1)} L start fuel needed for stint 1`,
        input.raceStartNewTyres ? "race start assumes a new tyre set" : "race start uses observed tyre wear",
        tyreWear == null ? "tyre projection needs more wear data" : `max projected tyre wear ${round(tyreWear * 100, 0)}%`,
        stops > 0 ? `tyre service: ${stopsDetail.map((stop) => `lap ${stop.lap} ${tyreListText(stop.tyresToChange)}`).join(", ")}` : "no scheduled tyre service",
        liftSavePercent > 0 ? `${round(liftSavePercent, 1)}% lift-and-coast fuel save required` : `${round(fuelMarginLiters, 1)} L fuel margin`,
      ];

      candidates.push({
        id: `${stops}-${maxTyres}-${round(liftSavePercent, 2)}-${stopsDetail.map((stop) => stop.tyresToChange.join("")).join("-")}`,
        label: candidateLabel(stops, maxTyres, liftSavePercent),
        stops,
        maxTyresChangedPerStop: maxTyres,
        tyresChangedPerStop: stopsDetail.length ? Math.max(...stopsDetail.map((stop) => stop.tyresChanged)) : 0,
        raceLaps: round(raceLaps, 2),
        stintLaps: round(stintLaps, 2),
        totalTimeSeconds: round(totalTimeSeconds, 2),
        pitTimeSeconds: round(pitTimeSeconds, 2),
        liftCoastSavePercent: round(liftSavePercent, 2),
        liftCoastSaveLitersPerLap: round(liftSavePerLap, 3),
        fuelMarginLiters: round(fuelMarginLiters, 2),
        finishFuelRemainingLiters: round(finishFuelRemainingLiters, 2),
        firstStintFuelNeedLiters: round(firstStintFuelNeed, 2),
        recommendedStartFuelLiters: round(recommendedStartFuel, 2),
        startFuelIsFullTank: recommendedStartFuel >= input.tankCapacityLiters - 0.01,
        projectedTyreWear: tyreWear == null ? null : round(tyreWear, 3),
        projectedTyreWearByWheel: tyrePlan?.projectedTyreWearByWheel ?? null,
        lowestRemainingTyreWear: tyrePlan?.lowestRemainingTyreWear ?? null,
        risk,
        reasons,
        stopsDetail,
        stintWear: tyrePlan?.stintWear ?? [],
      });
    }
  }

  return candidates
    .sort((a, b) => a.totalTimeSeconds - b.totalTimeSeconds || riskRank(a.risk) - riskRank(b.risk))
    .filter((candidate, index, sorted) => {
      const key = `${candidate.stops}|${candidate.liftCoastSavePercent}|${candidate.stopsDetail.map((stop) => stop.tyresToChange.join("/")).join(",")}`;
      return sorted.findIndex((other) => `${other.stops}|${other.liftCoastSavePercent}|${other.stopsDetail.map((stop) => stop.tyresToChange.join("/")).join(",")}` === key) === index;
    })
    .slice(0, 3);
}
