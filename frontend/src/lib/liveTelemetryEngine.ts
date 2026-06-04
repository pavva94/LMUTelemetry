import type { LiveLapSample, TelemetryInsight } from "../types/liveLapAnalysis";

export const wheels = ["fl", "fr", "rl", "rr"] as const;
export type Wheel = (typeof wheels)[number];

export function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function sampleAt(samples: LiveLapSample[], timestamp?: number | null): LiveLapSample | null {
  if (!samples.length) return null;
  if (timestamp == null || !Number.isFinite(timestamp)) return samples[samples.length - 1];
  return samples.reduce((best, sample) => {
    const bestTime = finite(best.lap_time ?? best.timestamp) ?? 0;
    const sampleTime = finite(sample.lap_time ?? sample.timestamp) ?? 0;
    return Math.abs(sampleTime - timestamp) < Math.abs(bestTime - timestamp) ? sample : best;
  }, samples[0]);
}

export function damperRows(samples: LiveLapSample[]) {
  return samples.map((sample, index) => {
    const previous = samples[index - 1];
    const currentTime = finite(sample.lap_time ?? sample.timestamp);
    const previousTime = finite(previous?.lap_time ?? previous?.timestamp);
    const row: Record<string, number | null> = { x: currentTime };
    for (const wheel of wheels) {
      const current = finite(sample[`suspension_deflection_${wheel}_mm` as keyof LiveLapSample] ?? sample[`ride_height_${wheel}_mm` as keyof LiveLapSample]);
      const last = finite(previous?.[`suspension_deflection_${wheel}_mm` as keyof LiveLapSample] ?? previous?.[`ride_height_${wheel}_mm` as keyof LiveLapSample]);
      row[`damper_${wheel}`] = current != null && last != null && currentTime != null && previousTime != null && currentTime > previousTime
        ? (current - last) / (currentTime - previousTime)
        : null;
    }
    return row;
  });
}

export function tempColor(value?: number | null) {
  const temp = finite(value);
  if (temp == null) return "#26313b";
  if (temp < 65) return "#2d78d6";
  if (temp < 95) return "#34c47c";
  if (temp < 115) return "#e6b450";
  return "#ff6961";
}

export function splitInsights(insights: TelemetryInsight[]) {
  return {
    driver: insights.filter((insight) => insight.category === "Driver"),
    setup: insights.filter((insight) => insight.category === "Setup"),
  };
}
