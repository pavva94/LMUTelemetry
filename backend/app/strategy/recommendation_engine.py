from __future__ import annotations

from app.schemas.recommendations import RecommendationType, StrategyRecommendation
from app.schemas.strategy import FuelState, PitWindowState, StrategyAssumptions, StintState, TyreStrategyState
from app.schemas.telemetry import CompetitorState, TelemetrySnapshot


class RecommendationEngine:
    def __init__(self, assumptions: StrategyAssumptions):
        self.assumptions = assumptions
        self._last_action_type: RecommendationType | None = None
        self._last_action_lap: int | None = None

    def _fuel_ready(self, fuel_state: FuelState) -> bool:
        return (
            fuel_state.fuel_laps_remaining is not None
            and fuel_state.fuel_per_lap_liters is not None
            and (fuel_state.valid_laps_observed or 0) >= (fuel_state.valid_laps_required or 3)
            and fuel_state.confidence != "low"
        )

    def _tyres_ready(self, tyre_state: TyreStrategyState) -> bool:
        return (
            tyre_state.estimated_remaining_tyre_life_laps is not None
            and (tyre_state.observed_laps or 0) >= (tyre_state.laps_required or 3)
            and tyre_state.confidence != "low"
        )

    def _pit_window_ready(self, fuel_state: FuelState, tyre_state: TyreStrategyState, pit_window_state: PitWindowState) -> bool:
        if pit_window_state.latest_safe_pit_lap is None:
            return False
        return self._fuel_ready(fuel_state) or self._tyres_ready(tyre_state)

    def _remember(self, recommendation: StrategyRecommendation, lap: int | None) -> StrategyRecommendation:
        self._last_action_type = recommendation.type
        self._last_action_lap = lap
        return recommendation

    def _recent_same_action(self, recommendation_type: RecommendationType, lap: int | None) -> bool:
        return (
            lap is not None
            and self._last_action_type == recommendation_type
            and self._last_action_lap is not None
            and lap - self._last_action_lap <= 1
        )

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
        fuel_ready = self._fuel_ready(fuel_state)
        tyres_ready = self._tyres_ready(tyre_state)
        pit_window_ready = self._pit_window_ready(fuel_state, tyre_state, pit_window_state)

        if (
            fuel_ready
            and fuel_state.fuel_laps_remaining is not None
            and fuel_state.fuel_laps_remaining <= self.assumptions.fuel_safety_margin_laps + 0.5
        ):
            recommendation_type = RecommendationType.SAVE_FUEL if pit_window_state.traffic_risk_after_stop == "high" else RecommendationType.PIT_NOW
            if self._recent_same_action(recommendation_type, lap):
                return self._hold(fuel_ready, tyres_ready, "action_recently_issued", assumptions)
            return self._remember(StrategyRecommendation(
                type=recommendation_type,
                priority="high",
                title="Fuel critical",
                message="Verified fuel range is inside the safety margin. Pit now, or save fuel immediately if traffic makes boxing unsafe.",
                reason_codes=["fuel_range_inside_safety_margin", f"traffic_after_stop_{pit_window_state.traffic_risk_after_stop}"],
                assumptions_used=assumptions,
                confidence=0.88,
                expires_in_seconds=45,
            ), lap)

        if lap is not None and pit_window_ready and pit_window_state.latest_safe_pit_lap is not None and lap >= pit_window_state.latest_safe_pit_lap:
            if self._recent_same_action(RecommendationType.PIT_THIS_LAP, lap):
                return self._hold(fuel_ready, tyres_ready, "action_recently_issued", assumptions)
            return self._remember(StrategyRecommendation(
                type=RecommendationType.PIT_THIS_LAP,
                priority="high",
                title="Pit this lap",
                message="The verified fuel or tyre limit has reached the latest safe pit lap.",
                reason_codes=["latest_safe_pit_lap_reached", "strategy_model_confident"],
                assumptions_used=assumptions,
                confidence=0.86,
                expires_at_lap=lap,
            ), lap)

        if pit_window_ready and pit_window_state.safety_car_pit_recommendation:
            return self._remember(StrategyRecommendation(
                type=RecommendationType.BOX_UNDER_SAFETY_CAR,
                priority="high",
                title="Box under safety car",
                message="The verified pit window is open under FCY or safety-car conditions, reducing expected pit loss.",
                reason_codes=["safety_car_active", "pit_window_open", "strategy_model_confident"],
                assumptions_used=assumptions,
                confidence=0.82,
                expires_at_lap=pit_window_state.latest_safe_pit_lap,
            ), lap)

        if tyres_ready and tyre_state.tyre_risk_level == "high":
            return self._remember(StrategyRecommendation(
                type=RecommendationType.WATCH_TYRE_DEG,
                priority="medium",
                title="Manage tyres",
                message="Verified tyre wear trend is near the configured limit. Protect the tyre and prepare to shorten the stint if pace drops.",
                reason_codes=[*(tyre_state.reason_codes or ["tyre_risk_high"]), "tyre_model_confident"],
                assumptions_used=assumptions,
                confidence=0.72,
                expires_at_lap=stint_state.recommended_stint_end_lap,
            ), lap)

        threats = [c for c in competitors if c.threat_level == "high" and not c.is_player]
        if pit_window_ready and threats and pit_window_state.traffic_risk_after_stop != "high":
            return self._remember(StrategyRecommendation(
                type=RecommendationType.COVER_COMPETITOR,
                priority="medium",
                title="Cover nearby threat",
                message=f"{threats[0].driver_name or 'A nearby car'} is close and the pit window is verified. Consider covering only if they stop first.",
                reason_codes=["competitor_threat_high", "pit_window_open", "traffic_after_stop_not_high"],
                assumptions_used=assumptions,
                confidence=0.64,
                expires_in_seconds=120,
            ), lap)

        return self._hold(fuel_ready, tyres_ready, "strategy_stable", assumptions)

    def _hold(
        self,
        fuel_ready: bool,
        tyres_ready: bool,
        reason: str,
        assumptions: dict[str, float | str | int | bool],
    ) -> StrategyRecommendation:
        missing = []
        if not fuel_ready:
            missing.append("fuel_model_collecting_laps")
        if not tyres_ready:
            missing.append("tyre_model_collecting_laps")
        reason_codes = [reason, *missing] if missing else [reason, "fuel_margin_ok", "tyre_window_ok"]
        message = (
            "No strategy action yet. The model is still collecting clean fuel and tyre laps before making pit calls."
            if missing
            else "No verified fuel, tyre, pit-window, or traffic trigger requires action."
        )
        return StrategyRecommendation(
            type=RecommendationType.HOLD_STRATEGY,
            priority="low",
            title="Hold strategy",
            message=message,
            reason_codes=reason_codes,
            assumptions_used=assumptions,
            confidence=0.72 if not missing else 0.45,
            expires_in_seconds=120,
        )
