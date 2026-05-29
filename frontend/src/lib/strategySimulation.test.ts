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

  it("marks overlong tyre stints as high risk", () => {
    const plans = simulateStrategies({ ...baseInput, currentTyreWear: 0.65, tyreWearRatePerLap: 0.02 });
    expect(plans.some((plan) => plan.risk === "high" && (plan.projectedTyreWear || 0) > baseInput.maxTyreWear)).toBe(true);
  });
});
