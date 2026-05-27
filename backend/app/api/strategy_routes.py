from __future__ import annotations

from fastapi import APIRouter, Request

from app.schemas.strategy import StrategyAssumptions

router = APIRouter(prefix="/api", tags=["strategy"])


@router.get("/strategy/current")
def current_strategy(request: Request):
    return request.app.state.telemetry_service.strategy_state


@router.get("/recommendations/current")
def current_recommendation(request: Request):
    return request.app.state.telemetry_service.recommendation_payload


@router.post("/strategy/assumptions")
def update_assumptions(assumptions: StrategyAssumptions, request: Request):
    return request.app.state.telemetry_service.update_assumptions(assumptions)
