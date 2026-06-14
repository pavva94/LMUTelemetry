from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.db.models import AppSettingModel, LmuDuckdbSessionModel
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
    assert review["laps"][0]["tyre_wear_end_fl"] == 98.0
    assert review["telemetry_samples"][0]["speed_kph"] == 100.0


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
