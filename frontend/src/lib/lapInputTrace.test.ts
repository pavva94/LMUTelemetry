import { describe, expect, it } from "vitest";
import { appendLapInputPoint, bestLapInputTrace, buildLapInputChartData, buildLapTimeDeltaData, isCompleteLapInputTrace, sampleLapGForcePoints, type LapInputTrace } from "./lapInputTrace";

describe("lap input traces", () => {
  it("replaces stationary samples and keeps moving samples", () => {
    const first = { distance: 10, throttle: 0.2, brake: 0 };
    expect(appendLapInputPoint([first], { distance: 11, throttle: 0.4, brake: 0 })).toEqual([{ distance: 11, throttle: 0.4, brake: 0 }]);
    expect(appendLapInputPoint([first], { distance: 20, throttle: 0.8, brake: 0 })).toHaveLength(2);
  });

  it("selects the quickest valid captured lap", () => {
    const traces: LapInputTrace[] = [
      { lap: 1, lapTime: 92, points: [{ distance: 0, throttle: 1, brake: 0 }, { distance: 100, throttle: 1, brake: 0 }] },
      { lap: 2, lapTime: 90, invalidated: true, points: [{ distance: 0, throttle: 1, brake: 0 }, { distance: 100, throttle: 1, brake: 0 }] },
      { lap: 3, lapTime: 91, points: [{ distance: 0, throttle: 1, brake: 0 }, { distance: 100, throttle: 1, brake: 0 }] },
    ];
    expect(bestLapInputTrace(traces)?.lap).toBe(3);
  });

  it("only accepts officially timed traces covering a complete lap", () => {
    const complete: LapInputTrace = {
      lap: 3,
      lapTime: 91,
      points: [
        { distance: 20, throttle: 1, brake: 0 },
        { distance: 2_500, throttle: 0.5, brake: 0 },
        { distance: 4_800, throttle: 0, brake: 1 },
      ],
    };
    const joinedMidLap: LapInputTrace = {
      ...complete,
      lap: 4,
      points: complete.points.map((point) => ({ ...point, distance: point.distance + 1_000 })),
    };

    expect(isCompleteLapInputTrace(complete, 5_000)).toBe(true);
    expect(isCompleteLapInputTrace(joinedMidLap, 5_000)).toBe(false);
    expect(isCompleteLapInputTrace({ ...complete, lapTime: undefined }, 5_000)).toBe(false);
  });

  it("aligns each lap by track-distance percentage", () => {
    const trace: LapInputTrace = { lap: 1, points: [{ distance: 0, throttle: 1, brake: 0 }, { distance: 500, throttle: 0, brake: 1 }] };
    const rows = buildLapInputChartData([{ id: "current", trace }], 1_000);
    expect(rows).toEqual([
      { progress: 0, currentThrottle: 1, currentBrake: 0 },
      { progress: 50, currentThrottle: 0, currentBrake: 1 },
    ]);
  });

  it("interpolates comparison-minus-reference time delta over lap distance", () => {
    const reference: LapInputTrace = { lap: 1, lapTime: 90, points: [
      { distance: 0, throttle: 1, brake: 0, elapsedTime: 0 },
      { distance: 1, throttle: 1, brake: 0, elapsedTime: 90 },
    ] };
    const comparison: LapInputTrace = { lap: 2, lapTime: 92, points: [
      { distance: 0, throttle: 1, brake: 0, elapsedTime: 0 },
      { distance: 0.5, throttle: 1, brake: 0, elapsedTime: 46 },
      { distance: 1, throttle: 1, brake: 0, elapsedTime: 92 },
    ] };

    const rows = buildLapTimeDeltaData(reference, comparison);
    expect(rows[0]).toEqual({ progress: 0, delta: 0 });
    expect(rows[100]).toEqual({ progress: 50, delta: 1 });
    expect(rows[200]).toEqual({ progress: 100, delta: 2 });
  });

  it("anchors the finish delta to the official lap-time difference", () => {
    const reference: LapInputTrace = { lap: 3, lapTime: 95.298, points: [
      { distance: 0, throttle: 1, brake: 0, elapsedTime: 0.2 },
      { distance: 950, throttle: 1, brake: 0, elapsedTime: 94.1 },
    ] };
    const comparison: LapInputTrace = { lap: 1, lapTime: 95.373, points: [
      { distance: 0, throttle: 1, brake: 0, elapsedTime: 0.1 },
      { distance: 950, throttle: 1, brake: 0, elapsedTime: 94.8 },
    ] };

    const rows = buildLapTimeDeltaData(reference, comparison, 1_000);
    expect(rows[0]).toEqual({ progress: 0, delta: 0 });
    expect(rows[200].progress).toBe(100);
    expect(rows[200].delta).toBeCloseTo(0.075);
  });

  it("ignores elapsed-time resets inside a completed lap", () => {
    const reference: LapInputTrace = { lap: 3, lapTime: 90, points: [
      { distance: 0, throttle: 1, brake: 0, elapsedTime: 0 },
      { distance: 980, throttle: 1, brake: 0, elapsedTime: 89 },
      { distance: 990, throttle: 1, brake: 0, elapsedTime: 0.1 },
    ] };
    const comparison: LapInputTrace = { lap: 1, lapTime: 90.03, points: [
      { distance: 0, throttle: 1, brake: 0, elapsedTime: 0 },
      { distance: 980, throttle: 1, brake: 0, elapsedTime: 89.02 },
    ] };

    const rows = buildLapTimeDeltaData(reference, comparison, 1_000);
    expect(rows[198].delta).toBeLessThan(0.1);
    expect(rows[200].delta).toBeCloseTo(0.03);
  });

  it("keeps a representative bounded sample of G-force history", () => {
    const trace: LapInputTrace = {
      lap: 4,
      points: Array.from({ length: 101 }, (_, index) => ({
        distance: index * 10,
        throttle: 1,
        brake: 0,
        gForceLat: index / 100,
        gForceLong: -index / 100,
      })),
    };

    const points = sampleLapGForcePoints(trace, 5);
    expect(points).toHaveLength(5);
    expect(points[0].x).toBeCloseTo(0);
    expect(points[0].y).toBeCloseTo(0);
    expect(points[0].z).toBe(12);
    expect(points[4]).toEqual({ x: 1, y: -1, z: 12 });
  });
});
