export type SessionReview = {
  session?: Record<string, unknown>;
  telemetry_samples: Array<Record<string, number | string | null>>;
  recommendations: Array<Record<string, number | string | null>>;
  laps: Array<Record<string, number | string | boolean | null>>;
  pit_events: Array<Record<string, number | string | boolean | null>>;
};
