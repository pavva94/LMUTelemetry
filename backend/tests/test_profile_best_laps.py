from __future__ import annotations

import pytest

from app.services.profile_repository import ProfileRepository


def lap(**overrides):
    row = {
        "id": "duckdb:s1:1",
        "source": "duckdb",
        "session_id": "s1",
        "session_type": "Practice",
        "track": "Silverstone",
        "layout": "National",
        "car": "Ferrari 296 GT3",
        "car_class": "GT3",
        "lap_number": "1",
        "lap_time": 60.0,
        "distance_km": 2.64,
        "average_speed": 158.4,
        "valid_lap": True,
        "in_pit": False,
        "date": "2026-01-01T12:00:00",
    }
    row.update(overrides)
    return row


@pytest.mark.parametrize(
    ("changes", "reason"),
    [
        ({"average_speed": 0}, "missing_zero_or_implausibly_low_average_speed"),
        ({"distance_km": 0}, "missing_or_incomplete_distance"),
        ({"distance_km": None}, "missing_or_incomplete_distance"),
        ({"out_lap": True}, "out_lap"),
        ({"in_lap": True}, "in_lap"),
        ({"in_pit": True}, "pit_lap"),
        ({"complete": False}, "incomplete_lap"),
        ({"valid_lap": False}, "recorded_invalid_lap"),
    ],
)
def test_ineligible_laps_are_excluded(changes, reason):
    candidate = lap(**changes)
    ProfileRepository()._with_lap_quality([candidate])
    assert candidate["valid_lap"] is False
    assert candidate["lap_quality"] == reason


def test_le_mans_sixty_second_zero_speed_record_is_rejected():
    corrupt = lap(track="Circuit de la Sarthe", layout="Full Circuit", lap_time=60.0, distance_km=13.626, average_speed=0)
    ProfileRepository()._with_lap_quality([corrupt])
    assert corrupt["validation_status"] == "invalid"
    assert "average speed" in corrupt["validation_reason"]


def test_duplicate_source_lap_is_rejected():
    first = lap()
    duplicate = lap(id="duplicate")
    ProfileRepository()._with_lap_quality([first, duplicate])
    assert first["valid_lap"] is True
    assert duplicate["lap_quality"] == "duplicate_lap"


def test_faster_valid_lap_replaces_slower_best_and_retains_comparison():
    slow = lap(session_id="old", lap_time=61.2, average_speed=155.3)
    fast = lap(session_id="new", lap_time=60.0, average_speed=158.4, date="2026-02-01T12:00:00")
    rows = ProfileRepository()._with_lap_quality([slow, fast])
    best = ProfileRepository()._best_laps_from_laps(rows)
    assert [row["session_id"] for row in best] == ["new"]
    assert best[0]["previous_best_lap"] == 61.2
    assert best[0]["improvement_seconds"] == pytest.approx(1.2)


@pytest.mark.parametrize(
    "change",
    [
        {"session_type": "Qualifying"},
        {"session_type": "Race"},
        {"layout": "Grand Prix"},
        {"car": "BMW M4 GT3"},
    ],
)
def test_context_boundaries_create_separate_personal_bests(change):
    first = lap(session_id="a")
    second = lap(session_id="b", lap_number="2", lap_time=59.0, average_speed=161.1, **change)
    rows = ProfileRepository()._with_lap_quality([first, second])
    assert len(ProfileRepository()._best_laps_from_laps(rows)) == 2


def test_live_and_duckdb_sources_share_the_same_validation_rules():
    rows = [
        lap(source="live", session_id="live", average_speed=0),
        lap(source="duckdb", session_id="duck", average_speed=0),
    ]
    ProfileRepository()._with_lap_quality(rows)
    assert {row["lap_quality"] for row in rows} == {"missing_zero_or_implausibly_low_average_speed"}


def test_optional_metadata_does_not_block_a_core_valid_lap():
    candidate = lap(fuel_start=None, fuel_end=None, tyre_compound=None, ambient_temp=None, track_temp=None)
    ProfileRepository()._with_lap_quality([candidate])
    assert candidate["valid_lap"] is True


def test_revalidation_promotes_next_valid_lap_when_corrupt_fastest_is_removed():
    corrupt = lap(session_id="bad", lap_time=50.0, distance_km=2.64, average_speed=0)
    valid = lap(session_id="good", lap_time=60.0, average_speed=158.4)
    rows = ProfileRepository()._with_lap_quality([corrupt, valid])
    best = ProfileRepository()._best_laps_from_laps(rows)
    assert [row["session_id"] for row in best] == ["good"]
