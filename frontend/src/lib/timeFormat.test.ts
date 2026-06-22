import { describe, expect, it } from "vitest";
import { formatDuration, formatRaceTime } from "./timeFormat";

describe("time formatting", () => {
  it("carries rounded seconds into the next minute", () => {
    expect(formatRaceTime(59.99999999999999)).toBe("01:00.000");
  });

  it("formats cumulative durations with hours", () => {
    expect(formatDuration(469213.319)).toBe("130:20:13.319");
  });
});
