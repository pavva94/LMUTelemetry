import { describe, expect, it } from "vitest";
import { completedLapDuration } from "./liveLapTiming";

describe("completedLapDuration", () => {
  it("derives the latest completed lap from consecutive scoring lap starts", () => {
    expect(completedLapDuration(120.25, 214.875)).toBeCloseTo(94.625);
  });

  it("rejects missing, reversed, and implausible scoring boundaries", () => {
    expect(completedLapDuration(undefined, 100)).toBeUndefined();
    expect(completedLapDuration(100, 90)).toBeUndefined();
    expect(completedLapDuration(100, 1305)).toBeUndefined();
  });
});
