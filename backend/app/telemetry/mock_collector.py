from __future__ import annotations

import math
import random
import time
from datetime import timedelta

from app.core.utils import utc_now
from app.schemas.telemetry import (
    CompetitorState,
    EnvironmentState,
    PlayerState,
    SessionState,
    TelemetrySnapshot,
    TyreState,
    TyreTemps,
)


class MockTelemetryCollector:
    def __init__(self, poll_hz: int = 10):
        self.poll_hz = poll_hz
        self.started_at = time.monotonic()
        self.latest: TelemetrySnapshot | None = None
        self.running = False
        self._fuel_capacity = 90.0
        self._base_lap_time = 214.0
        self._pitstops = 0
        self._last_lap = 1

    def start(self) -> None:
        self.running = True

    def stop(self) -> None:
        self.running = False

    def is_connected(self) -> bool:
        return True

    def get_latest_snapshot(self) -> TelemetrySnapshot | None:
        return self.latest

    def poll_once(self) -> TelemetrySnapshot | None:
        elapsed = time.monotonic() - self.started_at
        lap_float = max(1.0, elapsed / self._base_lap_time + 1)
        lap_number = int(lap_float)
        lap_progress = lap_float - lap_number
        if lap_number > self._last_lap:
            self._last_lap = lap_number
        in_pits = lap_number in {9, 18, 27} and lap_progress < 0.12
        if in_pits and lap_progress < 0.02:
            self._pitstops = max(self._pitstops, lap_number // 9)

        fuel_used = (lap_float - 1) * 3.25
        fuel = max(4.0, self._fuel_capacity - fuel_used + (self._pitstops * 52.0))
        fuel = min(self._fuel_capacity, fuel)
        wear = min(0.98, 0.03 + (lap_float - 1 - self._pitstops * 9) * 0.018)
        speed = 80 + 205 * abs(math.sin(lap_progress * math.pi))
        if in_pits:
            speed = 58.0

        session = SessionState(
            track_name="Circuit de la Sarthe",
            session_type="Race",
            game_phase="green" if int(elapsed / 480) % 5 else "full_course_yellow",
            current_time=elapsed,
            end_time=7200.0,
            time_remaining=max(0.0, 7200.0 - elapsed),
            max_laps=None,
            num_vehicles=18,
            yellow_flag_state="none" if int(elapsed / 480) % 5 else "fcy",
            sector_flags=[0, 0, 0],
            current_lap=lap_number,
        )
        avg_temp = 82 + random.uniform(-3, 4)
        tyres = TyreState(
            compound_front="Medium",
            compound_rear="Medium",
            wear_fl=min(1, wear + 0.012),
            wear_fr=min(1, wear + 0.016),
            wear_rl=min(1, wear - 0.004),
            wear_rr=min(1, wear),
            pressure_fl=26.1 + random.uniform(-0.15, 0.15),
            pressure_fr=26.2 + random.uniform(-0.15, 0.15),
            pressure_rl=25.7 + random.uniform(-0.15, 0.15),
            pressure_rr=25.8 + random.uniform(-0.15, 0.15),
            temp_fl=TyreTemps(left_c=avg_temp + 2, center_c=avg_temp + 1, right_c=avg_temp, carcass_c=avg_temp - 8),
            temp_fr=TyreTemps(left_c=avg_temp, center_c=avg_temp + 1, right_c=avg_temp + 3, carcass_c=avg_temp - 7),
            temp_rl=TyreTemps(left_c=avg_temp - 1, center_c=avg_temp, right_c=avg_temp + 1, carcass_c=avg_temp - 9),
            temp_rr=TyreTemps(left_c=avg_temp, center_c=avg_temp + 1, right_c=avg_temp + 2, carcass_c=avg_temp - 8),
            average_wear=wear,
            average_temp_c=avg_temp,
        )
        player = PlayerState(
            vehicle_id=0,
            vehicle_name="Porsche 963",
            vehicle_class="Hypercar",
            position=4,
            class_position=4,
            lap_number=lap_number,
            current_sector=int(lap_progress * 3) + 1,
            speed_kph=speed,
            g_force_lat=math.sin(lap_progress * math.tau) * 1.35,
            g_force_long=math.cos(lap_progress * math.tau) * 0.9,
            g_force_vert=1.0,
            gear=max(1, min(7, int(speed / 42))),
            rpm=4200 + speed * 28,
            fuel_liters=fuel,
            fuel_capacity_liters=self._fuel_capacity,
            throttle=max(0.0, min(1.0, math.sin(lap_progress * math.pi) + random.uniform(-0.05, 0.05))),
            brake=0.0 if speed > 115 else 0.35,
            steering=math.sin(lap_progress * math.tau) * 0.25,
            wheel_rot_speed_fl=speed / 3.6 / 0.32,
            wheel_rot_speed_fr=speed / 3.6 / 0.32,
            wheel_rot_speed_rl=(speed / 3.6 / 0.32) * (1.0 + (0.13 if lap_progress > 0.55 and lap_progress < 0.72 else 0.0)),
            wheel_rot_speed_rr=(speed / 3.6 / 0.32) * (1.0 + (0.13 if lap_progress > 0.55 and lap_progress < 0.72 else 0.0)),
            wheel_ground_speed_fl=speed / 3.6,
            wheel_ground_speed_fr=speed / 3.6,
            wheel_ground_speed_rl=speed / 3.6,
            wheel_ground_speed_rr=speed / 3.6,
            ride_height_fl=0.035 + math.sin(lap_progress * math.tau) * 0.006,
            ride_height_fr=0.036 - math.sin(lap_progress * math.tau) * 0.004,
            ride_height_rl=0.052 + math.cos(lap_progress * math.tau) * 0.004,
            ride_height_rr=0.052 - math.cos(lap_progress * math.tau) * 0.004,
            suspension_deflection_fl=0.055 + math.sin(lap_progress * math.tau) * 0.012,
            suspension_deflection_fr=0.054 - math.sin(lap_progress * math.tau) * 0.010,
            suspension_deflection_rl=0.047 + math.cos(lap_progress * math.tau) * 0.008,
            suspension_deflection_rr=0.047 - math.cos(lap_progress * math.tau) * 0.008,
            track_limits_steps=0,
            lap_invalidated=False,
            gap_car_ahead=3.8 + math.sin(elapsed / 31) * 1.4,
            gap_car_behind=2.6 + math.cos(elapsed / 27) * 1.2,
            gap_place_ahead=5.4,
            gap_place_behind=4.1,
            tyre_state=tyres,
        )
        competitors = self._competitors(elapsed, lap_number, in_pits)
        environment = EnvironmentState(
            raining=0.0,
            ambient_temp_c=21.0 + math.sin(elapsed / 900),
            track_temp_c=31.0 + math.sin(elapsed / 600) * 2,
            min_wetness=0.0,
            max_wetness=0.04,
            avg_wetness=0.01,
            track_grip=0.96,
            cloud_coverage=0.35 + math.sin(elapsed / 700) * 0.1,
        )
        self.latest = TelemetrySnapshot(
            timestamp=utc_now(),
            connected=True,
            session=session,
            player=player,
            competitors=competitors,
            environment=environment,
        )
        return self.latest

    def _competitors(self, elapsed: float, lap_number: int, player_in_pits: bool) -> list[CompetitorState]:
        names = ["Rossi", "Muller", "Kobayashi", "Taylor", "Martin", "Jensen", "Lopez", "Smith"]
        competitors: list[CompetitorState] = []
        for i, name in enumerate(names, start=1):
            pitstops = 1 if lap_number > (8 + i % 4) else 0
            in_pits = (lap_number + i) % 13 == 0 and int(elapsed) % 45 < 16
            gap = (i - 4) * 3.4 + math.sin(elapsed / (22 + i)) * 2.0
            competitors.append(
                CompetitorState(
                    vehicle_id=i,
                    driver_name=name,
                    vehicle_name="Hypercar",
                    vehicle_class="Hypercar" if i < 6 else "LMP2",
                    position=i if i < 4 else i + 1,
                    class_position=i,
                    total_laps=lap_number - (1 if i > 6 else 0),
                    lap_distance=(elapsed % 214.0) / 214.0,
                    best_lap_time=211.0 + i * 0.55,
                    last_lap_time=213.0 + math.sin(elapsed / 18 + i) * 1.8,
                    estimated_lap_time=213.5 + i * 0.3,
                    count_lap_flag=2,
                    pitstops=pitstops,
                    in_pits=in_pits,
                    pit_state="in_pits" if in_pits else "running",
                    time_behind_leader=max(0.0, i * 6.2 + gap),
                    time_behind_next=max(0.4, abs(gap)),
                    laps_behind_leader=0,
                )
            )
        competitors.insert(
            3,
            CompetitorState(
                vehicle_id=0,
                driver_name="Player",
                vehicle_name="Porsche 963",
                vehicle_class="Hypercar",
                position=4,
                class_position=4,
                total_laps=lap_number,
                count_lap_flag=2,
                pitstops=self._pitstops,
                in_pits=player_in_pits,
                pit_state="in_pits" if player_in_pits else "running",
                is_player=True,
            ),
        )
        return sorted(competitors, key=lambda c: c.position or 999)
