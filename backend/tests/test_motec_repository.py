from __future__ import annotations

from app.services.motec_repository import _motec_laps_with_quality


def lap_row(number: str, duration: float, distance: float | None) -> dict:
    return {
        "lap_number": number,
        "start_time": 0.0,
        "end_time": duration,
        "duration": duration,
        "sample_count": 100,
        "max_speed": 300.0,
        "min_corner_speed": 80.0,
        "max_rpm": 8000.0,
        "fuel_start": 80.0,
        "fuel_end": 75.0,
        "distance_km": distance,
        "average_speed": 180.0,
    }


def test_motec_lap_quality_rejects_real_data_out_and_partial_laps() -> None:
    rows = [
        lap_row("0", 946.98, 4.85),
        lap_row("1", 96.0, 4.87),
        lap_row("2", 93.72, 4.86),
        lap_row("3", 95.90, 4.86),
        lap_row("6", 12.60, 0.60),
    ]

    laps = _motec_laps_with_quality(rows)  # type: ignore[arg-type]

    assert [lap["lapNumber"] for lap in laps if lap["valid"]] == ["1", "2", "3"]
    assert "out_or_unidentified_lap" in laps[0]["quality"]
    assert "incomplete_or_implausible_duration" in laps[-1]["quality"]
