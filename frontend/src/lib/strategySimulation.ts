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
  tyreChangePolicy?: TyreChangePolicy;
  selectedTyres?: Wheel[];
  trafficPenaltySeconds?: number;
  liftCoastSecondsPerPercentPerLap?: number | null;
  safetyCarActive?: boolean;
  safetyCarPitLossSeconds?: number | null;
  maxStops?: number;
  fuelLoadPacePenaltySecondsPerLiter?: number;
};

export type StrategyStop = {
  lap: number;
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
  risk: StrategyRisk;
  reasons: string[];
  warnings: string[];
  stopsDetail: StrategyStop[];
  stintWear: StintWearProjection[];
};

const wheels: Wheel[] = ["fl", "fr", "rl", "rr"];
const wheelLabel: Record<Wheel, string> = { fl: "FL", fr: "FR", rl: "RL", rr: "RR" };
const round = (value: number, digits = 3) => Number(value.toFixed(digits));
const values = <T>(wheel: Record<Wheel, T>) => wheels.map((key) => wheel[key]);

function confidenceRank(value?: string) { return value === "high" ? 2 : value === "medium" ? 1 : 0; }
function confidenceName(value: number): StrategyConfidence { return value >= 2 ? "high" : value >= 1 ? "medium" : "low"; }
function riskRank(value: StrategyRisk) { return value === "high" ? 2 : value === "medium" ? 1 : 0; }

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
  const variance = Math.max(0, input.fuelUseStdDevLiters ?? 0) * (input.safetyPolicy === "conservative" ? 2 : input.safetyPolicy === "aggressive" ? 0 : 1);
  return Math.max(0, input.fuelSafetyMarginLiters * factor + variance);
}

