import { describe, expect, it } from "vitest";

describe("stint summary arithmetic", () => {
  it("uses only valid clean laps and does not coerce missing fuel to zero", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { protocol: "http:", host: "localhost" } },
    });
    const { buildStints } = await import("./RaceEngineeringPages");
    const [stint] = buildStints([
      { lap_number: 1, lap_time: 100, valid_lap: true, fuel_used: 3, tyre_wear_delta_fl: 0.01, tyre_wear_delta_fr: 0.02 },
      { lap_number: 2, lap_time: 101, valid_lap: true, fuel_used: null, tyre_wear_delta_fl: 0.03, tyre_wear_delta_fr: 0.01 },
      { lap_number: 3, lap_time: 180, valid_lap: false, fuel_used: 70, tyre_wear_delta: 0.5 },
    ]);

    expect(stint.summary.lap_count).toBe(2);
    expect(stint.summary.detected_lap_count).toBe(3);
    expect(stint.summary.fuel_used).toBe(3);
    expect(stint.summary.fuel_per_lap).toBe(3);
    expect(stint.summary.average_lap).toBe(100.5);
    expect(stint.summary.tyre_wear_delta).toBeCloseTo(0.0175);
  });
});
