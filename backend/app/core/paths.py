from __future__ import annotations

import os
import sys
from pathlib import Path


APP_DIR_NAME = "LMUTelemetry"


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def resource_root() -> Path:
    if hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parents[3]


def app_data_dir() -> Path:
    override = os.getenv("LMU_TELEMETRY_DATA_DIR")
    if override:
        return Path(override).expanduser()

    if is_frozen():
        local_app_data = os.getenv("LOCALAPPDATA")
        if local_app_data:
            return Path(local_app_data) / APP_DIR_NAME
        return Path.home() / "AppData" / "Local" / APP_DIR_NAME

    return resource_root() / "data"


def log_dir() -> Path:
    override = os.getenv("LMU_TELEMETRY_LOG_DIR")
    if override:
        return Path(override).expanduser()
    return app_data_dir() / "logs"


def config_path() -> Path:
    return resource_root() / "config" / "default_strategy.yaml"


def seed_database_path() -> Path:
    return resource_root() / "data" / "seed" / "lmu_strategy.sqlite3"


def frontend_dist_dir() -> Path:
    return resource_root() / "frontend" / "dist"

