import type { SavedSession, SessionReview } from "../types/session";

export type Row = Record<string, unknown>;
export type Wheel = "fl" | "fr" | "rl" | "rr";

export type StatSummary = {
  average: number | null;
  min: number | null;
  max: number | null;
  trend: "rising" | "falling" | "stable" | "unavailable";
};

export type RacePrepReport = {
  session: {
    track: string | null;
    car: string | null;
    sessionType: string | null;
    dateTime: string | null;
    duration: number | null;
    totalLaps: number;
    validLaps: number;
    ambientTemp: number | null;
    trackTemp: number | null;
  };
  pace: {
    bestLap: number | null;
    bestLapNumber: number | null;
    worstLap: number | null;
    averageLap: number | null;
    medianLap: number | null;
    spread: number | null;
    standardDeviation: number | null;
    trend: "improving" | "degrading" | "stable" | "unavailable";
    consistency: "high" | "medium" | "low" | "unknown";
    deltas: Array<{ lap: number | null; lapTime: number; delta: number }>;
  };
  sectors: {
    available: boolean;
    bestLap: number | null;
    bestLapNumber: number | null;
    theoreticalBest: number | null;
    potential: number | null;
    bestSectors: Record<"sector1" | "sector2" | "sector3", number | null>;
    message: string;
  };
  fuel: {
    startFuel: number | null;
    endFuel: number | null;
    totalUsed: number | null;
    averagePerLap: number | null;
    minPerLap: number | null;
    maxPerLap: number | null;
    tankCapacity: number | null;
    tankCapacitySource: string;
    fullTankLaps: number | null;
    raceLaps: number | null;
    raceDistanceSource: string;
    estimatedRaceFuel: number | null;
    margin: number | null;
    trend: "rising" | "falling" | "stable" | "unavailable";
  };
  tyres: {
    wear: Record<Wheel, { start: number | null; end: number | null; delta: number | null; perLap: number | null }>;
    mostWorn: Wheel | null;
    frontRearBalance: number | null;
    leftRightBalance: number | null;
    wearMessage: string;
    temperature: Record<Wheel, StatSummary>;
    pressure: Record<Wheel, StatSummary>;
    hottestTyre: Wheel | null;
    coldestTyre: Wheel | null;
    highestPressureTyre: Wheel | null;
    lowestPressureTyre: Wheel | null;
  };
  execution: {
    paceTargetLow: number | null;
    paceTargetHigh: number | null;
    stintLength: number | null;
    fuelStops: number | null;
    totalStints: number | null;
    averageRaceStintLaps: number | null;
    fuelSavingRequiredPercent: number | null;
    tyresAvailable: number;
    tyreSetsAvailable: number;
    tyreSetsNeeded: number | null;
    tyreSetsShortage: number | null;
    tyreWarning: string | null;
    tyrePlanSummary: string;
    tyreChangePlan: Array<{ stop: number; lap: number | null; tyresToChange: number; action: string; reason: string }>;
    liftCoastOptions: Array<{ label: string; targetSaving: string; consumption: string; paceLoss: string; recommendation: string; risk: "low" | "medium" | "high" | "unknown" }>;
    finalRecommendation: string;
  };
};

export type RacePrepOptions = {
  raceLaps?: number | null;
  raceDurationMinutes?: number | null;
  tankCapacityOverride?: number | null;
  defaultRaceDurationMinutes?: number | null;
  tyresAvailable?: number | null;
};

const wheels: Wheel[] = ["fl", "fr", "rl", "rr"];
const wheelLabel: Record<Wheel, string> = { fl: "front-left", fr: "front-right", rl: "rear-left", rr: "rear-right" };

