from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel

from app.schemas.strategy import StrategyAssumptions


ROOT_DIR = Path(__file__).resolve().parents[3]


class Settings(BaseModel):
    app_name: str = "LMU Race Strategy Assistant"
    use_mock_telemetry: bool = True
    poll_hz: int = 10
    broadcast_hz: int = 5
    log_hz: int = 1
    live_analysis_retained_laps: int = 10
    tyre_radius_m: float = 0.32
    vehicle_mass_kg: float = 1030.0
    roll_center_height_m: float = 0.08
    track_width_m: float = 1.9
    wheelbase_m: float = 3.0
    database_url: str = f"sqlite:///{ROOT_DIR / 'data' / 'sessions' / 'lmu_strategy.sqlite3'}"
    assumptions: StrategyAssumptions = StrategyAssumptions()


def _read_yaml_config() -> dict:
    path = ROOT_DIR / "config" / "default_strategy.yaml"
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


@lru_cache
def get_settings() -> Settings:
    raw = _read_yaml_config()
    dev = raw.get("dev", {})
    display = raw.get("display", {})
    strategy = raw.get("strategy", {})
    event = raw.get("event", {})
    use_mock = os.getenv("USE_MOCK_TELEMETRY")
    assumptions = StrategyAssumptions(
        race_duration_minutes=float(event.get("race_duration_minutes") or 120),
        pit_loss_seconds=float(strategy.get("pit_loss_seconds") or 28.0),
        pit_stationary_seconds=float(strategy.get("pit_stationary_seconds") or 12.0),
        tyre_change_seconds_per_tyre=float(strategy.get("tyre_change_seconds_per_tyre") or 3.0),
        refuel_seconds_per_5_liters=float(strategy.get("refuel_seconds_per_5_liters") or 1.2),
        race_start_fuel_liters=float(strategy.get("race_start_fuel_liters") or 90.0),
        safety_car_pit_loss_seconds=float(strategy.get("safety_car_pit_loss_seconds") or 16.0),
        fuel_safety_margin_liters=float(strategy.get("fuel_safety_margin_liters") or 2.0),
        fuel_safety_margin_laps=float(strategy.get("fuel_safety_margin_laps") or 1.0),
        max_tyre_wear=float(strategy.get("max_tyre_wear") or 0.75),
    )
    return Settings(
        use_mock_telemetry=(use_mock.lower() == "true") if use_mock is not None else bool(dev.get("use_mock_telemetry", True)),
        poll_hz=int(display.get("telemetry_update_hz") or 10),
        broadcast_hz=int(display.get("telemetry_update_hz") or 5),
        log_hz=int(display.get("log_update_hz") or 1),
        assumptions=assumptions,
    )
