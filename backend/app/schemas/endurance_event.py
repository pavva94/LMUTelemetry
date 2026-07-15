from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field, model_validator

class DriverProfile(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    pace_delta_seconds: float = Field(default=0, ge=-10, le=20)
    consistency_seconds: float = Field(default=.35, ge=.01, le=10)
    fatigue_seconds_per_hour: float = Field(default=.05, ge=0, le=5)

class EventEntry(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    team_name: str = Field(min_length=1, max_length=100)
    car: str = "Unknown car"
    car_class: str = "Unclassified"
    baseline_lap_seconds: float = Field(gt=40, le=900)
    drivers: list[DriverProfile] = Field(min_length=1, max_length=8)
    target: bool = False

class HourlyWeather(BaseModel):
    hour: int = Field(ge=0, le=24)
    ambient_c: float = Field(ge=-20, le=60)
    track_c: float = Field(ge=-20, le=90)
    wetness: float = Field(default=0, ge=0, le=1)
    grip: float = Field(default=1, ge=.5, le=1.2)

class FullFieldRequest(BaseModel):
    session_id: str
    duration_minutes: int = Field(ge=30, le=1440)
    simulation_count: int = Field(default=1000, ge=100, le=10_000)
    random_seed: int = Field(default=42, ge=0)
    entries: list[EventEntry] = Field(min_length=1, max_length=60)
    weather: list[HourlyWeather] = Field(min_length=1, max_length=25)

    @model_validator(mode="after")
    def target_and_weather(self):
        if sum(entry.target for entry in self.entries) != 1:
            raise ValueError("Exactly one target entry is required.")
        if self.weather[0].hour != 0:
            raise ValueError("Weather forecast must begin at hour 0.")
        return self
