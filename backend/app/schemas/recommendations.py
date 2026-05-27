from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class RecommendationType(str, Enum):
    HOLD_STRATEGY = "hold_strategy"
    PIT_NOW = "pit_now"
    PIT_THIS_LAP = "pit_this_lap"
    EXTEND_STINT = "extend_stint"
    SAVE_FUEL = "save_fuel"
    PUSH_FOR_UNDERCUT = "push_for_undercut"
    COVER_COMPETITOR = "cover_competitor"
    BOX_UNDER_SAFETY_CAR = "box_under_safety_car"
    WATCH_TYRE_DEG = "watch_tyre_deg"


class StrategyRecommendation(BaseModel):
    type: RecommendationType = RecommendationType.HOLD_STRATEGY
    priority: str = "low"
    title: str = "Hold strategy"
    message: str = "No urgent strategy action. Continue monitoring fuel, tyres, gaps, and flags."
    reason_codes: list[str] = Field(default_factory=lambda: ["baseline_strategy_stable"])
    assumptions_used: dict[str, float | str | int | bool] = Field(default_factory=dict)
    confidence: float = 0.5
    expires_at_lap: int | None = None
    expires_in_seconds: float | None = None
    explanation: str | None = None


class RecommendationPayload(BaseModel):
    current: StrategyRecommendation
    history: list[StrategyRecommendation] = Field(default_factory=list)
    ai_explanation: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
