from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.db.models import LapSummaryModel, LmuDuckdbLapModel, LmuDuckdbSessionModel, RecommendationModel, SessionAggregateModel, SessionModel, TelemetrySampleModel
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


def test_repository_session_type_name_maps_lmu_race_range() -> None:
    repository = Repository()

    assert repository._session_type_name("8") == "Qualifying 4"
    assert repository._session_type_name("9") == "Warmup"
    assert repository._session_type_name("10") == "Race"
    assert repository._session_type_name("13") == "Race 4"


def test_lap_summary_handles_repeated_identical_official_lap_times() -> None:
    rows = [
        sample(1, 0.0),
        sample(2, 90.0, 90.0),
        sample(3, 180.0, 90.0),
    ]

    laps = Repository()._build_laps(rows)

    assert laps[0]["lap_time"] == 90.0
    assert laps[1]["lap_time"] == 90.0


def test_lap_summary_uses_lap_start_boundaries_when_official_value_is_stale() -> None:
    rows = [
        TelemetrySampleModel(session_id="test", timestamp="2026-01-01T00:00:00", lap_number=1, game_time=0.0, current_lap_time=0.0),
        TelemetrySampleModel(session_id="test", timestamp="2026-01-01T00:01:20", lap_number=1, game_time=80.0, current_lap_time=80.0),
        TelemetrySampleModel(session_id="test", timestamp="2026-01-01T00:01:31", lap_number=2, game_time=91.234, current_lap_time=0.0, last_lap_time=84.0),
        TelemetrySampleModel(session_id="test", timestamp="2026-01-01T00:02:00", lap_number=2, game_time=120.0, current_lap_time=28.766, last_lap_time=91.234),
    ]

    laps = Repository()._build_laps(rows)

    assert laps[0]["lap_time"] == 91.234
    assert abs(laps[0]["end_time"] - 91.234) < 0.001


def test_lap_summary_captures_position_at_lap_end() -> None:
    rows = [
        TelemetrySampleModel(session_id="test", timestamp="2026-01-01T00:00:00", lap_number=1, game_time=0.0, position=6, class_position=3),
        TelemetrySampleModel(session_id="test", timestamp="2026-01-01T00:01:30", lap_number=1, game_time=90.0, position=4, class_position=2),
    ]

    laps = Repository()._build_laps(rows)

    assert laps[0]["position"] == 4
    assert laps[0]["class_position"] == 2


def test_lap_summary_persists_environment_and_tyre_details() -> None:
    rows = [
        TelemetrySampleModel(
            session_id="test",
            timestamp="2026-01-01T00:00:00",
            lap_number=1,
            game_time=0.0,
            tyre_wear_fl=0.01,
            tyre_temp_fl=80,
            tyre_pressure_fl=180,
            brake_temp_fl=500,
            ride_height_fl=0.04,
            throttle=0.5,
            brake=0.1,
            steering=0.2,
            track_temp=30,
            ambient_temp=20,
        ),
        TelemetrySampleModel(
            session_id="test",
            timestamp="2026-01-01T00:01:30",
            lap_number=1,
            game_time=90.0,
            tyre_wear_fl=0.03,
            tyre_temp_fl=90,
            tyre_pressure_fl=190,
            brake_temp_fl=520,
            ride_height_fl=0.05,
            throttle=0.7,
            brake=0.2,
            steering=0.4,
            track_temp=32,
            ambient_temp=22,
        ),
    ]

    laps = Repository()._build_laps(rows)

    assert laps[0]["track_temp"] == 31
    assert laps[0]["ambient_temp"] == 21
    assert laps[0]["tyre_wear_start_fl"] == 0.01
    assert laps[0]["tyre_wear_end_fl"] == 0.03
    assert abs(laps[0]["tyre_wear_delta_fl"] - 0.02) < 0.001
    assert laps[0]["tyre_temp_fl"] == 85
    assert laps[0]["tyre_pressure_fl"] == 185
    assert laps[0]["brake_temp_fl"] == 510
    assert laps[0]["ride_height_fl"] == 0.045
    assert laps[0]["throttle"] == 0.6
    assert abs(laps[0]["brake"] - 0.15) < 0.001
    assert abs(laps[0]["steering"] - 0.3) < 0.001


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
    assert review["telemetry_samples"]
    assert review["telemetry_samples"][0]["speed_kph"] == 180


