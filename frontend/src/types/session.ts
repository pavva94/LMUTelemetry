import type { RecommendationPayload, StrategyState } from "./strategy";
import type { TelemetrySnapshot } from "./telemetry";

export type SavedSession = {
  id: string;
  created_at?: string;
  track_name?: string | null;
  session_type?: string | null;
  vehicle_name?: string | null;
  vehicle_model?: string | null;
  final_position?: number | null;
  final_class_position?: number | null;
  classified_status?: string | null;
  started_at_game_time?: number | null;
  ended_at_game_time?: number | null;
  sample_count?: number | null;
  latest_lap_number?: number | null;
  latest_game_time?: number | null;
};

export type AggregatedSessionSummary = {
  duration_seconds?: number | null;
  lap_count?: number | null;
  total_distance_km?: number | null;
  best_lap?: number | null;
  average_lap?: number | null;
  total_fuel_used?: number | null;
  average_tyre_wear?: number | null;
  average_tyre_temp?: number | null;
  average_tyre_pressure?: number | null;
  average_brake_temp?: number | null;
  top_speed?: number | null;
  sample_count?: number | null;
};

export type SessionReview = {
  session?: SavedSession | null;
  telemetry_samples: Array<Record<string, number | string | boolean | null>>;
  recommendations: Array<Record<string, number | string | null>>;
  laps: Array<Record<string, number | string | boolean | null>>;
  pit_events: Array<Record<string, number | string | boolean | null>>;
  summary?: AggregatedSessionSummary | null;
  channel_manifest?: Array<{
    table: string;
    schema?: string;
    kind: string;
    columns: string[];
    row_count: number;
    frequency?: number | null;
    unit?: string | null;
    mapped_fields?: string[];
  }>;
  available_fields?: Record<string, boolean>;
};

export type SessionDashboard = {
  session?: SavedSession | null;
  telemetry?: TelemetrySnapshot | null;
  strategy: StrategyState;
  recommendation: RecommendationPayload;
  review: SessionReview;
};
