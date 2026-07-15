from app.schemas.endurance_event import FullFieldRequest
from app.strategy.endurance_event import run_full_field

def test_full_field_run_is_seeded_and_probabilities_are_bounded():
    request = FullFieldRequest(session_id="s", duration_minutes=30, simulation_count=100, random_seed=9, entries=[{"id":"target","team_name":"Target","baseline_lap_seconds":100,"car_class":"A","target":True,"drivers":[{"name":"Driver"}]},{"id":"other","team_name":"Other","baseline_lap_seconds":101,"car_class":"A","drivers":[{"name":"Other driver"}]}], weather=[{"hour":0,"ambient_c":20,"track_c":30}])
    first, second = run_full_field(request), run_full_field(request)
    assert first == second
    assert 0 <= first["win_probability"] <= 1
