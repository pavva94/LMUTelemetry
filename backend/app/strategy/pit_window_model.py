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
        player_pos = snapshot.player.position
        effective_pit_loss = self.assumptions.safety_car_pit_loss_seconds if _under_yellow(snapshot) else self.assumptions.pit_loss_seconds
        gaps = [
            competitor for competitor in snapshot.competitors
            if not competitor.is_player
            and competitor.gap_to_player is not None
            and competitor.laps_behind_leader in (None, 0)
        ]
        cars_passing = [competitor for competitor in gaps if 0 < float(competitor.gap_to_player) < effective_pit_loss]
        projected_rejoin = player_pos + len(cars_passing) if player_pos is not None and gaps else None
        rejoin_nearby = [competitor for competitor in gaps if abs(float(competitor.gap_to_player) - effective_pit_loss) <= 2.0]
        traffic_risk = "high" if len(rejoin_nearby) >= 3 else "medium" if rejoin_nearby else "low" if gaps else "unknown"
        explanation = []
        if latest is not None:
            explanation.append(f"Latest safe lap is {latest} from fuel/tyre limits with a one-lap buffer.")
        if traffic_risk == "high":
            explanation.append("Projected rejoin is in dense traffic.")
        if gaps and projected_rejoin is not None:
            explanation.append(f"Projected P{projected_rejoin}: {len(cars_passing)} cars are within the {effective_pit_loss:.1f}s assumed pit loss behind the player.")
        elif not gaps:
            explanation.append("Rejoin position and traffic risk are unavailable because no player-relative competitor gaps are available.")
        if _under_yellow(snapshot):
            explanation.append("FCY or safety-car state detected; pit loss is reduced.")
        return PitWindowState(
            earliest_viable_pit_lap=earliest,
            latest_safe_pit_lap=latest,
            optimal_pit_lap=optimal,
            traffic_risk_after_stop=traffic_risk,
            projected_rejoin_position=projected_rejoin,
            undercut_targets=[c.driver_name or f"Car {c.vehicle_id}" for c in sorted(cars_passing, key=lambda car: float(car.gap_to_player or 0))[:3]],
            overcut_targets=[c.driver_name or f"Car {c.vehicle_id}" for c in gaps if float(c.gap_to_player or 0) < 0 and c.in_pits][:3],
            safety_car_pit_recommendation=_under_yellow(snapshot) and earliest is not None and (latest is None or lap <= latest),
            explanation=explanation or ["Pit window is being monitored; no decisive trigger yet."],
        )
