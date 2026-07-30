import { describe, expect, it } from "vitest";
import { deltaColor, deltaSegments, selectFastestLapNumbers, type GpsPoint } from "../lib/trajectory";

const point = (lap: string, progress: number, time: number, x: number): GpsPoint => ({
  lap,
  lapLabel: `Lap ${lap}`,
  progress,
  x,
  y: 0,
  lat: 1,
  lon: 1,
  throttle: null,
  brake: null,
  speed: null,
  time,
  lapDistance: progress * 1000,
});

describe("trajectory delta alignment", () => {
  it("matches unequal lap samples by progress instead of screen position", () => {
    const primary = [point("1", 0, 100, 0), point("1", 0.5, 150, 10), point("1", 1, 200, 0)];
    const comparison = [point("2", 0, 300, 0), point("2", 0.25, 328, 10), point("2", 0.5, 355, 0), point("2", 0.75, 382, 10), point("2", 1, 410, 0)];

    const segments = deltaSegments(primary, comparison);

    expect(segments).toHaveLength(3);
    expect(segments[1].delta).toBe(-5);
    expect(segments[1].color).toBe("rgb(7, 81, 46)");
  });

  it("uses a continuous scale whose extremes get darker as the time loss or gain grows", () => {
    expect(deltaColor(0)).toBe("rgb(95, 159, 255)");
    expect(deltaColor(-0.1)).toBe("rgb(85, 202, 136)");
    expect(deltaColor(-1.5)).toBe("rgb(7, 81, 46)");
    expect(deltaColor(0.1)).toBe("rgb(255, 138, 127)");
    expect(deltaColor(1.5)).toBe("rgb(115, 19, 41)");
    expect(deltaColor(0.2)).not.toBe(deltaColor(0.3));
  });
});

describe("trajectory default laps", () => {
  it("selects the two fastest valid non-pit laps in fastest-first order", () => {
    expect(selectFastestLapNumbers([
      { lap_number: 8, lap_time: 95.441, in_pit: "false", valid_lap: true },
      { lap_number: 9, lap_time: 95.354, in_pit: false, valid_lap: true },
      { lap_number: 10, lap_time: 94.9, in_pit: true, valid_lap: true },
      { lap_number: 11, lap_time: 95.1, in_pit: false, valid_lap: false },
    ])).toEqual(["9", "8"]);
  });
});
