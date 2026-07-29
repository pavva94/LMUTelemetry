from __future__ import annotations

import math

import pytest

from app.analysis.xy_plot import SUPPORTED_PLOTS, UNAVAILABLE_REQUIREMENTS, build_xy_plot


def sample_rows() -> list[dict]:
    rows = []
    for index in range(80):
        lap = 1 if index < 40 else 2
        phase = (index % 40) / 39
        lateral_g = math.sin(phase * math.pi) * (0.8 + lap * 0.05)
        speed = 80 + phase * 150
        rows.append(
            {
                "timestamp": f"2026-01-01T00:00:{index:02d}",
                "game_time": index * 0.1,
                "lap_number": lap,
                "lap_distance": phase * 5000,
                "speed_kph": speed,
                "g_force_lat": lateral_g,
                "g_force_long": -0.7 + phase * 1.0,
                "yaw_rate": lateral_g * 0.35,
                "local_velocity_x": lateral_g * 0.6,
                "local_velocity_z": speed / 3.6,
                "throttle": phase,
                "brake": 1 - phase,
                "brake_pressure_fl": (1 - phase) * 0.8,
                "brake_pressure_fr": (1 - phase) * 0.82,
                "steering": lateral_g * 0.4,
                "gear": 2 + int(phase * 4),
                "rpm": 3500 + phase * 5000,
                "engine_torque": 480,
                "fuel_liters": 60 - index * 0.1,
                "front_ride_height": 0.065 - speed * 0.00003,
                "rear_ride_height": 0.078 - speed * 0.00002,
                "tyre_temp_fl": 78 + phase * 8,
                "tyre_temp_fr": 79 + phase * 8,
                "tyre_temp_rl": 76 + phase * 7,
                "tyre_temp_rr": 77 + phase * 7,
                "tyre_wear_fl": 0.1 + index * 0.0002,
                "tyre_compound_front": "Medium",
                "tyre_compound_rear": "Medium",
            }
        )
    return rows


LAPS = [
    {"lap_number": 1, "lap_time": 95.0, "valid_lap": True, "in_pit": False},
    {"lap_number": 2, "lap_time": 94.5, "valid_lap": True, "in_pit": False},
]


@pytest.mark.parametrize("plot_id", sorted(SUPPORTED_PLOTS))
def test_every_supported_plot_calculates_without_guessing_parameters(plot_id: str):
    result = build_xy_plot(sample_rows(), LAPS, plot_id=plot_id)

    assert result["plot_id"] == plot_id
    assert result["missing_requirements"] == []
    assert result["points"]
    assert result["stats"]["count"] >= len(result["points"])
    assert result["axes"]["x"]["label"]
    assert result["axes"]["y"]["label"]


def test_gg_uses_filtered_laps_and_preserves_raw_g_units():
    result = build_xy_plot(sample_rows(), LAPS, plot_id="gg", filters={"laps": [2], "valid_only": True})

    assert {point["lap"] for point in result["points"]} == {2}
    assert max(abs(point["x"]) for point in result["points"]) < 2
    assert result["filtered_count"] == 40


def test_power_uses_torque_times_rpm_conversion():
    rows = sample_rows()
    result = build_xy_plot(rows, LAPS, plot_id="engine_power")
    point = result["points"][-1]

    expected = 480 * point["x"] / 9549
    assert point["y"] == pytest.approx(expected)


def test_throttle_acceptance_aggregates_each_corner_exit_at_ninety_percent_throttle():
    result = build_xy_plot(sample_rows(), LAPS, plot_id="throttle_acceptance")

    assert len(result["points"]) == 2
    assert result["axes"]["x"]["label"] == "Peak lateral acceleration"
    assert result["axes"]["y"]["label"] == "Acceptance at 90% throttle"
    assert all(0 <= point["y"] <= 100 for point in result["points"])
    assert all(point["y"] < 60 for point in result["points"])


def test_custom_plot_supports_trend_percentile_envelope_and_downsampling():
    result = build_xy_plot(
        sample_rows(),
        LAPS,
        plot_id="custom",
        x_channel="speed_kph",
        y_channel="rpm",
        include_trend=True,
        include_envelope=True,
        max_points=25,
    )

    assert len(result["points"]) == 25
    assert len(result["trend"]) == 2
    assert len(result["envelope"]) > 2
    assert "speed_kph" in result["available_fields"]


def test_filters_cover_corner_speed_compound_fuel_and_valid_laps():
    rows = sample_rows()
    result = build_xy_plot(
        rows,
        LAPS,
        plot_id="gg",
        filters={
            "corners": ["C1"],
            "speed_min": 100,
            "speed_max": 180,
            "compound": "Medium",
            "fuel_min": 53,
            "fuel_max": 59,
            "valid_only": True,
        },
    )

    assert result["points"]
    assert all(point["corner"] == "C1" for point in result["points"])
    assert all(100 <= point["speed"] <= 180 for point in result["points"])
    assert all(53 <= point["fuel"] <= 59 for point in result["points"])


@pytest.mark.parametrize("plot_id,requirements", sorted(UNAVAILABLE_REQUIREMENTS.items()))
def test_unavailable_plots_report_precise_requirements(plot_id: str, requirements: list[str]):
    result = build_xy_plot(sample_rows(), LAPS, plot_id=plot_id)

    assert result["available"] is False
    assert result["missing_requirements"] == requirements
    assert result["points"] == []
