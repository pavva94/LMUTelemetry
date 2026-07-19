export type StrategyRisk = "low" | "medium" | "high";
export type StrategyConfidence = "low" | "medium" | "high";
export type Wheel = "fl" | "fr" | "rl" | "rr";
export type WheelValues = Record<Wheel, number>;
export type ServiceModel = "sequential" | "parallel";
export type TyreChangePolicy = "automatic" | "all" | "selected" | "never";
export type SafetyPolicy = "aggressive" | "balanced" | "conservative";

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
  method?: string;
  spreadSeconds?: number | null;
  foundLaps?: number;
};

export type EmpiricalStintPaceModel = {
  sampleLaps: number;
  observedStints: number;
  maxObservedStintLaps: number;
  fuelCoefficientSecondsPerLiter: number;
  tyreWearCoefficientSecondsPerFraction: number;
  warmupLossSeconds: number;
  residualStdDevSeconds: number;
  referenceFuelLiters: number;
  referenceTyreWear: number;
  referenceWarmup: number;
  confidence: StrategyConfidence;
};

export type LiftCoastPaceModel = {
  sampleLaps: number;
  secondsPerPercentPerLap: number;
  fuelSavingCoastCorrelation: number;
  observedSavingRangePercent: number;
  observedCoastRangePercent: number;
  confidence: StrategyConfidence;
};

export type CalculationBreakdown = {
  raceLaps: number;
  simulationPaceSeconds: number;
  baseRaceTimeSeconds: number;
  pitLaneTimeSeconds: number;
  stationaryServiceTimeSeconds: number;
  pitTimeSeconds: number;
  projectedPaceLossSeconds: number;
  tyreDegradationLossSeconds: number | null;
  liftCoastLossSeconds: number | null;
  trafficLossSeconds: number;
  fuelMarginLiters: number;
  fuelUseLitersPerLap: number;
  fuelUseStdDevLiters: number | null;
  fuelConfidence: string;
  paceConfidence: string;
  paceModelSource: "empirical stint regression" | "fallback heuristic";
  paceVariabilitySecondsPerLap: number | null;
  p90TotalTimeSeconds: number;
  tyreConfidence: string;
  targetDurationSeconds: number;
  timeRemainingSeconds: number;
  totalTimeSeconds: number;
};

export type StintWearProjection = {
  stint: number;
  startLap: number;
  endLap: number;
  startWear: WheelValues;
  endWear: WheelValues;
  remainingWear: WheelValues;
  startFuelLiters: number;
  endFuelLiters: number;
};

export type StintPaceProjection = {
  stint: number;
  startLap: number;
  endLap: number;
  startPaceSeconds: number;
  averagePaceSeconds: number;
  endPaceSeconds: number;
  drivingTimeSeconds: number;
  fuelLoadLossSeconds: number;
  tyreDegradationLossSeconds: number | null;
  recentTrendLossSeconds: number;
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
  currentFuelLiters?: number | null;
  currentVirtualEnergyFraction?: number | null;
  virtualEnergyPerLap?: number | null;
  fuelToVirtualEnergyRatio?: number | null;
  /** @deprecated Start fuel is calculated by the engine. */
  raceStartFuelLiters?: number | null;
  raceStartNewTyres?: boolean;
  startingTyreWearByWheel?: Partial<Record<Wheel, number | null>>;
  fuelSafetyMarginLiters: number;
  safetyPolicy?: SafetyPolicy;
  pitLaneLossSeconds: number;
  tyreChangeSecondsPerTyre: number;
  refuelSecondsPer5Liters: number;
  serviceModel?: ServiceModel;
  currentTyreWear: number | null;
  currentTyreWearByWheel?: Partial<Record<Wheel, number | null>>;
  tyreWearRatePerLap: number | null;
  tyreWearRateByWheel?: Partial<Record<Wheel, number | null>>;
  tyrePaceDegradationPerLap?: number | null;
  tyreConfidence?: string;
  maxTyreWear: number;
  maxTyreWearByWheel?: Partial<Record<Wheel, number | null>>;
  /** Total individual tyres available for the race, including the four fitted at the start. */
  maxTyresAvailable?: number;
  tyreChangePolicy?: TyreChangePolicy;
  selectedTyres?: Wheel[];
  trafficPenaltySeconds?: number;
  liftCoastSecondsPerPercentPerLap?: number | null;
  liftCoastMode?: "inferred" | "fixed";
  liftCoastTargetPercent?: number;
  safetyCarActive?: boolean;
  safetyCarPitLossSeconds?: number | null;
  maxStops?: number;
  fuelLoadPacePenaltySecondsPerLiter?: number;
  empiricalStintPace?: EmpiricalStintPaceModel | null;
};

export type StrategyStop = {
  lap: number;
  raceElapsedAtPitSeconds: number;
  raceTimeRemainingAtPitSeconds: number;
  fuelRemainingLiters: number;
  fuelAddedLiters: number;
  fuelOnExitLiters: number;
  virtualEnergyRemaining: number | null;
  virtualEnergyAdded: number | null;
  virtualEnergyOnExit: number | null;
  tyresChanged: number;
  tyresToChange: Wheel[];
  pitLaneTimeSeconds: number;
  stationaryTimeSeconds: number;
  stopTimeSeconds: number;
  tyreWearBeforeStop: WheelValues | null;
  nextStintProjectedWear: WheelValues | null;
  reason: string;
};

