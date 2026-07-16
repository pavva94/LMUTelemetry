from __future__ import annotations
import random, statistics
from collections import Counter
from typing import Any
from app.schemas.endurance_event import FullFieldRequest

def import_event(review: dict[str, Any], session_id: str) -> dict[str, Any]:
    clean = [float(l["lap_time"]) for l in review.get("laps", []) if l.get("valid_lap") and not l.get("in_pit") and isinstance(l.get("lap_time"), (int,float))]
    if not clean: raise ValueError("The selected session has no clean laps to calibrate the target entry.")
    session = review.get("session") or {}
    return {"entries":[{"id":"target","team_name":"Target team","car":session.get("vehicle_name") or "Recorded car","car_class":session.get("vehicle_class") or "Unclassified","baseline_lap_seconds":statistics.median(clean),"drivers":[{"name":"Recorded driver","pace_delta_seconds":0,"consistency_seconds":max(.1, statistics.pstdev(clean) if len(clean)>1 else .35),"fatigue_seconds_per_hour":.05}],"target":True}],"weather":[{"hour":0,"ambient_c":20,"track_c":30,"wetness":0,"grip":1}],"warnings":["The recorded-session format contains player telemetry only. Add opponent entries with calibrated evidence before running a full-field prediction."],"provenance":"session_derived"}

def run_full_field(request: FullFieldRequest, progress=None) -> dict[str, Any]:
    rng=random.Random(request.random_seed); target=next(e for e in request.entries if e.target); outcomes=[]; representative=[]
    duration=request.duration_minutes*60
    for run in range(request.simulation_count):
        state=[]
        for entry in request.entries:
            driver=entry.drivers[run % len(entry.drivers)]; elapsed=0.; laps=0; traffic=0.
            while elapsed < duration:
                hour=min(len(request.weather)-1, int(elapsed//3600)); weather=request.weather[hour]
                weather_loss=(weather.track_c-30)*.012 + weather.wetness*5 + (1-weather.grip)*8
                fatigue=driver.fatigue_seconds_per_hour*(elapsed/3600)
                lap=entry.baseline_lap_seconds+driver.pace_delta_seconds+weather_loss+fatigue+rng.gauss(0,driver.consistency_seconds)
                traffic_loss=max(0,rng.gauss(.18*max(0,len(request.entries)-1),.25))
                elapsed+=lap+traffic_loss; traffic+=traffic_loss; laps+=1
            state.append({"id":entry.id,"time":elapsed,"traffic":traffic,"laps":laps})
        state.sort(key=lambda x:x["time"]); position=next(i+1 for i,x in enumerate(state) if x["id"]==target.id); cls=[x for x in state if next(e for e in request.entries if e.id==x["id"]).car_class==target.car_class]; class_pos=next(i+1 for i,x in enumerate(cls) if x["id"]==target.id)
        target_state=next(x for x in state if x["id"]==target.id); outcomes.append((position,class_pos,target_state["time"],target_state["traffic"]));
        if run==0: representative=state
        if progress and run%max(1,request.simulation_count//50)==0: progress("Simulating full field",f"Run {run+1}/{request.simulation_count}",run+1,request.simulation_count,30+round(65*(run+1)/request.simulation_count))
    return {"target_id":target.id,"expected_overall_position":statistics.fmean(x[0] for x in outcomes),"expected_class_position":statistics.fmean(x[1] for x in outcomes),"win_probability":sum(x[1]==1 for x in outcomes)/len(outcomes),"podium_probability":sum(x[1]<=3 for x in outcomes)/len(outcomes),"expected_race_time":statistics.fmean(x[2] for x in outcomes),"expected_traffic_loss":statistics.fmean(x[3] for x in outcomes),"position_distribution":dict(Counter(x[1] for x in outcomes)),"representative_order":representative,"limitations":["Segment-level traffic is represented as stochastic per-lap density loss until full opponent trajectory telemetry is available.","No safety cars, virtual safety cars, penalties, collisions, or reliability failures are simulated."]}
