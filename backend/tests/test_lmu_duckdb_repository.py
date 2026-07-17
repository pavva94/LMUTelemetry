from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.db.models import AppSettingModel, LmuDuckdbSessionModel, LmuDuckdbSyncRunModel
from app.services import lmu_duckdb_repository


duckdb = pytest.importorskip("duckdb")


def _session_factory():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


def _make_duckdb(path):
    conn = duckdb.connect(str(path))
    try:
        conn.execute(
            """
            create table telemetry (
                "GPS Time" double,
                "Lap" integer,
                "Ground Speed" double,
                "Engine RPM" double,
                "Throttle Pos" double,
                "Brake Pos" double,
                "Steering Pos" double,
                "Fuel Level" double,
                "Tyres Wear" double[],
                "TyresPressure" double[],
                "Brakes Temp" double[],
                "RideHeights" double[],
                "Track Temperature" double,
                "Ambient Temperature" double
            )
            """
        )
        rows = [
            (0.0, 1, 100.0, 7000.0, 80.0, 0.0, 0.1, 80.0, [99, 99, 98, 98], [190, 191, 188, 189], [400, 410, 390, 395], [40, 41, 55, 56], 28.0, 21.0),
            (30.0, 1, 220.0, 8200.0, 100.0, 10.0, 0.0, 78.5, [98, 98, 97, 97], [191, 192, 189, 190], [500, 510, 470, 475], [38, 39, 53, 54], 29.0, 21.0),
            (60.0, 2, 120.0, 7100.0, 60.0, 20.0, -0.1, 77.0, [98, 98, 97, 97], [192, 193, 190, 191], [420, 430, 405, 410], [41, 42, 56, 57], 30.0, 22.0),
            (90.0, 2, 230.0, 8300.0, 100.0, 0.0, 0.0, 75.8, [97, 97, 96, 96], [193, 194, 191, 192], [505, 515, 480, 485], [39, 40, 54, 55], 30.0, 22.0),
        ]
        conn.executemany("insert into telemetry values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
    finally:
        conn.close()


def _make_channel_duckdb(path):
    conn = duckdb.connect(str(path))
    try:
        conn.execute('create table "GPS Time"("value" double)')
        conn.execute('create table "Ground Speed"("value" float)')
        conn.execute('create table "Engine RPM"("value" float)')
        conn.execute('create table "Throttle Pos"("value" float)')
        conn.execute('create table "Brake Pos"("value" float)')
        conn.execute('create table "Steering Pos"("value" float)')
        conn.execute('create table "Fuel Level"("value" float)')
        conn.execute('create table "Lap Dist"("value" float)')
        conn.execute('create table Lap(ts double, "value" usmallint)')
        conn.execute('create table "Brakes Temp"(value1 float, value2 float, value3 float, value4 float)')
        conn.execute('create table "Tyres Wear"(value1 float, value2 float, value3 float, value4 float)')
        conn.execute('create table TyresPressure(value1 float, value2 float, value3 float, value4 float)')
        conn.execute('create table RideHeights(value1 float, value2 float, value3 float, value4 float)')
        conn.execute('create table channelsList(channelName varchar primary key, frequency integer, unit varchar)')
        conn.execute('create table metadata("key" varchar primary key, "value" varchar)')
        conn.executemany(
            "insert into metadata values (?, ?)",
            [("track", "Le Mans"), ("car", "Ferrari 499P"), ("sessionType", "Race")],
        )
        for name in ["GPS Time", "Ground Speed", "Engine RPM", "Throttle Pos", "Brake Pos", "Steering Pos", "Fuel Level", "Lap Dist", "Brakes Temp", "Tyres Wear", "TyresPressure", "RideHeights"]:
            conn.execute("insert into channelsList values (?, 1, '')", [name])
        for table, values in {
            "GPS Time": [0.0, 1.0, 2.0, 3.0],
            "Ground Speed": [100.0, 220.0, 120.0, 230.0],
            "Engine RPM": [7000.0, 8200.0, 7100.0, 8300.0],
            "Throttle Pos": [80.0, 100.0, 60.0, 100.0],
            "Brake Pos": [0.0, 10.0, 20.0, 0.0],
            "Steering Pos": [0.1, 0.0, -0.1, 0.0],
            "Fuel Level": [80.0, 78.5, 77.0, 75.8],
            "Lap Dist": [10.0, 250.0, 5.0, 260.0],
        }.items():
            conn.executemany(f'insert into "{table}" values (?)', [(value,) for value in values])
        conn.executemany('insert into Lap values (?, ?)', [(0.0, 1), (2.0, 2)])
        vector_rows = [(1.0, 2.0, 3.0, 4.0), (2.0, 3.0, 4.0, 5.0), (3.0, 4.0, 5.0, 6.0), (4.0, 5.0, 6.0, 7.0)]
        for table in ['"Brakes Temp"', '"Tyres Wear"', 'TyresPressure', 'RideHeights']:
            conn.executemany(f"insert into {table} values (?, ?, ?, ?)", vector_rows)
    finally:
        conn.close()


def _make_outlier_duckdb(path):
    conn = duckdb.connect(str(path))
    try:
        conn.execute(
            """
            create table telemetry (
                "GPS Time" double,
                "Lap" integer,
                "Ground Speed" double,
                "Fuel Level" double
            )
            """
        )
        rows = [
            (0.0, 1, 180.0, 80.0),
            (100.0, 1, 210.0, 78.0),
            (100.0, 2, 181.0, 78.0),
            (201.0, 2, 211.0, 76.0),
            (201.0, 3, 182.0, 76.0),
            (303.0, 3, 212.0, 74.0),
            (303.0, 4, 183.0, 74.0),
            (405.0, 4, 213.0, 72.0),
            (405.0, 5, 184.0, 72.0),
            (508.0, 5, 214.0, 70.0),
            (508.0, 6, 9999.0, 70.0),
            (513.0, 6, 9999.0, 20.0),
        ]
        conn.executemany("insert into telemetry values (?, ?, ?, ?)", rows)
    finally:
        conn.close()


def test_scan_folder_returns_duckdb_sessions(tmp_path) -> None:
    db_path = tmp_path / "session.duckdb"
    _make_duckdb(db_path)

    payload = lmu_duckdb_repository.scan_folder(str(tmp_path))

    assert payload["warnings"] == []
    assert len(payload["sessions"]) == 1
    assert payload["sessions"][0]["file_name"] == "session.duckdb"
    assert payload["sessions"][0]["sample_count"] is None
    assert payload["total"] == 1
    assert payload["next_offset"] is None


def test_review_session_maps_channels_and_laps(tmp_path) -> None:
    db_path = tmp_path / "session.duckdb"
    _make_duckdb(db_path)
    session_id = lmu_duckdb_repository.scan_folder(str(tmp_path))["sessions"][0]["id"]

    review = lmu_duckdb_repository.review_session(str(tmp_path), session_id, sample_limit=2)

    assert review["session"]["file_name"] == "session.duckdb"
    assert len(review["telemetry_samples"]) == 2
    assert len(review["laps"]) == 2
    assert review["summary"]["top_speed"] == 230.0
    assert review["laps"][0]["fuel_used"] == 1.5
    assert review["laps"][0]["tyre_wear_end_fl"] == pytest.approx(0.02)
    assert review["telemetry_samples"][0]["speed_kph"] == 100.0
    assert review["telemetry_samples"][0]["tyre_wear_fl"] == pytest.approx(0.01)


def test_review_summary_filters_lap_and_speed_outliers(tmp_path) -> None:
    db_path = tmp_path / "outliers.duckdb"
    _make_outlier_duckdb(db_path)
    session_id = lmu_duckdb_repository.scan_folder(str(tmp_path))["sessions"][0]["id"]

    review = lmu_duckdb_repository.review_session(str(tmp_path), session_id, sample_limit=20)

    assert review["summary"]["best_lap"] == pytest.approx(100.0)
    assert review["summary"]["average_lap"] == pytest.approx(101.6)
    assert review["summary"]["top_speed"] == pytest.approx(214.0)
    assert review["summary"]["average_fuel_per_lap"] == pytest.approx(2.0)
    assert review["summary"]["total_fuel_used"] == pytest.approx(10.0)


def test_summary_uses_recent_five_laps_not_average_of_overlapping_averages() -> None:
    laps = [
        {"lap_number": index + 1, "lap_time": value, "valid_lap": True, "in_pit": False, "fuel_used": 2.0}
        for index, value in enumerate([100.0, 100.0, 100.0, 100.0, 100.0, 110.0])
    ]
    info = lmu_duckdb_repository.TableInfo("main", "telemetry", [], 6, {}, {}, 0)

    summary = lmu_duckdb_repository._summary([], laps, info)

    assert summary["average_five_lap_pace"] == pytest.approx(102.0)
    assert summary["valid_lap_count"] == 6
    assert summary["pace_lap_count"] == 6


def test_review_session_reads_lmu_table_per_channel_schema(tmp_path) -> None:
    db_path = tmp_path / "session_tables.duckdb"
    _make_channel_duckdb(db_path)
    session_id = lmu_duckdb_repository.scan_folder(str(tmp_path))["sessions"][0]["id"]

    review = lmu_duckdb_repository.review_session(str(tmp_path), session_id, sample_limit=10)

    assert review["warnings"] == []
    assert review["session"]["track_name"] == "Le Mans"
    assert review["session"]["vehicle_name"] == "Ferrari 499P"
    assert review["session"]["session_type"] == "Race"
    assert review["session"]["metadata"]["track"] == "Le Mans"
    assert len(review["telemetry_samples"]) == 4
    assert len(review["laps"]) == 2
    assert review["summary"]["top_speed"] == 230.0
    assert review["telemetry_samples"][0]["speed_kph"] == 100.0
    assert review["telemetry_samples"][0]["brake_temp_fl"] == 1.0
    assert review["telemetry_samples"][2]["lap_number"] == 2
    assert review["laps"][0]["fuel_used"] == 1.5
    assert review["laps"][0]["tyre_wear_end_fl"] == pytest.approx(0.98)
    assert review["available_fields"]["position"] is False
    assert any(channel["table"] == "Ground Speed" for channel in review["channel_manifest"])


def test_review_session_maps_position_when_source_table_exists(tmp_path) -> None:
    db_path = tmp_path / "session_with_position.duckdb"
    _make_channel_duckdb(db_path)
    conn = duckdb.connect(str(db_path))
    try:
        conn.execute('create table Position(ts double, "value" usmallint)')
        conn.execute('create table "Class Position"(ts double, "value" usmallint)')
        conn.executemany('insert into Position values (?, ?)', [(0.0, 4), (2.0, 2)])
        conn.executemany('insert into "Class Position" values (?, ?)', [(0.0, 3), (2.0, 1)])
    finally:
        conn.close()
    session_id = lmu_duckdb_repository.scan_folder(str(tmp_path))["sessions"][0]["id"]

    review = lmu_duckdb_repository.review_session(str(tmp_path), session_id, sample_limit=10)

    assert review["available_fields"]["position"] is True
    assert review["available_fields"]["class_position"] is True
    assert review["laps"][0]["position"] == 4
    assert review["laps"][1]["class_position"] == 1


def test_review_session_maps_expanded_lmu_channels(tmp_path) -> None:
    db_path = tmp_path / "session_expanded.duckdb"
    _make_channel_duckdb(db_path)
    conn = duckdb.connect(str(db_path))
    try:
        conn.execute('create table "G Force Lat"("value" float)')
        conn.execute('create table "Total Dist"("value" float)')
        conn.execute('create table SoC("value" float)')
        conn.execute('create table "Virtual Energy"("value" float)')
        conn.execute('create table "Brakes Force"(value1 float, value2 float, value3 float, value4 float)')
        conn.execute('create table "TyresRimTemp"(value1 float, value2 float, value3 float, value4 float)')
        conn.execute('create table "Sector1 Flag"(ts double, "value" usmallint)')
        conn.execute('create table "TyresCompound"(ts double, value1 integer, value2 integer, value3 integer, value4 integer)')
        for name in ["G Force Lat", "Total Dist", "SoC", "Virtual Energy", "Brakes Force", "TyresRimTemp"]:
            conn.execute("insert into channelsList values (?, 1, '')", [name])
        for table, values in {
            "G Force Lat": [0.1, 0.2, 0.3, 0.4],
            "Total Dist": [0.0, 100.0, 220.0, 360.0],
            "SoC": [0.9, 0.89, 0.88, 0.87],
            "Virtual Energy": [40.0, 39.5, 39.0, 38.5],
        }.items():
            conn.executemany(f'insert into "{table}" values (?)', [(value,) for value in values])
        conn.executemany('insert into "Brakes Force" values (?, ?, ?, ?)', [(10, 11, 12, 13), (20, 21, 22, 23), (30, 31, 32, 33), (40, 41, 42, 43)])
        conn.executemany('insert into "TyresRimTemp" values (?, ?, ?, ?)', [(60, 61, 62, 63), (64, 65, 66, 67), (68, 69, 70, 71), (72, 73, 74, 75)])
        conn.executemany('insert into "Sector1 Flag" values (?, ?)', [(0.0, 1), (2.0, 3)])
        conn.executemany('insert into "TyresCompound" values (?, ?, ?, ?, ?)', [(0.0, 2, 2, 2, 2)])
    finally:
        conn.close()
    session_id = lmu_duckdb_repository.scan_folder(str(tmp_path))["sessions"][0]["id"]

    review = lmu_duckdb_repository.review_session(str(tmp_path), session_id, sample_limit=10)
    first = review["telemetry_samples"][0]

    assert review["available_fields"]["gps"] is True
    assert review["available_fields"]["energy"] is True
    assert review["available_fields"]["brake_detail"] is True
    assert review["available_fields"]["tyre_detail"] is True
    assert review["available_fields"]["flags"] is True
    assert first["g_force_lat"] == pytest.approx(0.1)
    assert first["brake_force_fl"] == 10.0
    assert first["tyre_temp_rim_fl"] == 60.0
    assert first["sector1_flag"] == 1.0
    assert first["tyre_compound_fl"] == 2.0


def test_review_session_downsamples_large_channel_tables(tmp_path) -> None:
    db_path = tmp_path / "large.duckdb"
    conn = duckdb.connect(str(db_path))
    try:
        for table in ["GPS Time", "Ground Speed", "Engine RPM", "Throttle Pos", "Brake Pos", "Steering Pos", "Fuel Level"]:
            conn.execute(f'create table "{table}"("value" double)')
        conn.execute('create table Lap(ts double, "value" usmallint)')
        conn.execute('create table channelsList(channelName varchar primary key, frequency integer, unit varchar)')
        for name in ["GPS Time", "Ground Speed", "Engine RPM", "Throttle Pos", "Brake Pos", "Steering Pos", "Fuel Level"]:
            conn.execute("insert into channelsList values (?, 10, '')", [name])
        time_rows = [(index / 10.0,) for index in range(1000)]
        value_rows = [(float(index),) for index in range(1000)]
        conn.executemany('insert into "GPS Time" values (?)', time_rows)
        for table in ["Ground Speed", "Engine RPM", "Throttle Pos", "Brake Pos", "Steering Pos", "Fuel Level"]:
            conn.executemany(f'insert into "{table}" values (?)', value_rows)
        conn.execute('insert into Lap values (0.0, 1)')
    finally:
        conn.close()
    session_id = lmu_duckdb_repository.scan_folder(str(tmp_path))["sessions"][0]["id"]

    review = lmu_duckdb_repository.review_session(str(tmp_path), session_id, sample_limit=25)

    assert len(review["telemetry_samples"]) <= 25
    assert review["summary"]["sample_count"] == 1000


def test_review_summary_is_independent_of_chart_sample_limit(tmp_path) -> None:
    db_path = tmp_path / "sample_limit_independence.duckdb"
    _make_outlier_duckdb(db_path)
    session_id = lmu_duckdb_repository.scan_folder(str(tmp_path))["sessions"][0]["id"]

    compact = lmu_duckdb_repository.review_session(str(tmp_path), session_id, sample_limit=2)
    detailed = lmu_duckdb_repository.review_session(str(tmp_path), session_id, sample_limit=5000)

    assert compact["summary"] == detailed["summary"]
    assert compact["laps"] == detailed["laps"]
    assert len(compact["telemetry_samples"]) == 2


def test_unsupported_duckdb_file_returns_warning(tmp_path) -> None:
    db_path = tmp_path / "unsupported.duckdb"
    conn = duckdb.connect(str(db_path))
    try:
        conn.execute("create table notes (message varchar)")
    finally:
        conn.close()

    session_id = lmu_duckdb_repository.scan_folder(str(tmp_path))["sessions"][0]["id"]
    review = lmu_duckdb_repository.review_session(str(tmp_path), session_id)

    assert review["session"]["sample_count"] == 0
    assert review["warnings"]


def test_sync_caches_new_sessions_and_skips_unchanged(monkeypatch, tmp_path) -> None:
    factory = _session_factory()
    monkeypatch.setattr(lmu_duckdb_repository, "SessionLocal", factory)
    db_path = tmp_path / "session_tables.duckdb"
    _make_channel_duckdb(db_path)

    first = lmu_duckdb_repository.sync_folder(str(tmp_path))
    second = lmu_duckdb_repository.sync_folder(str(tmp_path))

    assert first["processed"] == 1
    assert first["active_sessions"] == 1
    assert second["processed"] == 0
    assert second["skipped"] == 1
    payload = lmu_duckdb_repository.cached_sessions()
    assert payload["total"] == 1
    assert payload["sessions"][0]["track_name"] == "Le Mans"
    with factory() as db:
        assert db.query(LmuDuckdbSessionModel).filter_by(active=True).count() == 1


def test_review_reuses_validated_cache_and_stale_signature_falls_back(monkeypatch, tmp_path) -> None:
    factory = _session_factory()
    monkeypatch.setattr(lmu_duckdb_repository, "SessionLocal", factory)
    db_path = tmp_path / "session_tables.duckdb"
    _make_channel_duckdb(db_path)
    baseline_session = lmu_duckdb_repository.scan_folder(str(tmp_path))["sessions"][0]
    baseline = lmu_duckdb_repository.review_session(str(tmp_path), baseline_session["id"], sample_limit=10)
    lmu_duckdb_repository.sync_folder(str(tmp_path))

    monkeypatch.setattr(lmu_duckdb_repository, "_review_file", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("full review called")))
    cached = lmu_duckdb_repository.review_session(None, baseline_session["id"], sample_limit=10)

    assert cached["laps"] == baseline["laps"]
    assert cached["summary"] == baseline["summary"]
    assert cached["pit_events"] == baseline["pit_events"]
    assert set(cached["available_fields"]) == set(baseline["available_fields"])

    conn = duckdb.connect(str(db_path))
    conn.execute("create table cache_signature_change(value integer)")
    conn.close()
    with pytest.raises(AssertionError, match="full review called"):
        lmu_duckdb_repository.review_session(None, baseline_session["id"], sample_limit=10)


