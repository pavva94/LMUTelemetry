export type ProfileLap = {
  id: string;
  source: "live" | "csv";
  session_id: string;
  session_name?: string | null;
  source_file?: string | null;
  date?: string | null;
  track: string;
  layout?: string | null;
  car: string;
  car_class: string;
  session_type?: string | null;
  lap_number: string | number;
  lap_time?: number | null;
  valid_lap?: boolean | null;
  expected_lap_time?: number | null;
  lap_time_ratio?: number | null;
  lap_quality?: string | null;
  expected_distance_km?: number | null;
  distance_ratio?: number | null;
  distance_km?: number | null;
  fuel_start?: number | null;
  fuel_end?: number | null;
  fuel_used?: number | null;
  tyre_compound?: string | null;
  tyre_wear_fl?: number | null;
  tyre_wear_fr?: number | null;
  tyre_wear_rl?: number | null;
  tyre_wear_rr?: number | null;
  tyre_pressure_fl?: number | null;
  tyre_pressure_fr?: number | null;
  tyre_pressure_rl?: number | null;
  tyre_pressure_rr?: number | null;
  brake_temp_fl?: number | null;
  brake_temp_fr?: number | null;
  brake_temp_rl?: number | null;
  brake_temp_rr?: number | null;
  track_temp?: number | null;
  ambient_temp?: number | null;
  engine_oil_temp?: number | null;
  engine_water_temp?: number | null;
  max_speed?: number | null;
  average_speed?: number | null;
  finish_position?: number | null;
  finish_status?: string | null;
};

export type ProfileSummary = {
  totals: Record<string, number | null>;
  distance_by_class: Array<{ car_class: string; distance_km: number; sessions: number; laps: number; distance_percent: number }>;
  top_cars: Array<{ car: string; car_class: string; distance_km: number; sessions: number; laps: number; tracks: number }>;
  top_tracks: Array<{ track: string; layout?: string; distance_km: number; sessions: number; laps: number; best_lap?: number | null; most_used_car: string }>;
  filter_options?: ProfileFilterOptions;
};

export type ProfileFilterOptions = {
  tracks: string[];
  cars: string[];
  classes: string[];
  sources: string[];
};

export type ProfileLapResponse = {
  total: number;
  page: number;
  page_size: number;
  laps: ProfileLap[];
  filter_options?: ProfileFilterOptions;
};

export type ProfileOverview = {
  summary: ProfileSummary;
  best_laps: ProfileLap[];
};