function num(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function avg(values: Array<number | null>): number | null {
  const clean = values.filter((value): value is number => value != null && Number.isFinite(value));
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

function median(values: Array<number | null>): number | null {
  const clean = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function min(values: Array<number | null>): number | null {
  const clean = values.filter((value): value is number => value != null && Number.isFinite(value));
  return clean.length ? Math.min(...clean) : null;
}

function max(values: Array<number | null>): number | null {
  const clean = values.filter((value): value is number => value != null && Number.isFinite(value));
  return clean.length ? Math.max(...clean) : null;
}

function std(values: number[], average: number | null): number | null {
  if (!values.length || average == null) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

function trend(values: number[], threshold: number): "rising" | "falling" | "stable" | "unavailable" {
  if (values.length < 4) return "unavailable";
  const split = Math.floor(values.length / 2);
  const first = avg(values.slice(0, split));
  const second = avg(values.slice(split));
  if (first == null || second == null) return "unavailable";
  const diff = second - first;
  if (Math.abs(diff) <= threshold) return "stable";
  return diff > 0 ? "rising" : "falling";
}

function lapTrend(values: number[]): RacePrepReport["pace"]["trend"] {
  const result = trend(values, 0.25);
  if (result === "rising") return "degrading";
  if (result === "falling") return "improving";
  return result;
}

function rowTime(row: Row): number {
  return num(row.game_time) ?? num(row.end_time) ?? num(row.start_time) ?? 0;
}

function validLaps(review: SessionReview): Row[] {
  const candidates = (review.laps || []).filter((lap) => {
    const lapTime = num(lap.lap_time);
    const fuelAdded = num(lap.fuel_added) || 0;
    return lapTime != null && lapTime >= 40 && lapTime <= 900 && lap.valid_lap !== false && lap.in_pit !== true && fuelAdded <= 2;
  });
  const normal = median(candidates.map((lap) => num(lap.lap_time)));
  return candidates.filter((lap) => {
    const lapTime = num(lap.lap_time);
    return lapTime != null && (!normal || (lapTime >= normal * 0.75 && lapTime <= normal * 1.8));
  });
}

function latestSessionDuration(session: SavedSession | null | undefined, samples: Row[], laps: Row[]): number | null {
  const explicit = num(session?.ended_at_game_time) != null && num(session?.started_at_game_time) != null
    ? (num(session?.ended_at_game_time)! - num(session?.started_at_game_time)!)
    : null;
  if (explicit != null && explicit >= 0) return explicit;
  const sampleTimes = samples.map(rowTime).filter(Number.isFinite);
  if (sampleTimes.length >= 2) return Math.max(...sampleTimes) - Math.min(...sampleTimes);
  const lapStart = min(laps.map((lap) => num(lap.start_time)));
  const lapEnd = max(laps.map((lap) => num(lap.end_time)));
  return lapStart != null && lapEnd != null && lapEnd >= lapStart ? lapEnd - lapStart : null;
}

function statFor(samples: Row[], key: string): StatSummary {
  const values = samples.map((sample) => num(sample[key])).filter((value): value is number => value != null);
  return { average: avg(values), min: min(values), max: max(values), trend: trend(values, key.includes("pressure") ? 0.03 : 1.0) };
}

function firstLastWithValue(samples: Row[], key: string): [number | null, number | null] {
  const values = samples.map((sample) => num(sample[key])).filter((value): value is number => value != null);
  return [values[0] ?? null, values[values.length - 1] ?? null];
}

function bestWheel(values: Record<Wheel, number | null>, chooser: typeof Math.max | typeof Math.min): Wheel | null {
  const entries = wheels.map((wheel) => [wheel, values[wheel]] as const).filter(([, value]) => value != null);
  if (!entries.length) return null;
  const chosen = chooser(...entries.map(([, value]) => value!));
  return entries.find(([, value]) => value === chosen)?.[0] ?? null;
}

function capacityFromSamples(samples: Row[]): number | null {
  return max(samples.map((sample) => num(sample.fuel_capacity_liters)).filter((value) => value != null && value > 0));
}

function raceLapsFromOptions(options: RacePrepOptions, medianLap: number | null): { laps: number | null; source: string } {
  if (options.raceLaps && options.raceLaps > 0) return { laps: options.raceLaps, source: "manual race laps" };
  if (options.raceDurationMinutes && options.raceDurationMinutes > 0 && medianLap) return { laps: (options.raceDurationMinutes * 60) / medianLap, source: "manual race duration" };
  if (options.defaultRaceDurationMinutes && options.defaultRaceDurationMinutes > 0 && medianLap) return { laps: (options.defaultRaceDurationMinutes * 60) / medianLap, source: "strategy assumption duration" };
  return { laps: null, source: "not available" };
}

function sectorReport(laps: Row[], bestLap: number | null, bestLapNumber: number | null): RacePrepReport["sectors"] {
  const sectorKeys = ["sector1", "sector2", "sector3"] as const;
  const sectorRows = laps.filter((lap) => sectorKeys.every((key) => num(lap[key]) != null && num(lap[key])! > 0));
  if (sectorRows.length < 2) {
    return {
      available: false,
      bestLap,
      bestLapNumber,
      theoreticalBest: null,
      potential: null,
      bestSectors: { sector1: null, sector2: null, sector3: null },
      message: "Sector split data is not stored for this live session yet.",
    };
  }
  const bestSectors = {
    sector1: min(sectorRows.map((lap) => num(lap.sector1))),
    sector2: min(sectorRows.map((lap) => num(lap.sector2))),
    sector3: min(sectorRows.map((lap) => num(lap.sector3))),
  };
  const sectorValues = Object.values(bestSectors);
  const theoreticalBest = sectorValues.every((value): value is number => value != null) ? sectorValues.reduce((sum, value) => sum + value, 0) : null;
  return {
    available: true,
    bestLap,
    bestLapNumber,
    theoreticalBest,
    potential: theoreticalBest != null && bestLap != null ? bestLap - theoreticalBest : null,
    bestSectors,
    message: "Sector split data available.",
  };
}

export function buildRacePrepReport(review: SessionReview, options: RacePrepOptions = {}): RacePrepReport {
  const samples = [...((review.telemetry_samples || []) as Row[])].sort((a, b) => rowTime(a) - rowTime(b));
  const allLaps = (review.laps || []) as Row[];
  const cleanLaps = validLaps(review);
  const lapTimes = cleanLaps.map((lap) => num(lap.lap_time)).filter((value): value is number => value != null);
  const averageLap = avg(lapTimes);
  const medianLap = median(lapTimes);
  const bestLap = min(lapTimes);
  const worstLap = max(lapTimes);
  const bestLapRow = cleanLaps.find((lap) => num(lap.lap_time) === bestLap);
  const bestLapNumber = num(bestLapRow?.lap_number);
  const spread = bestLap != null && worstLap != null ? worstLap - bestLap : null;
  const standardDeviation = std(lapTimes, averageLap);
  const consistency = standardDeviation == null || medianLap == null ? "unknown" : standardDeviation <= 0.35 ? "high" : standardDeviation <= 0.9 ? "medium" : "low";
  const deltas = cleanLaps
    .map((lap) => ({ lap: num(lap.lap_number), lapTime: num(lap.lap_time), delta: bestLap != null && num(lap.lap_time) != null ? num(lap.lap_time)! - bestLap : null }))
    .filter((lap): lap is { lap: number | null; lapTime: number; delta: number } => lap.lapTime != null && lap.delta != null);

  const session = review.session;
  const ambientTemp = avg(samples.map((sample) => num(sample.ambient_temp)));
  const trackTemp = avg(samples.map((sample) => num(sample.track_temp)));

  const fuelValues = cleanLaps.map((lap) => num(lap.fuel_used)).filter((value): value is number => value != null && value > 0);
  const sampleFuelValues = samples.map((sample) => num(sample.fuel_liters)).filter((value): value is number => value != null);
  const firstFuel = sampleFuelValues[0] ?? cleanLaps.map((lap) => num(lap.fuel_start)).find((value) => value != null) ?? null;
  const lastFuel = sampleFuelValues[sampleFuelValues.length - 1] ?? [...cleanLaps].reverse().map((lap) => num(lap.fuel_end)).find((value) => value != null) ?? null;
  const fuelAverage = avg(fuelValues);
  const tankCapacity = options.tankCapacityOverride && options.tankCapacityOverride > 0 ? options.tankCapacityOverride : capacityFromSamples(samples);
  const raceTarget = raceLapsFromOptions(options, medianLap);
  const estimatedRaceFuel = raceTarget.laps != null && fuelAverage != null ? raceTarget.laps * fuelAverage : null;
  const fuelStops = tankCapacity != null && estimatedRaceFuel != null ? Math.max(0, Math.ceil(estimatedRaceFuel / tankCapacity) - 1) : null;
  const totalStints = fuelStops != null ? fuelStops + 1 : null;
  const availableRaceFuel = tankCapacity != null && totalStints != null ? tankCapacity * totalStints : null;
  const fuelMargin = availableRaceFuel != null && estimatedRaceFuel != null ? availableRaceFuel - estimatedRaceFuel : null;
  const averageRaceStintLaps = raceTarget.laps != null && totalStints != null ? raceTarget.laps / totalStints : null;

  const wear: RacePrepReport["tyres"]["wear"] = { fl: emptyWear(), fr: emptyWear(), rl: emptyWear(), rr: emptyWear() };
  for (const wheel of wheels) {
    const [start, end] = firstLastWithValue(samples, `tyre_wear_${wheel}`);
    const delta = start != null && end != null ? Math.abs(end - start) : null;
    wear[wheel] = { start, end, delta, perLap: delta != null && cleanLaps.length ? delta / cleanLaps.length : null };
  }
  const wearDeltas = Object.fromEntries(wheels.map((wheel) => [wheel, wear[wheel].delta])) as Record<Wheel, number | null>;
  const mostWorn = bestWheel(wearDeltas, Math.max);
  const frontWear = avg([wear.fl.delta, wear.fr.delta]);
  const rearWear = avg([wear.rl.delta, wear.rr.delta]);
  const leftWear = avg([wear.fl.delta, wear.rl.delta]);
  const rightWear = avg([wear.fr.delta, wear.rr.delta]);
  const frontRearBalance = frontWear != null && rearWear != null ? rearWear - frontWear : null;
  const leftRightBalance = leftWear != null && rightWear != null ? rightWear - leftWear : null;

  const temperature = Object.fromEntries(wheels.map((wheel) => [wheel, statFor(samples, `tyre_temp_${wheel}`)])) as Record<Wheel, StatSummary>;
  const pressure = Object.fromEntries(wheels.map((wheel) => [wheel, statFor(samples, `tyre_pressure_${wheel}`)])) as Record<Wheel, StatSummary>;
  const tempAverages = Object.fromEntries(wheels.map((wheel) => [wheel, temperature[wheel].average])) as Record<Wheel, number | null>;
  const pressureAverages = Object.fromEntries(wheels.map((wheel) => [wheel, pressure[wheel].average])) as Record<Wheel, number | null>;

  const tyresAvailable = Math.max(4, Math.floor(options.tyresAvailable || 16));
  const tyreSetsAvailable = Math.floor(tyresAvailable / 4);
  const tyreLife = estimateTyreLife(wear, cleanLaps.length);
  const tyrePlan = buildTyrePlan(fuelStops, raceTarget.laps, averageRaceStintLaps, tyreLife, tyreSetsAvailable, frontRearBalance, leftRightBalance);
  const oneLessStopFuel = fuelStops != null && tankCapacity != null ? tankCapacity * Math.max(1, fuelStops) : null;
  const fuelShortageToRemoveStop = estimatedRaceFuel != null && oneLessStopFuel != null ? estimatedRaceFuel - oneLessStopFuel : null;
  const savingRequired = fuelShortageToRemoveStop != null && fuelShortageToRemoveStop > 0 && estimatedRaceFuel ? (fuelShortageToRemoveStop / estimatedRaceFuel) * 100 : null;
  const paceTargetLow = medianLap != null && averageLap != null ? Math.min(medianLap, averageLap) : medianLap ?? averageLap;
  const paceTargetHigh = medianLap != null && averageLap != null ? Math.max(medianLap, averageLap) + 0.5 : paceTargetLow != null ? paceTargetLow + 0.5 : null;
  const tyreWarning = mostWorn && wear[mostWorn].delta != null && wear[mostWorn].delta! > 0
    ? `${wheelLabel[mostWorn]} has the highest wear. ${frontRearBalance != null && Math.abs(frontRearBalance) > 0.02 ? (frontRearBalance > 0 ? "Rear wear is higher than front wear." : "Front wear is higher than rear wear.") : "Wear balance is broadly even."}`
    : null;
  const finalRecommendation = finalExecutionText(fuelStops, fuelMargin, savingRequired, paceTargetLow, paceTargetHigh, tyreWarning, lapTrend(lapTimes), tyrePlan.summary);

  return {
    session: {
      track: session?.track_name ?? null,
      car: session?.vehicle_name ?? null,
      sessionType: session?.session_type ?? null,
      dateTime: session?.created_at ?? null,
      duration: latestSessionDuration(session, samples, allLaps),
      totalLaps: allLaps.length,
      validLaps: cleanLaps.length,
      ambientTemp,
      trackTemp,
    },
    pace: {
      bestLap,
      bestLapNumber,
      worstLap,
      averageLap,
      medianLap,
      spread,
      standardDeviation,
      trend: lapTrend(lapTimes),
      consistency,
      deltas,
    },
    sectors: sectorReport(cleanLaps, bestLap, bestLapNumber),
    fuel: {
      startFuel: firstFuel,
      endFuel: lastFuel,
      totalUsed: fuelValues.length ? fuelValues.reduce((sum, value) => sum + value, 0) : firstFuel != null && lastFuel != null && firstFuel >= lastFuel ? firstFuel - lastFuel : null,
      averagePerLap: fuelAverage,
      minPerLap: min(fuelValues),
      maxPerLap: max(fuelValues),
      tankCapacity,
      tankCapacitySource: options.tankCapacityOverride && options.tankCapacityOverride > 0 ? "manual override" : tankCapacity != null ? "telemetry API" : "not available",
      fullTankLaps: tankCapacity != null && fuelAverage != null ? tankCapacity / fuelAverage : null,
      raceLaps: raceTarget.laps,
      raceDistanceSource: raceTarget.source,
      estimatedRaceFuel,
      margin: fuelMargin,
      trend: trend(fuelValues, 0.08),
    },
    tyres: {
      wear,
      mostWorn,
      frontRearBalance,
      leftRightBalance,
      wearMessage: mostWorn ? `${wheelLabel[mostWorn]} tyre had the highest wear.` : "Tyre wear data is not available yet.",
      temperature,
      pressure,
      hottestTyre: bestWheel(tempAverages, Math.max),
      coldestTyre: bestWheel(tempAverages, Math.min),
      highestPressureTyre: bestWheel(pressureAverages, Math.max),
      lowestPressureTyre: bestWheel(pressureAverages, Math.min),
    },
    execution: {
      paceTargetLow,
      paceTargetHigh,
      stintLength: tankCapacity != null && fuelAverage != null ? tankCapacity / fuelAverage : null,
      fuelStops,
      totalStints,
      averageRaceStintLaps,
      fuelSavingRequiredPercent: savingRequired,
      tyresAvailable,
      tyreSetsAvailable,
      tyreSetsNeeded: tyrePlan.setsNeeded,
      tyreSetsShortage: tyrePlan.setsShortage,
      tyreWarning,
      tyrePlanSummary: tyrePlan.summary,
      tyreChangePlan: tyrePlan.plan,
      liftCoastOptions: liftOptions(fuelAverage),
      finalRecommendation,
    },
  };
}

function emptyWear() {
  return { start: null, end: null, delta: null, perLap: null };
}

function liftOptions(fuelPerLap: number | null): RacePrepReport["execution"]["liftCoastOptions"] {
  const option = (label: string, low: number, high: number, paceLoss: string, recommendation: string, risk: "low" | "medium" | "high" | "unknown") => {
    const consumption = fuelPerLap == null ? "--" : low === 0 ? `${fuelPerLap.toFixed(3)} L/lap` : `${(fuelPerLap * (1 - high / 100)).toFixed(3)}-${(fuelPerLap * (1 - low / 100)).toFixed(3)} L/lap`;
    return { label, targetSaving: low === 0 ? "0%" : `${low}-${high}%`, consumption, paceLoss, recommendation, risk };
  };
  return [
    option("Option A - No Fuel Saving", 0, 0, "none", "Use normal pace when fuel margin is comfortable.", "low"),
    option("Option B - Light Lift-And-Coast", 1, 2, "small", "Lift slightly before the heaviest braking zones when margin is tight.", "low"),
    option("Option C - Moderate Lift-And-Coast", 3, 5, "medium", "Use earlier lifts before selected braking zones if current consumption cannot complete the stint.", "medium"),
    option("Option D - Heavy Fuel Saving", 6, 8, "high", "Use only to avoid an extra stop or reach the finish with a shortage.", "high"),
  ];
}

function estimateTyreLife(wear: RacePrepReport["tyres"]["wear"], validLaps: number): number | null {
  const starts = wheels.map((wheel) => wear[wheel].start).filter((value): value is number => value != null);
  const ends = wheels.map((wheel) => wear[wheel].end).filter((value): value is number => value != null);
  const rates = wheels.map((wheel) => wear[wheel].perLap).filter((value): value is number => value != null && value > 0);
  if (!starts.length || !ends.length || !rates.length || validLaps < 2) return null;
  const startAvg = avg(starts);
  const endAvg = avg(ends);
  const rate = avg(rates);
  if (startAvg == null || endAvg == null || rate == null || rate <= 0) return null;
  if (endAvg >= startAvg) {
    const wearLimit = 0.75;
    return endAvg < wearLimit ? Math.max(0, (wearLimit - endAvg) / rate) : 0;
  }
  return Math.max(0, endAvg / rate);
}

function buildTyrePlan(
  fuelStops: number | null,
  raceLaps: number | null,
  averageRaceStintLaps: number | null,
  tyreLife: number | null,
  tyreSetsAvailable: number,
  frontRearBalance: number | null,
  leftRightBalance: number | null,
): {
  setsNeeded: number | null;
  setsShortage: number | null;
  summary: string;
  plan: RacePrepReport["execution"]["tyreChangePlan"];
} {
  if (fuelStops == null || raceLaps == null || averageRaceStintLaps == null) {
    return { setsNeeded: null, setsShortage: null, summary: "Tyre plan needs race distance and fuel stop data.", plan: [] };
  }
  const totalStints = fuelStops + 1;
  const needsFreshEveryStint = tyreLife != null && tyreLife > 0 && tyreLife < averageRaceStintLaps * 1.15;
  const tyreSetsNeeded = needsFreshEveryStint ? totalStints : Math.max(1, Math.ceil(raceLaps / Math.max(averageRaceStintLaps * 1.8, tyreLife || averageRaceStintLaps)));
  const setsShortage = Math.max(0, tyreSetsNeeded - tyreSetsAvailable);
  const fullSetChangesAvailable = Math.max(0, tyreSetsAvailable - 1);
  const fullSetChanges = Math.min(fuelStops, needsFreshEveryStint ? fullSetChangesAvailable : Math.min(fullSetChangesAvailable, Math.max(0, tyreSetsNeeded - 1)));
  const twoTyreUseful = fullSetChanges < fuelStops && (
    (frontRearBalance != null && Math.abs(frontRearBalance) > 0.02) ||
    (leftRightBalance != null && Math.abs(leftRightBalance) > 0.02)
  );
  const plan = Array.from({ length: fuelStops }, (_, index) => {
    const stop = index + 1;
    const lap = averageRaceStintLaps ? Math.round(averageRaceStintLaps * stop) : null;
    if (stop <= fullSetChanges) {
      return { stop, lap, tyresToChange: 4, action: "Change 4 tyres", reason: needsFreshEveryStint ? "Tyre life is close to or below planned stint length." : "Fresh set available within tyre allocation." };
    }
    if (twoTyreUseful) {
      const axle = frontRearBalance != null && Math.abs(frontRearBalance) >= Math.abs(leftRightBalance || 0)
        ? (frontRearBalance > 0 ? "rear" : "front")
        : (leftRightBalance != null && leftRightBalance > 0 ? "right side" : "left side");
      return { stop, lap, tyresToChange: 2, action: `Change 2 tyres on the ${axle}`, reason: "Full sets are limited and wear imbalance is visible." };
    }
    return { stop, lap, tyresToChange: 0, action: "Fuel only / keep tyres", reason: needsFreshEveryStint ? "Tyre sets are limited; manage pace and avoid sliding." : "Observed tyre life supports extending the set." };
  });
  const summary = setsShortage > 0
    ? `Tyre allocation is tight: estimated ${tyreSetsNeeded} full sets needed, ${tyreSetsAvailable} available. Plan tyre saving or partial changes.`
    : needsFreshEveryStint
      ? `Plan around ${fuelStops} fuel stops and change 4 tyres at each stop if the set budget allows.`
      : `Tyre wear supports extending sets; full tyre changes are optional unless balance or temperatures worsen.`;
  return { setsNeeded: tyreSetsNeeded, setsShortage, summary, plan };
}

function finalExecutionText(
  fuelStops: number | null,
  margin: number | null,
  savingRequired: number | null,
  low: number | null,
  high: number | null,
  tyreWarning: string | null,
  paceTrend: RacePrepReport["pace"]["trend"],
  tyrePlanSummary: string,
) {
  const pace = low != null && high != null ? `targeting ${formatSeconds(low)}-${formatSeconds(high)}` : "using a controlled representative pace";
  const stops = fuelStops == null
    ? "Fuel stop count cannot be confirmed yet."
    : fuelStops === 0
      ? "No pit stop is required on the current fuel model."
      : `Base fuel plan is ${fuelStops} stop${fuelStops === 1 ? "" : "s"}.`;
  const fuel = margin == null
    ? "Fuel margin cannot be confirmed yet."
    : margin >= 0
      ? `Fuel margin for that stop count is positive by ${margin.toFixed(2)} L.`
      : `Fuel is short by ${Math.abs(margin).toFixed(2)} L; target at least ${(savingRequired || 0).toFixed(1)}% saving.`;
  const trend = paceTrend === "degrading" ? "Avoid pushing aggressively late in the stint because lap times are degrading." : paceTrend === "improving" ? "The run improved over time, so build pace progressively." : "Lap pace is stable enough for a predictable race plan.";
  const tyrePlan = fuelStops === 0 ? "Keep the starting tyres unless wear or pressure behavior changes." : tyrePlanSummary;
  return `Run the race at controlled pace, ${pace}. ${stops} ${fuel} ${tyrePlan} ${tyreWarning || "No major tyre wear warning is available yet."} ${trend}`;
}

function formatSeconds(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}
