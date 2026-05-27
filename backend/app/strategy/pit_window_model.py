from __future__ import annotations

from app.schemas.strategy import FuelState, PitWindowState, StrategyAssumptions, StintState, TyreStrategyState
from app.schemas.telemetry import TelemetrySnapshot
from app.telemetry.event_detector import _under_yellow


class PitWindowModel:
    def __init__(self, assumptions: StrategyAssumptions):
        self.assumptions = assumptions

    def update(
        self,
        snapshot: TelemetrySnapshot,
        fuel_state: FuelState,
        tyre_state: TyreStrategyState,
        stint_state: StintState,
    ) -> PitWindowState:
        lap = snapshot.player.lap_number if snapshot.player else None
        if lap is None:
            return PitWindowState(explanation=["No player lap available."])
        latest_candidates = [v for v in [stint_state.fuel_limited_stint_end_lap, stint_state.tyre_limited_stint_end_lap] if v is not None]
        latest = min(latest_candidates) - 1 if latest_candidates else None
        earliest = lap if fuel_state.fuel_laps_remaining and fuel_state.fuel_laps_remaining > self.assumptions.fuel_safety_margin_laps else None
        optimal = None
        if earliest is not None and latest is not None:
            optimal = max(earliest, min(latest, lap + 2))
        player_pos = snapshot.player.position or 1
        projected_rejoin = player_pos + max(1, int(self.assumptions.pit_loss_seconds / 8))
        nearby = [c for c in snapshot.competitors if c.time_behind_next is not None and c.time_behind_next < 2.0]
        traffic_risk = "high" if len(nearby) >= 3 else "medium" if len(nearby) else "low"
        explanation = []
        if latest is not None:
            explanation.append(f"Latest safe lap is {latest} from fuel/tyre limits with a one-lap buffer.")
        if traffic_risk == "high":
            explanation.append("Projected rejoin is in dense traffic.")
        if _under_yellow(snapshot):
            explanation.append("FCY or safety-car state detected; pit loss is reduced.")
        return PitWindowState(
            earliest_viable_pit_lap=earliest,
            latest_safe_pit_lap=latest,
            optimal_pit_lap=optimal,
            traffic_risk_after_stop=traffic_risk,
            projected_rejoin_position=projected_rejoin,
            undercut_targets=[c.driver_name or f"Car {c.vehicle_id}" for c in snapshot.competitors if not c.is_player and (c.time_behind_next or 99) < 5][:3],
            overcut_targets=[c.driver_name or f"Car {c.vehicle_id}" for c in snapshot.competitors if not c.is_player and c.pitstops][:3],
            safety_car_pit_recommendation=_under_yellow(snapshot) and earliest is not None and (latest is None or lap <= latest),
            explanation=explanation or ["Pit window is being monitored; no decisive trigger yet."],
        )
