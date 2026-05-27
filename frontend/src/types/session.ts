export type SavedSession = {
  id: string;
  created_at?: string;
  track_name?: string | null;
  session_type?: string | null;
  vehicle_name?: string | null;
  started_at_game_time?: number | null;
  ended_at_game_time?: number | null;
  sample_count?: number | null;
  latest_lap_number?: number | null;
  latest_game_time?: number | null;
};

export type SessionReview = {
  session?: SavedSession | null;
  telemetry_samples: Array<Record<string, number | string | null>>;
  recommendations: Array<Record<string, number | string | null>>;
  laps: Array<Record<string, number | string | boolean | null>>;
  pit_events: Array<Record<string, number | string | boolean | null>>;
};
