from app.schemas.race_simulation import RaceSimulationRequest
from app.strategy.race_simulation import derive_model, generate_strategies, run_simulation

def _review():
    return {"laps": [{"lap_number": index, "lap_time": 100 + index * .1, "valid_lap": True, "in_pit": False, "fuel_used": 2.1, "tyre_wear_end_fl": .01 * index, "tyre_wear_end_fr": .01 * index, "tyre_wear_end_rl": .01 * index, "tyre_wear_end_rr": .01 * index} for index in range(1, 15)], "pit_events": []}

def _request():
    return RaceSimulationRequest(session_id="test", race_duration_minutes=10, simulation_count=100, random_seed=7)

def test_simulation_is_deterministic_and_returns_probability():
    first = run_simulation(_review(), _request())
    second = run_simulation(_review(), _request())
    assert first["summaries"] == second["summaries"]
    assert first["summaries"][0]["fastest_probability"] == 1

def test_duration_generates_complete_candidate_strategies():
    result = run_simulation(_review(), _request())
    assert result["model"]["estimated_race_laps"] > 1
    assert result["summaries"]


def test_generation_holds_pits_to_latest_feasible_fuel_lap_and_short_fills():
    request = RaceSimulationRequest(session_id="test", race_duration_minutes=120, simulation_count=100, random_seed=7, fuel_tank_capacity_liters=90, finish_reserve_liters=2)
    strategies = generate_strategies(derive_model(_review(), request), request, 90)[1]
    late = next(strategy for strategy in strategies if strategy.name == "1-stop late pit")

    assert [stint.laps for stint in late.stints] == [41, 31]
    assert late.stints[0].fuel_added_liters < 90


def test_synthetic_field_reports_seeded_traffic_and_clear_air_removes_it():
    traffic = RaceSimulationRequest(session_id="test", race_duration_minutes=30, simulation_count=100, random_seed=7, field_size=30, traffic_preset="heavy")
    clear = RaceSimulationRequest(session_id="test", race_duration_minutes=30, simulation_count=100, random_seed=7, field_size=30, traffic_preset="clear")

    traffic_result = run_simulation(_review(), traffic)
    clear_result = run_simulation(_review(), clear)

    assert traffic_result["summaries"][0]["expected_traffic_loss"] > 0
    assert traffic_result["summaries"][0]["expected_traffic_events"] > 0
    assert clear_result["summaries"][0]["expected_traffic_loss"] == 0
    assert clear_result["summaries"][0]["expected_traffic_events"] == 0
    assert traffic_result["limitations"][0].startswith("Opponent pace and traffic are estimated")


def test_generated_strategy_contains_initial_fuel_and_pit_service_plan():
    result = run_simulation(_review(), RaceSimulationRequest(session_id="test", race_duration_minutes=120, simulation_count=100, random_seed=7, fuel_tank_capacity_liters=90))
    plan = next(summary["plan"] for summary in result["summaries"] if summary["stops"] > 0)

    assert plan["initial_fuel_liters"] > 0
    assert plan["pits"]
    assert plan["pits"][0]["pit_lap"] > 0
    assert isinstance(plan["pits"][0]["change_tyres"], bool)
    assert plan["pits"][0]["fuel_to_add_liters"] > 0
