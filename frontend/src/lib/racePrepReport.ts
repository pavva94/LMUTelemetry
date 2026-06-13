import type { SavedSession, SessionReview } from "../types/session";
import { average, maximum, median as medianValue, minimum, splitTrend, standardDeviation as deviation, toFiniteNumber, validSessionLaps } from "./sessionAnalysis";

export type Row = Record<string, unknown>;
export type Wheel = "fl" | "fr" | "rl" | "rr";

export type StatSummary = {
  average: number | null;
  min: number | null;
  max: number | null;
  trend: "rising" | "falling" | "stable" | "unavailable";
};

export type ChartRow = Record<string, number | string | boolean | null>;

export type EngineeringFinding = {
  title: string;
  severity: "info" | "warning" | "critical";
  evidence: string;
  detail: string;
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
    topSpeed: number | null;
    totalDistanceKm: number | null;
    pitLaps: number;
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
  coverage: {
    sampleCount: number;
    lapCount: number;
    validLapRatio: number | null;
    channelGroups: string[];
    missingGroups: string[];
  };
  charts: {
    laps: ChartRow[];
    samples: ChartRow[];
    stints: ChartRow[];
    events: ChartRow[];
    pitStops: ChartRow[];
  };
  engineeringFindings: EngineeringFinding[];
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
const wheelDisplay: Record<Wheel, string> = { fl: "Front-left", fr: "Front-right", rl: "Rear-left", rr: "Rear-right" };

const num = toFiniteNumber;
const avg = average;
const median = medianValue;
const min = minimum;
const max = maximum;

function trend(values: number[], threshold: number): "rising" | "falling" | "stable" | "unavailable" {
  return splitTrend(values, threshold);
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

function numericRows(rows: Row[], keys: string[]) {
  return rows.some((row) => keys.some((key) => num(row[key]) != null));
}

function decimateRows<T>(rows: T[], limit = 650): T[] {
  if (rows.length <= limit) return rows;
  const step = Math.ceil(rows.length / limit);
  return rows.filter((_, index) => index % step === 0 || index === rows.length - 1);
}

function chartNumber(value: unknown): number | null {
  return num(value);
}

function chartWear(value: unknown): number | null {
  return tyreWearUsedFraction(num(value));
}

function buildCoverage(samples: Row[], laps: Row[]): RacePrepReport["coverage"] {
  const groups: Array<[string, string[]]> = [
    ["Pace", ["lap_time", "speed_kph", "top_speed"]],
    ["Driver inputs", ["throttle", "brake", "steering"]],
    ["Fuel", ["fuel_liters", "fuel_used", "fuel_start", "fuel_end"]],
    ["Tyres", ["tyre_wear_fl", "tyre_temp_fl", "tyre_pressure_fl", "tyre_wear_end_fl", "tyre_wear_delta"]],
    ["Brakes", ["brake_temp_fl", "brake_temp_fr", "brake_temp_rl", "brake_temp_rr"]],
    ["Platform", ["ride_height_fl", "ride_height_fr", "ride_height_rl", "ride_height_rr", "front_ride_height", "rear_ride_height"]],
    ["G-force", ["g_force_lat", "g_force_long", "g_force_vert"]],
    ["Environment", ["track_temp", "ambient_temp", "rain", "wetness"]],
  ];
  const source = [...samples, ...laps];
  const channelGroups = groups.filter(([, keys]) => numericRows(source, keys)).map(([label]) => label);
  const missingGroups = groups.filter(([label]) => !channelGroups.includes(label)).map(([label]) => label);
  const validLapCount = laps.filter((lap) => {
    const lapTime = num(lap.lap_time);
    const fuelAdded = num(lap.fuel_added) || 0;
    return lapTime != null && lapTime >= 40 && lapTime <= 900 && lap.valid_lap !== false && lap.in_pit !== true && fuelAdded <= 2;
  }).length;
  return {
    sampleCount: samples.length,
    lapCount: laps.length,
    validLapRatio: laps.length ? validLapCount / laps.length : null,
    channelGroups,
    missingGroups,
  };
}

function buildLapSeries(laps: Row[], bestLap: number | null): ChartRow[] {
  return laps.map((lap, index) => {
    const lapTime = chartNumber(lap.lap_time);
    const tyreWearDelta = avg(wheels.map((wheel) => chartNumber(lap[`tyre_wear_delta_${wheel}`]))) ?? chartNumber(lap.tyre_wear_delta);
    const valid = lap.valid_lap !== false && lap.in_pit !== true && lapTime != null;
    const row: ChartRow = {
      lap: chartNumber(lap.lap_number) ?? index + 1,
      lap_time: lapTime,
      delta: lapTime != null && bestLap != null ? lapTime - bestLap : null,
      fuel_used: chartNumber(lap.fuel_used),
      top_speed: chartNumber(lap.top_speed),
      tyre_wear_delta: tyreWearDelta,
      track_temp: chartNumber(lap.track_temp),
      ambient_temp: chartNumber(lap.ambient_temp),
      valid_lap: Boolean(valid),
      in_pit: lap.in_pit === true,
      invalid_marker: valid ? null : lapTime,
      pit_marker: lap.in_pit === true ? lapTime : null,
    };
    for (const wheel of wheels) {
      row[`tyre_wear_${wheel}`] = chartWear(lap[`tyre_wear_end_${wheel}`] ?? lap.tyre_wear_end);
      row[`tyre_temp_${wheel}`] = chartNumber(lap[`tyre_temp_${wheel}`]);
      row[`tyre_pressure_${wheel}`] = chartNumber(lap[`tyre_pressure_${wheel}`]);
      row[`brake_temp_${wheel}`] = chartNumber(lap[`brake_temp_${wheel}`]);
      row[`ride_height_${wheel}`] = chartNumber(lap[`ride_height_${wheel}`]);
    }
    return row;
  });
}

function buildSampleSeries(samples: Row[]): ChartRow[] {
  return decimateRows(samples).map((sample) => {
    const row: ChartRow = {
      game_time: rowTime(sample),
      speed_kph: chartNumber(sample.speed_kph),
      rpm: chartNumber(sample.rpm),
      throttle: chartNumber(sample.throttle),
      brake: chartNumber(sample.brake),
      steering: chartNumber(sample.steering),
      fuel_liters: chartNumber(sample.fuel_liters),
      g_force_lat: chartNumber(sample.g_force_lat),
      g_force_long: chartNumber(sample.g_force_long),
      g_force_vert: chartNumber(sample.g_force_vert),
      front_ride_height: chartNumber(sample.front_ride_height),
      rear_ride_height: chartNumber(sample.rear_ride_height),
      track_temp: chartNumber(sample.track_temp),
      ambient_temp: chartNumber(sample.ambient_temp),
    };
    for (const wheel of wheels) {
      row[`tyre_wear_${wheel}`] = chartWear(sample[`tyre_wear_${wheel}`]);
      row[`tyre_temp_${wheel}`] = chartNumber(sample[`tyre_temp_${wheel}`]);
      row[`tyre_pressure_${wheel}`] = chartNumber(sample[`tyre_pressure_${wheel}`]);
      row[`brake_temp_${wheel}`] = chartNumber(sample[`brake_temp_${wheel}`]);
      row[`ride_height_${wheel}`] = chartNumber(sample[`ride_height_${wheel}`]);
    }
    return row;
  });
}

function buildStintSeries(laps: Row[]): ChartRow[] {
  const stints: Row[][] = [];
  let current: Row[] = [];
  laps.forEach((lap) => {
    if (lap.in_pit === true) {
      if (current.length) {
        stints.push(current);
        current = [];
      }
      return;
    }
    current.push(lap);
  });
  if (current.length) stints.push(current);
  return stints.map((rows, index) => {
    const lapTimes = rows.map((lap) => chartNumber(lap.lap_time)).filter((value): value is number => value != null);
    const fuel = rows.map((lap) => chartNumber(lap.fuel_used)).filter((value): value is number => value != null && value > 0);
    const tyreWearDeltas = rows.map((lap) => avg(wheels.map((wheel) => chartNumber(lap[`tyre_wear_delta_${wheel}`]))) ?? chartNumber(lap.tyre_wear_delta)).filter((value): value is number => value != null);
    return {
      stint: index + 1,
      start_lap: chartNumber(rows[0]?.lap_number),
      end_lap: chartNumber(rows[rows.length - 1]?.lap_number),
      lap_count: rows.length,
      average_lap: avg(lapTimes),
      best_lap: min(lapTimes),
      fuel_per_lap: avg(fuel),
      tyre_wear_delta: tyreWearDeltas.length ? tyreWearDeltas.reduce((sum, value) => sum + Math.abs(value), 0) : null,
      top_speed: max(rows.map((lap) => chartNumber(lap.top_speed))),
    };
  });
}

function buildEventSeries(review: SessionReview): ChartRow[] {
  const pitEvents = (review.pit_events || []).map((event, index) => ({
    event_index: index + 1,
    lap: chartNumber(event.lap_number),
    timestamp: chartNumber(event.timestamp),
    type: String(event.type ?? "Pit"),
    message: String(event.message ?? event.phase ?? "Pit event"),
  }));
  const recommendations = (review.recommendations || []).map((event, index) => ({
    event_index: pitEvents.length + index + 1,
    lap: chartNumber(event.lap_number),
    timestamp: chartNumber(event.timestamp),
    type: String(event.recommendation_type ?? event.type ?? "Recommendation"),
    message: String(event.message ?? event.priority ?? "Recommendation"),
  }));
  return [...pitEvents, ...recommendations].sort((a, b) => (a.timestamp ?? a.lap ?? a.event_index) - (b.timestamp ?? b.lap ?? b.event_index));
}

function lapNumber(row: Row | undefined): number | null {
  return num(row?.lap_number);
}

function lapFuelEnd(row: Row | undefined): number | null {
  return num(row?.fuel_end) ?? num(row?.fuel_liters);
}

function lapFuelStart(row: Row | undefined): number | null {
  return num(row?.fuel_start) ?? num(row?.fuel_liters);
}

function lapWear(row: Row | undefined, wheel: Wheel, phase: "start" | "end"): number | null {
  const explicit = phase === "start" ? row?.[`tyre_wear_start_${wheel}`] : row?.[`tyre_wear_end_${wheel}`];
  return tyreWearUsedFraction(num(explicit) ?? num(row?.[`tyre_wear_${wheel}`]) ?? num(phase === "start" ? row?.tyre_wear_start : row?.tyre_wear_end));
}

function buildPitStopReport(review: SessionReview, laps: Row[]): ChartRow[] {
  const pitLaps = laps.filter((lap) => lap.in_pit === true || (num(lap.fuel_added) ?? 0) > 2);
  const eventRows = (review.pit_events || []).map((event) => ({
    event,
    lap: chartNumber(event.lap_number ?? event.lap),
    timestamp: chartNumber(event.timestamp),
  }));
  const sources = eventRows.length
    ? eventRows
    : pitLaps.map((lap) => ({ event: null, lap: lapNumber(lap), timestamp: chartNumber(lap.end_time ?? lap.start_time) }));

  return sources.map((source, index) => {
    const sourceLap = source.lap;
    const pitLap = sourceLap != null
      ? pitLaps.find((lap) => lapNumber(lap) === sourceLap) ?? laps.find((lap) => lapNumber(lap) === sourceLap)
      : pitLaps[index] ?? null;
    const pitLapNo = sourceLap ?? lapNumber(pitLap) ?? null;
    const before = [...laps].reverse().find((lap) => {
      const current = lapNumber(lap);
      return current != null && pitLapNo != null && current < pitLapNo && lap.in_pit !== true;
    });
    const after = laps.find((lap) => {
      const current = lapNumber(lap);
      return current != null && pitLapNo != null && current > pitLapNo && lap.in_pit !== true;
    });
    const event = source.event;
    const fuelBefore = lapFuelEnd(before) ?? lapFuelStart(pitLap);
    const fuelAfter = lapFuelStart(after) ?? lapFuelEnd(pitLap);
    const inferredFuelAdded = fuelBefore != null && fuelAfter != null && fuelAfter > fuelBefore ? fuelAfter - fuelBefore : null;
    const fuelAdded = chartNumber(event?.fuel_added ?? pitLap?.fuel_added) ?? inferredFuelAdded;
    const changed = wheels.filter((wheel) => {
      const beforeWear = lapWear(before, wheel, "end");
      const afterWear = lapWear(after, wheel, "start");
      return beforeWear != null && afterWear != null && afterWear + 0.01 < beforeWear;
    });
    const wearBefore = avg(wheels.map((wheel) => lapWear(before, wheel, "end")));
    const wearAfter = avg(wheels.map((wheel) => lapWear(after, wheel, "start")));
    return {
      stop: index + 1,
      lap: pitLapNo,
      timestamp: source.timestamp,
      type: String(event?.type ?? "Pit stop"),
      message: String(event?.message ?? event?.phase ?? (pitLap ? "Pit lap detected" : "Pit event")),
      fuel_before: fuelBefore,
      fuel_after: fuelAfter,
      fuel_added: fuelAdded,
      tyres_changed: changed.length ? changed.map((wheel) => wheel.toUpperCase()).join(", ") : wearBefore != null && wearAfter != null ? "None detected" : "Not available",
      tyre_wear_before: wearBefore,
      tyre_wear_after: wearAfter,
    };
  });
}

function fmt(value: number | null, digits = 1, suffix = "") {
  return value == null || !Number.isFinite(value) ? "--" : `${value.toFixed(digits)}${suffix}`;
}

function brakeAverages(samples: Row[], laps: Row[]) {
  return wheels.map((wheel) => averageFromRows(samples, `brake_temp_${wheel}`) ?? averageFromRows(laps, `brake_temp_${wheel}`));
}

function stintDegradation(stints: ChartRow[]): number | null {
  if (stints.length < 2) return null;
  const first = num(stints[0].average_lap);
  const last = num(stints[stints.length - 1].average_lap);
  return first != null && last != null ? last - first : null;
}

function buildEngineeringFindings(input: {
  sessionType: string | null | undefined;
  paceTrend: RacePrepReport["pace"]["trend"];
  consistency: RacePrepReport["pace"]["consistency"];
  fuelValues: number[];
  fuelStops: number | null;
  fuelMargin: number | null;
  fuelSavingRequiredPercent: number | null;
  pitEventCount: number;
  frontRearBalance: number | null;
  leftRightBalance: number | null;
  hottestTyre: Wheel | null;
  coldestTyre: Wheel | null;
  brakeTemps: Array<number | null>;
  coverage: RacePrepReport["coverage"];
  stints: ChartRow[];
  tyreWarning: string | null;
  tyrePlanSummary: string;
}): EngineeringFinding[] {
  const findings: EngineeringFinding[] = [];
  const isRace = String(input.sessionType || "").toLowerCase().includes("race");
  if (isRace) {
    const expectedStops = input.fuelStops;
    const actualStops = input.pitEventCount;
    const stopDelta = expectedStops != null ? actualStops - expectedStops : null;
    findings.push({
      title: "Race strategy review",
      severity: stopDelta == null ? "info" : Math.abs(stopDelta) >= 1 || (input.fuelMargin != null && input.fuelMargin < 0) ? "warning" : "info",
      evidence: expectedStops == null ? `${actualStops} pit events; fuel model incomplete` : `${actualStops} pit events; model suggests ${expectedStops} fuel stop${expectedStops === 1 ? "" : "s"}`,
      detail: stopDelta == null
        ? "Fuel strategy cannot be audited until tank capacity and fuel consumption are both available."
        : input.fuelMargin != null && input.fuelMargin < 0
          ? `The current model shows a fuel shortage. Consider an extra stop, a longer fill, or at least ${fmt(input.fuelSavingRequiredPercent, 1, "%")} lift-and-coast.`
          : stopDelta > 0
            ? "The race used more stops than the fuel model suggests. Review whether traffic, tyre loss, damage, or safety-car timing justified the extra stop."
            : stopDelta < 0
              ? "The race used fewer stops than the model suggests. Keep this strategy only if the fuel margin and tyre degradation graphs support the longer stint."
              : "Observed stop count matches the fuel model; strategy changes should come from tyre degradation, traffic, or pace loss rather than fuel count.",
    });
  } else {
    findings.push({
      title: "Session purpose",
      severity: "info",
      evidence: `${input.sessionType || "Non-race session"} telemetry`,
      detail: "Treat this as a setup and run-quality report. Race strategy suggestions are limited because no completed race context is present.",
    });
  }

  findings.push({
    title: "Pace profile",
    severity: input.paceTrend === "degrading" || input.consistency === "low" ? "warning" : "info",
    evidence: `Trend ${input.paceTrend}; consistency ${input.consistency}`,
    detail: input.paceTrend === "degrading"
      ? "Lap times got slower across the run, so compare late-stint tyres, fuel saving, and traffic before using the average pace as the target."
      : input.paceTrend === "improving"
        ? "Lap times improved across the run, which suggests the best reference pace may be late-run rather than whole-session average."
        : "Pace is stable enough to use the median and average as useful references.",
  });

  const fuelMin = min(input.fuelValues);
  const fuelMax = max(input.fuelValues);
  const fuelSpread = fuelMin != null && fuelMax != null ? fuelMax - fuelMin : null;
  findings.push({
    title: "Fuel variability",
    severity: fuelSpread != null && fuelSpread > 0.25 ? "warning" : "info",
    evidence: fuelSpread == null ? "Fuel per lap unavailable" : `Spread ${fmt(fuelSpread, 3, " L/lap")}`,
    detail: fuelSpread != null && fuelSpread > 0.25
      ? "Fuel use moved enough to affect stint planning. Check throttle time, traffic, lift-and-coast, and push laps."
      : "Fuel use is consistent enough for the current race estimate.",
  });

  const axleBalance = input.frontRearBalance;
  const sideBalance = input.leftRightBalance;
  findings.push({
    title: "Tyre wear balance",
    severity: (Math.abs(axleBalance ?? 0) > 0.02 || Math.abs(sideBalance ?? 0) > 0.02) ? "warning" : "info",
    evidence: `F/R ${fmt(axleBalance, 4)}; R/L ${fmt(sideBalance, 4)}`,
    detail: Math.abs(axleBalance ?? 0) > Math.abs(sideBalance ?? 0)
      ? (axleBalance != null && axleBalance > 0 ? "Rear wear is leading front wear." : "Front wear is leading rear wear.")
      : Math.abs(sideBalance ?? 0) > 0.02
        ? (sideBalance != null && sideBalance > 0 ? "Right-side wear is leading left-side wear." : "Left-side wear is leading right-side wear.")
        : "Wear is broadly balanced across the car.",
  });

  const setupDetails: string[] = [];
  if (axleBalance != null && Math.abs(axleBalance) > 0.02) setupDetails.push(axleBalance > 0 ? "rear wear is leading, so check rear traction, differential exit behavior, and rear pressures" : "front wear is leading, so check entry understeer, brake migration, and front pressures");
  if (sideBalance != null && Math.abs(sideBalance) > 0.02) setupDetails.push(sideBalance > 0 ? "right-side wear is leading, so verify track loading and right-side pressure growth" : "left-side wear is leading, so verify track loading and left-side pressure growth");
  const cleanBrakeTemps = input.brakeTemps.filter((value): value is number => value != null);
  const brakeSpread = cleanBrakeTemps.length >= 2 ? Math.max(...cleanBrakeTemps) - Math.min(...cleanBrakeTemps) : null;
  if (brakeSpread != null && brakeSpread > 80) setupDetails.push("brake temperature spread is high, so review bias, ducting, lockups, and track-side loading");
  if (input.coverage.channelGroups.includes("Platform")) setupDetails.push("use ride-height traces to confirm platform stability before changing springs, ARBs, or packers");
  if (setupDetails.length) {
    findings.push({
      title: "Setup change candidates",
      severity: setupDetails.length > 1 ? "warning" : "info",
      evidence: setupDetails.slice(0, 2).join("; "),
      detail: input.tyreWarning || "Prioritize the largest repeatable tyre/brake/platform imbalance before changing the baseline setup.",
    });
  }

  if (input.hottestTyre || input.coldestTyre) {
    findings.push({
      title: "Tyre temperature split",
      severity: "info",
      evidence: `Hottest ${input.hottestTyre ? wheelDisplay[input.hottestTyre] : "--"}; coldest ${input.coldestTyre ? wheelDisplay[input.coldestTyre] : "--"}`,
      detail: "Use the tyre temperature graph to see whether the split is persistent or only a short phase of the run.",
    });
  }

  if (cleanBrakeTemps.length >= 2) {
    findings.push({
      title: "Brake temperature spread",
      severity: (brakeSpread ?? 0) > 80 ? "warning" : "info",
      evidence: `Spread ${fmt(brakeSpread, 0, " C")}`,
      detail: (brakeSpread ?? 0) > 80
        ? "Brake temperatures are uneven enough to justify checking lockups, bias, ducting, and track-side loading."
        : "Brake temperatures are not showing a large corner-to-corner split.",
    });
  } else {
    findings.push({
      title: "Brake data coverage",
      severity: "info",
      evidence: "Brake temperature channels unavailable",
      detail: "Brake graphs stay hidden until the selected session includes brake temperature channels.",
    });
  }

  findings.push({
    title: "Platform data coverage",
    severity: input.coverage.channelGroups.includes("Platform") ? "info" : "warning",
    evidence: input.coverage.channelGroups.includes("Platform") ? "Ride-height channels available" : "Ride-height channels unavailable",
    detail: input.coverage.channelGroups.includes("Platform")
      ? "Ride-height graphs can be used to connect platform movement to speed, braking, and tyre behavior."
      : "Platform analysis needs ride-height channels in the selected recording.",
  });

  const stintDelta = stintDegradation(input.stints);
  if (stintDelta != null) {
    findings.push({
      title: "Stint degradation",
      severity: stintDelta > 0.5 ? "warning" : "info",
      evidence: `Last stint average ${stintDelta >= 0 ? "+" : ""}${fmt(stintDelta, 3, " s")} vs first stint`,
      detail: stintDelta > 0.5 ? "Later stints are slower on average. Compare fuel load, tyres, and traffic before changing the baseline pace." : "Stint averages are close enough that there is no major stint-to-stint pace drop.",
    });
  }

  if (isRace && input.tyrePlanSummary) {
    findings.push({
      title: "Tyre strategy",
      severity: input.tyrePlanSummary.toLowerCase().includes("tight") ? "warning" : "info",
      evidence: input.tyrePlanSummary,
      detail: "Use the stint and tyre graphs to decide whether the next race should change tyres earlier, run partial changes, or extend the set.",
    });
  }

  if (input.coverage.missingGroups.length) {
    findings.push({
      title: "Missing channel groups",
      severity: "info",
      evidence: input.coverage.missingGroups.join(", "),
      detail: "Unavailable groups are intentionally shown as empty states so the report does not invent engineering conclusions.",
    });
  }
  return findings;
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
  const values = samples.map((sample) => num(sample[key])).filter((value): value is number => validTyreChannelValue(key, value));
  return { average: avg(values), min: min(values), max: max(values), trend: trend(values, key.includes("pressure") ? 0.03 : 1.0) };
}

function statForRows(rows: Row[], key: string, aggregateAverage?: number | null): StatSummary {
  const values = rows.map((row) => num(row[key])).filter((value): value is number => validTyreChannelValue(key, value));
  if (values.length) {
    return { average: avg(values), min: min(values), max: max(values), trend: trend(values, key.includes("pressure") ? 0.03 : 1.0) };
  }
  return { average: aggregateAverage ?? null, min: aggregateAverage ?? null, max: aggregateAverage ?? null, trend: "unavailable" };
}

function tyreWearUsedFraction(value: number | null): number | null {
  if (value == null) return null;
  if (value >= 0 && value <= 1) return value;
  if (value > 1 && value <= 100) return 1 - value / 100;
  return null;
}

function firstLastWithValue(samples: Row[], key: string, lapRows: Row[] = []): [number | null, number | null] {
  const values = samples
    .filter((sample) => isUsableTyreSample(sample, key))
    .map((sample) => num(sample[key]))
    .map((value) => key.includes("wear") ? tyreWearUsedFraction(value) : value)
    .filter((value): value is number => validTyreChannelValue(key, value));
  if (!values.length && key.includes("tyre_wear_")) {
    const wheel = key.replace("tyre_wear_", "");
    const starts = lapRows
      .map((lap) => num(lap[`tyre_wear_start_${wheel}`]) ?? num(lap.tyre_wear_start))
      .map(tyreWearUsedFraction)
      .filter((value): value is number => validTyreChannelValue(key, value));
    const ends = lapRows
      .map((lap) => num(lap[`tyre_wear_end_${wheel}`]) ?? num(lap.tyre_wear_end))
      .map(tyreWearUsedFraction)
      .filter((value): value is number => validTyreChannelValue(key, value));
    if (starts.length || ends.length) return [starts[0] ?? null, ends[ends.length - 1] ?? null];
  }
  return [values[0] ?? null, values[values.length - 1] ?? null];
}

function validTyreChannelValue(key: string, value: number | null): value is number {
  if (value == null) return false;
  if (key.includes("pressure") || key.includes("temp")) return value > 0;
  if (key.includes("wear")) return value >= 0 && value <= 1;
  return true;
}

function isUsableTyreSample(sample: Row, key: string): boolean {
  if (!key.includes("wear")) return true;
  const wearValues = wheels.map((wheel) => num(sample[`tyre_wear_${wheel}`]));
  const hasNonZeroWear = wearValues.some((value) => value != null && value > 0);
  if (hasNonZeroWear) return true;
  const hasSupportingTyreData = wheels.some((wheel) => {
    const pressure = num(sample[`tyre_pressure_${wheel}`]);
    const temp = num(sample[`tyre_temp_${wheel}`]);
    return (pressure != null && pressure > 0) || (temp != null && temp > 0);
  });
  return hasSupportingTyreData;
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

function averageFromRows(rows: Row[], key: string, fallback?: number | null): number | null {
  return avg(rows.map((row) => num(row[key]))) ?? fallback ?? null;
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
  const cleanLaps = validSessionLaps(review);
  const lapTimes = cleanLaps.map((lap) => num(lap.lap_time)).filter((value): value is number => value != null);
  const averageLap = avg(lapTimes);
  const medianLap = median(lapTimes);
  const bestLap = min(lapTimes);
  const worstLap = max(lapTimes);
  const bestLapRow = cleanLaps.find((lap) => num(lap.lap_time) === bestLap);
  const bestLapNumber = num(bestLapRow?.lap_number);
  const spread = bestLap != null && worstLap != null ? worstLap - bestLap : null;
  const standardDeviation = deviation(lapTimes, averageLap);
  const consistency = standardDeviation == null || medianLap == null ? "unknown" : standardDeviation <= 0.35 ? "high" : standardDeviation <= 0.9 ? "medium" : "low";
  const deltas = cleanLaps
    .map((lap) => ({ lap: num(lap.lap_number), lapTime: num(lap.lap_time), delta: bestLap != null && num(lap.lap_time) != null ? num(lap.lap_time)! - bestLap : null }))
    .filter((lap): lap is { lap: number | null; lapTime: number; delta: number } => lap.lapTime != null && lap.delta != null);

  const session = review.session;
  const summary = review.summary;
  const ambientTemp = averageFromRows(samples, "ambient_temp") ?? averageFromRows(allLaps, "ambient_temp");
  const trackTemp = averageFromRows(samples, "track_temp") ?? averageFromRows(allLaps, "track_temp");

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
    const [start, end] = firstLastWithValue(samples, `tyre_wear_${wheel}`, allLaps);
    const lapDeltas = allLaps
      .map((lap) => num(lap[`tyre_wear_delta_${wheel}`]) ?? num(lap.tyre_wear_delta))
      .filter((value): value is number => value != null && value >= 0 && value <= 1);
    const delta = lapDeltas.length ? lapDeltas.reduce((sum, value) => sum + Math.abs(value), 0) : start != null && end != null ? Math.abs(end - start) : null;
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

  const temperature = Object.fromEntries(wheels.map((wheel) => [wheel, samples.length ? statFor(samples, `tyre_temp_${wheel}`) : statForRows(allLaps, `tyre_temp_${wheel}`, num(summary?.average_tyre_temp))])) as Record<Wheel, StatSummary>;
  const pressure = Object.fromEntries(wheels.map((wheel) => [wheel, samples.length ? statFor(samples, `tyre_pressure_${wheel}`) : statForRows(allLaps, `tyre_pressure_${wheel}`, num(summary?.average_tyre_pressure))])) as Record<Wheel, StatSummary>;
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
  const coverage = buildCoverage(samples, allLaps);
  const charts = {
    laps: buildLapSeries(allLaps, bestLap),
    samples: buildSampleSeries(samples),
    stints: buildStintSeries(allLaps),
    events: buildEventSeries(review),
    pitStops: buildPitStopReport(review, allLaps),
  };
  const engineeringFindings = buildEngineeringFindings({
    sessionType: session?.session_type,
    paceTrend: lapTrend(lapTimes),
    consistency,
    fuelValues,
    fuelStops,
    fuelMargin,
    fuelSavingRequiredPercent: savingRequired,
    pitEventCount: review.pit_events?.length || 0,
    frontRearBalance,
    leftRightBalance,
    hottestTyre: bestWheel(tempAverages, Math.max),
    coldestTyre: bestWheel(tempAverages, Math.min),
    brakeTemps: brakeAverages(samples, allLaps),
    coverage,
    stints: charts.stints,
    tyreWarning,
    tyrePlanSummary: tyrePlan.summary,
  });

  return {
    session: {
      track: session?.track_name ?? null,
      car: session?.vehicle_model ?? session?.vehicle_name ?? null,
      sessionType: session?.session_type ?? null,
      dateTime: session?.created_at ?? null,
      duration: latestSessionDuration(session, samples, allLaps),
      totalLaps: allLaps.length,
      validLaps: cleanLaps.length,
      ambientTemp,
      trackTemp,
      topSpeed: max([...samples.map((sample) => num(sample.speed_kph)), ...allLaps.map((lap) => num(lap.top_speed)), num(summary?.top_speed)]),
      totalDistanceKm: num(summary?.total_distance_km),
      pitLaps: allLaps.filter((lap) => lap.in_pit === true).length,
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
    coverage,
    charts,
    engineeringFindings,
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
