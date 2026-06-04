import { describe, expect, it } from "vitest";
import { damperRows, sampleAt, splitInsights, tempColor } from "./liveTelemetryEngine";
import type { TelemetryInsight } from "../types/liveLapAnalysis";

describe("liveTelemetryEngine helpers", () => {
  it("finds the nearest sample to a selected timestamp", () => {
    const sample = sampleAt([{ lap_time: 1 }, { lap_time: 2.2 }, { lap_time: 4 }], 2);
    expect(sample?.lap_time).toBe(2.2);
  });

  it("maps tire temperature bands to stable colors", () => {
    expect(tempColor(null)).toBe("#26313b");
    expect(tempColor(50)).toBe("#2d78d6");
    expect(tempColor(80)).toBe("#34c47c");
    expect(tempColor(105)).toBe("#e6b450");
    expect(tempColor(125)).toBe("#ff6961");
  });

  it("calculates damper velocity from suspension traces", () => {
    const rows = damperRows([
      { lap_time: 1, suspension_deflection_fl_mm: 10 },
      { lap_time: 1.5, suspension_deflection_fl_mm: 12 },
    ]);
    expect(rows[1].damper_fl).toBe(4);
  });

  it("splits driver and setup insights", () => {
    const insights: TelemetryInsight[] = [
      { category: "Driver", icon: "stop", severity: "critical", message: "driver" },
      { category: "Setup", icon: "wrench", severity: "warning", message: "setup" },
    ];
    expect(splitInsights(insights).driver).toHaveLength(1);
    expect(splitInsights(insights).setup).toHaveLength(1);
  });
});