function fuelRateFor(input: StrategySimulationInput) {
  const base = input.fuelPerLap ?? 0;
  const deviation = Math.max(0, input.fuelUseStdDevLiters ?? 0);
  return base + (input.safetyPolicy === "conservative" ? deviation : input.safetyPolicy === "balanced" ? deviation * 0.5 : 0);
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

function stintResourceLimits(input: StrategySimulationInput, stints: number) {
  const rate = fuelRateFor(input);
  const future = Math.max(1, Math.floor((futureFuelCapacity(input) - reserveFor(input)) / rate));
  const currentFuel = input.currentFuelLiters;
  const currentEnergy = input.currentVirtualEnergyFraction;
  const fuelLaps = currentFuel != null && currentFuel >= 0 ? Math.floor(currentFuel / rate) : future;
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

function stintLayout(input: StrategySimulationInput, total: number, stints: number, layout: StintLayout) {
  const limits = stintResourceLimits(input, stints);
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
  const start = input.currentFuelLiters != null ? input.currentFuelLiters : required[0] + reserve;
  if (rate <= 0 || start > (input.tankCapacityLiters ?? tank) + 1e-6 || required[0] > start + 1e-6) return null;
  let fuel = start;
  const stops: Array<{ entry: number; add: number; exit: number }> = [];
  for (let index = 0; index < stintLaps.length; index += 1) {
    fuel -= required[index];
    if (fuel < -1e-6) return null;
    if (index < stintLaps.length - 1) {
      const target = required[index + 1] + reserve;
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
  return { rate, reserve, start, finish: fuel, stops, required, energyStops, finishEnergy: virtualEnergy };
}

function elapsedFor(input: StrategySimulationInput, laps: number, stintLaps: number[], tyreCalls: Wheel[][], fuelPlan: { start: number; rate: number; stops: Array<{ add: number }> }, savePercent: number) {
  const basePace = paceFor(input);
  const trend = Math.max(0, input.paceEvidence?.paceTrendSecondsPerLap ?? 0);
  const degradation = input.tyrePaceDegradationPerLap != null && input.tyrePaceDegradationPerLap >= 0 ? input.tyrePaceDegradationPerLap : null;
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
  const stops: Array<{ lane: number; stationary: number; total: number }> = [];
  for (let stint = 0; stint < stintLaps.length; stint += 1) {
    for (let local = 0; local < stintLaps[stint]; local += 1) {
      if (elapsed >= input.raceDurationMinutes * 60) break;
      const trendPart = trend * completed;
      const tyrePart = degradation == null ? 0 : degradation * (values(tyreAge).reduce((sum, age) => sum + age, 0) / wheels.length);
      const liftPart = liftCost == null ? 0 : liftCost / Math.max(1, laps);
      const fuelPart = Math.max(0, fuelOnBoard - fuelPlan.rate / 2) * (input.fuelLoadPacePenaltySecondsPerLiter ?? 0.025);
      elapsed += basePace + trendPart + tyrePart + liftPart + fuelPart;
      base += basePace;
      trendLoss += trendPart + fuelPart;
      tyreLoss += tyrePart;
      completed += 1;
      fuelOnBoard -= fuelPlan.rate;
      tyreAge = Object.fromEntries(wheels.map((wheel) => [wheel, tyreAge[wheel] + 1])) as WheelValues;
    }
    if (elapsed >= input.raceDurationMinutes * 60 || stint >= stintLaps.length - 1) continue;
    const lane = input.safetyCarActive && input.safetyCarPitLossSeconds != null ? input.safetyCarPitLossSeconds : input.pitLaneLossSeconds;
    const tyre = tyreCalls[stint].length * input.tyreChangeSecondsPerTyre;
    const fuel = fuelPlan.stops[stint].add / 5 * input.refuelSecondsPer5Liters;
    const work = input.serviceModel === "parallel" ? Math.max(tyre, fuel) : tyre + fuel;
    const stopStationary = work;
    elapsed += lane + stopStationary + Math.max(0, input.trafficPenaltySeconds ?? 0);
    pitLane += lane;
    stationary += stopStationary;
    stops.push({ lane, stationary: stopStationary, total: lane + stopStationary });
    fuelOnBoard += fuelPlan.stops[stint].add;
    tyreAge = Object.fromEntries(wheels.map((wheel) => [wheel, tyreCalls[stint].includes(wheel) ? 0 : tyreAge[wheel]])) as WheelValues;
  }
  return { elapsed, completed, base, trendLoss, tyreLoss: degradation == null ? null : tyreLoss, liftCost, pitLane, stationary, stops };
}

function candidate(input: StrategySimulationInput, stopCount: number, initialLapGuess: number, allowSave: boolean, layout: StintLayout): StrategyCandidate | null {
  const targetDuration = input.raceDurationMinutes * 60;
  let raceLaps = Math.max(1, initialLapGuess);
  let result: ReturnType<typeof elapsedFor> | null = null;
  let tyre = calculateTyres(input, stintLayout(input, raceLaps, stopCount + 1, layout));
  let fuel: ReturnType<typeof buildFuel> = null;
  let savePerLap = 0;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const stints = stintLayout(input, raceLaps, stopCount + 1, layout);
    tyre = calculateTyres(input, stints);
    fuel = buildFuel(input, stints, savePerLap);
    if (!fuel && allowSave && input.fuelPerLap) {
      for (let percent = 0.5; percent <= 8 && !fuel; percent += 0.5) {
        savePerLap = input.fuelPerLap * percent / 100;
        fuel = buildFuel(input, stints, savePerLap);
      }
    }
    if (!fuel) return null;
    const savePercent = savePerLap / (input.fuelPerLap ?? 1) * 100;
    result = elapsedFor(input, raceLaps, stints, tyre.calls, fuel, savePercent);
    // A strategy is only valid when its final lap reaches the race-duration
    // target.  Completing all planned laps before the target is not a finish.
    if (result.completed === raceLaps && result.elapsed >= targetDuration) break;
    raceLaps = result.completed === raceLaps
      ? raceLaps + 1
      : Math.max(1, result.completed);
  }
  if (!fuel || !result || result.completed !== raceLaps || result.elapsed < targetDuration) return null;
  const stints = stintLayout(input, raceLaps, stopCount + 1, layout);
  tyre = calculateTyres(input, stints);
  if (tyre.violations.length && input.tyreChangePolicy !== "never") return null;
  const savePercent = savePerLap / (input.fuelPerLap ?? 1) * 100;
  const stopsDetail: StrategyStop[] = fuel.stops.map((stop, index) => {
    const wear = tyre.stints[index]?.endWear ?? null;
    const tyres = tyre.calls[index] ?? [];
    const limits = wearLimits(input);
    const next = tyre.stints[index + 1]?.endWear ?? null;
    const thresholdReason = (input.tyreChangePolicy ?? "automatic") === "automatic" ? tyres.map(wheel => wheelLabel[wheel]) : [];
    return {
      lap: stints.slice(0, index + 1).reduce((sum, value) => sum + value, 0),
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
  if (input.tyrePaceDegradationPerLap == null) warnings.push("Insufficient tyre degradation data; no degradation time was applied");
  if (tyre.violations.length) warnings.push(...tyre.violations);
  if (input.fuelObservedLaps < input.fuelRequiredLaps) warnings.push(`Fuel model uses only ${input.fuelObservedLaps} valid laps`);
  const risk: StrategyRisk = tyre.violations.length || savePercent > 5 ? "high" : margin < (input.fuelPerLap ?? 0) * 0.5 || savePercent > 0 ? "medium" : "low";
  const confidence = confidenceName(Math.min(confidenceRank(input.paceEvidence?.confidence), confidenceRank(input.fuelConfidence), confidenceRank(input.tyreConfidence), risk === "low" ? 2 : risk === "medium" ? 1 : 0));
  const traffic = stopCount * Math.max(0, input.trafficPenaltySeconds ?? 0);
  const total = result.elapsed;
  const breakdown: CalculationBreakdown = {
    raceLaps, simulationPaceSeconds: round(paceFor(input), 3), baseRaceTimeSeconds: round(result.base, 2),
    pitLaneTimeSeconds: round(result.pitLane, 2), stationaryServiceTimeSeconds: round(result.stationary, 2), pitTimeSeconds: round(result.pitLane + result.stationary, 2),
    projectedPaceLossSeconds: round(result.trendLoss, 2), tyreDegradationLossSeconds: result.tyreLoss == null ? null : round(result.tyreLoss, 2),
    liftCoastLossSeconds: result.liftCost == null ? null : round(result.liftCost, 2), trafficLossSeconds: round(traffic, 2), fuelMarginLiters: round(margin, 2),
    fuelUseLitersPerLap: round(fuel.rate, 3), fuelUseStdDevLiters: input.fuelUseStdDevLiters ?? null, fuelConfidence: input.fuelConfidence ?? "low",
    paceConfidence: String(input.paceEvidence?.confidence ?? "low"), tyreConfidence: input.tyreConfidence ?? "low", targetDurationSeconds: input.raceDurationMinutes * 60,
    timeRemainingSeconds: round(input.raceDurationMinutes * 60 - total, 2), totalTimeSeconds: round(total, 2),
  };
  const reasons = [
    `${raceLaps} laps are completed by simulating elapsed time including ${stopCount} stop${stopCount === 1 ? "" : "s"}`,
    `${round(fuel.rate, 3)} L/lap planning rate from ${input.fuelObservedLaps} valid fuel laps`,
    `${round(fuel.start, 1)} L start fuel covers stint 1 plus ${round(fuel.reserve, 1)} L reserve`,
    layout === "late" ? "Pit calls are held to the latest fuel-feasible lap; tyre limits can still require an earlier stop" : "Balanced stint lengths retained as a tyre-life comparison",
    savePercent ? `${round(savePercent, 1)}% fuel saving is required` : "No lift-and-coast is required",
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
    risk, reasons, warnings, stopsDetail, stintWear: tyre.stints,
  };
}

export function simulateStrategies(input: StrategySimulationInput): StrategyCandidate[] {
  if (!input.fuelPerLap || !input.tankCapacityLiters || paceFor(input) <= 0 || input.raceDurationMinutes <= 0) return [];
  const roughLaps = Math.max(1, Math.ceil(input.raceDurationMinutes * 60 / paceFor(input)));
  const fuelStint = Math.max(1, Math.floor((futureFuelCapacity(input) - reserveFor(input)) / fuelRateFor(input)));
  const minimumStops = Math.max(0, Math.ceil(roughLaps / fuelStint) - 1);
  const maxStops = input.maxStops ?? Math.min(40, Math.max(minimumStops + 3, 4));
  const all: StrategyCandidate[] = [];
  for (let stops = 0; stops <= maxStops; stops += 1) {
    for (const layout of ["late", "balanced"] as const) {
      const normal = candidate(input, stops, roughLaps, false, layout);
      if (normal) all.push(normal);
      else {
        const saved = candidate(input, stops, roughLaps, true, layout);
        if (saved) all.push(saved);
      }
    }
  }
  if (!all.length) return [];
  all.sort((a, b) => b.raceLaps - a.raceLaps || a.totalTimeSeconds - b.totalTimeSeconds || riskRank(a.risk) - riskRank(b.risk));
  const selected: StrategyCandidate[] = [];
  const add = (item?: StrategyCandidate, category?: StrategyCandidate["category"], label?: string) => {
    if (!item || selected.some(existing => existing.id === item.id)) return;
    selected.push({ ...item, category: category ?? item.category, label: label ?? item.label });
  };
  add(all[0], "fastest", "Fastest projected");
  add(all.find(item => item.label.includes("late pit")), "alternative", "Latest feasible pit");
  add(all.filter(item => item.risk !== "high").sort((a, b) => riskRank(a.risk) - riskRank(b.risk) || a.totalTimeSeconds - b.totalTimeSeconds)[0], "balanced", "Balanced");
  add(all.filter(item => item.confidence === "high" || item.risk === "low").sort((a, b) => riskRank(a.risk) - riskRank(b.risk) || b.finishFuelRemainingLiters - a.finishFuelRemainingLiters)[0], "conservative", "Conservative");
  add(all.find(item => item.stops !== all[0].stops && item.liftCoastSavePercent === 0), "alternative", "Alternative stop count");
  add(all.find(item => item.liftCoastSavePercent > 0), "fuel-save", "Fuel-save contingency");
  all.forEach(item => { if (selected.length < 4) add(item, "alternative", `${item.stops}-stop alternative`); });
  return selected.slice(0, 5);
}
