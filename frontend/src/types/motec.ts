export type WheelPosition = "FL" | "FR" | "RL" | "RR";

export type ChannelKind = "scalar" | "perWheel" | "gps" | "marker" | "lap";

export type ChannelDefinition = {
  originalName: string;
  displayName: string;
  unit: string;
  category: string;
  type: ChannelKind;
  wheelPosition?: WheelPosition;
  defaultPrecision: number;
  defaultGraphType: "line" | "step" | "scatter" | "histogram";
  defaultMin?: number;
  defaultMax?: number;
  derived?: boolean;
};

export type MotecSample = Record<string, number | string | boolean | null>;

export type MotecLap = {
  lapNumber: string;
  startTime: number | null;
  endTime: number | null;
  duration: number | null;
  sampleCount: number;
  maxSpeed: number | null;
  minCornerSpeed: number | null;
  maxRpm: number | null;
  fuelStart: number | null;
  fuelEnd: number | null;
};

export type MotecSession = {
  id: string;
  name: string;
  importedAt: string;
  channels: ChannelDefinition[];
  samples: MotecSample[];
  laps: MotecLap[];
  warnings: string[];
  minSessionTime: number | null;
  maxSessionTime: number | null;
  sampleCount?: number;
  lapCount?: number;
};
