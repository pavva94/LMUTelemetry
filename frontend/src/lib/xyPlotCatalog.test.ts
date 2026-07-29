import { describe, expect, it } from "vitest";
import { localize, xyPlotCatalog } from "./xyPlotCatalog";

describe("XY plot catalog", () => {
  it("contains the complete curated list with unique identifiers", () => {
    expect(xyPlotCatalog).toHaveLength(25);
    expect(new Set(xyPlotCatalog.map((plot) => plot.id)).size).toBe(25);
  });

  it("ships complete English and Italian content for every entry", () => {
    xyPlotCatalog.forEach((plot) => {
      expect(localize(plot.title, "en")).toBeTruthy();
      expect(localize(plot.title, "it")).toBeTruthy();
      expect(localize(plot.axes, "en")).toBeTruthy();
      expect(localize(plot.axes, "it")).toBeTruthy();
      expect(localize(plot.explanation, "en")).toBeTruthy();
      expect(localize(plot.explanation, "it")).toBeTruthy();
      if (plot.supported) {
        expect(plot.dotMeaning && localize(plot.dotMeaning, "en")).toBeTruthy();
        expect(plot.dotMeaning && localize(plot.dotMeaning, "it")).toBeTruthy();
        expect(plot.whatToLookFor && localize(plot.whatToLookFor, "en")).toBeTruthy();
        expect(plot.whatToLookFor && localize(plot.whatToLookFor, "it")).toBeTruthy();
        expect(plot.example && localize(plot.example, "en")).toBeTruthy();
        expect(plot.example && localize(plot.example, "it")).toBeTruthy();
      } else {
        expect(plot.requirements && localize(plot.requirements, "en")).toBeTruthy();
        expect(plot.requirements && localize(plot.requirements, "it")).toBeTruthy();
      }
    });
  });

  it("exposes thirteen executable plots and twelve availability-aware definitions", () => {
    expect(xyPlotCatalog.filter((plot) => plot.supported)).toHaveLength(13);
    expect(xyPlotCatalog.filter((plot) => !plot.supported)).toHaveLength(12);
  });
});
