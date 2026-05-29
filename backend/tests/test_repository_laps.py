from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.db.models import LapSummaryModel, RecommendationModel, SessionAggregateModel, SessionModel, TelemetrySampleModel
import app.db.repository as repository_module
import app.services.profile_repository as profile_repository_module
from app.db.repository import Repository
from app.schemas.telemetry import PlayerState, SessionState, TelemetrySnapshot
from app.services.profile_repository import ProfileFilters, ProfileRepository
from app.core.utils import utc_now


def sample(lap: int, game_time: float, last_lap_time: float | None = None) -> TelemetrySampleModel:
    return TelemetrySampleModel(
        session_id="test",
        timestamp="2026-01-01T00:00:00",
        lap_number=lap,
        game_time=game_time,
        last_lap_time=last_lap_time,
        fuel_liters=100 - game_time,
        speed_kph=200,
    )


def test_lap_summary_uses_official_last_lap_time_for_completed_lap() -> None:
    rows = [
        sample(1, 0.0),
        sample(1, 1.0),
        sample(2, 2.0, 91.234),
        sample(2, 3.0, 91.234),
    ]
    laps = Repository()._build_laps(rows)
    assert laps[0]["lap_time"] == 91.234


def test_lap_summary_captures_position_at_lap_end() -> None:
    rows = [
        TelemetrySampleModel(session_id="test", timestamp="2026-01-01T00:00:00", lap_number=1, game_time=0.0, position=6, class_position=3),
        TelemetrySampleModel(session_id="test", timestamp="2026-01-01T00:01:30", lap_number=1, game_time=90.0, position=4, class_position=2),
    ]

    laps = Repository()._build_laps(rows)

    assert laps[0]["position"] == 4
    assert laps[0]["class_position"] == 2


def test_lap_summary_does_not_treat_fuel_jump_as_pit_without_pit_signal() -> None:
    rows = [
        TelemetrySampleModel(session_id="test", timestamp="2026-01-01T00:00:00", lap_number=1, game_time=0.0, fuel_liters=100, in_pits=False),
        TelemetrySampleModel(session_id="test", timestamp="2026-01-01T00:00:01", lap_number=1, game_time=1.0, fuel_liters=98, in_pits=False),
        TelemetrySampleModel(session_id="test", timestamp="2026-01-01T00:01:30", lap_number=2, game_time=90.0, fuel_liters=105, in_pits=False),
        TelemetrySampleModel(session_id="test", timestamp="2026-01-01T00:01:31", lap_number=2, game_time=91.0, fuel_liters=103, in_pits=False),
    ]

    laps = Repository()._build_laps(rows)

    assert laps[1]["fuel_added"] == 7
    assert laps[1]["in_pit"] is False


def test_pit_events_use_persisted_pit_signal() -> None:
    rows = [
        TelemetrySampleModel(session_id="test", timestamp="2026-01-01T00:00:00", lap_number=1, game_time=0.0, in_pits=False),
        TelemetrySampleModel(session_id="test", timestamp="2026-01-01T00:01:00", lap_number=1, game_time=60.0, in_pits=True),
        TelemetrySampleModel(session_id="test", timestamp="2026-01-01T00:01:15", lap_number=2, game_time=75.0, in_pits=False),
    ]

    events = Repository()._build_pit_events(rows)

    assert len(events) == 1
    assert events[0]["lap_number"] == 2
    assert events[0]["total_pit_loss"] == 15


def temp_session_factory():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


def test_find_resume_session_uses_latest_compatible_unfinished_session(monkeypatch) -> None:
    factory = temp_session_factory()
    monkeypatch.setattr(repository_module, "SessionLocal", factory)
    with factory() as db:
        db.add_all([
            SessionModel(id="old", created_at="2026-01-01T00:00:00", track_name="Spa", session_type="Race", vehicle_name="Porsche", ended_at_game_time=None),
            SessionModel(id="done", created_at="2026-01-02T00:00:00", track_name="Spa", session_type="Race", vehicle_name="Porsche", ended_at_game_time=100.0),
            SessionModel(id="new", created_at="2026-01-03T00:00:00", track_name="Spa", session_type="Race", vehicle_name="Porsche", ended_at_game_time=None),
        ])
        db.commit()
    snapshot = TelemetrySnapshot(timestamp=utc_now(), connected=True, session=SessionState(track_name="Spa", session_type="Race"), player=PlayerState(vehicle_name="Porsche"))
    assert Repository().find_resume_session(snapshot)["id"] == "new"


