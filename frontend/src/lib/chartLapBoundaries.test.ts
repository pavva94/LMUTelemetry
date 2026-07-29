import { describe, expect, it } from "vitest";
import { buildLapBoundaries } from "./chartLapBoundaries";

describe("buildLapBoundaries", () => {
  it("places a boundary at the first visible sample of each subsequent lap", () => {
    const boundaries = buildLapBoundaries([
      { game_time: 10, lap_number: 1 },
      { game_time: 11, lap_number: 1 },
      { game_time: 20, lap_number: 2 },
      { game_time: 21, lap_number: 2 },
      { game_time: 30, lap_number: 3 },
    ], "game_time");

    expect(boundaries).toEqual([
      { lap: 2, x: 20, showLabel: true },
      { lap: 3, x: 30, showLabel: true },
    ]);
  });

  it("sorts lap starts by chart position and limits labels without removing lines", () => {
    const data = Array.from({ length: 13 }, (_, index) => ({
      game_time: (12 - index) * 10,
      lap_number: 12 - index,
    }));
    const boundaries = buildLapBoundaries(data, "game_time", 3);

    expect(boundaries).toHaveLength(12);
    expect(boundaries.map((boundary) => boundary.x)).toEqual(
      Array.from({ length: 12 }, (_, index) => (index + 1) * 10),
    );
    expect(boundaries.filter((boundary) => boundary.showLabel)).toHaveLength(3);
    expect(boundaries[boundaries.length - 1]?.showLabel).toBe(true);
  });

  it("ignores rows without usable lap or x-axis values", () => {
    expect(buildLapBoundaries([
      { game_time: 10, lap_number: null },
      { game_time: null, lap_number: 1 },
      { game_time: 20, lap_number: 2 },
    ], "game_time")).toEqual([]);
  });
});
