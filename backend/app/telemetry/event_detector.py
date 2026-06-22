from __future__ import annotations

from app.schemas.session import LapSummary, PitEvent
from app.schemas.telemetry import TelemetrySnapshot


class EventDetector:
    def __init__(self) -> None:
        self.previous: TelemetrySnapshot | None = None
        self.laps: list[LapSummary] = []
        self.pit_events: list[PitEvent] = []
        self._lap_fuel_start: float | None = None
        self._lap_wear_start: float | None = None
        self._pit_entry_time: float | None = None

    def update(self, snapshot: TelemetrySnapshot) -> dict[str, object]:
        events: dict[str, object] = {"lap_completed": None, "pit_event": None, "safety_car": False}
        player = snapshot.player
        prev_player = self.previous.player if self.previous else None
        session = snapshot.session
        current_lap = player.lap_number if player else None
        previous_lap = prev_player.lap_number if prev_player else None
        if self._lap_fuel_start is None and player:
            self._lap_fuel_start = player.fuel_liters
            self._lap_wear_start = player.tyre_state.average_wear if player.tyre_state else None
        if current_lap and previous_lap and current_lap > previous_lap:
            fuel_end = player.fuel_liters if player else None
            wear_end = player.tyre_state.average_wear if player and player.tyre_state else None
            official_lap_time = player.last_lap_time if player and player.last_lap_time else None
            boundary_lap_time = (session.current_time - self.previous.session.current_time) if session and self.previous and self.previous.session else None
            lap = LapSummary(
                lap_number=previous_lap,
                lap_time=official_lap_time or boundary_lap_time,
                fuel_start=self._lap_fuel_start,
                fuel_end=fuel_end,
                fuel_used=(self._lap_fuel_start - fuel_end) if self._lap_fuel_start is not None and fuel_end is not None else None,
                tyre_wear_start=self._lap_wear_start,
                tyre_wear_end=wear_end,
                valid_lap=not bool(prev_player.lap_invalidated),
                in_pit=bool(self._pit_entry_time is not None),
                under_yellow=_under_yellow(self.previous),
            )
            self.laps.append(lap)
            events["lap_completed"] = lap
            self._lap_fuel_start = fuel_end
            self._lap_wear_start = wear_end
        in_pits = _player_in_pits(snapshot)
        was_in_pits = _player_in_pits(self.previous)
        if in_pits and not was_in_pits:
            self._pit_entry_time = session.current_time if session else None
        if was_in_pits and not in_pits:
            event = PitEvent(
                vehicle_id=player.vehicle_id if player else None,
                driver_name="Player",
                lap_number=current_lap,
                pit_entry_time=self._pit_entry_time,
                pit_exit_time=session.current_time if session else None,
                total_pit_loss=(session.current_time - self._pit_entry_time) if session and self._pit_entry_time else None,
            )
            self.pit_events.append(event)
            events["pit_event"] = event
            self._pit_entry_time = None
        events["safety_car"] = _under_yellow(snapshot)
        self.previous = snapshot
        return events


def _player_in_pits(snapshot: TelemetrySnapshot | None) -> bool:
    if not snapshot:
        return False
    player_id = snapshot.player.vehicle_id if snapshot.player else None
    player_comp = next((c for c in snapshot.competitors if c.is_player or c.vehicle_id == player_id), None)
    return bool(player_comp and player_comp.in_pits)


def _under_yellow(snapshot: TelemetrySnapshot | None) -> bool:
    if not snapshot or not snapshot.session:
        return False
    phase = str(snapshot.session.game_phase or "").strip()
    flag = str(snapshot.session.yellow_flag_state or "").strip()
    # LMU exposes game phase 6 as FCY and yellow-flag procedure states 1-5 as
    # active. State 6 means resume, so it is no longer treated as a yellow lap.
    if phase == "6" or flag in {"1", "2", "3", "4", "5"}:
        return True
    text = f"{phase} {flag}".lower()
    return "yellow" in text or "safety" in text or "fcy" in text