def test_dashboard_snapshot_reconstructs_latest_telemetry(monkeypatch) -> None:
    factory = temp_session_factory()
    monkeypatch.setattr(repository_module, "SessionLocal", factory)
    with factory() as db:
        db.add(SessionModel(id="dash", created_at="2026-01-01T00:00:00", track_name="Monza", session_type="Practice", vehicle_name="Ferrari", vehicle_class="Hypercar"))
        db.add_all([
            TelemetrySampleModel(session_id="dash", timestamp="2026-01-01T00:00:00", lap_number=1, game_time=0, fuel_liters=100, position=4, speed_kph=200),
            TelemetrySampleModel(session_id="dash", timestamp="2026-01-01T00:01:31.234000", lap_number=2, game_time=91.234, last_lap_time=91.234, fuel_liters=96, fuel_capacity_liters=100, position=3, abs_active=True, abs_setting=4, tc_active=False, tc_setting=2),
        ])
        db.commit()
    dashboard = Repository().dashboard_snapshot("dash")
    assert dashboard["telemetry"].player.position == 3
    assert dashboard["telemetry"].player.abs_active is True
    assert dashboard["strategy"].fuel.valid_laps_observed >= 0


def test_finalize_discards_short_sessions(monkeypatch) -> None:
    factory = temp_session_factory()
    monkeypatch.setattr(repository_module, "SessionLocal", factory)
    with factory() as db:
        db.add(SessionModel(id="short", created_at="2026-01-01T00:00:00", track_name="Spa", session_type="Practice", vehicle_name="Porsche", started_at_game_time=0.0))
        db.add_all([
            TelemetrySampleModel(session_id="short", timestamp="2026-01-01T00:00:00", lap_number=1, game_time=0.0, fuel_liters=80, speed_kph=180),
            TelemetrySampleModel(session_id="short", timestamp="2026-01-01T00:00:10", lap_number=1, game_time=10.0, fuel_liters=79, speed_kph=190),
            RecommendationModel(session_id="short", timestamp="2026-01-01T00:00:10", lap_number=1, recommendation_type="info", priority="low", message="test"),
        ])
        db.commit()

    assert Repository().finalize_session("short") is None

    with factory() as db:
        assert db.get(SessionModel, "short") is None
        assert db.query(TelemetrySampleModel).filter_by(session_id="short").count() == 0
        assert db.query(RecommendationModel).filter_by(session_id="short").count() == 0
        assert db.get(SessionAggregateModel, "short") is None


def test_finalize_discards_sessions_without_valid_laps(monkeypatch) -> None:
    factory = temp_session_factory()
    monkeypatch.setattr(repository_module, "SessionLocal", factory)
    with factory() as db:
        db.add(SessionModel(id="invalid", created_at="2026-01-01T00:00:00", track_name="Spa", session_type="Practice", vehicle_name="Porsche", started_at_game_time=0.0))
        db.add_all([
            TelemetrySampleModel(session_id="invalid", timestamp="2026-01-01T00:00:00", lap_number=1, game_time=0.0, fuel_liters=80, speed_kph=100, in_pits=True),
            TelemetrySampleModel(session_id="invalid", timestamp="2026-01-01T00:01:00", lap_number=1, game_time=60.0, fuel_liters=79, speed_kph=100, in_pits=True),
            TelemetrySampleModel(session_id="invalid", timestamp="2026-01-01T00:01:31", lap_number=2, game_time=91.0, last_lap_time=91.0, fuel_liters=78, speed_kph=100, in_pits=True),
            TelemetrySampleModel(session_id="invalid", timestamp="2026-01-01T00:02:31", lap_number=2, game_time=151.0, fuel_liters=77, speed_kph=100, in_pits=True),
        ])
        db.commit()

    assert Repository().finalize_session("invalid") is None

    with factory() as db:
        assert db.get(SessionModel, "invalid") is None
        assert db.query(TelemetrySampleModel).filter_by(session_id="invalid").count() == 0


def test_finalize_stores_result_from_latest_sample_without_snapshot(monkeypatch) -> None:
    factory = temp_session_factory()
    monkeypatch.setattr(repository_module, "SessionLocal", factory)
    with factory() as db:
        db.add(SessionModel(id="race-result", created_at="2026-01-01T00:00:00", track_name="Spa", session_type="Race", vehicle_name="Porsche", started_at_game_time=0.0))
        db.add_all([
            TelemetrySampleModel(session_id="race-result", timestamp="2026-01-01T00:00:00", lap_number=1, game_time=0.0, fuel_liters=80, speed_kph=180, position=8, class_position=4),
            TelemetrySampleModel(session_id="race-result", timestamp="2026-01-01T00:01:30", lap_number=2, game_time=90.0, last_lap_time=90.0, fuel_liters=77, speed_kph=190, position=6, class_position=3),
        ])
        db.commit()

    result = Repository().finalize_session("race-result")

    assert result is not None
    assert result["final_position"] == 6
    assert result["final_class_position"] == 3
    review = Repository().review("race-result", sample_limit=0)
    assert review["laps"][0]["position"] == 8
    assert review["laps"][1]["position"] == 6


