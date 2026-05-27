from __future__ import annotations

from app.schemas.recommendations import RecommendationType, StrategyRecommendation
from app.schemas.strategy import FuelState, PitWindowState, StrategyAssumptions, StintState, TyreStrategyState
from app.schemas.telemetry import CompetitorState, TelemetrySnapshot


class RecommendationEngine:
    def __init__(self, assumptions: StrategyAssumptions):
        self.assumptions = assumptions

    def update(
        self,
        snapshot: TelemetrySnapshot,
        fuel_state: FuelState,
        tyre_state: TyreStrategyState,
        stint_state: StintState,
        pit_window_state: PitWindowState,
        competitors: list[CompetitorState],
    ) -> StrategyRecommendation:
        lap = snapshot.player.lap_number if snapshot.player else None
        assumptions = {
            "fuel_per_lap_l": fuel_state.fuel_per_lap_liters or 0,
            "pit_loss_s": self.assumptions.pit_loss_seconds,
            "safety_margin_l": self.assumptions.fuel_safety_margin_liters,
            "max_tyre_wear": self.assumptions.max_tyre_wear,
        }
        if pit_window_state.safety_car_pit_recommendation:
            return StrategyRecommendation(
                type=RecommendationType.BOX_UNDER_SAFETY_CAR,
                priority="high",
                title="Box under safety car",
                message="The pit window is open and the session is under FCY or safety-car conditions, reducing expected pit loss.",
                reason_codes=["safety_car_active", "pit_window_open"],
                assumptions_used=assumptions,
                confidence=0.78,
                expires_at_lap=pit_window_state.latest_safe_pit_lap,
            )
        if lap is not None and pit_window_state.latest_safe_pit_lap is not None and lap >= pit_window_state.latest_safe_pit_lap:
            return StrategyRecommendation(
                type=RecommendationType.PIT_THIS_LAP,
                priority="high",
                title="Pit this lap",
                message="The latest safe pit lap has been reached from the current fuel and tyre limits.",
                reason_codes=["latest_safe_pit_lap_reached"],
                assumptions_used=assumptions,
                confidence=0.84,
                expires_at_lap=lap,
            )
        if fuel_state.fuel_laps_remaining is not None and fuel_state.fuel_laps_remaining <= self.assumptions.fuel_safety_margin_laps + 1:
            return StrategyRecommendation(
                type=RecommendationType.SAVE_FUEL if pit_window_state.traffic_risk_after_stop == "high" else RecommendationType.PIT_NOW,
                priority="high",
                title="Fuel window critical",
                message="Fuel remaining is close to the configured safety margin. Pit now unless traffic risk makes short fuel saving preferable.",
                reason_codes=["fuel_laps_remaining_below_threshold", f"traffic_after_stop_{pit_window_state.traffic_risk_after_stop}"],
                assumptions_used=assumptions,
                confidence=0.8,
                expires_in_seconds=60,
            )
        if tyre_state.tyre_risk_level == "high":
            return StrategyRecommendation(
                type=RecommendationType.WATCH_TYRE_DEG,
                priority="medium",
                title="Watch tyre degradation",
                message="Tyre wear or temperature is above the expected window. Prepare to shorten the stint if pace drops.",
                reason_codes=tyre_state.reason_codes or ["tyre_risk_high"],
                assumptions_used=assumptions,
                confidence=0.68,
                expires_at_lap=stint_state.recommended_stint_end_lap,
            )
        threats = [c for c in competitors if c.threat_level == "high" and not c.is_player]
        if threats and pit_window_state.traffic_risk_after_stop != "high":
            return StrategyRecommendation(
                type=RecommendationType.COVER_COMPETITOR,
                priority="medium",
                title="Cover nearby threat",
                message=f"{threats[0].driver_name or 'A nearby car'} is close enough to affect the pit cycle. Consider covering if they stop.",
                reason_codes=["competitor_threat_high", "traffic_after_stop_not_high"],
                assumptions_used=assumptions,
                confidence=0.62,
                expires_in_seconds=120,
            )
        return StrategyRecommendation(
            type=RecommendationType.HOLD_STRATEGY,
            priority="low",
            title="Hold strategy",
            message="Fuel, tyres, pit window, and nearby traffic do not require immediate action.",
            reason_codes=["fuel_margin_ok", "tyre_risk_not_high", "pit_window_not_closing"],
            assumptions_used=assumptions,
            confidence=0.58,
            expires_in_seconds=120,
        )
