import { describe, expect, it } from "vitest";
import type { XYPoint } from "../types/xyPlot";
import { calculatePlotDomains } from "./xyPlotScale";

const points = (xs: number[], ys: number[]): XYPoint[] =>
  xs.map((x, index) => ({ x, y: ys[index], series: "Data" }));

describe("XY plot domains", () => {
  it("uses a tight domain instead of forcing narrow data back to zero", () => {
    const domain = calculatePlotDomains("ride_height_speed", points([100, 150, 200], [51, 52, 53]));
    expect(domain.y[0]).toBeGreaterThan(50);
    expect(domain.y[1]).toBeLessThan(54);
  });

  it("keeps G-G axes symmetric around zero", () => {
    const domain = calculatePlotDomains("gg", points([-1, 0.2, 1.5], [-2, 0, 1]));
    expect(domain.x[0]).toBe(-domain.x[1]);
    expect(domain.y[0]).toBe(-domain.y[1]);
  });

  it("keeps throttle percentage readable while adapting lateral-G scale", () => {
    const domain = calculatePlotDomains("throttle_acceptance", points([0.4, 0.8, 1.2], [0, 47, 100]));
    expect(domain.x[0]).toBe(0);
    expect(domain.y).toEqual([-5, 105]);
  });

  it("clips isolated extreme tails when a large sample is available", () => {
    const values = Array.from({ length: 100 }, (_, index) => 40 + index / 100);
    values.push(1000);
    const domain = calculatePlotDomains("engine_power", points(values, values));
    expect(domain.y[1]).toBeLessThan(100);
  });
});
