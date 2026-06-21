export type StrategyRisk = "low" | "medium" | "high";
export type Wheel = "fl" | "fr" | "rl" | "rr";
export type WheelWear = Record<Wheel, number | null>;

export type StrategyConfidence = "low" | "medium" | "high";

export type PaceEvidence = {
  lastLapTime?: number | null;
  last7LapAverage?: number | null;
  last10LapAverage?: number | null;
  weightedRecentPace?: number | null;
  paceTrendSecondsPerLap?: number | null;
  paceDegradationPerLap?: number | null;
  sampleLaps?: number;
  confidence?: StrategyConfidence | string;
  source?: string;
};

export type CalculationBreakdown = {
  raceLaps: number;
  simulationPaceSeconds: number;
  baseRaceTimeSeconds: number;
  pitTimeSeconds: number;
  projectedPaceLossSeconds: number;
  tyreDegradationLossSeconds: number;
  liftCoastLossSeconds: number;
  trafficLossSeconds: number;
  fuelMarginLiters: number;
  fuelUseLitersPerLap: number;
  fuelUseStdDevLiters: number | null;
  fuelConfidence: string;
  paceConfidence: string;
  tyreConfidence: string;
  totalTimeSeconds: number;
};

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
  paceEvidence?: PaceEvidence;
  fuelPerLap: number | null;
  fuelObservedLaps: number;
  fuelRequiredLaps: number;
  fuelUseStdDevLiters?: number | null;
  fuelConfidence?: string;
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
  tyrePaceDegradationPerLap?: number | null;
  tyreConfidence?: string;
  maxTyreWear: number;
  trafficPenaltySeconds?: number;
  safetyCarActive?: boolean;
  safetyCarPitLossSeconds?: number | null;
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
  baseRaceTimeSeconds: number;
  projectedPaceLossSeconds: number;
  tyreDegradationLossSeconds: number;
  liftCoastLossSeconds: number;
  trafficLossSeconds: number;
  confidence: StrategyConfidence;
  calculationBreakdown: CalculationBreakdown;
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
const MAX_SEARCHED_STOPS = 40;
const TARGET_STINT_LAPS = 12;
const TYRE_WEAR_LIMIT_TOLERANCE = 0.02;

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

function confidenceRank(confidence: StrategyConfidence | string | undefined) {
  if (confidence === "high") return 2;
  if (confidence === "medium") return 1;
  return 0;
}

function confidenceFromRank(rank: number): StrategyConfidence {
  if (rank >= 2) return "high";
  if (rank >= 1) return "medium";
  return "low";
}

function simulationPace(input: StrategySimulationInput) {
  const evidence = input.paceEvidence;
  const direct = evidence?.weightedRecentPace;
  const last7 = evidence?.last7LapAverage;
  const last10 = evidence?.last10LapAverage;
  const last = evidence?.lastLapTime;
  for (const value of [direct, last7, last10, last, input.normalLapTime]) {
    if (value != null && Number.isFinite(value) && value > 0) return value;
  }
  return input.normalLapTime;
}

function projectedPaceLoss(input: StrategySimulationInput, raceLaps: number) {
  const trend = input.paceEvidence?.paceTrendSecondsPerLap ?? 0;
  if (!Number.isFinite(trend) || trend <= 0) return 0;
  return trend * raceLaps * Math.max(0, raceLaps - 1) / 2;
}

function tyreDegradationLoss(input: StrategySimulationInput, tyrePlan: ReturnType<typeof tyreProjection>, stops: number, stintLaps: number) {
  const paceDegradation = input.tyrePaceDegradationPerLap ?? 0;
  if (!Number.isFinite(paceDegradation) || paceDegradation <= 0) return 0;
  const stints = tyrePlan?.stintWear.length ? tyrePlan.stintWear : Array.from({ length: stops + 1 }, (_, index) => ({
    stint: index + 1,
    startLap: Math.round(stintLaps * index) + 1,
    endLap: Math.round(stintLaps * (index + 1)),
    startWear: { fl: 0, fr: 0, rl: 0, rr: 0 },
    endWear: { fl: 0, fr: 0, rl: 0, rr: 0 },
    remainingWear: { fl: input.maxTyreWear, fr: input.maxTyreWear, rl: input.maxTyreWear, rr: input.maxTyreWear },
  }));
  return stints.reduce((sum, stint) => {
    const laps = Math.max(0, stint.endLap - stint.startLap + 1);
    const triangularLoss = paceDegradation * laps * Math.max(0, laps - 1) / 2;
    return sum + triangularLoss;
  }, 0);
}

