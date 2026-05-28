export type FuelState = {
  last_lap_fuel_used_liters?: number;
  fuel_per_lap_liters?: number;
  fuel_laps_remaining?: number;
  estimated_laps_remaining?: number;
  required_fuel_to_finish?: number;
  fuel_delta_to_finish?: number;
  recommended_fuel_save_per_lap?: number;
  stint_laps_observed?: number;
  confidence: string;
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

export type StrategyState = {
  fuel: FuelState;
  tyres: TyreStrategyState;
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
  assumptions: Record<string, number | string | boolean>;
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
