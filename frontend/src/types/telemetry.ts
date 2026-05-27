export type TyreTemps = {
  left_c?: number;
  center_c?: number;
  right_c?: number;
  carcass_c?: number;
};

export type TyreState = {
  compound_front?: string;
  compound_rear?: string;
  wear_fl?: number;
  wear_fr?: number;
  wear_rl?: number;
  wear_rr?: number;
  pressure_fl?: number;
  pressure_fr?: number;
  pressure_rl?: number;
  pressure_rr?: number;
  temp_fl?: TyreTemps;
  temp_fr?: TyreTemps;
  temp_rl?: TyreTemps;
  temp_rr?: TyreTemps;
  average_wear?: number;
  average_temp_c?: number;
};

export type PlayerState = {
  vehicle_name?: string;
  vehicle_class?: string;
  position?: number;
  class_position?: number;
  lap_number?: number;
  current_sector?: number;
  speed_kph?: number;
  gear?: number;
  rpm?: number;
  max_rpm?: number;
  engine_torque?: number;
  fuel_liters?: number;
  fuel_capacity_liters?: number;
  throttle?: number;
  brake?: number;
  steering?: number;
  clutch?: number;
  speed_limiter?: boolean;
  abs_active?: boolean;
  tc_active?: boolean;
  front_ride_height?: number;
  rear_ride_height?: number;
  front_downforce?: number;
  rear_downforce?: number;
  drag?: number;
  track_limits_steps?: number;
  lap_invalidated?: boolean;
  gap_car_ahead?: number;
  gap_car_behind?: number;
  gap_place_ahead?: number;
  gap_place_behind?: number;
  tyre_state?: TyreState;
};

export type SessionState = {
  track_name?: string;
  session_type?: string;
  game_phase?: string;
  current_time?: number;
  time_remaining?: number;
  num_vehicles?: number;
  yellow_flag_state?: string;
  current_lap?: number;
};

export type EnvironmentState = {
  raining?: number;
  ambient_temp_c?: number;
  track_temp_c?: number;
  avg_wetness?: number;
  track_grip?: number;
  cloud_coverage?: number;
};

export type CompetitorState = {
  vehicle_id: number;
  driver_name?: string;
  vehicle_name?: string;
  vehicle_class?: string;
  position?: number;
  class_position?: number;
  current_lap?: number;
  total_laps?: number;
  lap_distance?: number;
  best_lap_time?: number;
  last_lap_time?: number;
  estimated_lap_time?: number;
  pitstops?: number;
  pit_state?: string;
  penalties?: number;
  fuel_fraction?: number;
  last_pit_lap?: number;
  current_stint_lap?: number;
  in_pits?: boolean;
  time_behind_next?: number;
  time_behind_leader?: number;
  gap_to_player?: number;
  estimated_strategy_group?: string;
  threat_level?: string;
  is_player?: boolean;
};

export type TelemetrySnapshot = {
  timestamp: string;
  connected: boolean;
  session?: SessionState;
  player?: PlayerState;
  competitors: CompetitorState[];
  environment?: EnvironmentState;
  strategy?: unknown;
  message?: string;
};
