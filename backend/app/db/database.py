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
    if "telemetry_samples" not in inspector.get_table_names():
        return

    existing = {column["name"] for column in inspector.get_columns("telemetry_samples")}
    columns = {
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
        "tyre_load_fl": "FLOAT",
        "tyre_load_fr": "FLOAT",
        "tyre_load_rl": "FLOAT",
        "tyre_load_rr": "FLOAT",
    }
    with engine.begin() as connection:
        for name, column_type in columns.items():
            if name not in existing:
                connection.execute(text(f"ALTER TABLE telemetry_samples ADD COLUMN {name} {column_type}"))
