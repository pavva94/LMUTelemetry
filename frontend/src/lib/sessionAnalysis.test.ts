import { describe, expect, it } from "vitest";
import { average, median, standardDeviation, toFiniteNumber } from "./sessionAnalysis";

describe("session analysis numeric handling", () => {
  it("does not silently turn missing values into zero", () => {
    expect(toFiniteNumber(null)).toBeNull();
    expect(toFiniteNumber(undefined)).toBeNull();
    expect(toFiniteNumber("")).toBeNull();
    expect(toFiniteNumber("  ")).toBeNull();
    expect(toFiniteNumber(false)).toBeNull();
    expect(toFiniteNumber("12.5")).toBe(12.5);
  });

  it("uses population standard deviation and ignores unavailable values", () => {
    expect(average([1, null, 3])).toBe(2);
    expect(median([1, null, 3])).toBe(2);
    expect(standardDeviation([1, 2, 3])).toBeCloseTo(Math.sqrt(2 / 3));
  });
});
