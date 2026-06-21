import { describe, expect, it } from "vitest";
import { simulateStrategies, stopServiceTime, type StrategySimulationInput } from "./strategySimulation";

const baseInput: StrategySimulationInput = {
  raceDurationMinutes: 60,
  normalLapTime: 120,
  paceEvidence: { weightedRecentPace: 120, sampleLaps: 10, confidence: "high", source: "test session" },
  fuelPerLap: 2.5,
  fuelObservedLaps: 10,
  fuelRequiredLaps: 3,
  fuelUseStdDevLiters: 0.05,
  fuelConfidence: "high",
  tankCapacityLiters: 60,
  raceStartNewTyres: true,
  fuelSafetyMarginLiters: 2,
  safetyPolicy: "balanced",
  pitLaneLossSeconds: 28,
  baseStationarySeconds: 2,
  tyreChangeSecondsPerTyre: 3,
  refuelSecondsPer5Liters: 1.2,
  serviceModel: "sequential",
  currentTyreWear: 0,
  currentTyreWearByWheel: { fl: 0, fr: 0, rl: 0, rr: 0 },
  tyreWearRatePerLap: 0.01,
  tyreWearRateByWheel: { fl: 0.012, fr: 0.011, rl: 0.009, rr: 0.01 },
  tyreConfidence: "high",
  maxTyreWear: 0.75,
};

