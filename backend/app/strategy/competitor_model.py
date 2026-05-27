from __future__ import annotations

from app.schemas.telemetry import CompetitorState, TelemetrySnapshot


class CompetitorModel:
    def update(self, snapshot: TelemetrySnapshot) -> list[CompetitorState]:
        player_pos = snapshot.player.position if snapshot.player else None
        updated: list[CompetitorState] = []
        for competitor in snapshot.competitors:
            if competitor.is_player:
                competitor.estimated_strategy_group = "ON_SAME_STRATEGY"
                competitor.threat_level = "low"
            else:
                competitor.estimated_strategy_group = self._strategy_group(competitor)
                gap = competitor.time_behind_next or competitor.time_behind_leader or 999
                positional = abs((competitor.position or 99) - (player_pos or 99))
                competitor.threat_level = "high" if positional <= 1 and gap < 5 else "medium" if positional <= 3 and gap < 12 else "low"
            updated.append(competitor)
        return updated

    def _strategy_group(self, competitor: CompetitorState) -> str:
        if competitor.in_pits:
            return "PITTED_EARLY"
        if competitor.pitstops is None:
            return "UNKNOWN"
        if competitor.pitstops == 0:
            return "NOT_STOPPED"
        if competitor.last_lap_time and competitor.best_lap_time and competitor.last_lap_time < competitor.best_lap_time + 1.0:
            return "UNDERCUT_THREAT"
        return "ON_SAME_STRATEGY"
