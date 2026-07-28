import { describe, expect, it } from "vitest";
import type { SessionReview } from "../types/session";
import { calibrateLiftCoast } from "./liftCoastCalibration";
import type { EmpiricalStintPaceModel } from "./strategySimulation";

const stintModel: EmpiricalStintPaceModel = {
  sampleLaps: 30,
  observedStints: 1,
  maxObservedStintLaps: 30,
  fuelCoefficientSecondsPerLiter: 0.05,
  tyreWearCoefficientSecondsPerFraction: 10,
  warmupLossSeconds: 1,
  residualStdDevSeconds: 0.2,
  referenceFuelLiters: 45,
  referenceTyreWear: 0.15,
  referenceWarmup: 0,
  confidence: "high",
};

function reviewWithLiftCoast(): SessionReview {
  const laps: SessionReview["laps"] = [];
  const telemetry_samples: SessionReview["telemetry_samples"] = [];
  for (let lap = 1; lap <= 30; lap += 1) {
    const save = (lap % 6) * 0.8;
    const fuelUsed = 2 * (1 - save / 100);
    const fuelStart = 70 - lap * 2;
    const wear = 0.08 + lap * 0.005;
    const baseEffects = stintModel.fuelCoefficientSecondsPerLiter * (fuelStart - fuelUsed / 2 - stintModel.referenceFuelLiters)
      + stintModel.tyreWearCoefficientSecondsPerFraction * (wear - stintModel.referenceTyreWear)
      + stintModel.warmupLossSeconds * Math.exp(-(lap - 1) / 2);
    laps.push({
      lap_number: lap,
      lap_time: 90 + baseEffects + save * 0.25,
      fuel_start: fuelStart,
      fuel_used: fuelUsed,
      valid_lap: true,
      in_pit: false,
      tyre_wear_end_fl: wear,
      tyre_wear_end_fr: wear,
      tyre_wear_end_rl: wear,
      tyre_wear_end_rr: wear,
    });
    const coastSamples = Math.round(4 + save * 3);
    for (let sample = 0; sample < 40; sample += 1) {
      telemetry_samples.push({
        lap_number: lap,
        speed_kph: 180,
        throttle: sample < coastSamples ? 0.02 : 0.8,
        brake: sample < coastSamples ? 0 : 0.1,
      });
    }
  }
  return { laps, telemetry_samples, pit_events: [], recommendations: [] };
}

describe("lift-and-coast calibration", () => {
  it("fits time cost only when coasting and fuel saving move together", () => {
    const model = calibrateLiftCoast(reviewWithLiftCoast(), stintModel);
    expect(model).not.toBeNull();
    expect(model!.sampleLaps).toBe(30);
    expect(model!.fuelSavingCoastCorrelation).toBeGreaterThan(0.9);
    expect(model!.secondsPerPercentPerLap).toBeCloseTo(0.25, 1);
  });

  it("does not claim calibration without a controlled stint model", () => {
    expect(calibrateLiftCoast(reviewWithLiftCoast(), null)).toBeNull();
  });
});
