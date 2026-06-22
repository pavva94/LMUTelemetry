export type LiveLapSummary = {
  lap_number: number;
  lap_time?: number | null;
  sample_count?: number | null;
  top_speed?: number | null;
  valid_lap?: boolean | null;
  reason?: string | null;
  reason_codes?: string[];
  lap_invalidated?: boolean | null;
  in_pits?: boolean | null;
  yellow_flag?: boolean | null;
  quality_state?: "Valid" | "Valid but noisy" | "Partially unreliable" | "Invalid for performance analysis";
  quality_score?: number | null;
  flagged_samples?: number | null;
  timestamp_gaps?: number | null;
  gap_to_representative?: number | null;
  role?: string | null;
};

export type LiveLapSample = {
  timestamp?: number | null;
  lap_time?: number | null;
  lap_number?: number | null;
  current_sector?: number | null;
  speed_kph?: number | null;
  rpm?: number | null;
  engine_torque_nm?: number | null;
  power_kw?: number | null;
  power_hp?: number | null;
  brake_pct?: number | null;
  throttle_pct?: number | null;
  steering_angle?: number | null;
  g_force_lat?: number | null;
  g_force_long?: number | null;
  g_force_vert?: number | null;
  ride_height_fl_mm?: number | null;
  ride_height_fr_mm?: number | null;
  ride_height_rl_mm?: number | null;
  ride_height_rr_mm?: number | null;
  suspension_deflection_fl_mm?: number | null;
  suspension_deflection_fr_mm?: number | null;
  suspension_deflection_rl_mm?: number | null;
  suspension_deflection_rr_mm?: number | null;
  tyre_pressure_fl?: number | null;
  tyre_pressure_fr?: number | null;
  tyre_pressure_rl?: number | null;
  tyre_pressure_rr?: number | null;
  tyre_temp_fl_inner?: number | null;
  tyre_temp_fl_center?: number | null;
  tyre_temp_fl_outer?: number | null;
  tyre_temp_fr_inner?: number | null;
  tyre_temp_fr_center?: number | null;
  tyre_temp_fr_outer?: number | null;
  tyre_temp_rl_inner?: number | null;
  tyre_temp_rl_center?: number | null;
  tyre_temp_rl_outer?: number | null;
  tyre_temp_rr_inner?: number | null;
  tyre_temp_rr_center?: number | null;
  tyre_temp_rr_outer?: number | null;
  front_rear_slip_delta?: number | null;
  distance_pct?: number | null;
  sample_quality?: "valid" | "flagged";
  quality_flags?: string[];
};

export type CoachingConfidence = "High" | "Medium" | "Low";
export type CoachingTrend = "Improving" | "Stable" | "Worsening";

export type CornerOpportunity = {
  id: number;
  label: string;
  start_pct: number;
  end_pct: number;
  category: string;
  phase: string;
  opportunity: number;
  confidence: CoachingConfidence;
  confidence_score: number;
  affected_laps: number;
  clean_laps: number;
  affected_lap_numbers?: number[];
  trend: CoachingTrend;
  signals?: Array<{
    category: string;
    phase: string;
    opportunity: number;
  }>;
};

export type CoachingFinding = {
  id: string;
  corner_id: number;
  title: string;
  summary: string;
  what_happened: string;
  why_it_matters: string;
  primary_action: string;
  supporting_action?: string | null;
  avoid?: string | null;
  category: string;
  phase: string;
  opportunity: number;
  confidence: CoachingConfidence;
  confidence_score: number;
  affected_laps: number;
  clean_laps: number;
  affected_lap_numbers?: number[];
  trend: CoachingTrend;
  start_pct: number;
  end_pct: number;
  reference_lap?: number | null;
  relevant_channels: Array<"speed" | "brake" | "throttle" | "steering" | "g_force">;
  metrics: {
    segment_time_delta?: number | null;
    brake_release_delta_pct?: number | null;
    throttle_delta_pct?: number | null;
    exit_speed_delta?: number | null;
    coast_time_delta?: number | null;
    steering_correction_delta?: number | null;
  };
};

export type TelemetryInsight = {
  category: "Driver" | "Setup";
  icon: "stop" | "check" | "wrench";
  severity: "success" | "warning" | "critical";
  message: string;
  timestamp?: number | null;
  lap_time?: number | null;
  lap_number?: number | null;
  corner_id?: number | null;
  evidence?: string[];
};

export type CornerSegment = {
  id: number;
  label: string;
  start: number;
  end: number;
  vmin_timestamp?: number | null;
  max_steering_timestamp?: number | null;
};

export type LiveSectorDelta = {
  sector: 1 | 2 | 3;
  time?: number | null;
  reference_time?: number | null;
  delta?: number | null;
};

export type LiveLapAnalysis = {
  session: {
    track_name?: string | null;
    session_type?: string | null;
    vehicle_name?: string | null;
    vehicle_model?: string | null;
  };
  laps: LiveLapSummary[];
  selected_lap_number?: number | null;
  reference_lap_number?: number | null;
  current_lap_data: LiveLapSample[];
  reference_lap_data: LiveLapSample[];
  sectors: LiveSectorDelta[];
  insights: TelemetryInsight[];
  corners: CornerSegment[];
  session_summary?: {
    best_valid_lap?: number | null;
    best_valid_lap_number?: number | null;
    representative_pace?: number | null;
    representative_lap_number?: number | null;
    robust_consistency?: number | null;
    theoretical_best?: number | null;
    time_to_theoretical?: number | null;
    pace_trend?: "Improving" | "Stable" | "Degrading";
    robust_peak_combined_g?: number | null;
    largest_opportunity_corner?: string | null;
  };
  quality?: {
    status: "Valid" | "Valid but noisy" | "Partially unreliable";
    clean_laps: number;
    excluded_laps: number;
    flagged_samples: number;
    total_samples: number;
  };
  references?: {
    personal_best_lap?: number | null;
    representative_fast_lap?: number | null;
    representative_pace_lap?: number | null;
  };
  corner_opportunities?: CornerOpportunity[];
  findings?: CoachingFinding[];
  metrics: {
    session_peak_combined_g?: number | null;
    understeer_gradient?: number | null;
    load_transfer_geom?: number | null;
  };
};