def test_sync_reuses_cache_after_processing_changed_file(monkeypatch, tmp_path) -> None:
    factory = _session_factory()
    monkeypatch.setattr(lmu_duckdb_repository, "SessionLocal", factory)
    changed_path = tmp_path / "changed.duckdb"
    unchanged_path = tmp_path / "unchanged.duckdb"
    _make_channel_duckdb(changed_path)
    _make_channel_duckdb(unchanged_path)
    lmu_duckdb_repository.sync_folder(str(tmp_path))

    changed_path.unlink()
    _make_channel_duckdb(changed_path)
    result = lmu_duckdb_repository.sync_folder(str(tmp_path))

    assert result["processed"] == 1
    assert result["skipped"] == 1
    assert result["failed"] == 0


def test_sync_marks_removed_files_inactive(monkeypatch, tmp_path) -> None:
    factory = _session_factory()
    monkeypatch.setattr(lmu_duckdb_repository, "SessionLocal", factory)
    db_path = tmp_path / "session_tables.duckdb"
    _make_channel_duckdb(db_path)
    lmu_duckdb_repository.sync_folder(str(tmp_path))

    db_path.unlink()
    result = lmu_duckdb_repository.sync_folder(str(tmp_path))

    assert result["inactive"] == 1
    assert result["active_sessions"] == 0


