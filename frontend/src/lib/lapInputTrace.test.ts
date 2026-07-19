import { describe, expect, it } from "vitest";
import { appendLapInputPoint, bestLapInputTrace, buildLapInputChartData, type LapInputTrace } from "./lapInputTrace";

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

  it("aligns each lap by track-distance percentage", () => {
    const trace: LapInputTrace = { lap: 1, points: [{ distance: 0, throttle: 1, brake: 0 }, { distance: 500, throttle: 0, brake: 1 }] };
    const rows = buildLapInputChartData([{ id: "current", trace }], 1_000);
    expect(rows).toEqual([
      { progress: 0, currentThrottle: 1, currentBrake: 0 },
      { progress: 50, currentThrottle: 0, currentBrake: 1 },
    ]);
  });
});
