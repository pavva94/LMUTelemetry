export type LiveLapSummary = {
  lap_number: number;
  lap_time?: number | null;
  sample_count?: number | null;
  top_speed?: number | null;
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
  metrics: {
    session_peak_combined_g?: number | null;
    understeer_gradient?: number | null;
    load_transfer_geom?: number | null;
  };
};
