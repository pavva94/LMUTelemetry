from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
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
