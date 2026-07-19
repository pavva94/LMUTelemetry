import { describe, expect, it } from "vitest";
import { isHypercarClass } from "./vehicleClass";

describe("isHypercarClass", () => {
  it("recognizes Hypercar class labels", () => {
    expect(isHypercarClass("Hypercar")).toBe(true);
    expect(isHypercarClass("FIA Hypercar 2026")).toBe(true);
    expect(isHypercarClass("Hyper")).toBe(true);
    expect(isHypercarClass(" hyper ")).toBe(true);
  });

  it("does not enable hybrid telemetry for other or misleading classes", () => {
    expect(isHypercarClass("LMP2")).toBe(false);
    expect(isHypercarClass("GT3")).toBe(false);
    expect(isHypercarClass("NonHypercar")).toBe(false);
  });
});
