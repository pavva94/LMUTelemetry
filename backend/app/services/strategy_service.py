from __future__ import annotations

from app.schemas.strategy import StrategyAssumptions, StrategyState
from app.services.telemetry_service import TelemetryService


class StrategyService:
    def __init__(self, telemetry_service: TelemetryService):
        self.telemetry_service = telemetry_service

    def current(self) -> StrategyState:
        return self.telemetry_service.strategy_state

    def update_assumptions(self, assumptions: StrategyAssumptions) -> StrategyState:
        return self.telemetry_service.update_assumptions(assumptions)
