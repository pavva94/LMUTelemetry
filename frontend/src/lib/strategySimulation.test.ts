import { describe, expect, it } from "vitest";
import { explainNoViableStrategies, simulateStrategies, stopServiceTime, type StrategySimulationInput } from "./strategySimulation";

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
  it("uses continuous fuel-loading time and sequential service without a fixed stationary overhead", () => {
    expect(stopServiceTime({ pitLaneLossSeconds: 28, tyresChanged: 4, tyreChangeSecondsPerTyre: 3, fuelAddedLiters: 21, refuelSecondsPer5Liters: 2 })).toBeCloseTo(48.4, 3);
  });

  it("supports parallel tyre and fuel service", () => {
    expect(stopServiceTime({ pitLaneLossSeconds: 28, tyresChanged: 4, tyreChangeSecondsPerTyre: 3, fuelAddedLiters: 50, refuelSecondsPer5Liters: 2, serviceModel: "parallel" })).toBe(48);
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

  it("uses current virtual energy for the first stop and ratio-limits future fuel loads", () => {
    const plans = simulateStrategies({
      ...baseInput,
      raceDurationMinutes: 90,
      tankCapacityLiters: 100,
      currentFuelLiters: 42,
      currentVirtualEnergyFraction: 0.5,
      virtualEnergyPerLap: 0.03,
      fuelToVirtualEnergyRatio: 0.85,
    });
    expect(plans.length).toBeGreaterThan(0);
    plans.forEach((plan) => {
      expect(plan.stopsDetail[0].lap).toBeLessThanOrEqual(16);
      plan.stopsDetail.forEach((stop) => {
        expect(stop.fuelOnExitLiters).toBeLessThanOrEqual(85);
        expect(stop.virtualEnergyOnExit).toBe(1);
        expect(stop.virtualEnergyRemaining).toBeGreaterThanOrEqual(0);
      });
      expect(plan.finishVirtualEnergy).toBeGreaterThanOrEqual(0);
    });
  });

  it("evaluates latest-feasible pit layouts alongside balanced stints", () => {
    const plans = simulateStrategies({ ...baseInput, raceDurationMinutes: 180 });
    const late = plans.find((plan) => plan.reasons.some((reason) => reason.includes("latest fuel-feasible")));
    expect(late).toBeDefined();
    expect(late!.stopsDetail[0].lap).toBeGreaterThanOrEqual(Math.floor(late!.raceLaps / (late!.stops + 1)));
    expect(late!.reasons.join(" ")).toContain("latest fuel-feasible");
  });

  it("uses elapsed time so pit stops can reduce completed laps", () => {
    const stopped = simulateStrategies({ ...baseInput, fuelPerLap: 1, tankCapacityLiters: 20, maxStops: 1 }).find((plan) => plan.stops === 1);
    expect(stopped).toBeDefined();
    expect(stopped!.raceLaps).toBeLessThanOrEqual(30);
    expect(stopped!.calculationBreakdown.pitTimeSeconds).toBeGreaterThan(0);
  });

  it("charges the pit-lane driving loss once for every stop", () => {
    const plans = simulateStrategies({ ...baseInput, raceDurationMinutes: 120, maxStops: 5 });
    plans.forEach((plan) => {
      expect(plan.calculationBreakdown.pitLaneTimeSeconds).toBe(plan.stops * baseInput.pitLaneLossSeconds);
    });
  });

  it("reports the scheduled race time remaining at every pit entry", () => {
    const plan = simulateStrategies({ ...baseInput, raceDurationMinutes: 180 })[0];
    expect(plan.stopsDetail.length).toBeGreaterThan(1);
    plan.stopsDetail.forEach((stop, index) => {
      expect(stop.raceElapsedAtPitSeconds + stop.raceTimeRemainingAtPitSeconds).toBeCloseTo(180 * 60, 1);
      expect(stop.raceTimeRemainingAtPitSeconds).toBeGreaterThan(0);
      if (index > 0) expect(stop.raceTimeRemainingAtPitSeconds).toBeLessThan(plan.stopsDetail[index - 1].raceTimeRemainingAtPitSeconds);
    });
  });

  it("does not reset tyre degradation when no tyres are changed", () => {
    const degradation = 0.1;
    const plans = simulateStrategies({ ...baseInput, raceDurationMinutes: 60, fuelPerLap: 0.5, tankCapacityLiters: 100, tyreChangePolicy: "never", tyrePaceDegradationPerLap: degradation, maxStops: 3 });
    plans.forEach((plan) => {
      const expected = degradation * plan.raceLaps * (plan.raceLaps - 1) / 2;
      expect(plan.tyreDegradationLossSeconds).toBeCloseTo(expected, 2);
    });
  });

  it("finishes the lap that crosses the duration target", () => {
    const plan = simulateStrategies({ ...baseInput, raceDurationMinutes: 10.1, fuelPerLap: 0.5, tankCapacityLiters: 100, maxStops: 0 })[0];
    expect(plan.raceLaps).toBe(6);
    expect(plan.totalTimeSeconds).toBeGreaterThanOrEqual(10.1 * 60);
  });

  it("never returns a strategy that ends before the race-duration target", () => {
    const durationMinutes = 180;
    const plans = simulateStrategies({ ...baseInput, raceDurationMinutes: durationMinutes });
    expect(plans.length).toBeGreaterThanOrEqual(4);
    plans.forEach((plan) => {
      expect(plan.totalTimeSeconds).toBeGreaterThanOrEqual(durationMinutes * 60);
      expect(plan.calculationBreakdown.timeRemainingSeconds).toBeLessThanOrEqual(0);
    });
  });

  it("does not extrapolate a short recent pace trend across an endurance race", () => {
    const durationMinutes = 360;
    const nominalLaps = Math.ceil(durationMinutes * 60 / 94);
    const plan = simulateStrategies({
      ...baseInput,
      raceDurationMinutes: durationMinutes,
      normalLapTime: 94,
      paceEvidence: {
        weightedRecentPace: 94,
        paceTrendSecondsPerLap: 0.8,
        sampleLaps: 10,
        confidence: "high",
        source: "test session",
      },
      fuelPerLap: 2,
      tankCapacityLiters: 100,
      tyreWearRatePerLap: null,
      tyreWearRateByWheel: {},
      maxStops: 8,
    })[0];

    expect(plan).toBeDefined();
    expect(plan.raceLaps).toBeGreaterThan(nominalLaps - 30);
    expect(plan.raceLaps).toBeLessThanOrEqual(nominalLaps);
    expect(plan.totalTimeSeconds).toBeGreaterThanOrEqual(durationMinutes * 60);
  });

  it("projects auditable start, average, and end pace for every stint", () => {
    const plan = simulateStrategies({
      ...baseInput,
      raceDurationMinutes: 60,
      tyrePaceDegradationPerLap: 0.08,
      paceEvidence: { ...baseInput.paceEvidence, paceTrendSecondsPerLap: 0.12 },
    })[0];

    expect(plan.stintPace).toHaveLength(plan.stops + 1);
    expect(plan.stintPace.reduce((sum, stint) => sum + stint.drivingTimeSeconds, 0)).toBeCloseTo(
      plan.baseRaceTimeSeconds + plan.projectedPaceLossSeconds + (plan.tyreDegradationLossSeconds ?? 0),
      1,
    );
    plan.stintPace.forEach((stint) => {
      expect(stint.averagePaceSeconds).toBeGreaterThanOrEqual(Math.min(stint.startPaceSeconds, stint.endPaceSeconds));
      expect(stint.averagePaceSeconds).toBeLessThanOrEqual(Math.max(stint.startPaceSeconds, stint.endPaceSeconds));
    });
  });

  it("weights recent pace trend by evidence confidence", () => {
    const high = simulateStrategies({ ...baseInput, paceEvidence: { ...baseInput.paceEvidence, paceTrendSecondsPerLap: 0.5, confidence: "high" }, maxStops: 1 })[0];
    const low = simulateStrategies({ ...baseInput, paceEvidence: { ...baseInput.paceEvidence, paceTrendSecondsPerLap: 0.5, confidence: "low" }, maxStops: 1 })[0];
    expect(high.projectedPaceLossSeconds).toBeGreaterThan(low.projectedPaceLossSeconds);
  });

  it("matches the observed 41-lap Hypercar fuel range with cumulative variance", () => {
    const plans = simulateStrategies({
      ...baseInput,
      raceDurationMinutes: 360,
      normalLapTime: 87.64,
      paceEvidence: { weightedRecentPace: 87.64, sampleLaps: 52, confidence: "high", source: "latest Hypercar race" },
      fuelPerLap: 1.879081726,
      fuelUseStdDevLiters: 0.057319791,
      fuelSafetyMarginLiters: 1.879081726,
      tankCapacityLiters: 80,
      tyreWearRatePerLap: 0.006,
      tyreWearRateByWheel: {},
      maxStops: 8,
    });
    const endurance = plans.find((plan) => plan.label === "Full-stint endurance");
    expect(endurance).toBeDefined();
    expect(endurance!.stopsDetail[0].lap).toBe(41);
    expect(endurance!.recommendedStartFuelLiters).toBeLessThanOrEqual(80);
  });

  it("searches tyre-driven stop counts for a six-hour race with a lower wear limit", () => {
    const plans = simulateStrategies({
      ...baseInput,
      raceDurationMinutes: 360,
      fuelPerLap: 1,
      tankCapacityLiters: 60,
      tyreWearRatePerLap: 0.005,
      tyreWearRateByWheel: { fl: 0.03, fr: 0.005, rl: 0.005, rr: 0.005 },
      maxTyreWear: 0.67,
      maxTyresAvailable: 24,
    });

    expect(plans.length).toBeGreaterThan(0);
    plans.forEach((plan) => {
      expect(plan.totalTimeSeconds).toBeGreaterThanOrEqual(360 * 60);
      expect(plan.projectedTyreWear).toBeLessThanOrEqual(0.67);
      expect(plan.tyresUsed).toBeLessThanOrEqual(24);
    });
    expect(plans.some((plan) => plan.stops > 6)).toBe(true);
  });

  it("removes a final splash stop when the preceding stint can reach the finish", () => {
    const plans = simulateStrategies({
      ...baseInput,
      raceDurationMinutes: 360,
      normalLapTime: 98.6,
      paceEvidence: { weightedRecentPace: 98.6, sampleLaps: 40, confidence: "high", source: "six-hour regression" },
      fuelPerLap: 1.8,
      fuelUseStdDevLiters: 0,
      fuelSafetyMarginLiters: 1.8,
      tankCapacityLiters: 85,
      tyreWearRatePerLap: 0.006,
      tyreWearRateByWheel: {},
      fuelLoadPacePenaltySecondsPerLiter: 0,
      maxStops: 8,
    });

    expect(plans.length).toBeGreaterThan(0);
    expect(plans[0].stops).toBe(4);
    plans.forEach((plan) => {
      if (!plan.stopsDetail.length) return;
      const finalStop = plan.stopsDetail[plan.stopsDetail.length - 1];
      const penultimateStint = plan.stintPace[plan.stintPace.length - 2];
      const finalStint = plan.stintPace[plan.stintPace.length - 1];
      const combinedLaps = penultimateStint.endLap - penultimateStint.startLap + 1
        + finalStint.endLap - finalStint.startLap + 1;
      if (finalStop.tyresChanged === 0) expect(combinedLaps).toBeGreaterThan(46);
    });
    expect(plans.some((plan) => plan.category === "fuel-save")).toBe(true);
  });

  it("uses an empirical stint model and propagates its residual variance", () => {
    const plan = simulateStrategies({
      ...baseInput,
      empiricalStintPace: {
        sampleLaps: 52, observedStints: 2, maxObservedStintLaps: 40,
        fuelCoefficientSecondsPerLiter: 0.075,
        tyreWearCoefficientSecondsPerFraction: 25,
        warmupLossSeconds: 4.4,
        residualStdDevSeconds: 1.24,
        referenceFuelLiters: 40,
        referenceTyreWear: 0.18,
        referenceWarmup: 0,
        confidence: "high",
      },
    })[0];
    expect(plan.calculationBreakdown.paceModelSource).toBe("empirical stint regression");
    expect(plan.calculationBreakdown.paceVariabilitySecondsPerLap).toBe(1.24);
    expect(plan.calculationBreakdown.p90TotalTimeSeconds).toBeGreaterThan(plan.totalTimeSeconds);
    expect(plan.warnings.join(" ")).not.toContain("Insufficient tyre degradation data");
  });

  it("produces distinct ranked strategy categories", () => {
    const plans = simulateStrategies({ ...baseInput, raceDurationMinutes: 120 });
    expect(plans[0].category).toBe("fastest");
    expect(new Set(plans.map((plan) => plan.id)).size).toBe(plans.length);
    expect(plans.length).toBeGreaterThanOrEqual(2);
    expect(plans.some((plan) => plan.category === "fuel-save")).toBe(true);
  });

  it("offers fuel saving only when it changes feasibility", () => {
    const plan = simulateStrategies({ ...baseInput, raceDurationMinutes: 35, tankCapacityLiters: 45, maxStops: 0 })[0];
    expect(plan.liftCoastSavePercent).toBeGreaterThan(0);
    expect(plan.liftCoastSavePercent).toBeLessThanOrEqual(8);
    expect(plan.warnings.join(" ")).toContain("pace cost unavailable");
  });

  it("uses the selected fixed lift-and-coast percentage and calibrated pace cost", () => {
    const plans = simulateStrategies({
      ...baseInput,
      raceDurationMinutes: 120,
      liftCoastMode: "fixed",
      liftCoastTargetPercent: 3,
      liftCoastSecondsPerPercentPerLap: 0.2,
    });
    const fuelSave = plans.find((plan) => plan.category === "fuel-save");
    expect(fuelSave).toBeDefined();
    expect(fuelSave!.liftCoastSavePercent).toBe(3);
    expect(fuelSave!.liftCoastLossSeconds).toBeGreaterThan(0);
    expect(fuelSave!.warnings.join(" ")).not.toContain("pace cost unavailable");
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

  it("rejects plans that exceed the race tyre allocation", () => {
    const plans = simulateStrategies({
      ...baseInput,
      raceDurationMinutes: 120,
      fuelPerLap: 1,
      tankCapacityLiters: 45,
      tyreChangePolicy: "all",
      maxTyresAvailable: 8,
      maxStops: 4,
    });
    expect(plans.length).toBeGreaterThan(0);
    plans.forEach((plan) => {
      expect(plan.tyresUsed).toBeLessThanOrEqual(8);
      expect(plan.tyresAvailable).toBe(8);
      expect(plan.tyresRemaining).toBe(8 - plan.tyresUsed);
    });
    expect(simulateStrategies({
      ...baseInput,
      raceDurationMinutes: 120,
      fuelPerLap: 1,
      tankCapacityLiters: 45,
      tyreChangePolicy: "all",
      maxTyresAvailable: 4,
      maxStops: 4,
    })).toEqual([]);
  });

  it("explains when tyre allocation prevents every otherwise viable strategy", () => {
    const input = {
      ...baseInput,
      raceDurationMinutes: 120,
      fuelPerLap: 1,
      tankCapacityLiters: 45,
      tyreChangePolicy: "all" as const,
      maxTyresAvailable: 4,
      maxStops: 4,
    };

    expect(simulateStrategies(input)).toEqual([]);
    expect(explainNoViableStrategies(input).join(" ")).toContain("Tyre allocation is too small");
  });

  it("explains missing strategy inputs", () => {
    expect(explainNoViableStrategies({ ...baseInput, fuelPerLap: null })).toEqual([
      "Missing fuel use per lap. Add the required inputs before generating a strategy.",
    ]);
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
    const aggressive = simulateStrategies({ ...baseInput, safetyPolicy: "aggressive" }).find((plan) => plan.reasons.some((reason) => reason.includes("latest fuel-feasible")))!;
    const conservative = simulateStrategies({ ...baseInput, safetyPolicy: "conservative" }).find((plan) => plan.reasons.some((reason) => reason.includes("latest fuel-feasible")))!;
    expect(conservative.finishFuelRemainingLiters).toBeGreaterThanOrEqual(aggressive.finishFuelRemainingLiters);
    expect(conservative.fuelMarginLiters).toBeGreaterThanOrEqual(aggressive.fuelMarginLiters);
  });

  it("exposes a calculation breakdown that reconciles to elapsed time", () => {
    const plan = simulateStrategies({ ...baseInput, paceEvidence: { ...baseInput.paceEvidence, paceTrendSecondsPerLap: 0.02 }, tyrePaceDegradationPerLap: 0.05, trafficPenaltySeconds: 3 })[0];
    const breakdown = plan.calculationBreakdown;
    const sum = breakdown.baseRaceTimeSeconds + breakdown.pitLaneTimeSeconds + breakdown.stationaryServiceTimeSeconds + breakdown.projectedPaceLossSeconds + (breakdown.tyreDegradationLossSeconds ?? 0) + (breakdown.liftCoastLossSeconds ?? 0) + breakdown.trafficLossSeconds;
    expect(breakdown.totalTimeSeconds).toBeCloseTo(sum, 1);
  });
});
