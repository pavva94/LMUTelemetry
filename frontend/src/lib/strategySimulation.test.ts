import { describe, expect, it } from "vitest";
import { simulateStrategies, stopServiceTime, type StrategySimulationInput } from "./strategySimulation";

const baseInput: StrategySimulationInput = {
  raceDurationMinutes: 60,
  normalLapTime: 120,
  fuelPerLap: 3,
  fuelObservedLaps: 5,
  fuelRequiredLaps: 3,
  tankCapacityLiters: 60,
  raceStartFuelLiters: 60,
  fuelSafetyMarginLiters: 2,
  pitLaneLossSeconds: 25,
  tyreChangeSecondsPerTyre: 4,
  refuelSecondsPer5Liters: 2,
  currentTyreWear: 0.1,
  tyreWearRatePerLap: 0.01,
  maxTyreWear: 0.75,
  maxStops: 4,
};

describe("strategy simulation", () => {
  it("adds pit lane loss, tyres, and refuel service time", () => {
    expect(stopServiceTime({
      pitLaneLossSeconds: 25,
      tyresChanged: 3,
      tyreChangeSecondsPerTyre: 4,
      fuelAddedLiters: 21,
      refuelSecondsPer5Liters: 2,
    })).toBe(47);
  });

  it("uses editable race start fuel instead of current fuel", () => {
    const plans = simulateStrategies({ ...baseInput, raceStartFuelLiters: 30, tankCapacityLiters: 60 });
    expect(plans.every((plan) => plan.stops > 0)).toBe(true);
  });

  it("reports fuel remaining at pit stops and the finish", () => {
    const plans = simulateStrategies({ ...baseInput, raceDurationMinutes: 60, maxStops: 1 });
    const oneStop = plans.find((plan) => plan.stops === 1);

    expect(oneStop?.stopsDetail[0].fuelRemainingLiters).toBeGreaterThan(0);
    expect(oneStop?.finishFuelRemainingLiters).toBeCloseTo((oneStop?.fuelMarginLiters ?? 0) + baseInput.fuelSafetyMarginLiters, 2);
  });

  it("reports the fuel needed for the first stint including start margin", () => {
    const plans = simulateStrategies({ ...baseInput, raceDurationMinutes: 60, maxStops: 1 });
    const oneStop = plans.find((plan) => plan.stops === 1);

    expect(oneStop?.firstStintFuelNeedLiters).toBeCloseTo(45, 1);
    expect(oneStop?.recommendedStartFuelLiters).toBeCloseTo(47, 1);
    expect(oneStop?.startFuelIsFullTank).toBe(false);
  });

  it("returns the top three plans sorted by total time", () => {
    const plans = simulateStrategies(baseInput);
    expect(plans).toHaveLength(3);
    expect(plans[0].totalTimeSeconds).toBeLessThanOrEqual(plans[1].totalTimeSeconds);
    expect(plans[1].totalTimeSeconds).toBeLessThanOrEqual(plans[2].totalTimeSeconds);
  });

  it("allows lift-and-coast to make a lower stop strategy viable", () => {
    const plans = simulateStrategies({ ...baseInput, raceDurationMinutes: 35, raceStartFuelLiters: 52, tankCapacityLiters: 52, maxStops: 0 });
    expect(plans.some((plan) => plan.liftCoastSavePercent > 0 && plan.liftCoastSavePercent <= 5)).toBe(true);
  });

  it("rejects stops that need more fuel than the tank can accept", () => {
    const plans = simulateStrategies({
      ...baseInput,
      raceDurationMinutes: 84,
      raceStartFuelLiters: 60,
      tankCapacityLiters: 60,
      fuelSafetyMarginLiters: 3,
      maxStops: 1,
    });

    expect(plans).toHaveLength(0);
  });

  it("uses fuel saving when tank space, not total capacity, limits the stop count", () => {
    const plans = simulateStrategies({
      ...baseInput,
      raceDurationMinutes: 78,
      raceStartFuelLiters: 60,
      tankCapacityLiters: 60,
      fuelSafetyMarginLiters: 2,
      maxStops: 1,
    });
    const oneStop = plans.find((plan) => plan.stops === 1);

    expect(oneStop).toBeDefined();
    if (!oneStop) throw new Error("Expected a one-stop plan");
    expect(oneStop.liftCoastSavePercent).toBeGreaterThan(0);
    expect(oneStop.stopsDetail[0].fuelRemainingLiters).toBeGreaterThanOrEqual(1);
    expect(oneStop.stopsDetail[0].fuelRemainingLiters + oneStop.stopsDetail[0].fuelAddedLiters).toBeLessThanOrEqual(60);
  });

  it("marks overlong tyre stints as high risk", () => {
    const plans = simulateStrategies({ ...baseInput, raceDurationMinutes: 12, currentTyreWear: 0.65, tyreWearRatePerLap: 0.02, maxStops: 0 });
    expect(plans.some((plan) => plan.risk === "high" && (plan.projectedTyreWear || 0) > baseInput.maxTyreWear)).toBe(true);
  });

  it("starts tyre projection from zero when race start uses new tyres", () => {
    const plans = simulateStrategies({
      ...baseInput,
      raceDurationMinutes: 12,
      raceStartNewTyres: true,
      currentTyreWear: 0.65,
      currentTyreWearByWheel: { fl: 0.65, fr: 0.65, rl: 0.65, rr: 0.65 },
      tyreWearRatePerLap: 0.02,
      maxStops: 0,
    });

    expect(plans[0]?.stintWear[0].startWear.fl).toBe(0);
    expect(plans[0]?.risk).not.toBe("high");
  });

  it("suggests specific tyres to change when the next stint would cross the wear threshold", () => {
    const plans = simulateStrategies({
      ...baseInput,
      raceDurationMinutes: 72,
      currentTyreWear: 0.35,
      currentTyreWearByWheel: { fl: 0.2, fr: 0.36, rl: 0.3, rr: 0.5 },
      tyreWearRatePerLap: 0.018,
      maxTyreWear: 0.75,
      maxStops: 1,
    });

    const planWithTyres = plans.find((plan) => plan.stops === 1 && plan.stopsDetail[0]?.tyresToChange.length);
    expect(planWithTyres?.stopsDetail[0].tyresToChange).toContain("rr");
    expect(planWithTyres?.stopsDetail[0].nextStintProjectedWear?.rr).toBeLessThan(0.75);
  });

  it("keeps stint wear projections after applying tyre changes", () => {
    const plans = simulateStrategies({
      ...baseInput,
      raceDurationMinutes: 72,
      currentTyreWear: 0.35,
      currentTyreWearByWheel: { fl: 0.2, fr: 0.36, rl: 0.3, rr: 0.5 },
      tyreWearRatePerLap: 0.018,
      maxTyreWear: 0.75,
      maxStops: 1,
    });
    const plan = plans.find((candidate) => candidate.stops === 1 && candidate.stopsDetail[0]?.tyresToChange.includes("rr"));

    expect(plan?.stintWear).toHaveLength(2);
    expect(plan?.stintWear[0].remainingWear.rr).toBeLessThan(plan?.stintWear[1].remainingWear.rr ?? 0);
  });
});