describe("strategy simulation", () => {
  it("uses continuous fuel-loading time and sequential service", () => {
    expect(stopServiceTime({ pitLaneLossSeconds: 28, baseStationarySeconds: 2, tyresChanged: 4, tyreChangeSecondsPerTyre: 3, fuelAddedLiters: 21, refuelSecondsPer5Liters: 2 })).toBeCloseTo(50.4, 3);
  });

  it("supports parallel tyre and fuel service", () => {
    expect(stopServiceTime({ pitLaneLossSeconds: 28, baseStationarySeconds: 2, tyresChanged: 4, tyreChangeSecondsPerTyre: 3, fuelAddedLiters: 50, refuelSecondsPer5Liters: 2, serviceModel: "parallel" })).toBe(50);
  });

  it("calculates start fuel instead of accepting a user guess", () => {
    const lowGuess = simulateStrategies({ ...baseInput, raceStartFuelLiters: 1, maxStops: 1 });
    const highGuess = simulateStrategies({ ...baseInput, raceStartFuelLiters: 60, maxStops: 1 });
    expect(lowGuess[0].recommendedStartFuelLiters).toBe(highGuess[0].recommendedStartFuelLiters);
    expect(lowGuess[0].recommendedStartFuelLiters).toBeLessThanOrEqual(baseInput.tankCapacityLiters!);
  });

  it("keeps every fuel load within tank capacity and never goes negative", () => {
    const plans = simulateStrategies({ ...baseInput, raceDurationMinutes: 180 });
    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) {
      expect(plan.recommendedStartFuelLiters).toBeLessThanOrEqual(baseInput.tankCapacityLiters!);
      expect(plan.finishFuelRemainingLiters).toBeGreaterThanOrEqual(baseInput.fuelSafetyMarginLiters);
      plan.stopsDetail.forEach((stop) => {
        expect(stop.fuelRemainingLiters).toBeGreaterThanOrEqual(0);
        expect(stop.fuelOnExitLiters).toBeLessThanOrEqual(baseInput.tankCapacityLiters!);
      });
    }
  });

  it("uses elapsed time so pit stops can reduce completed laps", () => {
    const noStop = simulateStrategies({ ...baseInput, fuelPerLap: 0.5, tankCapacityLiters: 100, maxStops: 0 })[0];
    const stopped = simulateStrategies({ ...baseInput, fuelPerLap: 0.5, tankCapacityLiters: 100, maxStops: 1 }).find((plan) => plan.stops === 1);
    expect(stopped).toBeDefined();
    expect(stopped!.raceLaps).toBeLessThanOrEqual(noStop.raceLaps);
    expect(stopped!.calculationBreakdown.pitTimeSeconds).toBeGreaterThan(0);
  });

  it("finishes the lap that crosses the duration target", () => {
    const plan = simulateStrategies({ ...baseInput, raceDurationMinutes: 10.1, fuelPerLap: 0.5, tankCapacityLiters: 100, maxStops: 0 })[0];
    expect(plan.raceLaps).toBe(6);
    expect(plan.totalTimeSeconds).toBeGreaterThanOrEqual(10.1 * 60);
  });

  it("produces distinct ranked strategy categories", () => {
    const plans = simulateStrategies({ ...baseInput, raceDurationMinutes: 120 });
    expect(plans[0].category).toBe("fastest");
    expect(new Set(plans.map((plan) => plan.id)).size).toBe(plans.length);
    expect(plans.length).toBeGreaterThanOrEqual(3);
  });

  it("offers fuel saving only when it changes feasibility", () => {
    const plan = simulateStrategies({ ...baseInput, raceDurationMinutes: 35, tankCapacityLiters: 45, maxStops: 0 })[0];
    expect(plan.liftCoastSavePercent).toBeGreaterThan(0);
    expect(plan.liftCoastSavePercent).toBeLessThanOrEqual(8);
    expect(plan.warnings.join(" ")).toContain("pace cost unavailable");
  });

  it("marks never-change tyre threshold violations as high risk", () => {
    const plan = simulateStrategies({ ...baseInput, raceDurationMinutes: 12, raceStartNewTyres: false, currentTyreWear: 0.65, currentTyreWearByWheel: { fl: 0.65, fr: 0.65, rl: 0.65, rr: 0.65 }, tyreWearRatePerLap: 0.02, tyreWearRateByWheel: {}, tyreChangePolicy: "never", maxStops: 0 })[0];
    expect(plan.risk).toBe("high");
    expect(plan.projectedTyreWear).toBeGreaterThan(baseInput.maxTyreWear);
  });

  it("starts wear at zero for a new tyre set", () => {
    const plan = simulateStrategies({ ...baseInput, raceDurationMinutes: 12, raceStartNewTyres: true, currentTyreWear: 0.65, maxStops: 0 })[0];
    expect(plan.stintWear[0].startWear).toEqual({ fl: 0, fr: 0, rl: 0, rr: 0 });
  });

  it("changes only corners that would cross the next-stint threshold", () => {
    const plans = simulateStrategies({ ...baseInput, raceDurationMinutes: 60, fuelPerLap: 1, tankCapacityLiters: 40, raceStartNewTyres: false, currentTyreWear: 0.2, currentTyreWearByWheel: { fl: 0.2, fr: 0.2, rl: 0.2, rr: 0.55 }, tyreWearRatePerLap: 0.01, tyreWearRateByWheel: { fl: 0.01, fr: 0.01, rl: 0.01, rr: 0.015 }, maxTyreWear: 0.8, maxStops: 2 });
    const call = plans.flatMap((plan) => plan.stopsDetail).find((stop) => stop.tyresToChange.length);
    expect(call).toBeDefined();
    expect(call!.tyresToChange).toContain("rr");
    expect(call!.tyresToChange).not.toContain("rl");
    expect(call!.reason).toContain("permitted wear");
  });

  it("reports tyre degradation as unavailable when no measured slope exists", () => {
    const plan = simulateStrategies({ ...baseInput, tyrePaceDegradationPerLap: null })[0];
    expect(plan.tyreDegradationLossSeconds).toBeNull();
    expect(plan.warnings.join(" ")).toContain("Insufficient tyre degradation data");
  });

  it("applies a measured degradation slope when supplied", () => {
    const plan = simulateStrategies({ ...baseInput, tyrePaceDegradationPerLap: 0.1 })[0];
    expect(plan.tyreDegradationLossSeconds).not.toBeNull();
    expect(plan.tyreDegradationLossSeconds!).toBeGreaterThan(0);
  });

  it("makes conservative fuel policy no less conservative than aggressive", () => {
    const aggressive = simulateStrategies({ ...baseInput, safetyPolicy: "aggressive" })[0];
    const conservative = simulateStrategies({ ...baseInput, safetyPolicy: "conservative" })[0];
    expect(conservative.recommendedStartFuelLiters).toBeGreaterThanOrEqual(aggressive.recommendedStartFuelLiters);
    expect(conservative.finishFuelRemainingLiters).toBeGreaterThanOrEqual(aggressive.finishFuelRemainingLiters);
  });

  it("exposes a calculation breakdown that reconciles to elapsed time", () => {
    const plan = simulateStrategies({ ...baseInput, paceEvidence: { ...baseInput.paceEvidence, paceTrendSecondsPerLap: 0.02 }, tyrePaceDegradationPerLap: 0.05, trafficPenaltySeconds: 3 })[0];
    const breakdown = plan.calculationBreakdown;
    const sum = breakdown.baseRaceTimeSeconds + breakdown.pitLaneTimeSeconds + breakdown.stationaryServiceTimeSeconds + breakdown.projectedPaceLossSeconds + (breakdown.tyreDegradationLossSeconds ?? 0) + (breakdown.liftCoastLossSeconds ?? 0) + breakdown.trafficLossSeconds;
    expect(breakdown.totalTimeSeconds).toBeCloseTo(sum, 1);
  });
});
