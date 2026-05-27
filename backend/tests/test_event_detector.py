from __future__ import annotations

from app.telemetry.event_detector import EventDetector
from app.telemetry.mock_collector import MockTelemetryCollector


def test_lap_completed_detected() -> None:
    collector = MockTelemetryCollector()
    detector = EventDetector()
    first = collector.poll_once()
    first.player.lap_number = 1
    second = collector.poll_once()
    second.player.lap_number = 2
    detector.update(first)
    events = detector.update(second)
    assert events["lap_completed"] is not None