export type StrategyCandidate = {
  id: string;
  label: string;
  category: "fastest" | "balanced" | "conservative" | "alternative" | "fuel-save";
  stops: number;
  maxTyresChangedPerStop: number;
  tyresChangedPerStop: number;
  raceLaps: number;
  stintLaps: number;
  totalTimeSeconds: number;
  baseRaceTimeSeconds: number;
  projectedPaceLossSeconds: number;
  tyreDegradationLossSeconds: number | null;
  liftCoastLossSeconds: number | null;
  trafficLossSeconds: number;
  confidence: StrategyConfidence;
  calculationBreakdown: CalculationBreakdown;
  pitTimeSeconds: number;
  liftCoastSavePercent: number;
  liftCoastSaveLitersPerLap: number;
  fuelMarginLiters: number;
  finishFuelRemainingLiters: number;
  finishVirtualEnergy: number | null;
  firstStintFuelNeedLiters: number;
  recommendedStartFuelLiters: number;
  startFuelIsFullTank: boolean;
  projectedTyreWear: number | null;
  projectedTyreWearByWheel: WheelValues | null;
  lowestRemainingTyreWear: number | null;
  tyresAvailable: number | null;
  tyresUsed: number;
  tyresRemaining: number | null;
  risk: StrategyRisk;
  reasons: string[];
  warnings: string[];
  stopsDetail: StrategyStop[];
  stintWear: StintWearProjection[];
  stintPace: StintPaceProjection[];
};

const wheels: Wheel[] = ["fl", "fr", "rl", "rr"];
// A recent slope is evidence about a short window, not a permanent acceleration
// in lap time. This horizon bounds its asymptotic pace offset to trend * 10.
const PACE_TREND_HORIZON_LAPS = 10;
const wheelLabel: Record<Wheel, string> = { fl: "FL", fr: "FR", rl: "RL", rr: "RR" };
const round = (value: number, digits = 3) => Number(value.toFixed(digits));
const values = <T>(wheel: Record<Wheel, T>) => wheels.map((key) => wheel[key]);

function confidenceRank(value?: string) { return value === "high" ? 2 : value === "medium" ? 1 : 0; }
function confidenceName(value: number): StrategyConfidence { return value >= 2 ? "high" : value >= 1 ? "medium" : "low"; }
function riskRank(value: StrategyRisk) { return value === "high" ? 2 : value === "medium" ? 1 : 0; }
function paceTrendConfidenceWeight(value?: string) { return value === "high" ? 1 : value === "medium" ? 0.65 : 0.35; }

export function stopServiceTime(input: {
  pitLaneLossSeconds: number;
  tyresChanged: number;
  tyreChangeSecondsPerTyre: number;
  fuelAddedLiters: number;
  refuelSecondsPer5Liters: number;
  serviceModel?: ServiceModel;
}) {
  const tyre = Math.max(0, input.tyresChanged) * Math.max(0, input.tyreChangeSecondsPerTyre);
  const fuel = Math.max(0, input.fuelAddedLiters) / 5 * Math.max(0, input.refuelSecondsPer5Liters);
  const work = input.serviceModel === "parallel" ? Math.max(tyre, fuel) : tyre + fuel;
  return Math.max(0, input.pitLaneLossSeconds) + work;
}

function reserveFor(input: StrategySimulationInput) {
  const factor = input.safetyPolicy === "conservative" ? 1.35 : input.safetyPolicy === "aggressive" ? 0.8 : 1;
  return Math.max(0, input.fuelSafetyMarginLiters * factor);
}

function fuelRateFor(input: StrategySimulationInput) {
  return input.fuelPerLap ?? 0;
}

function fuelUncertaintyFor(input: StrategySimulationInput, laps: number) {
  const z = input.safetyPolicy === "conservative" ? 1.645 : input.safetyPolicy === "aggressive" ? 0 : 1;
  return z * Math.max(0, input.fuelUseStdDevLiters ?? 0) * Math.sqrt(Math.max(0, laps));
}

function futureFuelCapacity(input: StrategySimulationInput) {
  const tank = input.tankCapacityLiters ?? 0;
  const ratio = input.fuelToVirtualEnergyRatio;
  const ratioCapacity = ratio != null && Number.isFinite(ratio) && ratio > 0 ? tank * ratio : tank;
  const energyRate = input.virtualEnergyPerLap;
  const energyCapacity = energyRate != null && energyRate > 0
    ? Math.floor(1 / energyRate) * fuelRateFor(input) + reserveFor(input)
    : tank;
  return Math.min(tank, ratioCapacity, energyCapacity);
}