function planConfidence(input: StrategySimulationInput, risk: StrategyRisk): StrategyConfidence {
  const ranks = [
    input.fuelObservedLaps >= input.fuelRequiredLaps ? confidenceRank(input.fuelConfidence || "high") : 0,
    confidenceRank(input.paceEvidence?.confidence),
    confidenceRank(input.tyreConfidence || (input.tyreWearRatePerLap ? "medium" : "low")),
    risk === "high" ? 0 : risk === "medium" ? 1 : 2,
  ];
  return confidenceFromRank(Math.min(...ranks));
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

function buildFuelPlan(input: StrategySimulationInput, stops: number, stintLaps: number, effectiveFuelPerLap: number) {
  const stintFuelNeed = stintLaps * effectiveFuelPerLap;
  const fuelSafetyMargin = Math.max(0, input.fuelSafetyMarginLiters);
  const tankCapacityLiters = input.tankCapacityLiters ?? 0;
  const stopsDetail: Array<Pick<StrategyStop, "lap" | "fuelRemainingLiters" | "fuelAddedLiters">> = [];
  let fuelInTank = input.raceStartFuelLiters ?? 0;

  if (fuelInTank + 0.01 < stintFuelNeed + (stops > 0 ? fuelSafetyMargin : 0)) return null;

  for (let index = 0; index < stops; index += 1) {
    fuelInTank -= stintFuelNeed;
    if (fuelInTank < fuelSafetyMargin - 0.01) return null;

    const stintsRemaining = stops - index;
    const fuelNeededAfterStop = stintsRemaining * stintFuelNeed + fuelSafetyMargin;
    const fuelAddedLiters = Math.max(0, Math.min(tankCapacityLiters, fuelNeededAfterStop) - fuelInTank);
    if (fuelAddedLiters > tankCapacityLiters - fuelInTank + 0.01) return null;

    stopsDetail.push({
      lap: Math.round(stintLaps * (index + 1)),
      fuelRemainingLiters: round(fuelInTank, 2),
      fuelAddedLiters: round(fuelAddedLiters, 2),
    });
    fuelInTank += fuelAddedLiters;
  }

  fuelInTank -= stintFuelNeed;
  if (fuelInTank < fuelSafetyMargin - 0.01) return null;

  return {
    stopsDetail,
    finishFuelRemainingLiters: fuelInTank,
    fuelAddedTotalLiters: stopsDetail.reduce((sum, stop) => sum + stop.fuelAddedLiters, 0),
  };
}

function findFuelPlan(input: StrategySimulationInput, stops: number, raceLaps: number, stintLaps: number, baseFuelNeed: number) {
  const maxLiftSavePerLap = input.fuelPerLap == null ? 0 : input.fuelPerLap * 0.08;
  const fuelCapacityAvailable = (input.raceStartFuelLiters ?? 0) + stops * (input.tankCapacityLiters ?? 0);
  const totalShortage = Math.max(0, baseFuelNeed - fuelCapacityAvailable);
  let liftSavePerLap = totalShortage > 0 ? totalShortage / raceLaps : 0;

  const planFor = (savePerLap: number) => {
    const effectiveFuelPerLap = (input.fuelPerLap ?? 0) - savePerLap;
    return effectiveFuelPerLap > 0 ? buildFuelPlan(input, stops, stintLaps, effectiveFuelPerLap) : null;
  };

  let fuelPlan = planFor(liftSavePerLap);
  if (!fuelPlan) {
    let low = liftSavePerLap;
    let high = maxLiftSavePerLap;
    if (!planFor(high)) return null;
    for (let index = 0; index < 24; index += 1) {
      const mid = (low + high) / 2;
      if (planFor(mid)) high = mid;
      else low = mid;
    }
    liftSavePerLap = high;
    fuelPlan = planFor(liftSavePerLap);
  }

  if (!fuelPlan) return null;
  return { liftSavePerLap, effectiveFuelPerLap: (input.fuelPerLap ?? 0) - liftSavePerLap, fuelPlan };
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

  const paceSeconds = simulationPace(input);
  const raceLaps = input.raceDurationMinutes * 60 / paceSeconds;
  const baseFuelNeed = raceLaps * input.fuelPerLap + input.fuelSafetyMarginLiters;
  const raceStartFuelLiters = input.raceStartFuelLiters;
  const fuelLimitedMinimumStops = input.tankCapacityLiters > 0
    ? Math.max(0, Math.ceil(Math.max(0, baseFuelNeed - raceStartFuelLiters) / input.tankCapacityLiters))
    : 0;
  const maxStops = input.maxStops ?? Math.min(
    MAX_SEARCHED_STOPS,
    Math.max(2, Math.ceil(raceLaps / TARGET_STINT_LAPS), fuelLimitedMinimumStops),
  );
  const candidates: StrategyCandidate[] = [];

  for (let stops = 0; stops <= maxStops; stops += 1) {
    const stints = stops + 1;
    const stintLaps = raceLaps / stints;

    for (let maxTyres = 0; maxTyres <= 4; maxTyres += 1) {
      const fuelFit = findFuelPlan(input, stops, raceLaps, stintLaps, baseFuelNeed);
      if (!fuelFit) continue;
      const { liftSavePerLap, effectiveFuelPerLap, fuelPlan } = fuelFit;
      const liftSavePercent = input.fuelPerLap > 0 ? liftSavePerLap / input.fuelPerLap * 100 : 0;
      if (liftSavePercent > 8) continue;
      const firstStintFuelNeed = stintLaps * effectiveFuelPerLap;
      if (firstStintFuelNeed > raceStartFuelLiters + 0.01) continue;
      const recommendedStartFuel = Math.min(input.tankCapacityLiters, firstStintFuelNeed + input.fuelSafetyMarginLiters);

      const tyrePlan = tyreProjection(input, stops, stintLaps, maxTyres);
      const tyreWear = tyrePlan?.projectedTyreWear ?? null;
      const tyreOverLimit = tyreWear != null && tyreWear > input.maxTyreWear;
      if (tyreOverLimit && tyreWear > input.maxTyreWear + TYRE_WEAR_LIMIT_TOLERANCE) continue;

      const stopsDetail = fuelPlan.stopsDetail.map((fuelStop, index) => {
        const tyresToChange = tyrePlan?.stopTyres[index] ?? [];
        const stopTimeSeconds = stopServiceTime({
          pitLaneLossSeconds: input.safetyCarActive && input.safetyCarPitLossSeconds != null ? input.safetyCarPitLossSeconds : input.pitLaneLossSeconds,
          tyresChanged: tyresToChange.length,
          tyreChangeSecondsPerTyre: input.tyreChangeSecondsPerTyre,
          fuelAddedLiters: fuelStop.fuelAddedLiters,
          refuelSecondsPer5Liters: input.refuelSecondsPer5Liters,
        });
        const nextStintProjectedWear = tyrePlan?.stintWear[index + 1]?.endWear ?? null;
        return {
          lap: fuelStop.lap,
          fuelRemainingLiters: fuelStop.fuelRemainingLiters,
          fuelAddedLiters: fuelStop.fuelAddedLiters,
          tyresChanged: tyresToChange.length,
          tyresToChange,
          stopTimeSeconds: round(stopTimeSeconds, 2),
          tyreWearBeforeStop: tyrePlan?.stopWearBefore[index] ?? null,
          nextStintProjectedWear,
        };
      });
      const pitTimeSeconds = stopsDetail.reduce((sum, stop) => sum + stop.stopTimeSeconds, 0);
      // Fuel saving remains a feasibility result until a calibrated, explicit
      // seconds-per-percent assumption is available; do not invent pace cost.
      const liftTimeLoss = 0;
      const baseRaceTimeSeconds = raceLaps * paceSeconds;
      const paceLoss = projectedPaceLoss(input, raceLaps);
      const tyreLoss = tyreDegradationLoss(input, tyrePlan, stops, stintLaps);
      const trafficLoss = stops > 0 ? Math.max(0, input.trafficPenaltySeconds ?? 0) * stops : 0;
      const totalTimeSeconds = baseRaceTimeSeconds + pitTimeSeconds + liftTimeLoss + paceLoss + tyreLoss + trafficLoss;
      const finishFuelRemainingLiters = fuelPlan.finishFuelRemainingLiters;
      const fuelMarginLiters = finishFuelRemainingLiters - input.fuelSafetyMarginLiters;
      const risks: StrategyRisk[] = [];
      if (liftSavePercent > 0) risks.push(liftCoastRisk(liftSavePercent));
      if (tyreOverLimit) risks.push("high");
      else if (tyreWear != null && tyreWear > input.maxTyreWear - 0.08) risks.push("medium");
      if (fuelMarginLiters < input.fuelPerLap * 0.5) risks.push("medium");
      if (input.fuelObservedLaps < input.fuelRequiredLaps) risks.push("medium");
      if ((input.fuelUseStdDevLiters ?? 0) > input.fuelPerLap * 0.12) risks.push("medium");
      if ((input.paceEvidence?.paceTrendSecondsPerLap ?? 0) > 0.25) risks.push("medium");
      if (tyreLoss > Math.max(5, input.pitLaneLossSeconds * 0.5)) risks.push("medium");
      const risk = risks.sort((a, b) => riskRank(b) - riskRank(a))[0] ?? "low";
      const confidence = planConfidence(input, risk);
      const calculationBreakdown: CalculationBreakdown = {
        raceLaps: round(raceLaps, 2),
        simulationPaceSeconds: round(paceSeconds, 3),
        baseRaceTimeSeconds: round(baseRaceTimeSeconds, 2),
        pitTimeSeconds: round(pitTimeSeconds, 2),
        projectedPaceLossSeconds: round(paceLoss, 2),
        tyreDegradationLossSeconds: round(tyreLoss, 2),
        liftCoastLossSeconds: round(liftTimeLoss, 2),
        trafficLossSeconds: round(trafficLoss, 2),
        fuelMarginLiters: round(fuelMarginLiters, 2),
        fuelUseLitersPerLap: round(input.fuelPerLap, 3),
        fuelUseStdDevLiters: input.fuelUseStdDevLiters == null ? null : round(input.fuelUseStdDevLiters, 3),
        fuelConfidence: input.fuelConfidence || (input.fuelObservedLaps >= input.fuelRequiredLaps ? "high" : "low"),
        paceConfidence: String(input.paceEvidence?.confidence || "low"),
        tyreConfidence: input.tyreConfidence || (input.tyreWearRatePerLap ? "medium" : "low"),
        totalTimeSeconds: round(totalTimeSeconds, 2),
      };
      const reasons = [
        `${round(stintLaps, 1)} lap average stint`,
        `pace model ${round(paceSeconds, 3)} s/lap from ${input.paceEvidence?.source || "strategy input"}`,
        `finish with ${round(finishFuelRemainingLiters, 1)} L fuel remaining`,
        stops > 0 ? `${round(fuelPlan.fuelAddedTotalLiters, 1)} L total fuel added` : "no scheduled fuel stop",
        `${round(recommendedStartFuel, 1)} L start fuel needed for stint 1`,
        input.raceStartNewTyres ? "race start assumes a new tyre set" : "race start uses observed tyre wear",
        tyreWear == null ? "tyre projection needs more wear data" : `max projected tyre wear ${round(tyreWear * 100, 0)}%`,
        tyreLoss > 0 ? `${round(tyreLoss, 1)} s tyre degradation loss` : "no tyre degradation loss applied",
        paceLoss > 0 ? `${round(paceLoss, 1)} s recent pace trend loss` : "recent pace trend stable",
        trafficLoss > 0 ? `${round(trafficLoss, 1)} s traffic loss applied` : "no traffic loss applied",
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
        baseRaceTimeSeconds: round(baseRaceTimeSeconds, 2),
        projectedPaceLossSeconds: round(paceLoss, 2),
        tyreDegradationLossSeconds: round(tyreLoss, 2),
        liftCoastLossSeconds: round(liftTimeLoss, 2),
        trafficLossSeconds: round(trafficLoss, 2),
        confidence,
        calculationBreakdown,
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
