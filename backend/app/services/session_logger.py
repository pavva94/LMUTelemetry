from __future__ import annotations

import logging
import time

from app.db.repository import Repository
from app.schemas.recommendations import StrategyRecommendation
from app.schemas.telemetry import TelemetrySnapshot

logger = logging.getLogger(__name__)


class SessionLogger:
    def __init__(self, repository: Repository, log_hz: int = 1):
        self.repository = repository
        self.log_interval = 1 / max(1, log_hz)
        self._last_log = 0.0
        self._last_rec_type: str | None = None

    def log(self, session_id: str, snapshot: TelemetrySnapshot, recommendation: StrategyRecommendation) -> None:
        now = time.monotonic()
        if now - self._last_log < self.log_interval:
            return
        self._last_log = now
        try:
            self.repository.ensure_session(session_id, snapshot)
            self.repository.log_sample(session_id, snapshot)
            rec_key = f"{recommendation.type.value}:{recommendation.priority}:{snapshot.player.lap_number if snapshot.player else None}"
            if rec_key != self._last_rec_type:
                self.repository.log_recommendation(session_id, snapshot, recommendation)
                self._last_rec_type = rec_key
        except Exception as exc:
            logger.warning("Session logging failed: %s", exc)
