from __future__ import annotations

from app.telemetry.mock_collector import MockTelemetryCollector
from app.telemetry.normalizer import kelvin_to_celsius, vector_speed_kph


def test_mock_collector_emits_valid_snapshot() -> None:
    snapshot = MockTelemetryCollector().poll_once()
    assert snapshot.connected
    assert snapshot.player is not None
    assert snapshot.competitors


def test_normalizer_helpers() -> None:
    assert round(kelvin_to_celsius(300), 2) == 26.85
    assert vector_speed_kph((3, 4, 0)) == 18