def test_sync_commits_processed_files_when_later_file_fails(monkeypatch, tmp_path) -> None:
    factory = _session_factory()
    monkeypatch.setattr(lmu_duckdb_repository, "SessionLocal", factory)
    good_path = tmp_path / "good.duckdb"
    broken_path = tmp_path / "broken.duckdb"
    _make_channel_duckdb(good_path)
    _make_channel_duckdb(broken_path)
    original_review = lmu_duckdb_repository._review_file

    def flaky_review(file_path, *args, **kwargs):
        if file_path.name == "broken.duckdb":
            raise RuntimeError("broken file")
        return original_review(file_path, *args, **kwargs)

    monkeypatch.setattr(lmu_duckdb_repository, "_review_file", flaky_review)

    result = lmu_duckdb_repository.sync_folder(str(tmp_path))

    assert result["processed"] == 1
    assert result["failed"] == 1
    with factory() as db:
        assert db.query(LmuDuckdbSessionModel).filter_by(active=True).count() == 1
        run = db.query(LmuDuckdbSyncRunModel).one()
        assert run.status == "complete"
        assert run.processed == 1
        assert run.failed == 1


def test_interrupted_sync_does_not_mark_removed_files_inactive(monkeypatch, tmp_path) -> None:
    factory = _session_factory()
    monkeypatch.setattr(lmu_duckdb_repository, "SessionLocal", factory)
    db_path = tmp_path / "session_tables.duckdb"
    _make_channel_duckdb(db_path)
    lmu_duckdb_repository.sync_folder(str(tmp_path))
    db_path.unlink()
    with factory() as db:
        db.add(
            LmuDuckdbSyncRunModel(
                id="active-sync",
                folder_path=str(tmp_path),
                status="running",
                warnings_json="[]",
                started_at="2026-01-01T00:00:00",
                updated_at="2026-01-01T00:00:00",
            )
        )
        db.commit()

    assert lmu_duckdb_repository.mark_interrupted_sync_runs() == 1
    with factory() as db:
        assert db.query(LmuDuckdbSessionModel).filter_by(active=True).count() == 1
        assert db.get(LmuDuckdbSyncRunModel, "active-sync").status == "interrupted"


