import { describe, expect, it } from "vitest";
import { environmentTrendDirection, trackWetnessState } from "./environmentTrend";

describe("environmentTrendDirection", () => {
  it("reports rising and falling values outside the deadband", () => {
    expect(environmentTrendDirection([20, 20.3], 0.1)).toBe("up");
    expect(environmentTrendDirection([0.4, 0.2], 0.01)).toBe("down");
  });

  it("keeps small fluctuations steady", () => {
    expect(environmentTrendDirection([31, 31.04, 31.08], 0.1)).toBe("steady");
  });

  it("requires two valid readings", () => {
    expect(environmentTrendDirection([undefined, 21], 0.1)).toBe("unavailable");
  });
});

describe("trackWetnessState", () => {
  it("maps average path wetness to the displayed condition bands", () => {
    expect(trackWetnessState(0.05)).toBe("dry");
    expect(trackWetnessState(0.12)).toBe("slightlyDamp");
    expect(trackWetnessState(0.35)).toBe("wet");
    expect(trackWetnessState(0.70)).toBe("veryWet");
    expect(trackWetnessState(0.90)).toBe("saturated");
  });

  it("reports unavailable when no live wetness exists", () => {
    expect(trackWetnessState(undefined)).toBe("unavailable");
  });
});
