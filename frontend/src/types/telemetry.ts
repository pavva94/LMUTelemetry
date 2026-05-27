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
  fuel_liters?: number;
  fuel_capacity_liters?: number;
  throttle?: number;
  brake?: number;
  steering?: number;
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
  best_lap_time?: number;
  last_lap_time?: number;
  pitstops?: number;
  in_pits?: boolean;
  time_behind_next?: number;
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