def test_start_sync_run_reuses_active_run(monkeypatch, tmp_path) -> None:
    factory = _session_factory()
    monkeypatch.setattr(lmu_duckdb_repository, "SessionLocal", factory)
    monkeypatch.setattr(lmu_duckdb_repository, "_ensure_sync_thread", lambda *_args, **_kwargs: None)
    db_path = tmp_path / "session_tables.duckdb"
    _make_channel_duckdb(db_path)

    first = lmu_duckdb_repository.start_sync_run(str(tmp_path))
    second = lmu_duckdb_repository.start_sync_run(str(tmp_path))

    assert second["id"] == first["id"]
    assert second["status"] == "queued"
    with factory() as db:
        assert db.query(LmuDuckdbSyncRunModel).count() == 1


def test_configured_folder_lists_and_reviews_without_cache(monkeypatch, tmp_path) -> None:
    factory = _session_factory()
    monkeypatch.setattr(lmu_duckdb_repository, "SessionLocal", factory)
    db_path = tmp_path / "session_tables.duckdb"
    _make_channel_duckdb(db_path)
    with factory() as db:
        db.add(AppSettingModel(key=lmu_duckdb_repository.FOLDER_SETTING_KEY, value=str(tmp_path), updated_at="2026-01-01T00:00:00"))
        db.commit()

    payload = lmu_duckdb_repository.sessions_from_cache_or_setting()
    review = lmu_duckdb_repository.review_session(None, payload["sessions"][0]["id"], sample_limit=10)

    assert payload["total"] == 1
    assert payload["warnings"][0].startswith("Showing configured folder files")
    assert review["session"]["track_name"] == "Le Mans"
    assert len(review["telemetry_samples"]) == 4


