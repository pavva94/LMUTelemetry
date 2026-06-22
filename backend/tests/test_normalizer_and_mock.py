from __future__ import annotations

from types import SimpleNamespace

from app.telemetry.mock_collector import MockTelemetryCollector
from app.telemetry.normalizer import _normalize_competitor, _normalize_tyres, completed_lap_time, kelvin_to_celsius, normalize_lmu_snapshot, race_gap, session_type_name, tyre_wear_used_fraction, vector_speed_kph, yellow_flag_state_name


def test_mock_collector_emits_valid_snapshot() -> None:
    snapshot = MockTelemetryCollector().poll_once()
    assert snapshot.connected
    assert snapshot.player is not None
    assert snapshot.competitors


def test_normalizer_helpers() -> None:
    assert round(kelvin_to_celsius(300), 2) == 26.85
    assert vector_speed_kph((3, 4, 0)) == 18
    assert completed_lap_time(1.0) is None
    assert completed_lap_time(95.2) == 95.2
    assert race_gap(0.0) is None
    assert race_gap(0.0, allow_zero=True) == 0.0
    assert race_gap(4.2) == 4.2
    assert round(tyre_wear_used_fraction(0.98) or 0, 3) == 0.02
    assert round(tyre_wear_used_fraction(92) or 0, 3) == 0.08


def test_session_type_name_maps_lmu_session_ranges() -> None:
    assert session_type_name(5) == "Qualifying"
    assert session_type_name(8) == "Qualifying 4"
    assert session_type_name(9) == "Warmup"
    assert session_type_name(10) == "Race"
    assert session_type_name(13) == "Race 4"


def test_yellow_flag_state_name_decodes_null_byte_as_clear() -> None:
    assert yellow_flag_state_name(b"\x00") == "0"
    assert yellow_flag_state_name(None) == "0"
    assert yellow_flag_state_name("fcy") == "fcy"


def test_tyre_normalizer_ignores_zero_channels_and_reads_temperature_fallback() -> None:
    zero_wheel = SimpleNamespace(
        mWear=1.0,
        mPressure=0.0,
        mTireLoad=0.0,
        mTireCarcassTemperature=0.0,
        mTemperature=[0.0, 0.0, 0.0],
    )
    hot_wheel = SimpleNamespace(
        mWear=0.12,
        mPressure=182.0,
        mTireLoad=2400.0,
        mTireCarcassTemperature=345.0,
        mTemperature=[350.0, 352.0, 351.0],
    )
    telemetry = SimpleNamespace(
        mWheels=[hot_wheel, zero_wheel, zero_wheel, zero_wheel],
        mFrontTireCompoundName=b"Medium",
        mRearTireCompoundName=b"Medium",
    )

    tyres = _normalize_tyres(SimpleNamespace(), telemetry)

    assert tyres.pressure_fl == 182.0
    assert tyres.pressure_fr is None
    assert round(tyres.wear_fl or 0, 2) == 0.88
    assert round(tyres.wear_fr or 0, 2) == 0.0
    assert round(tyres.temp_fl.center_c or 0, 1) == 78.9
    assert tyres.temp_fr.center_c is None
    assert tyres.load_fl == 2400.0
    assert tyres.load_fr is None


def test_competitor_normalizer_filters_placeholder_lap_times() -> None:
    vehicle = SimpleNamespace(
        mID=12,
        mVehicleName=b"Team",
        mDriverName=b"Driver",
        mVehicleClass=b"GT3",
        mBestLapTime=1.0,
        mLastLapTime=0.0,
        mEstimatedLapTime=96.4,
        mCountLapFlag=2,
    )

    competitor = _normalize_competitor(vehicle, SimpleNamespace(), False)

    assert competitor.best_lap_time is None
    assert competitor.last_lap_time is None
    assert competitor.estimated_lap_time == 96.4
    assert competitor.count_lap_flag == 2


def test_competitor_normalizer_filters_placeholder_zero_gaps() -> None:
    leader = _normalize_competitor(SimpleNamespace(mID=1, mPlace=1, mTimeBehindLeader=0.0, mTimeBehindNext=0.0), SimpleNamespace(), False)
    opponent = _normalize_competitor(SimpleNamespace(mID=2, mPlace=2, mTimeBehindLeader=0.0, mTimeBehindNext=0.0), SimpleNamespace(), False)

    assert leader.time_behind_leader == 0.0
    assert leader.time_behind_next is None
    assert opponent.time_behind_leader is None
    assert opponent.time_behind_next is None


