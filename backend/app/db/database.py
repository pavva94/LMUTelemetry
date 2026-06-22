from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy import inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


engine = create_engine(get_settings().database_url, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def _ensure_sqlite_database_directory() -> None:
    url = make_url(get_settings().database_url)
    if not url.drivername.startswith("sqlite") or not url.database or url.database == ":memory:":
        return

    Path(url.database).expanduser().parent.mkdir(parents=True, exist_ok=True)


def init_db() -> None:
    from app.db import models  # noqa: F401

    _ensure_sqlite_database_directory()
    Base.metadata.create_all(bind=engine)
    _ensure_sqlite_columns()


def _ensure_sqlite_columns() -> None:
    url = make_url(get_settings().database_url)
    if not url.drivername.startswith("sqlite"):
        return

    inspector = inspect(engine)
    table_names = inspector.get_table_names()
    if "sessions" not in table_names or "telemetry_samples" not in table_names:
        return

    existing = {column["name"] for column in inspector.get_columns("sessions")}
    columns = {
        "track_layout": "VARCHAR",
        "vehicle_model": "VARCHAR",
        "vehicle_class": "VARCHAR",
        "final_position": "INTEGER",
        "final_class_position": "INTEGER",
        "classified_status": "VARCHAR",
        "total_cars": "INTEGER",
        "is_saved": "BOOLEAN DEFAULT 1 NOT NULL",
        "removed_at": "VARCHAR",
    }
    with engine.begin() as connection:
        for name, column_type in columns.items():
            if name not in existing:
                connection.execute(text(f"ALTER TABLE sessions ADD COLUMN {name} {column_type}"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_sessions_saved_created_at ON sessions (is_saved, created_at)"))

    existing = {column["name"] for column in inspector.get_columns("telemetry_samples")}
    columns = {
        "position": "INTEGER",
        "class_position": "INTEGER",
        "current_lap_time": "FLOAT",
        "last_lap_time": "FLOAT",
        "best_lap_time": "FLOAT",
        "fuel_capacity_liters": "FLOAT",
        "abs_active": "BOOLEAN",
        "tc_active": "BOOLEAN",
        "abs_setting": "INTEGER",
        "abs_max": "INTEGER",
        "tc_setting": "INTEGER",
        "tc_max": "INTEGER",
        "tc_slip_setting": "INTEGER",
        "tc_cut_setting": "INTEGER",
        "engine_oil_temp": "FLOAT",
        "engine_water_temp": "FLOAT",
        "brake_temp_fl": "FLOAT",
        "brake_temp_fr": "FLOAT",
        "brake_temp_rl": "FLOAT",
        "brake_temp_rr": "FLOAT",
        "brake_pressure_fl": "FLOAT",
        "brake_pressure_fr": "FLOAT",
        "brake_pressure_rl": "FLOAT",
        "brake_pressure_rr": "FLOAT",
        "ride_height_fl": "FLOAT",
        "ride_height_fr": "FLOAT",
        "ride_height_rl": "FLOAT",
        "ride_height_rr": "FLOAT",
        "front_ride_height": "FLOAT",
        "rear_ride_height": "FLOAT",
        "suspension_deflection_fl": "FLOAT",
        "suspension_deflection_fr": "FLOAT",
        "suspension_deflection_rl": "FLOAT",
        "suspension_deflection_rr": "FLOAT",
        "tyre_wear_fl": "FLOAT",
        "tyre_wear_fr": "FLOAT",
        "tyre_wear_rl": "FLOAT",
        "tyre_wear_rr": "FLOAT",
        "tyre_load_fl": "FLOAT",
        "tyre_load_fr": "FLOAT",
        "tyre_load_rl": "FLOAT",
        "tyre_load_rr": "FLOAT",
        "tyre_pressure_fl": "FLOAT",
        "tyre_pressure_fr": "FLOAT",
        "tyre_pressure_rl": "FLOAT",
        "tyre_pressure_rr": "FLOAT",
        "tyre_temp_fl": "FLOAT",
        "tyre_temp_fr": "FLOAT",
        "tyre_temp_rl": "FLOAT",
        "tyre_temp_rr": "FLOAT",
        "pitstops": "INTEGER",
        "in_pits": "BOOLEAN",
        "pit_state": "VARCHAR",
    }
    with engine.begin() as connection:
        for name, column_type in columns.items():
            if name not in existing:
                connection.execute(text(f"ALTER TABLE telemetry_samples ADD COLUMN {name} {column_type}"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_telemetry_samples_session_id_id ON telemetry_samples (session_id, id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_telemetry_samples_session_id_lap ON telemetry_samples (session_id, lap_number)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_recommendations_session_id_id ON recommendations (session_id, id)"))

    if "lap_summaries" in table_names:
        with engine.begin() as connection:
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_lap_summaries_session_id_lap ON lap_summaries (session_id, lap_number)"))

    if "session_aggregates" in table_names:
        existing = {column["name"] for column in inspector.get_columns("session_aggregates")}
        columns = {
            "sample_trace_json": "TEXT",
        }
        with engine.begin() as connection:
            for name, column_type in columns.items():
                if name not in existing:
                    connection.execute(text(f"ALTER TABLE session_aggregates ADD COLUMN {name} {column_type}"))

    if "lmu_duckdb_sessions" in table_names:
        existing = {column["name"] for column in inspector.get_columns("lmu_duckdb_sessions")}
        with engine.begin() as connection:
            if "laps_json" not in existing:
                connection.execute(text("ALTER TABLE lmu_duckdb_sessions ADD COLUMN laps_json TEXT"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_lmu_duckdb_sessions_file_key ON lmu_duckdb_sessions (file_key)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_lmu_duckdb_sessions_active_modified ON lmu_duckdb_sessions (active, modified_at)"))

    if "lmu_duckdb_laps" in table_names:
        with engine.begin() as connection:
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_lmu_duckdb_laps_session_lap ON lmu_duckdb_laps (session_id, lap_number)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_lmu_duckdb_laps_track_car ON lmu_duckdb_laps (track, car, car_class)"))