def test_discovers_lmu_telemetry_folder_from_steam_library_manifest(monkeypatch, tmp_path) -> None:
    steam = tmp_path / "Steam"
    library = tmp_path / "Games" / "SteamLibrary"
    telemetry = library / "steamapps" / "common" / "Le Mans Ultimate" / "UserData" / "Telemetry"
    telemetry.mkdir(parents=True)
    manifest = steam / "steamapps" / "libraryfolders.vdf"
    manifest.parent.mkdir(parents=True)
    manifest.write_text(
        f'"libraryfolders" {{ "0" {{ "path" "{str(library).replace(chr(92), chr(92) * 2)}" }} }}',
        encoding="utf-8",
    )
    monkeypatch.setattr(lmu_duckdb_repository, "_steam_install_candidates", lambda: [steam])
    monkeypatch.setattr(lmu_duckdb_repository, "_common_steam_library_roots", lambda: [])
    monkeypatch.setattr(lmu_duckdb_repository, "DEFAULT_WINDOWS_TELEMETRY_FOLDER", tmp_path / "missing")

    assert lmu_duckdb_repository.discover_lmu_telemetry_folder() == str(telemetry)


def test_configured_folder_uses_discovery_when_no_setting(monkeypatch, tmp_path) -> None:
    factory = _session_factory()
    monkeypatch.setattr(lmu_duckdb_repository, "SessionLocal", factory)
    telemetry = tmp_path / "SteamLibrary" / "steamapps" / "common" / "Le Mans Ultimate" / "UserData" / "Telemetry"
    telemetry.mkdir(parents=True)
    monkeypatch.setattr(lmu_duckdb_repository, "_steam_library_roots", lambda: [])
    monkeypatch.setattr(lmu_duckdb_repository, "_common_steam_library_roots", lambda: [tmp_path / "SteamLibrary"])
    monkeypatch.setattr(lmu_duckdb_repository, "DEFAULT_WINDOWS_TELEMETRY_FOLDER", tmp_path / "missing")

    assert lmu_duckdb_repository._configured_folder_path() == str(telemetry)
