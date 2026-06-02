from __future__ import annotations

from fastapi import APIRouter, Query

from app.services.profile_repository import ProfileFilters, ProfileRepository

router = APIRouter(prefix="/api/profile", tags=["profile"])


@router.get("/summary")
def profile_summary():
    return ProfileRepository().summary()


@router.get("/overview")
def profile_overview():
    return ProfileRepository().overview()


@router.get("/best-laps")
def profile_best_laps():
    return ProfileRepository().best_laps()


@router.get("/laps")
def profile_laps(
    track: str | None = None,
    car: str | None = None,
    car_class: str | None = Query(None, alias="class"),
    session: str | None = None,
    layout: str | None = None,
    lap_number: str | None = None,
    source: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    valid_only: bool = False,
    valid_status: str | None = None,
    tyre_compound: str | None = None,
    track_temp_min: float | None = None,
    track_temp_max: float | None = None,
    ambient_temp_min: float | None = None,
    ambient_temp_max: float | None = None,
    fuel_min: float | None = None,
    fuel_max: float | None = None,
    fuel_used_min: float | None = None,
    fuel_used_max: float | None = None,
    lap_time_min: float | None = None,
    lap_time_max: float | None = None,
    tyre_wear_min: float | None = None,
    tyre_wear_max: float | None = None,
    tyre_pressure_min: float | None = None,
    tyre_pressure_max: float | None = None,
    brake_temp_min: float | None = None,
    brake_temp_max: float | None = None,
    oil_temp_min: float | None = None,
    oil_temp_max: float | None = None,
    water_temp_min: float | None = None,
    water_temp_max: float | None = None,
    speed_min: float | None = None,
    speed_max: float | None = None,
    search: str | None = None,
    sort: str = "date",
    direction: str = "desc",
    page: int = 1,
    page_size: int = 100,
):
    return ProfileRepository().filtered_laps(
        ProfileFilters(
            track=track,
            car=car,
            car_class=car_class,
            session=session,
            layout=layout,
            lap_number=lap_number,
            source=source,
            date_from=date_from,
            date_to=date_to,
            valid_only=valid_only,
            valid_status=valid_status,
            tyre_compound=tyre_compound,
            track_temp_min=track_temp_min,
            track_temp_max=track_temp_max,
            ambient_temp_min=ambient_temp_min,
            ambient_temp_max=ambient_temp_max,
            fuel_min=fuel_min,
            fuel_max=fuel_max,
            fuel_used_min=fuel_used_min,
            fuel_used_max=fuel_used_max,
            lap_time_min=lap_time_min,
            lap_time_max=lap_time_max,
            tyre_wear_min=tyre_wear_min,
            tyre_wear_max=tyre_wear_max,
            tyre_pressure_min=tyre_pressure_min,
            tyre_pressure_max=tyre_pressure_max,
            brake_temp_min=brake_temp_min,
            brake_temp_max=brake_temp_max,
            oil_temp_min=oil_temp_min,
            oil_temp_max=oil_temp_max,
            water_temp_min=water_temp_min,
            water_temp_max=water_temp_max,
            speed_min=speed_min,
            speed_max=speed_max,
            search=search,
            sort=sort,
            direction=direction,
            page=page,
            page_size=page_size,
        )
    )
