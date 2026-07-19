import { describe, expect, it } from "vitest";
import type { SessionReview } from "../types/session";
import { calibrateStintPace } from "./stintCalibration";

function calibrationReview(): SessionReview {
  const laps: SessionReview["laps"] = [];
  let lapNumber = 1;
  for (const stint of [1, 2]) {
    for (let age = 1; age <= (stint === 1 ? 40 : 16); age += 1) {
      const fuel = 80 - (age - 1) * 1.88;
      const wear = (stint === 1 ? 0 : 0.24) + age * 0.006;
      const pace = 84 + fuel * 0.07 + wear * 20 + 4 * Math.exp(-(age - 1) / 2) + (age % 2 ? 0.2 : -0.2);
      laps.push({
        lap_number: lapNumber++, lap_time: pace, valid_lap: true, in_pit: false,
        fuel_start: fuel, fuel_used: 1.88,
        tyre_wear_end_fl: wear, tyre_wear_end_fr: wear, tyre_wear_end_rl: wear, tyre_wear_end_rr: wear,
      });
    }
    if (stint === 1) laps.push({ lap_number: lapNumber++, lap_time: 140, valid_lap: false, in_pit: true });
  }
  return { telemetry_samples: [], recommendations: [], pit_events: [], laps };
}

describe("stint pace calibration", () => {
  it("separates fuel-load, tyre-wear, and warm-up effects across observed stints", () => {
    const model = calibrateStintPace(calibrationReview());
    expect(model).not.toBeNull();
    expect(model!.sampleLaps).toBe(56);
    expect(model!.observedStints).toBe(2);
    expect(model!.fuelCoefficientSecondsPerLiter).toBeCloseTo(0.07, 2);
    expect(model!.tyreWearCoefficientSecondsPerFraction).toBeCloseTo(20, 0);
    expect(model!.warmupLossSeconds).toBeCloseTo(4, 0);
    expect(model!.residualStdDevSeconds).toBeLessThan(0.5);
    expect(model!.confidence).toBe("high");
  });

  it("falls back instead of overfitting a five-lap run", () => {
    const review = calibrationReview();
    review.laps = review.laps.slice(0, 5);
    expect(calibrateStintPace(review)).toBeNull();
  });
});