def test_profile_live_laps_use_persisted_official_lap_times(monkeypatch, tmp_path) -> None:
    factory = temp_session_factory()
    monkeypatch.setattr(profile_repository_module, "SessionLocal", factory)
    monkeypatch.setattr(profile_repository_module, "init_motec_db", lambda: None)
    monkeypatch.setattr(profile_repository_module, "MOTEC_DB_PATH", tmp_path / "missing.sqlite3")
    ProfileRepository._all_laps_cache_key = None
    ProfileRepository._all_laps_cache = None
    with factory() as db:
        db.add(SessionModel(id="profile", created_at="2026-01-01T00:00:00", track_name="Spa", session_type="Race", vehicle_name="Porsche", vehicle_class="GTE"))
        db.add_all([
            TelemetrySampleModel(session_id="profile", timestamp="2026-01-01T00:00:00", lap_number=1, game_time=0.0, fuel_liters=90, speed_kph=200),
            TelemetrySampleModel(session_id="profile", timestamp="2026-01-01T00:00:01", lap_number=1, game_time=1.0, fuel_liters=89, speed_kph=210),
            TelemetrySampleModel(session_id="profile", timestamp="2026-01-01T00:01:31.234000", lap_number=2, game_time=91.234, last_lap_time=91.234, fuel_liters=86, speed_kph=205),
        ])
        db.commit()

    laps = ProfileRepository().all_laps()
    lap_one = next(lap for lap in laps if lap["source"] == "live" and lap["lap_number"] == 1)
    assert lap_one["lap_time"] == 91.234
    assert ProfileRepository().filtered_laps(ProfileFilters())["filter_options"]["tracks"] == ["Spa"]


def test_profile_summary_counts_persisted_sessions_without_completed_laps(monkeypatch, tmp_path) -> None:
    factory = temp_session_factory()
    monkeypatch.setattr(profile_repository_module, "SessionLocal", factory)
    monkeypatch.setattr(profile_repository_module, "init_motec_db", lambda: None)
    monkeypatch.setattr(profile_repository_module, "MOTEC_DB_PATH", tmp_path / "missing.sqlite3")
    ProfileRepository._all_laps_cache_key = None
    ProfileRepository._all_laps_cache = None
    with factory() as db:
        db.add(SessionModel(id="empty", created_at="2026-01-01T00:00:00", track_name="Spa", session_type="Practice", vehicle_name="Porsche"))
        db.commit()

    summary = ProfileRepository().summary()

    assert summary["totals"]["total_sessions"] == 1
    assert summary["totals"]["live_sessions"] == 1


def test_profile_total_distance_includes_invalid_stored_live_laps(monkeypatch, tmp_path) -> None:
    factory = temp_session_factory()
    monkeypatch.setattr(profile_repository_module, "SessionLocal", factory)
    monkeypatch.setattr(profile_repository_module, "init_motec_db", lambda: None)
    monkeypatch.setattr(profile_repository_module, "MOTEC_DB_PATH", tmp_path / "missing.sqlite3")
    ProfileRepository._all_laps_cache_key = None
    ProfileRepository._all_laps_cache = None
    with factory() as db:
        db.add(SessionModel(id="distance", created_at="2026-01-01T00:00:00", track_name="Spa", session_type="Practice", vehicle_name="Porsche"))
        db.add_all([
            LapSummaryModel(session_id="distance", lap_number=1, lap_time=72.0, valid_lap=False),
            TelemetrySampleModel(session_id="distance", timestamp="2026-01-01T00:00:00", lap_number=1, game_time=0.0, speed_kph=180),
            TelemetrySampleModel(session_id="distance", timestamp="2026-01-01T00:01:00", lap_number=1, game_time=60.0, speed_kph=180),
            TelemetrySampleModel(session_id="distance", timestamp="2026-01-01T00:02:00", lap_number=2, game_time=120.0, speed_kph=180),
        ])
        db.commit()

    summary = ProfileRepository().summary()

    assert summary["totals"]["total_distance_km"] == 6.0
    assert summary["distance_by_class"][0]["distance_km"] == 3.0
    assert summary["totals"]["total_laps"] == 1
    assert summary["totals"]["valid_laps"] == 0
