import type { XYPoint } from "../types/xyPlot";

export type NumericDomain = [number, number];

export type PlotDomains = {
  x: NumericDomain;
  y: NumericDomain;
};

function quantile(sorted: number[], fraction: number) {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] * (upper - position) + sorted[upper] * (position - lower);
}

function robustDomain(values: number[], includeZero = false): NumericDomain {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return [0, 1];

  // Ignore only the most extreme tails when enough samples exist. This keeps a
  // single corrupt sample from flattening thousands of useful telemetry points.
  let lower = sorted.length >= 40 ? quantile(sorted, 0.01) : sorted[0];
  let upper = sorted.length >= 40 ? quantile(sorted, 0.99) : sorted[sorted.length - 1];
  if (includeZero) {
    lower = Math.min(0, lower);
    upper = Math.max(0, upper);
  }

  const span = upper - lower;
  const padding = span > 0 ? span * 0.07 : Math.max(Math.abs(lower) * 0.05, 1);
  return [lower - padding, upper + padding];
}

function symmetricDomain(values: number[]): NumericDomain {
  const magnitudes = values.filter(Number.isFinite).map(Math.abs).sort((left, right) => left - right);
  if (!magnitudes.length) return [-1, 1];
  const extent = magnitudes.length >= 40 ? quantile(magnitudes, 0.99) : magnitudes[magnitudes.length - 1];
  const padded = Math.max(extent * 1.08, 0.1);
  return [-padded, padded];
}

export function calculatePlotDomains(plotId: string, points: XYPoint[]): PlotDomains {
  const xs = points.map((point) => Number(point.x));
  const ys = points.map((point) => Number(point.y));

  if (plotId === "gg" || plotId === "speed_binned_gg") {
    return { x: symmetricDomain(xs), y: symmetricDomain(ys) };
  }

  if (plotId === "throttle_acceptance") {
    const x = robustDomain(xs, true);
    return { x: [0, Math.max(0.1, x[1])], y: [-5, 105] };
  }

  if (plotId === "brake_deceleration") {
    const x = robustDomain(xs, true);
    const y = robustDomain(ys, true);
    return {
      x: [0, Math.max(0.01, x[1])],
      y: [0, Math.max(0.1, y[1])],
    };
  }

  if (plotId === "curvature_consistency") {
    const finiteX = xs.filter(Number.isFinite);
    const xMin = finiteX.length ? Math.min(...finiteX) : 0;
    const xMax = finiteX.length ? Math.max(...finiteX) : 1;
    return { x: [Math.floor(xMin) - 0.5, Math.ceil(xMax) + 0.5], y: robustDomain(ys) };
  }

  return {
    x: robustDomain(xs),
    y: robustDomain(ys),
  };
}
