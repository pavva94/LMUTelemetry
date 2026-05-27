from __future__ import annotations

from app.schemas.recommendations import StrategyRecommendation
from app.schemas.strategy import StrategyState


class StrategyAssistant:
    def explain_recommendation(self, recommendation: StrategyRecommendation, strategy_state: StrategyState) -> str:
        reasons = ", ".join(recommendation.reason_codes) or "no reason codes supplied"
        assumptions = ", ".join(f"{key}={value}" for key, value in recommendation.assumptions_used.items())
        risk = f"Priority is {recommendation.priority}; confidence is {recommendation.confidence:.0%}."
        change = "The recommendation would change if fuel margin, tyre risk, traffic risk, or flag state changes."
        return f"{recommendation.title}: {recommendation.message} Reasons: {reasons}. Assumptions: {assumptions}. {risk} {change}"
