from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from app.reports.analyzers import (
    FuelAnalyzer, LapAnalyzer, SessionAnalysisPipeline, SessionDataValidator,
    SessionTypeAnalyzer, StintAnalyzer, confidence, theil_sen,
)
from app.reports.models import ReportConfiguration
from app.reports.pdf_renderer import PdfReportRenderer


def lap(number: int, time: float | None, *, valid: bool = True, pit: bool = False, fuel: float | None = 2.0, position: int | None = None) -> dict:
    return {
        "lap_number": number, "lap_time": time, "timing_source": "official" if time is not None else "partial_samples",
        "valid_lap": valid, "in_pit": pit, "under_yellow": False,
        "fuel_start": 80 - number * 2, "fuel_end": 78 - number * 2, "fuel_used": fuel,
        "fuel_added": 0, "position": position,
        "tyre_wear_end_fl": .01 * number, "tyre_wear_end_fr": .011 * number,
        "tyre_wear_end_rl": .009 * number, "tyre_wear_end_rr": .01 * number,
    }


def review(session_type: str = "Practice", laps: list[dict] | None = None, samples: list[dict] | None = None) -> dict:
    return {
        "session": {"id": "session-1", "session_type": session_type, "track_name": "Le Mans", "vehicle_name": "499P", "created_at": "2026-07-16T12:00:00"},
        "laps": laps if laps is not None else [lap(i, 100 + i * .15) for i in range(1, 11)],
        "telemetry_samples": samples if samples is not None else [{"game_time": i, "lap_number": i // 10 + 1, "speed_kph": 200, "fuel_liters": 80 - i * .02, "throttle": .8, "brake": .1, "steering": 0} for i in range(100)],
        "pit_events": [], "available_fields": {"position": False}, "warnings": [],
    }


@pytest.mark.parametrize(("raw", "expected"), [("Practice", "practice"), ("Warm-up", "practice"), ("Test Day", "practice"), ("Qualifying 1", "qualifying"), ("Race", "race"), (None, "practice")])
def test_session_type_selection(raw, expected) -> None:
    assert SessionTypeAnalyzer.analyze({"session_type": raw})[0] == expected


def test_lap_analyzer_uses_robust_metrics_and_excludes_pit_invalid_incomplete() -> None:
    rows = [lap(1, 100), lap(2, 101), lap(3, 102), lap(4, 150, pit=True), lap(5, None), lap(6, 99, valid=False)]
    validated = SessionDataValidator().analyze(review(laps=rows))
    result = LapAnalyzer().analyze(validated["laps"])
    assert result["valid_count"] == 3
    assert result["best_lap"] == 100
    assert result["median_pace"] == 101
    assert result["mad"] == 1


def test_one_valid_lap_has_low_confidence_and_no_fake_dispersion() -> None:
    result = SessionAnalysisPipeline().analyze(review(laps=[lap(1, 100)]))
    assert result.lap["confidence"] == "low"
    assert result.lap["standard_deviation"] is None
    assert result.tyre["degradation_seconds_per_lap"] is None


def test_missing_fuel_and_tyre_channels_are_unavailable_not_zero() -> None:
    rows = [lap(i, 100 + i) for i in range(1, 7)]
    for row in rows:
        for key in list(row):
            if key.startswith("fuel") or key.startswith("tyre"):
                row[key] = None
    result = SessionAnalysisPipeline().analyze(review(laps=rows, samples=[{"game_time": 1, "speed_kph": 100}]))
    assert result.fuel["available"] is False
    assert result.fuel["lap_time_effect_seconds_per_liter"] is None
    assert result.tyre["available"] is False


def test_validator_audits_duplicates_discontinuities_and_impossible_values() -> None:
    samples = [
        {"game_time": 0, "lap_number": 1, "speed_kph": 100},
        {"game_time": 0, "lap_number": 1, "speed_kph": 100},
        {"game_time": 50, "lap_number": 1, "speed_kph": 900},
    ]
    result = SessionDataValidator().analyze(review(laps=[lap(1, 100)], samples=samples))
    assert result["duplicate_samples"] == 1
    assert result["timestamp_discontinuities"] == 1
    assert result["impossible_samples"] == 1
    assert result["excluded_laps"][0]["reasons"] == ["sensor_anomaly"]


def test_coded_sector_flags_and_signed_gap_do_not_create_false_yellow_or_traffic() -> None:
    samples = [
        {"game_time": 0, "lap_number": 1, "speed_kph": 200, "sector1_flag": 11, "sector2_flag": 1, "sector3_flag": 3, "yellow_flag_state": 0, "time_behind_next": -20},
        {"game_time": 1, "lap_number": 1, "speed_kph": 210, "sector1_flag": 1, "yellow_flag_state": 0, "time_behind_next": 2},
    ]
    result = SessionAnalysisPipeline().analyze(review(laps=[lap(1, 100)], samples=samples))
    assert result.lap["valid_count"] == 1
    assert result.lap_table[0]["traffic"] == "unknown"


def test_followup_detail_includes_every_lap_and_measured_session_endpoints() -> None:
    rows = [lap(1, 100), lap(2, 101), lap(3, 140, pit=True)]
    samples = [
        {"game_time": 0, "lap_number": 1, "speed_kph": 200, "fuel_liters": 90, "soc": 100},
        {"game_time": 100, "lap_number": 3, "speed_kph": 80, "fuel_liters": 12, "soc": 42},
    ]
    payload = review("Race", rows, samples)
    payload["channel_manifest"] = [{"table": "Fuel Level", "frequency": 20, "row_count": 2000, "unit": "L", "mapped_fields": ["fuel_liters"]}]
    result = SessionAnalysisPipeline().analyze(payload)
    assert len(result.lap_table) == 3
    assert result.overview["starting_fuel"] == 90
    assert result.overview["ending_soc"] == 42
    assert result.channels[0]["usage"] == "direct/derived"


def test_stint_detection_uses_pits_and_refuel_boundaries() -> None:
    rows = [lap(1, 100), lap(2, 101), lap(3, 140, pit=True), lap(4, 99), lap(5, 100)]
    rows[3]["fuel_added"] = 20
    stints = StintAnalyzer().analyze(rows)
    assert [(row["start_lap"], row["end_lap"]) for row in stints] == [(1, 2), (4, 5)]


def test_robust_fuel_effect_requires_six_comparable_laps() -> None:
    short = FuelAnalyzer().analyze([lap(i, 100 + i) for i in range(1, 6)], [])
    long = FuelAnalyzer().analyze([lap(i, 100 + i) for i in range(1, 8)], [])
    assert short["lap_time_effect_seconds_per_liter"] is None
    assert long["lap_time_effect_seconds_per_liter"] is not None


def test_theil_sen_resists_single_outlier() -> None:
    assert theil_sen([(1, 1), (2, 2), (3, 3), (4, 400), (5, 5)]) == pytest.approx(1)


def test_race_position_changes_remain_uncertain() -> None:
    rows = [lap(1, 100, position=5), lap(2, 101, position=4), lap(3, 102, position=6)]
    payload = review("Race", rows)
    payload["available_fields"]["position"] = True
    result = SessionAnalysisPipeline().analyze(payload)
    assert result.race_progress["positions_gained"] == -1
    assert all(event["type"] == "uncertain position change" for event in result.traffic["events"])


@pytest.mark.parametrize("session_type", ["Practice", "Qualifying", "Race"])
def test_session_types_have_distinct_structure_and_recommendations(session_type) -> None:
    result = SessionAnalysisPipeline().analyze(review(session_type))
    assert result.structure in {"practice_development", "qualifying_execution", "race_progression"}
    titles = " ".join(row.title.lower() for row in result.recommendations)
    expected = {"Practice": "degradation", "Qualifying": "push-lap", "Race": "race pace"}[session_type]
    assert expected in titles


def test_pdf_renderer_creates_real_multipage_pdf() -> None:
    analysis = SessionAnalysisPipeline().analyze(review("Race"))
    with TemporaryDirectory() as folder:
        output = Path(folder) / "report.pdf"
        PdfReportRenderer().render(output, analysis, ReportConfiguration(detail_level="detailed", language="en"))
        content = output.read_bytes()
    assert content.startswith(b"%PDF")
    assert len(content) > 10_000
    assert content.count(b"/Type /Page") >= 8
