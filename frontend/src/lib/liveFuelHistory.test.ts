import { describe, expect, it } from "vitest";
import { completedLapFuelUsed, currentLapFuelUsed } from "./liveFuelHistory";

describe("completedLapFuelUsed", () => {
  it("uses fuel retained from the lap boundary instead of the previous telemetry tick", () => {
    expect(completedLapFuelUsed({ lapStartFuel: 80, currentFuel: 75.1, observedFromBoundary: true })).toBeCloseTo(4.9);
  });

  it("uses the backend value for the first partially observed lap", () => {
    expect(completedLapFuelUsed({ lapStartFuel: 75.12, currentFuel: 75.1, observedFromBoundary: false, fallbackFuelUsed: 4.85 })).toBe(4.85);
  });

  it("does not report a refuel as consumption", () => {
    expect(completedLapFuelUsed({ lapStartFuel: 20, currentFuel: 80, observedFromBoundary: true })).toBeUndefined();
  });

  it("reports current-lap consumption immediately and resets safely after refuelling", () => {
    expect(currentLapFuelUsed(80, 79.4)).toBeCloseTo(0.6);
    expect(currentLapFuelUsed(20, 80)).toBe(0);
  });
});
