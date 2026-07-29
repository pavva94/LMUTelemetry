import { describe, expect, it } from "vitest";
import { brakeHeatColour } from "./brakeTemperature";

describe("brakeHeatColour", () => {
  it("uses the class-specific temperature ranges", () => {
    expect(brakeHeatColour(250, "GT3")).toBe("rgb(36 167 199)");
    expect(brakeHeatColour(250, "LMP3")).toBe("rgb(40 168 176)");
    expect(brakeHeatColour(250, "LMP2")).toBe("rgb(52 169 107)");
    expect(brakeHeatColour(250, "Hypercar")).toBe("rgb(52 169 107)");
  });

  it("interpolates continuously within each range", () => {
    expect(brakeHeatColour(125, "GT3")).toBe("rgb(41 144 207)");
    expect(brakeHeatColour(500, "GT3")).toBe("rgb(147 155 83)");
    expect(brakeHeatColour(775, "LMP2")).toBe("rgb(236 112 71)");
  });

  it("recognizes decorated class labels and clamps out-of-range values", () => {
    expect(brakeHeatColour(250, "FIA Hypercar 2026")).toBe("rgb(52 169 107)");
    expect(brakeHeatColour(-50, "GT3")).toBe("rgb(45 120 214)");
    expect(brakeHeatColour(1200, "LMP2")).toBe("rgb(230 83 83)");
  });

  it("uses the unavailable colour for missing telemetry", () => {
    expect(brakeHeatColour(undefined, "GT3")).toBe("#24313d");
  });
});
