import { describe, expect, it } from "vitest";
import { formatDuration, formatRaceTime, formatTotalTime } from "./timeFormat";

describe("time formatting", () => {
  it("carries rounded seconds into the next minute", () => {
    expect(formatRaceTime(59.99999999999999)).toBe("01:00.000");
  });

  it("formats cumulative durations with hours", () => {
    expect(formatDuration(469213.319)).toBe("130:20:13.319");
  });

  it("always includes hours for race totals", () => {
    expect(formatTotalTime(3723.456)).toBe("01:02:03.456");
    expect(formatTotalTime(723.456)).toBe("00:12:03.456");
  });
});
