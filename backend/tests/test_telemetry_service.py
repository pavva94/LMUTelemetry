from __future__ import annotations

from app.core.config import Settings
from app.services.telemetry_service import TelemetryService
from app.services.session_logger import SessionLogger
from app.telemetry.mock_collector import MockTelemetryCollector


class FakeRepository:
    def __init__(self) -> None:
        self.finalized: list[str] = []

    def find_resume_session(self, snapshot):
        return None

    def ensure_session(self, session_id, snapshot) -> None:
        pass

    def log_sample(self, session_id, snapshot) -> None:
        pass

    def log_recommendation(self, session_id, snapshot, recommendation) -> None:
        pass

    def finalize_session(self, session_id, snapshot=None):
        self.finalized.append(session_id)
        return {"id": session_id}


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


def test_live_session_stays_open_when_driver_returns_to_menu() -> None:
    service = TelemetryService(Settings(use_mock_telemetry=True))
    fake_repository = FakeRepository()
    service.repository = fake_repository
    service.session_logger = SessionLogger(fake_repository, log_hz=1000)
    collector = MockTelemetryCollector()

    on_track = collector.poll_once()
    on_track.session.game_phase = "green"
    service._process(on_track)
    active_session_id = service.session_id
    assert service.latest_snapshot is not None
    assert service.latest_snapshot.session_id == active_session_id

    menu = collector.poll_once()
    menu.session.game_phase = "menu"
    service._process(menu)

    assert fake_repository.finalized == []
    assert service.session_id == active_session_id
    assert service.latest_snapshot is not None
    assert service.latest_snapshot.feed_paused is True


def test_unavailable_telemetry_preserves_last_live_snapshot_for_review() -> None:
    service = TelemetryService(Settings(use_mock_telemetry=True))
    fake_repository = FakeRepository()
    service.repository = fake_repository
    service.session_logger = SessionLogger(fake_repository, log_hz=1000)
    collector = MockTelemetryCollector()

    on_track = collector.poll_once()
    on_track.session.game_phase = "green"
    on_track.player.position = 4
    service._process(on_track)
    active_session_id = service.session_id

    unavailable = collector.poll_once()
    unavailable.connected = False
    unavailable.player = None
    service._process(unavailable)

    assert fake_repository.finalized == []
    assert service.session_id == active_session_id
    assert service.latest_snapshot is not None
    assert service.latest_snapshot.feed_paused is True
    assert service.latest_snapshot.player is not None
    assert service.latest_snapshot.player.position == 4


def test_live_session_finalizes_on_new_session_start() -> None:
    service = TelemetryService(Settings(use_mock_telemetry=True))
    fake_repository = FakeRepository()
    service.repository = fake_repository
    service.session_logger = SessionLogger(fake_repository, log_hz=1000)
    collector = MockTelemetryCollector()

    on_track = collector.poll_once()
    on_track.session.game_phase = "green"
    on_track.session.current_time = 240
    on_track.player.lap_number = 5
    service._process(on_track)
    active_session_id = service.session_id

    new_session = collector.poll_once()
    new_session.session.game_phase = "green"
    new_session.session.current_time = 5
    new_session.player.lap_number = 0
    service._process(new_session)

    assert fake_repository.finalized == [active_session_id]
    assert service.session_id != active_session_id
    assert service.latest_snapshot is not None
    assert service.latest_snapshot.session_id == service.session_id
