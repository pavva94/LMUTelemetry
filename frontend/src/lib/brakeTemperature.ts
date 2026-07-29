type BrakeTemperatureClass = "GT3" | "LMP3" | "LMP2" | "HYPERCAR";
type BrakeTemperatureColour = "blue" | "cyan" | "green" | "orange" | "red";

type TemperatureRange = {
  colour: BrakeTemperatureColour;
  min: number;
  max: number;
};

const COLOURS: Record<BrakeTemperatureColour, readonly [number, number, number]> = {
  blue: [45, 120, 214],
  cyan: [36, 167, 199],
  green: [52, 169, 107],
  orange: [242, 140, 58],
  red: [230, 83, 83],
};

const BRAKE_TEMPERATURE_RANGES: Record<BrakeTemperatureClass, readonly TemperatureRange[]> = {
  GT3: [
    { colour: "blue", min: 0, max: 250 },
    { colour: "cyan", min: 250, max: 400 },
    { colour: "green", min: 400, max: 600 },
    { colour: "orange", min: 600, max: 750 },
    { colour: "red", min: 750, max: 1000 },
  ],
  LMP3: [
    { colour: "blue", min: 0, max: 200 },
    { colour: "cyan", min: 200, max: 400 },
    { colour: "green", min: 400, max: 600 },
    { colour: "orange", min: 600, max: 750 },
    { colour: "red", min: 750, max: 1000 },
  ],
  LMP2: [
    { colour: "blue", min: 0, max: 200 },
    { colour: "cyan", min: 200, max: 250 },
    { colour: "green", min: 250, max: 700 },
    { colour: "orange", min: 700, max: 850 },
    { colour: "red", min: 850, max: 1100 },
  ],
  HYPERCAR: [
    { colour: "blue", min: 0, max: 200 },
    { colour: "cyan", min: 200, max: 250 },
    { colour: "green", min: 250, max: 700 },
    { colour: "orange", min: 700, max: 850 },
    { colour: "red", min: 850, max: 1100 },
  ],
};

function brakeTemperatureClass(value?: string | null): BrakeTemperatureClass | undefined {
  const label = (value || "").trim().toUpperCase();
  if (/(^|\W)GT3(\W|$)/.test(label)) return "GT3";
  if (/(^|\W)LMP3(\W|$)/.test(label)) return "LMP3";
  if (/(^|\W)LMP2(\W|$)/.test(label)) return "LMP2";
  if (/(^|\W)HYPERCAR(\W|$)/.test(label) || label === "HYPER") return "HYPERCAR";
  return undefined;
}

function interpolateColour(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  progress: number,
) {
  const channel = (index: number) => Math.round(from[index] + (to[index] - from[index]) * progress);
  return `rgb(${channel(0)} ${channel(1)} ${channel(2)})`;
}

export function brakeHeatColour(value?: number | null, vehicleClass?: string | null) {
  if (value == null || !Number.isFinite(value)) return "#24313d";

  const ranges = BRAKE_TEMPERATURE_RANGES[brakeTemperatureClass(vehicleClass) || "GT3"];
  const clamped = Math.max(ranges[0].min, Math.min(value, ranges[ranges.length - 1].max));
  const rangeIndex = ranges.findIndex((range) => clamped >= range.min && clamped < range.max);
  const index = rangeIndex < 0 ? ranges.length - 1 : rangeIndex;
  const range = ranges[index];
  const next = ranges[Math.min(index + 1, ranges.length - 1)];
  const progress = range.max === range.min ? 0 : (clamped - range.min) / (range.max - range.min);

  return interpolateColour(COLOURS[range.colour], COLOURS[next.colour], progress);
}