def test_normalizer_computes_signed_gap_to_player_from_leader_gaps() -> None:
    vehicles = [
        SimpleNamespace(mID=1, mPlace=2, mClassPosition=1, mDriverName=b"Ahead", mVehicleName=b"Team A", mVehicleClass=b"GT3", mTimeBehindLeader=5.0, mTimeBehindNext=1.0),
        SimpleNamespace(mID=2, mPlace=3, mClassPosition=2, mDriverName=b"Player", mVehicleName=b"Team P", mVehicleClass=b"GT3", mTimeBehindLeader=7.0, mTimeBehindNext=2.0),
        SimpleNamespace(mID=3, mPlace=4, mClassPosition=3, mDriverName=b"Behind", mVehicleName=b"Team B", mVehicleClass=b"GT3", mTimeBehindLeader=10.0, mTimeBehindNext=3.0),
    ]
    telemetry_rows = [SimpleNamespace(mVehicleModel=b"Car") for _ in vehicles]
    raw = SimpleNamespace(
        scoring=SimpleNamespace(
            scoringInfo=SimpleNamespace(mNumVehicles=3, mPlayerVehScoringId=1, mTrackName=b"Track", mSession=7, mCurrentET=100.0, mEndET=200.0),
            vehScoringInfo=vehicles,
        ),
        telemetry=SimpleNamespace(playerVehicleIdx=1, telemInfo=telemetry_rows),
    )

    snapshot = normalize_lmu_snapshot(raw)

    assert snapshot.competitors[0].gap_to_player == -2.0
    assert snapshot.competitors[1].gap_to_player == 0.0
    assert snapshot.competitors[2].gap_to_player == 3.0
    assert snapshot.player is not None
    assert snapshot.player.gap_car_ahead == 2.0
    assert snapshot.player.gap_car_behind == 3.0


def test_normalizer_prefers_dedicated_player_gap_channels() -> None:
    vehicles = [
        SimpleNamespace(mID=1, mPlace=4, mClassPosition=1, mDriverName=b"Ahead", mVehicleName=b"Team A", mVehicleClass=b"GT3", mTimeBehindNext=None, mTimeBehindLeader=None),
        SimpleNamespace(mID=2, mPlace=5, mClassPosition=2, mDriverName=b"Player", mVehicleName=b"Team P", mVehicleClass=b"GT3", mTimeBehindNext=None, mTimeBehindLeader=None),
        SimpleNamespace(mID=3, mPlace=6, mClassPosition=3, mDriverName=b"Behind", mVehicleName=b"Team B", mVehicleClass=b"GT3", mTimeBehindNext=None, mTimeBehindLeader=None),
    ]
    telemetry_rows = [
        SimpleNamespace(mVehicleModel=b"Car"),
        SimpleNamespace(mVehicleModel=b"Car", mTimeGapCarAhead=1.75, mTimeGapCarBehind=2.5, mTimeGapPlaceAhead=1.8, mTimeGapPlaceBehind=2.6),
        SimpleNamespace(mVehicleModel=b"Car"),
    ]
    raw = SimpleNamespace(
        scoring=SimpleNamespace(
            scoringInfo=SimpleNamespace(mNumVehicles=3, mPlayerVehScoringId=1, mTrackName=b"Track", mSession=10, mCurrentET=100.0, mEndET=200.0),
            vehScoringInfo=vehicles,
        ),
        telemetry=SimpleNamespace(playerVehicleIdx=1, telemInfo=telemetry_rows),
    )

    snapshot = normalize_lmu_snapshot(raw)

    assert snapshot.player is not None
    assert snapshot.player.gap_car_ahead == 1.75
    assert snapshot.player.gap_car_behind == 2.5
    assert snapshot.player.gap_place_ahead == 1.8
    assert snapshot.player.gap_place_behind == 2.6
    assert snapshot.competitors[0].gap_to_player == -1.75
    assert snapshot.competitors[2].gap_to_player == 2.5
