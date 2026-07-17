import { describe, expect, it } from "vitest";
import { deltaSegments, type GpsPoint } from "../lib/trajectory";

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
    expect(segments[1].color).toBe("#69d28f");
  });
});
