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
      { lap_number: 2, driver_name: "Jane Driver", lap_time: 101, valid_lap: true, fuel_used: null, tyre_wear_delta_fl: 0.03, tyre_wear_delta_fr: 0.01 },
      { lap_number: 3, lap_time: 180, valid_lap: false, fuel_used: 70, tyre_wear_delta: 0.5 },
    ], "Jane Driver");

    expect(stint.summary.lap_count).toBe(2);
    expect(stint.summary.detected_lap_count).toBe(3);
    expect(stint.summary.fuel_used).toBe(3);
    expect(stint.summary.fuel_per_lap).toBe(3);
    expect(stint.summary.average_lap).toBe(100.5);
    expect(stint.summary.tyre_wear_delta).toBeCloseTo(0.0175);
    expect(stint.summary.driver_name).toBe("Jane Driver");
  });

  it("does not create pit-only stints from repeated menu pit samples", async () => {
    const { buildStints } = await import("./RaceEngineeringPages");
    const stints = buildStints([
      { lap_number: 1, lap_time: 100, valid_lap: true, in_pit: false },
      { lap_number: 2, lap_time: 140, valid_lap: false, in_pit: true },
      { lap_number: 2, lap_time: null, valid_lap: false, in_pit: true },
      { lap_number: 3, lap_time: 101, valid_lap: true, in_pit: false },
      { lap_number: 4, lap_time: 145, valid_lap: false, in_pit: true },
      { lap_number: 4, lap_time: null, valid_lap: false, in_pit: true },
    ]);

    expect(stints).toHaveLength(2);
    expect(stints.map((stint) => stint.number)).toEqual([1, 2]);
    expect(stints.map((stint) => stint.summary.lap_count)).toEqual([1, 1]);
    expect(stints.map((stint) => stint.summary.detected_lap_count)).toEqual([2, 2]);
  });

  it("finds the fastest pace window only across consecutive valid laps", async () => {
    const { bestConsecutivePace } = await import("./RaceEngineeringPages");
    const rows = [
      { lap_number: 1, lap_time: 101, valid_lap: true },
      { lap_number: 2, lap_time: 100, valid_lap: true },
      { lap_number: 3, lap_time: 99, valid_lap: true },
      { lap_number: 4, lap_time: 98, valid_lap: false },
      { lap_number: 5, lap_time: 97, valid_lap: true },
      { lap_number: 6, lap_time: 96, valid_lap: true },
      { lap_number: 7, lap_time: 95, valid_lap: true },
      { lap_number: 8, lap_time: 94, valid_lap: true },
      { lap_number: 9, lap_time: 93, valid_lap: true },
    ];

    expect(bestConsecutivePace(rows, 5)).toEqual({ average: 95, startLap: 5, endLap: 9 });
    expect(bestConsecutivePace(rows, 10)).toBeNull();
  });

  it("defaults the input comparison to the two fastest laps in the current stint", async () => {
    const { fastestLapPair } = await import("./RaceEngineeringPages");
    const valid = [
      { lap_number: 2, lap_time: 90, valid_lap: true },
      { lap_number: 4, lap_time: 93, valid_lap: true },
      { lap_number: 5, lap_time: 91, valid_lap: true },
      { lap_number: 6, lap_time: 92, valid_lap: true },
    ];
    const all = [...valid, { lap_number: 3, lap_time: 120, in_pit: true, valid_lap: false }];

    expect(fastestLapPair(valid, all)).toEqual(["5", "6"]);
  });
});