def test_profile_uses_only_active_duckdb_lap_cache(monkeypatch, tmp_path) -> None:
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
        db.add(LmuDuckdbSessionModel(id="duck", file_key="duck", file_path="C:/telemetry/duck.duckdb", file_name="duck.duckdb", file_size_bytes=100, signature="sig", active=True, created_at="2026-01-02T00:00:00", synced_at="2026-01-02T00:01:00", track_name="Le Mans", session_type="Race", vehicle_name="Ferrari", vehicle_class="Hypercar", sample_count=10))
        db.add(LmuDuckdbSessionModel(id="old", file_key="old", file_path="C:/telemetry/old.duckdb", file_name="old.duckdb", file_size_bytes=100, signature="sig", active=False, created_at="2026-01-03T00:00:00", track_name="Spa", session_type="Race", vehicle_name="Porsche", vehicle_class="GTE", sample_count=10))
        db.add(LmuDuckdbLapModel(session_id="duck", lap_number="1", date="2026-01-02T00:00:00", track="Le Mans", car="Ferrari", car_class="Hypercar", session_type="Race", lap_time=91.234, valid_lap=True, distance_km=13.6, fuel_used=2.5, max_speed=320, average_speed=190))
        db.add(LmuDuckdbLapModel(session_id="old", lap_number="1", date="2026-01-03T00:00:00", track="Spa", car="Porsche", car_class="GTE", session_type="Race", lap_time=100.0, valid_lap=True, distance_km=7.0))
        db.commit()

    laps = ProfileRepository().all_laps()
    assert {lap["source"] for lap in laps} == {"duckdb"}
    lap_one = next(lap for lap in laps if lap["session_id"] == "duck" and lap["lap_number"] == "1")
    assert lap_one["lap_time"] == 91.234
    assert ProfileRepository().filtered_laps(ProfileFilters())["filter_options"]["tracks"] == ["Le Mans"]


def test_profile_summary_counts_duckdb_sessions_without_completed_laps(monkeypatch, tmp_path) -> None:
    factory = temp_session_factory()
    monkeypatch.setattr(profile_repository_module, "SessionLocal", factory)
    monkeypatch.setattr(profile_repository_module, "init_motec_db", lambda: None)
    monkeypatch.setattr(profile_repository_module, "MOTEC_DB_PATH", tmp_path / "missing.sqlite3")
    ProfileRepository._all_laps_cache_key = None
    ProfileRepository._all_laps_cache = None
    with factory() as db:
        db.add(SessionModel(id="empty", created_at="2026-01-01T00:00:00", track_name="Spa", session_type="Practice", vehicle_name="Porsche"))
        db.add(LmuDuckdbSessionModel(id="empty-duck", file_key="empty-duck", file_path="C:/telemetry/empty.duckdb", file_name="empty.duckdb", file_size_bytes=100, signature="sig", active=True, created_at="2026-01-01T00:00:00", track_name="Spa", session_type="Practice", vehicle_name="Porsche", sample_count=10))
        db.commit()

    summary = ProfileRepository().summary()

    assert summary["totals"]["total_sessions"] == 1
    assert summary["totals"]["live_sessions"] == 0
    assert summary["totals"]["csv_sessions"] == 0
    assert summary["totals"]["duckdb_sessions"] == 1


def test_profile_total_distance_includes_invalid_duckdb_laps(monkeypatch, tmp_path) -> None:
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
        db.add(LmuDuckdbSessionModel(id="distance-duck", file_key="distance-duck", file_path="C:/telemetry/distance.duckdb", file_name="distance.duckdb", file_size_bytes=100, signature="sig", active=True, created_at="2026-01-01T00:00:00", track_name="Spa", session_type="Practice", vehicle_name="Porsche", vehicle_class="GTE", sample_count=10))
        db.add(LmuDuckdbLapModel(session_id="distance-duck", lap_number="1", date="2026-01-01T00:00:00", track="Spa", car="Porsche", car_class="GTE", session_type="Practice", lap_time=72.0, valid_lap=False, distance_km=3.0))
        db.commit()

    summary = ProfileRepository().summary()

    assert summary["totals"]["total_distance_km"] == 3.0
    assert summary["distance_by_class"][0]["distance_km"] == 3.0
    assert summary["totals"]["total_laps"] == 1
    assert summary["totals"]["valid_laps"] == 0
