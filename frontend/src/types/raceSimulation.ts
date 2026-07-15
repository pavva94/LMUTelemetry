export type RaceSimulationSummary = {
  name: string;
  mean_time: number;
  median_time: number;
  std_dev: number;
  p5: number;
  p90: number;
  fastest_probability: number;
  fuel_risk_probability: number;
  tyre_risk_probability: number;
  expected_finish_fuel: number;
  expected_max_wear: number;
  expected_pit_time: number;
  expected_traffic_loss: number;
  p90_traffic_loss: number;
  expected_traffic_events: number;
  expected_traffic_wear: number;
  plan: {
    initial_fuel_liters: number;
    start_new_tyres: boolean;
    stints: number;
    pits: Array<{
      pit_lap: number;
      next_stint_laps: number;
      change_tyres: boolean;
      fuel_to_add_liters: number;
      target_fuel_liters: number;
      pace_mode: "push" | "normal" | "conserve";
    }>;
  };
  stops: number;
  distribution: number[];
};

export type RaceSimulationResult = {
  session_id: string;
  recommended: string;
  explanation: string;
  summaries: RaceSimulationSummary[];
  model: { accepted: number; total: number; reasons: Record<string, number>; provenance: Record<string, string>; baseline: number; fuel_per_lap: number; pit_loss: number; estimated_race_laps?: number; derived_max_stint_laps?: number };
  representative_laps: Record<string, Array<{ lap: number; lap_time: number; fuel: number; wear: number; stint: number; pit: boolean; traffic_loss?: number; traffic_event?: string }>>;
  limitations: string[];
};

export type FullFieldResult = { expected_overall_position: number; expected_class_position: number; win_probability: number; podium_probability: number; expected_race_time: number; expected_traffic_loss: number; position_distribution: Record<string, number>; limitations: string[] };
