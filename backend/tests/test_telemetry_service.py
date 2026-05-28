from __future__ import annotations

from app.core.config import Settings
from app.services.telemetry_service import TelemetryService
from app.telemetry.mock_collector import MockTelemetryCollector


def test_paused_feed_keeps_latest_position_fresh() -> None:
    service = TelemetryService(Settings(use_mock_telemetry=True))
    collector = MockTelemetryCollector()

    first = collector.poll_once()
    first.session.game_phase = "menu"
    first.player.position = 5
    service._process(first)

    second = collector.poll_once()
    second.session.game_phase = "menu"
    second.player.position = 3
    service._process(second)

    assert service.latest_snapshot is not None
    assert service.latest_snapshot.feed_paused is True
    assert service.latest_snapshot.player.position == 3
