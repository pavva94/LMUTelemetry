export type FuelState = {
  last_lap_fuel_used_liters?: number;
  fuel_capacity_liters?: number;
  fuel_per_lap_liters?: number;
  fuel_use_stddev_liters?: number;
  fuel_laps_remaining?: number;
  estimated_laps_remaining?: number;
  required_fuel_to_finish?: number;
  fuel_delta_to_finish?: number;
  recommended_fuel_save_per_lap?: number;
  valid_laps_observed?: number;
  valid_laps_required?: number;
  confidence: string;
  reason_codes?: string[];
};

export type TyreStrategyState = {
  average_wear?: number;
  wear_rate_per_lap?: number;
  estimated_remaining_tyre_life_laps?: number;
  pace_degradation_per_lap?: number;
  tyre_risk_level: string;
  confidence?: string;
  observed_laps?: number;
  laps_required?: number;
  reason_codes: string[];
};

export type PaceState = {
  last_lap_time?: number;
  last_7_lap_average?: number;
  last_10_lap_average?: number;
  weighted_recent_pace?: number;
  pace_trend_seconds_per_lap?: number;
  pace_degradation_per_lap?: number;
  sample_laps?: number;
  confidence?: string;
  reason_codes: string[];
};

export type StrategyState = {
  fuel: FuelState;
  tyres: TyreStrategyState;
  pace?: PaceState;
  stint: {
    current_stint_lap?: number;
    last_pit_lap?: number;
    fuel_limited_stint_end_lap?: number;
    tyre_limited_stint_end_lap?: number;
    recommended_stint_end_lap?: number;
  };
  pit_window: {
    earliest_viable_pit_lap?: number;
    latest_safe_pit_lap?: number;
    optimal_pit_lap?: number;
    traffic_risk_after_stop: string;
    projected_rejoin_position?: number;
    safety_car_pit_recommendation: boolean;
    undercut_targets: string[];
    overcut_targets: string[];
    explanation: string[];
  };
  assumptions: {
    race_duration_minutes?: number;
    pit_loss_seconds?: number;
    pit_stationary_seconds?: number;
    tyre_change_seconds_per_tyre?: number;
    refuel_seconds_per_5_liters?: number;
    race_start_fuel_liters?: number;
    race_start_new_tyres?: boolean;
    safety_car_pit_loss_seconds?: number;
    fuel_safety_margin_liters?: number;
    fuel_safety_margin_laps?: number;
    max_tyre_wear?: number;
    normal_lap_time?: number;
    [key: string]: number | string | boolean | undefined;
  };
};

export type RecommendationPayload = {
  current: {
    type: string;
    priority: string;
    title: string;
    message: string;
    reason_codes: string[];
    assumptions_used: Record<string, number | string | boolean>;
    confidence: number;
    explanation?: string;
  };
  ai_explanation?: string;
};