function stintResourceLimits(input: StrategySimulationInput, stints: number, savePerLap = 0) {
  const rate = fuelRateFor(input) - savePerLap;
  const capacity = futureFuelCapacity(input);
  let future = 1;
  while ((future + 1) * rate + fuelUncertaintyFor(input, future + 1) + reserveFor(input) <= capacity + 1e-6) future += 1;
  const currentFuel = input.currentFuelLiters;
  const currentEnergy = input.currentVirtualEnergyFraction;
  let fuelLaps = future;
  if (currentFuel != null && currentFuel >= 0) {
    fuelLaps = 0;
    while ((fuelLaps + 1) * rate + fuelUncertaintyFor(input, fuelLaps + 1) <= currentFuel + 1e-6) fuelLaps += 1;
  }
  const energyLaps = currentEnergy != null && input.virtualEnergyPerLap != null && input.virtualEnergyPerLap > 0
    ? Math.floor(currentEnergy / input.virtualEnergyPerLap)
    : future;
  return [Math.max(1, Math.min(future, fuelLaps, energyLaps)), ...Array(Math.max(0, stints - 1)).fill(future)];
}

function paceFor(input: StrategySimulationInput) {
  for (const value of [input.paceEvidence?.weightedRecentPace, input.paceEvidence?.last7LapAverage, input.paceEvidence?.last10LapAverage, input.paceEvidence?.lastLapTime, input.normalLapTime]) {
    if (value != null && Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function startingWear(input: StrategySimulationInput): WheelValues | null {
  if (input.raceStartNewTyres !== false) return { fl: 0, fr: 0, rl: 0, rr: 0 };
  const fallback = input.currentTyreWear;
  const source = input.startingTyreWearByWheel ?? input.currentTyreWearByWheel;
  if (fallback == null && !wheels.some((wheel) => source?.[wheel] != null)) return null;
  return Object.fromEntries(wheels.map((wheel) => [wheel, Math.max(0, source?.[wheel] ?? fallback ?? 0)])) as WheelValues;
}

function wearRates(input: StrategySimulationInput): WheelValues | null {
  if (input.tyreWearRatePerLap == null && !wheels.some((wheel) => input.tyreWearRateByWheel?.[wheel] != null)) return null;
  return Object.fromEntries(wheels.map((wheel) => [wheel, Math.max(0, input.tyreWearRateByWheel?.[wheel] ?? input.tyreWearRatePerLap ?? 0)])) as WheelValues;
}

function startingTyreAge(input: StrategySimulationInput): WheelValues {
  const wear = startingWear(input);
  const rates = wearRates(input);
  if (!wear || !rates) return { fl: 0, fr: 0, rl: 0, rr: 0 };
  return Object.fromEntries(wheels.map((wheel) => [wheel, rates[wheel] > 0 ? wear[wheel] / rates[wheel] : 0])) as WheelValues;
}

function wearLimits(input: StrategySimulationInput): WheelValues {
  return Object.fromEntries(wheels.map((wheel) => [wheel, input.maxTyreWearByWheel?.[wheel] ?? input.maxTyreWear])) as WheelValues;
}

function splitLaps(total: number, stints: number) {
  const base = Math.floor(total / stints);
  const extra = total % stints;
  return Array.from({ length: stints }, (_, index) => base + (index < extra ? 1 : 0));
}

type StintLayout = "balanced" | "late";

function stintLayout(input: StrategySimulationInput, total: number, stints: number, layout: StintLayout, savePerLap = 0) {
  const limits = stintResourceLimits(input, stints, savePerLap);
  if (limits.reduce((sum, value) => sum + value, 0) < total) return splitLaps(total, stints);
  let remaining = total;
  return Array.from({ length: stints }, (_, index) => {
    const laterStints = stints - index - 1;
    const laterCapacity = limits.slice(index + 1).reduce((sum, value) => sum + value, 0);
    const minimumHere = Math.max(1, remaining - laterCapacity);
    const balancedTarget = Math.ceil(remaining / (laterStints + 1));
    const requested = layout === "late" ? remaining - laterStints : balancedTarget;
    const laps = Math.min(limits[index], Math.max(minimumHere, requested));
    remaining -= laps;
    return laps;
  });
}

function tyresForStop(input: StrategySimulationInput, wear: WheelValues, rates: WheelValues, nextLaps: number) {
  const policy = input.tyreChangePolicy ?? "automatic";
  if (policy === "never") return [];
  if (policy === "all") return [...wheels];
  if (policy === "selected") return [...(input.selectedTyres ?? [])];
  const limits = wearLimits(input);
  return wheels.filter((wheel) => wear[wheel] + rates[wheel] * nextLaps > limits[wheel]);
}

function calculateTyres(input: StrategySimulationInput, stintLaps: number[]) {
  const start = startingWear(input);
  const rates = wearRates(input);
  if (!start || !rates) return { stints: [] as StintWearProjection[], calls: [] as Wheel[][], maxWear: null, final: null, violations: [] as string[] };
  const limits = wearLimits(input);
  let wear = { ...start };
  let lap = 1;
  const stints: StintWearProjection[] = [];
  const calls: Wheel[][] = [];
  const violations: string[] = [];
  let maxWear = 0;
  for (let index = 0; index < stintLaps.length; index += 1) {
    const laps = stintLaps[index];
    const end = Object.fromEntries(wheels.map((wheel) => [wheel, wear[wheel] + rates[wheel] * laps])) as WheelValues;
    wheels.forEach((wheel) => {
      maxWear = Math.max(maxWear, end[wheel]);
      if (end[wheel] > limits[wheel] + 1e-6) violations.push(`${wheelLabel[wheel]} reaches ${round(end[wheel] * 100, 1)}% (limit ${round(limits[wheel] * 100, 1)}%)`);
    });
    stints.push({ stint: index + 1, startLap: lap, endLap: lap + laps - 1, startWear: { ...wear }, endWear: end, remainingWear: Object.fromEntries(wheels.map((wheel) => [wheel, limits[wheel] - end[wheel]])) as WheelValues, startFuelLiters: 0, endFuelLiters: 0 });
    lap += laps;
    if (index < stintLaps.length - 1) {
      const call = tyresForStop(input, end, rates, stintLaps[index + 1]);
      calls.push(call);
      wear = Object.fromEntries(wheels.map((wheel) => [wheel, call.includes(wheel) ? 0 : end[wheel]])) as WheelValues;
    }
  }
  return { stints, calls, maxWear, final: stints[stints.length - 1]?.endWear ?? null, violations };
}

function buildFuel(input: StrategySimulationInput, stintLaps: number[], savePerLap: number) {
  const rate = fuelRateFor(input) - savePerLap;
  const reserve = reserveFor(input);
  const tank = futureFuelCapacity(input);
  const required = stintLaps.map((laps) => laps * rate);
  const uncertainty = stintLaps.map((laps) => fuelUncertaintyFor(input, laps));
  const start = input.currentFuelLiters != null ? input.currentFuelLiters : required[0] + uncertainty[0] + reserve;
  if (rate <= 0 || start > (input.tankCapacityLiters ?? tank) + 1e-6 || required[0] + uncertainty[0] > start + 1e-6) return null;
  let fuel = start;
  const stops: Array<{ entry: number; add: number; exit: number }> = [];
  for (let index = 0; index < stintLaps.length; index += 1) {
    fuel -= required[index];
    if (fuel < -1e-6) return null;
    if (index < stintLaps.length - 1) {
      const target = required[index + 1] + uncertainty[index + 1] + reserve;
      if (target > tank + 1e-6) return null;
      const add = Math.max(0, target - fuel);
      stops.push({ entry: fuel, add, exit: fuel + add });
      fuel += add;
    }
  }
  if (fuel + 1e-6 < reserve) return null;
  const energyRate = input.virtualEnergyPerLap;
  let virtualEnergy = energyRate != null && energyRate > 0 ? (input.currentVirtualEnergyFraction ?? 1) : null;
  const energyStops: Array<{ entry: number; add: number; exit: number }> = [];
  if (virtualEnergy != null && energyRate != null && energyRate > 0) {
    for (let index = 0; index < stintLaps.length; index += 1) {
      virtualEnergy -= stintLaps[index] * energyRate;
      if (virtualEnergy < -1e-6) return null;
      if (index < stintLaps.length - 1) {
        energyStops.push({ entry: virtualEnergy, add: Math.max(0, 1 - virtualEnergy), exit: 1 });
        virtualEnergy = 1;
      }
    }
  }
  return { rate, reserve, start, finish: fuel, stops, required, uncertainty, energyStops, finishEnergy: virtualEnergy };
}

function elapsedFor(input: StrategySimulationInput, laps: number, stintLaps: number[], tyreCalls: Wheel[][], fuelPlan: { start: number; rate: number; stops: Array<{ add: number }> }, savePercent: number) {
  const basePace = paceFor(input);
  const degradation = input.tyrePaceDegradationPerLap != null && input.tyrePaceDegradationPerLap >= 0 ? input.tyrePaceDegradationPerLap : null;
  const empirical = input.empiricalStintPace ?? null;
  // Tyre degradation already explains part of a positive observed pace slope.
  // Only project the unexplained residual, weighted by pace evidence quality.
  const observedTrend = Math.max(0, input.paceEvidence?.paceTrendSecondsPerLap ?? 0);
  const trend = Math.max(0, observedTrend - (degradation ?? 0)) * paceTrendConfidenceWeight(input.paceEvidence?.confidence);
  const liftCost = savePercent > 0 && input.liftCoastSecondsPerPercentPerLap != null ? input.liftCoastSecondsPerPercentPerLap * savePercent * laps : null;
  let elapsed = 0;
  let base = 0;
  let trendLoss = 0;
  let tyreLoss = 0;
  let pitLane = 0;
  let stationary = 0;
  let fuelOnBoard = fuelPlan.start;
  let completed = 0;
  let tyreAge = startingTyreAge(input);
  let projectedWear = startingWear(input);
  const projectedWearRates = wearRates(input);
  const stops: Array<{ lane: number; stationary: number; total: number; entryElapsed: number }> = [];
  const stintPace: StintPaceProjection[] = [];
  for (let stint = 0; stint < stintLaps.length; stint += 1) {
    const startLap = completed + 1;
    let stintDriving = 0;
    let stintFuelLoss = 0;
    let stintTyreLoss = 0;
    let stintTrendLoss = 0;
    let startPace = 0;
    let endPace = 0;
    let stintCompleted = 0;
    for (let local = 0; local < stintLaps[stint]; local += 1) {
      if (elapsed >= input.raceDurationMinutes * 60) break;
      const averageWear = projectedWear ? values(projectedWear).reduce((sum, wear) => sum + wear, 0) / wheels.length : null;
      const trendPart = empirical
        ? empirical.warmupLossSeconds * (Math.exp(-local / 2) - empirical.referenceWarmup)
        : trend * PACE_TREND_HORIZON_LAPS * (1 - Math.exp(-completed / PACE_TREND_HORIZON_LAPS));
      const tyrePart = empirical && averageWear != null
        ? empirical.tyreWearCoefficientSecondsPerFraction * (averageWear - empirical.referenceTyreWear)
        : degradation == null ? 0 : degradation * (values(tyreAge).reduce((sum, age) => sum + age, 0) / wheels.length);
      const liftPart = liftCost == null ? 0 : liftCost / Math.max(1, laps);
      const fuelPart = empirical
        ? empirical.fuelCoefficientSecondsPerLiter * (fuelOnBoard - fuelPlan.rate / 2 - empirical.referenceFuelLiters)
        : Math.max(0, fuelOnBoard - fuelPlan.rate / 2) * (input.fuelLoadPacePenaltySecondsPerLiter ?? 0.025);
      const lapPace = basePace + trendPart + tyrePart + liftPart + fuelPart;
      elapsed += lapPace;
      base += basePace;
      trendLoss += trendPart + fuelPart;
      tyreLoss += tyrePart;
      stintDriving += lapPace;
      stintFuelLoss += fuelPart;
      stintTyreLoss += tyrePart;
      stintTrendLoss += trendPart;
      if (stintCompleted === 0) startPace = lapPace;
      endPace = lapPace;
      stintCompleted += 1;
      completed += 1;
      fuelOnBoard -= fuelPlan.rate;
      tyreAge = Object.fromEntries(wheels.map((wheel) => [wheel, tyreAge[wheel] + 1])) as WheelValues;
      if (projectedWear && projectedWearRates) projectedWear = Object.fromEntries(wheels.map((wheel) => [wheel, projectedWear![wheel] + projectedWearRates[wheel]])) as WheelValues;
    }
    if (stintCompleted > 0) {
      stintPace.push({
        stint: stint + 1, startLap, endLap: completed,
        startPaceSeconds: round(startPace, 3), averagePaceSeconds: round(stintDriving / stintCompleted, 3), endPaceSeconds: round(endPace, 3),
        drivingTimeSeconds: round(stintDriving, 2), fuelLoadLossSeconds: round(stintFuelLoss, 2),
        tyreDegradationLossSeconds: empirical || degradation != null ? round(stintTyreLoss, 2) : null, recentTrendLossSeconds: round(stintTrendLoss, 2),
      });
    }
    if (elapsed >= input.raceDurationMinutes * 60 || stint >= stintLaps.length - 1) continue;
    const lane = input.safetyCarActive && input.safetyCarPitLossSeconds != null ? input.safetyCarPitLossSeconds : input.pitLaneLossSeconds;
    const tyresChanged = tyreCalls[stint] ?? [];
    const tyre = tyresChanged.length * input.tyreChangeSecondsPerTyre;
    const fuel = fuelPlan.stops[stint].add / 5 * input.refuelSecondsPer5Liters;
    const work = input.serviceModel === "parallel" ? Math.max(tyre, fuel) : tyre + fuel;
    const stopStationary = work;
    const entryElapsed = elapsed;
    elapsed += lane + stopStationary + Math.max(0, input.trafficPenaltySeconds ?? 0);
    pitLane += lane;
    stationary += stopStationary;
    stops.push({ lane, stationary: stopStationary, total: lane + stopStationary, entryElapsed });
    fuelOnBoard += fuelPlan.stops[stint].add;
    tyreAge = Object.fromEntries(wheels.map((wheel) => [wheel, tyresChanged.includes(wheel) ? 0 : tyreAge[wheel]])) as WheelValues;
    if (projectedWear) projectedWear = Object.fromEntries(wheels.map((wheel) => [wheel, tyresChanged.includes(wheel) ? 0 : projectedWear![wheel]])) as WheelValues;
  }
  return { elapsed, completed, base, trendLoss, tyreLoss: empirical || degradation != null ? tyreLoss : null, liftCost, pitLane, stationary, stops, stintPace };
}

function candidate(input: StrategySimulationInput, stopCount: number, initialLapGuess: number, allowSave: boolean, layout: StintLayout, forcedSavePercent = 0): StrategyCandidate | null {
  const targetDuration = input.raceDurationMinutes * 60;
  let raceLaps = Math.max(1, initialLapGuess);
  let result: ReturnType<typeof elapsedFor> | null = null;
  let tyre = calculateTyres(input, stintLayout(input, raceLaps, stopCount + 1, layout));
  let fuel: ReturnType<typeof buildFuel> = null;
  let savePerLap = (input.fuelPerLap ?? 0) * forcedSavePercent / 100;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    let stints = stintLayout(input, raceLaps, stopCount + 1, layout, savePerLap);
    tyre = calculateTyres(input, stints);
    fuel = buildFuel(input, stints, savePerLap);
    if (!fuel && allowSave && input.fuelPerLap) {
      for (let percent = Math.max(0.5, forcedSavePercent); percent <= 8 && !fuel; percent += 0.5) {
        savePerLap = input.fuelPerLap * percent / 100;
        stints = stintLayout(input, raceLaps, stopCount + 1, layout, savePerLap);
        tyre = calculateTyres(input, stints);
        fuel = buildFuel(input, stints, savePerLap);
      }
    }
    if (!fuel) {
      const capacityLaps = stintResourceLimits(input, stopCount + 1, savePerLap).reduce((sum, limit) => sum + limit, 0);
      if (!allowSave && capacityLaps < raceLaps) {
        raceLaps = capacityLaps;
        continue;
      }
      return null;
    }
    const savePercent = savePerLap / (input.fuelPerLap ?? 1) * 100;
    result = elapsedFor(input, raceLaps, stints, tyre.calls, fuel, savePercent);
    // A strategy is only valid when its final lap reaches the race-duration
    // target.  Completing all planned laps before the target is not a finish.
    if (result.completed === raceLaps && result.elapsed >= targetDuration) break;
    if (result.completed === raceLaps) {
      const capacityLaps = stintResourceLimits(input, stopCount + 1, savePerLap).reduce((sum, limit) => sum + limit, 0);
      if (raceLaps >= capacityLaps) return null;
      raceLaps += 1;
    } else {
      raceLaps = Math.max(1, result.completed);
    }
  }
  if (!fuel || !result || result.completed !== raceLaps || result.elapsed < targetDuration) return null;
  const stints = stintLayout(input, raceLaps, stopCount + 1, layout, savePerLap);
  tyre = calculateTyres(input, stints);
  if (tyre.violations.length && input.tyreChangePolicy !== "never") return null;
  const tyresAvailable = input.maxTyresAvailable == null ? null : Math.max(4, Math.floor(input.maxTyresAvailable));
  const tyresUsed = 4 + tyre.calls.reduce((sum, call) => sum + call.length, 0);
  if (tyresAvailable != null && tyresUsed > tyresAvailable) return null;
  const limits = stintResourceLimits(input, stints.length, savePerLap);
  const finalStop = stints.length - 2;
  if (finalStop >= 0 && (tyre.calls[finalStop]?.length ?? 0) === 0 && stints[finalStop] + stints[finalStop + 1] <= limits[finalStop]) return null;
  const savePercent = savePerLap / (input.fuelPerLap ?? 1) * 100;
  const stopsDetail: StrategyStop[] = fuel.stops.map((stop, index) => {
    const wear = tyre.stints[index]?.endWear ?? null;
    const tyres = tyre.calls[index] ?? [];
    const limits = wearLimits(input);
    const next = tyre.stints[index + 1]?.endWear ?? null;
    const thresholdReason = (input.tyreChangePolicy ?? "automatic") === "automatic" ? tyres.map(wheel => wheelLabel[wheel]) : [];
    return {
      lap: stints.slice(0, index + 1).reduce((sum, value) => sum + value, 0),
      raceElapsedAtPitSeconds: round(result!.stops[index]?.entryElapsed ?? 0, 2),
      raceTimeRemainingAtPitSeconds: round(Math.max(0, targetDuration - (result!.stops[index]?.entryElapsed ?? targetDuration)), 2),
      fuelRemainingLiters: round(stop.entry, 2), fuelAddedLiters: round(stop.add, 2), fuelOnExitLiters: round(stop.exit, 2),
      virtualEnergyRemaining: fuel.energyStops[index] ? round(fuel.energyStops[index].entry, 4) : null,
      virtualEnergyAdded: fuel.energyStops[index] ? round(fuel.energyStops[index].add, 4) : null,
      virtualEnergyOnExit: fuel.energyStops[index] ? round(fuel.energyStops[index].exit, 4) : null,
      tyresChanged: tyres.length, tyresToChange: tyres,
      pitLaneTimeSeconds: round(result!.stops[index]?.lane ?? input.pitLaneLossSeconds, 2),
      stationaryTimeSeconds: round(result!.stops[index]?.stationary ?? 0, 2),
      stopTimeSeconds: round(result!.stops[index]?.total ?? 0, 2),
      tyreWearBeforeStop: wear, nextStintProjectedWear: next,
      reason: thresholdReason.length ? `${thresholdReason.join(" + ")} would exceed the permitted wear before the next stop` : tyres.length ? "Selected tyre service policy" : "Fuel range",
    };
  });
  let fuelCursor = fuel.start;
  tyre.stints.forEach((stint, index) => {
    stint.startFuelLiters = round(fuelCursor, 2);
    fuelCursor -= fuel.required[index];
    stint.endFuelLiters = round(fuelCursor, 2);
    if (fuel.stops[index]) fuelCursor += fuel.stops[index].add;
  });
  const margin = fuel.finish - fuel.reserve;
  const warnings: string[] = [];
  if (savePercent > 0 && input.liftCoastSecondsPerPercentPerLap == null) warnings.push("Fuel-saving pace cost unavailable: no calibrated lift-and-coast model");
  if (input.tyrePaceDegradationPerLap == null && !input.empiricalStintPace) warnings.push("Insufficient tyre degradation data; no degradation time was applied");
  if (tyre.violations.length) warnings.push(...tyre.violations);
  if (input.fuelObservedLaps < input.fuelRequiredLaps) warnings.push(`Fuel model uses only ${input.fuelObservedLaps} valid laps`);
  const varianceProtected = (fuel.uncertainty[fuel.uncertainty.length - 1] ?? 0) > 0;
  const risk: StrategyRisk = tyre.violations.length || savePercent > 5
    ? "high"
    : savePercent > 0 || (!varianceProtected && margin < (input.fuelPerLap ?? 0) * 0.5)
      ? "medium"
      : "low";
  const confidence = confidenceName(Math.min(confidenceRank(input.paceEvidence?.confidence), confidenceRank(input.fuelConfidence), confidenceRank(input.tyreConfidence), risk === "low" ? 2 : risk === "medium" ? 1 : 0));
  const traffic = stopCount * Math.max(0, input.trafficPenaltySeconds ?? 0);
  const total = result.elapsed;
  const breakdown: CalculationBreakdown = {
    raceLaps, simulationPaceSeconds: round(paceFor(input), 3), baseRaceTimeSeconds: round(result.base, 2),
    pitLaneTimeSeconds: round(result.pitLane, 2), stationaryServiceTimeSeconds: round(result.stationary, 2), pitTimeSeconds: round(result.pitLane + result.stationary, 2),
    projectedPaceLossSeconds: round(result.trendLoss, 2), tyreDegradationLossSeconds: result.tyreLoss == null ? null : round(result.tyreLoss, 2),
    liftCoastLossSeconds: result.liftCost == null ? null : round(result.liftCost, 2), trafficLossSeconds: round(traffic, 2), fuelMarginLiters: round(margin, 2),
    fuelUseLitersPerLap: round(fuel.rate, 3), fuelUseStdDevLiters: input.fuelUseStdDevLiters ?? null, fuelConfidence: input.fuelConfidence ?? "low",
    paceConfidence: String(input.paceEvidence?.confidence ?? "low"),
    paceModelSource: input.empiricalStintPace ? "empirical stint regression" : "fallback heuristic",
    paceVariabilitySecondsPerLap: input.empiricalStintPace?.residualStdDevSeconds ?? input.paceEvidence?.spreadSeconds ?? null,
    p90TotalTimeSeconds: round(total + 1.282 * (input.empiricalStintPace?.residualStdDevSeconds ?? input.paceEvidence?.spreadSeconds ?? 0) * Math.sqrt(raceLaps), 2),
    tyreConfidence: input.tyreConfidence ?? "low", targetDurationSeconds: input.raceDurationMinutes * 60,
    timeRemainingSeconds: round(input.raceDurationMinutes * 60 - total, 2), totalTimeSeconds: round(total, 2),
  };
  const reasons = [
    `${raceLaps} laps are completed by simulating elapsed time including ${stopCount} stop${stopCount === 1 ? "" : "s"}`,
    `${round(fuel.rate, 3)} L/lap expected use with cumulative variance allowance from ${input.fuelObservedLaps} valid fuel laps`,
    input.empiricalStintPace ? `Stint pace calibrated from ${input.empiricalStintPace.sampleLaps} laps across ${input.empiricalStintPace.observedStints} observed stint${input.empiricalStintPace.observedStints === 1 ? "" : "s"}` : "Stint pace uses the fallback heuristic because calibration data is incomplete",
    `${round(fuel.start, 1)} L start fuel covers stint 1, ${round(fuel.uncertainty[0], 2)} L variance allowance, and ${round(fuel.reserve, 1)} L reserve`,
    tyresAvailable == null ? `${tyresUsed} individual tyres are used; no race allocation was configured` : `${tyresUsed} of ${tyresAvailable} available individual tyres are used, including the four starting tyres`,
    layout === "late" ? "Pit calls are held to the latest fuel-feasible lap; tyre limits can still require an earlier stop" : "Balanced stint lengths retained as a tyre-life comparison",
    savePercent ? `${round(savePercent, 1)}% fuel saving ${input.liftCoastMode === "fixed" ? "is the selected fixed target" : "is the proposed inferred target"}` : "No lift-and-coast is required",
  ];
  return {
    id: `${stopCount}-${layout}-${input.safetyPolicy ?? "balanced"}-${round(savePercent, 1)}`, label: `${stopCount === 0 ? "No stop" : `${stopCount} stop${stopCount === 1 ? "" : "s"}`} · ${layout === "late" ? "late pit" : "balanced stints"}`,
    category: savePercent ? "fuel-save" : "alternative", stops: stopCount, maxTyresChangedPerStop: stopsDetail.length ? Math.max(...stopsDetail.map(stop => stop.tyresChanged)) : 0,
    tyresChangedPerStop: stopsDetail.length ? Math.max(...stopsDetail.map(stop => stop.tyresChanged)) : 0, raceLaps, stintLaps: round(raceLaps / (stopCount + 1), 2), totalTimeSeconds: round(total, 2),
    baseRaceTimeSeconds: round(result.base, 2), projectedPaceLossSeconds: round(result.trendLoss, 2), tyreDegradationLossSeconds: breakdown.tyreDegradationLossSeconds,
    liftCoastLossSeconds: breakdown.liftCoastLossSeconds, trafficLossSeconds: round(traffic, 2), confidence, calculationBreakdown: breakdown, pitTimeSeconds: breakdown.pitTimeSeconds,
    liftCoastSavePercent: round(savePercent, 2), liftCoastSaveLitersPerLap: round(savePerLap, 3), fuelMarginLiters: round(margin, 2), finishFuelRemainingLiters: round(fuel.finish, 2),
    finishVirtualEnergy: fuel.finishEnergy == null ? null : round(fuel.finishEnergy, 4),
    firstStintFuelNeedLiters: round(fuel.required[0], 2), recommendedStartFuelLiters: round(fuel.start, 2), startFuelIsFullTank: fuel.start >= (input.tankCapacityLiters ?? 0) - 0.01,
    projectedTyreWear: tyre.maxWear == null ? null : round(tyre.maxWear, 3), projectedTyreWearByWheel: tyre.final, lowestRemainingTyreWear: tyre.final ? round(Math.min(...wheels.map(wheel => wearLimits(input)[wheel] - tyre.final![wheel])), 3) : null,
    tyresAvailable, tyresUsed, tyresRemaining: tyresAvailable == null ? null : tyresAvailable - tyresUsed,
    risk, reasons, warnings, stopsDetail, stintWear: tyre.stints, stintPace: result.stintPace,
  };
}

export function simulateStrategies(input: StrategySimulationInput): StrategyCandidate[] {
  if (!input.fuelPerLap || !input.tankCapacityLiters || paceFor(input) <= 0 || input.raceDurationMinutes <= 0) return [];
  const roughLaps = Math.max(1, Math.ceil(input.raceDurationMinutes * 60 / paceFor(input)));
  const fuelStint = stintResourceLimits(input, 1)[0];
  const minimumStops = Math.max(0, Math.ceil(roughLaps / fuelStint) - 1);
  const maxStops = input.maxStops ?? Math.min(40, Math.max(minimumStops + 3, 4));
  const candidates: StrategyCandidate[] = [];
  const fuelSaveCandidates: StrategyCandidate[] = [];
  const liftCoastTarget = Math.min(12, Math.max(0.5, input.liftCoastTargetPercent ?? 3));
  const fixedLiftCoast = input.liftCoastMode === "fixed";
  for (let stops = 0; stops <= maxStops; stops += 1) {
    for (const layout of ["late", "balanced"] as const) {
      const normal = candidate(input, stops, roughLaps, false, layout);
      if (normal) {
        candidates.push(normal);
        const contingency = candidate(input, stops, roughLaps, false, layout, liftCoastTarget);
        if (contingency) fuelSaveCandidates.push(contingency);
      } else {
        const saved = candidate(input, stops, roughLaps, !fixedLiftCoast, layout, fixedLiftCoast ? liftCoastTarget : 0);
        if (saved) fuelSaveCandidates.push(saved);
      }
    }
  }
  if (!candidates.length) {
    fuelSaveCandidates.sort((a, b) => b.raceLaps - a.raceLaps || a.stops - b.stops || a.liftCoastSavePercent - b.liftCoastSavePercent);
    return fuelSaveCandidates.slice(0, 5).map((item, index) => ({ ...item, category: "fuel-save", label: index === 0 ? "Lift-and-coast · minimum-stop plan" : `Lift-and-coast · ${item.stops} stops` }));
  }
  const calibratedSaving = input.liftCoastSecondsPerPercentPerLap != null;
  const all = [...candidates, ...(calibratedSaving ? fuelSaveCandidates : [])];
  all.sort((a, b) => b.raceLaps - a.raceLaps || a.totalTimeSeconds - b.totalTimeSeconds || riskRank(a.risk) - riskRank(b.risk));
  fuelSaveCandidates.sort((a, b) =>
    (a.stops < all[0].stops ? 0 : 1) - (b.stops < all[0].stops ? 0 : 1)
    || a.stops - b.stops
    || b.raceLaps - a.raceLaps
    || a.liftCoastSavePercent - b.liftCoastSavePercent
    || a.totalTimeSeconds - b.totalTimeSeconds
  );
  const selected: StrategyCandidate[] = [];
  const add = (item?: StrategyCandidate, category?: StrategyCandidate["category"], label?: string) => {
    if (!item || selected.some(existing => existing.id === item.id)) return;
    selected.push({ ...item, category: category ?? item.category, label: label ?? item.label });
  };
  add(all[0], "fastest", all[0].liftCoastSavePercent > 0 ? "Fastest projected · lift-and-coast" : all[0].reasons.some((reason) => reason.includes("latest fuel-feasible")) ? "Full-stint endurance" : "Fastest projected");
  add(candidates.find(item => item.label.includes("late pit")), "alternative", "Full-stint endurance");
  add(candidates.filter(item => item.risk !== "high").sort((a, b) => riskRank(a.risk) - riskRank(b.risk) || a.totalTimeSeconds - b.totalTimeSeconds)[0], "balanced", "Balanced");
  const fuelSave = fuelSaveCandidates[0];
  add(fuelSave, "fuel-save", fuelSave && fuelSave.stops < all[0].stops ? `Lift-and-coast · skip ${all[0].stops - fuelSave.stops} stop${all[0].stops - fuelSave.stops === 1 ? "" : "s"}` : "Lift-and-coast · extend stints");
  add(candidates.filter(item => item.confidence === "high" || item.risk === "low").sort((a, b) => riskRank(a.risk) - riskRank(b.risk) || b.finishFuelRemainingLiters - a.finishFuelRemainingLiters)[0], "conservative", "Conservative");
  add(candidates.find(item => item.stops !== all[0].stops), "alternative", "Alternative stop count");
  all.forEach(item => { if (selected.length < 5) add(item, "alternative", `${item.stops}-stop alternative`); });
  return selected.slice(0, 5);
}
