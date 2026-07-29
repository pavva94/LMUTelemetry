import type { SavedSession } from "./session";

export type XYPoint = {
  x: number;
  y: number;
  series: string;
  lap?: number | null;
  corner?: string | null;
  speed?: number | null;
  throttle?: number | null;
  brake?: number | null;
  tyre_condition?: number | null;
  fuel?: number | null;
  timestamp?: string | null;
};

export type XYPlotResponse = {
  plot_id: string;
  available: boolean;
  missing_requirements: string[];
  warnings: string[];
  axes?: {
    x: { label: string; unit: string };
    y: { label: string; unit: string };
  };
  points: XYPoint[];
  trend: Array<{ x: number; y: number }>;
  envelope: Array<{ x: number; low: number; high: number }>;
  stats: {
    min: number | null;
    max: number | null;
    average: number | null;
    std_dev: number | null;
    count: number;
  };
  available_fields?: string[];
  filter_options?: {
    laps: number[];
    corners: string[];
    compounds: string[];
    drivers: string[];
    setups: string[];
  };
  applied_filters?: Record<string, unknown>;
  color_by?: string;
  source_count?: number;
  filtered_count?: number;
  session?: SavedSession | null;
};

export type XYPlotQuery = {
  plotId: string;
  xChannel?: string;
  yChannel?: string;
  laps?: number[];
  corners?: string[];
  speedMin?: number | null;
  speedMax?: number | null;
  compound?: string;
  fuelMin?: number | null;
  fuelMax?: number | null;
  validOnly?: boolean;
  colorBy?: string;
  trend?: boolean;
  percentileEnvelope?: boolean;
  maxPoints?: number;
};
