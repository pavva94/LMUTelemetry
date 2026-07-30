import { describe, expect, it } from "vitest";
import type { SessionReview } from "../types/session";

describe("Strategy Planner session model", () => {
  it("defaults lift-and-coast to the user-selected 3% target", async () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { protocol: "http:", host: "localhost" } } });
    const { seededForm } = await import("./StrategyPlanner");
    const form = seededForm(null);
    expect(form.lift_coast_mode).toBe("fixed");
    expect(form.lift_coast_target_percent).toBe(3);
  });

  it("uses the selected robust basis rather than worn-tyre tail laps as the simulation baseline", async () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { protocol: "http:", host: "localhost" } } });
    const { modelFromSession } = await import("./StrategyPlanner");
    const laps: SessionReview["laps"] = Array.from({ length: 20 }, (_, index) => ({
      lap_number: index + 1,
      lap_time: index < 15 ? 86 : 96,
      valid_lap: true,
      in_pit: false,
      fuel_used: 1.9,
      fuel_start: 80 - index * 1.9,
      tyre_wear_end_fl: index * 0.006,
      tyre_wear_end_fr: index * 0.006,
      tyre_wear_end_rl: index * 0.007,
      tyre_wear_end_rr: index * 0.007,
    }));
    const review: SessionReview = { telemetry_samples: [{ fuel_capacity_liters: 80 }], recommendations: [], pit_events: [], laps };
    const model = modelFromSession(review, "test session", undefined, "median");
    expect(model).not.toBeNull();
    expect(model!.normalLapTime).toBe(86);
    expect(model!.paceEvidence.weightedRecentPace).toBe(86);
    expect(model!.paceEvidence.last7LapAverage).toBeGreaterThan(90);
  });
});
