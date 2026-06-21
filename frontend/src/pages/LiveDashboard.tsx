import { useEffect, useMemo, useRef, useState } from "react";
import { RecommendationPanel } from "../components/RecommendationPanel";
import { SectionTitle } from "../components/SectionTitle";
import { formatDuration, formatRaceTime } from "../lib/timeFormat";
import type { RecommendationPayload, StrategyState } from "../types/strategy";
import type { CompetitorState, PlayerState, TelemetrySnapshot, TyreState, TyreTemps } from "../types/telemetry";

const fmt = (value?: number | null, digits = 1, suffix = "") =>
  value == null || Number.isNaN(value) ? "--" : `${value.toFixed(digits)}${suffix}`;
const pct = (value?: number | null) => (value == null || Number.isNaN(value) ? "--" : `${Math.round(value * 100)}%`);
const percent = (value?: number | null) => (value == null || Number.isNaN(value) ? "--" : `${Math.round(value)}%`);
const text = (value?: string | number | boolean | null) => (value == null || value === "" ? "--" : String(value));
const tyreTemp = (value?: TyreTemps) => fmt(value?.center_c ?? value?.left_c ?? value?.right_c ?? value?.carcass_c, 0);
const tyreIOM = (value?: TyreTemps) => {
  const hasIom = value?.left_c != null || value?.center_c != null || value?.right_c != null;
  return hasIom ? `${fmt(value?.left_c, 0)} / ${fmt(value?.center_c, 0)} / ${fmt(value?.right_c, 0)} C` : "--";
};
const assist = (active?: boolean | null, setting?: number | null, max?: number | null) => {
  const level = setting == null ? "--" : max != null && max > 0 ? `${setting}/${max}` : String(setting);
  return `${active ? "Active" : "Ready"} (${level})`;
};
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const validLapTime = (value?: number | null) => value != null && Number.isFinite(value) && value > 20 && value < 1200;
const lapTimeText = (value?: number | null) => validLapTime(value) ? formatRaceTime(value) : "--";
const carName = (car?: { vehicle_model?: string | null; vehicle_name?: string | null }) => car?.vehicle_model || car?.vehicle_name || null;
const outStatuses = new Set(["dnf", "dns", "dq", "retired", "disqualified"]);

type LapHistory = Record<number, { lastRecordedLap?: number; lastLapTime?: number; currentLap?: number; dirtyLaps: Set<number>; lastPitstops?: number; laps: number[] }>;

function useOpponentLapHistory(competitors: CompetitorState[]) {
  const history = useRef<LapHistory>({});
  useEffect(() => {
    competitors.forEach((car) => {
      const lap = car.total_laps ?? car.current_lap;
      const lapTime = car.last_lap_time;
      if (lap == null) return;
      const row = history.current[car.vehicle_id] || { dirtyLaps: new Set<number>(), laps: [] };
      const pitstops = car.pitstops;
      const completedLap = lap > 0 ? lap - 1 : null;
      if (car.in_pits) row.dirtyLaps.add(lap);
      if (pitstops != null && row.lastPitstops != null && pitstops > row.lastPitstops) {
        row.dirtyLaps.add(lap);
        if (completedLap != null) row.dirtyLaps.add(completedLap);
      }
      if (completedLap != null && validLapTime(lapTime) && row.lastRecordedLap !== completedLap) {
        if (!row.dirtyLaps.has(completedLap)) {
          row.laps = [...row.laps, lapTime as number].slice(-12);
        }
        row.lastRecordedLap = completedLap;
        row.lastLapTime = lapTime;
      }
      row.currentLap = lap;
      row.lastPitstops = pitstops;
      history.current[car.vehicle_id] = row;
    });
  }, [competitors]);
  return history.current;
}

function lastAverage(history: LapHistory, car: CompetitorState | undefined, count: number) {
  if (!car) return null;
  const laps = history[car.vehicle_id]?.laps || [];
  if (laps.length < count) return null;
  return avg(laps.slice(-count));
}

function trendLabel(delta: number | null, laps: number) {
  if (delta == null) return "--";
  const amount = Math.abs(delta) * laps;
  return `${delta < 0 ? "Gained" : "Lost"} ${formatRaceTime(amount)}`;
}

function playerTrendLabel(delta: number | null) {
  return delta == null ? "--" : "Reference";
}

function isRaceSession(sessionType?: string | null) {
  return String(sessionType || "").toLowerCase().includes("race");
}

function fuelColumnText(car: CompetitorState, telemetry: TelemetrySnapshot | null) {
  if (car.is_player) {
    const fuel = telemetry?.player?.fuel_liters;
    const capacity = telemetry?.player?.fuel_capacity_liters;
    if (fuel != null && capacity != null && Number.isFinite(fuel) && Number.isFinite(capacity) && capacity > 0) {
      return pct(Math.max(0, Math.min(1, fuel / capacity)));
    }
  }
  return isRaceSession(telemetry?.session?.session_type) ? pct(car.fuel_fraction) : "--";
}

function InputBar({ label, value, color = "#e6b450" }: { label: string; value?: number; color?: string }) {
  return (
    <div className="metric">
      <div className="row"><span className="label">{label}</span><span className="subvalue">{pct(value)}</span></div>
      <div className="bar"><span style={{ width: `${Math.max(0, Math.min(100, (value ?? 0) * 100))}%`, background: color }} /></div>
    </div>
  );
}

function TyreCorner({ label, tyres, keyName }: { label: string; tyres?: TyreState; keyName: "fl" | "fr" | "rl" | "rr" }) {
  const temp = tyres?.[`temp_${keyName}` as keyof TyreState] as TyreTemps | undefined;
  return (
    <div className="corner-cell">
      <strong>{label}</strong>
      <span>Pressure {fmt(tyres?.[`pressure_${keyName}` as keyof TyreState] as number | undefined, 1)}</span>
      <span>Wear {pct(tyres?.[`wear_${keyName}` as keyof TyreState] as number | undefined)}</span>
      <span>Temp {tyreTemp(temp)} C</span>
      <span>I/M/O {tyreIOM(temp)}</span>
      <span>Load {fmt(tyres?.[`load_${keyName}` as keyof TyreState] as number | undefined, 0)}</span>
    </div>
  );
}

function Header({ telemetry, connected, readOnlyLabel }: { telemetry: TelemetrySnapshot | null; connected: boolean; readOnlyLabel?: string }) {
  const player = telemetry?.player;
  const session = telemetry?.session;
  const playerCar = telemetry?.competitors?.find((car) => car.is_player);
  const driver = playerCar?.driver_name || "Player";
  const position = player?.position ?? playerCar?.position;
  return (
    <section className="card span-12 page-header-card">
      <div className="header-grid">
        <div><span className="label">Connection</span><strong className={readOnlyLabel ? "ok-text" : telemetry?.feed_paused ? "warn-text" : connected && telemetry?.connected ? "ok-text" : "warn-text"}>{readOnlyLabel || (telemetry?.feed_paused ? "Paused" : connected && telemetry?.connected ? "Live" : "Mock/offline")}</strong>{!readOnlyLabel && telemetry?.feed_paused && <span className="subvalue">{telemetry.pause_reason || "not on track"}</span>}</div>
        <div><span className="label">Track</span><strong>{text(session?.track_name)}</strong></div>
        <div><span className="label">Session</span><strong>{text(session?.session_type)}</strong></div>
        <div><span className="label">Car</span><strong>{text(player?.vehicle_model ?? player?.vehicle_name)}</strong>{player?.vehicle_name && player.vehicle_name !== player.vehicle_model && <span className="subvalue">{player.vehicle_name}</span>}</div>
        <div><span className="label">Driver</span><strong>{driver}</strong></div>
        <div><span className="label">Position</span><strong>{position != null ? `P${position}` : "--"}</strong></div>
        <div><span className="label">Lap</span><strong>{text(player?.lap_number ?? session?.current_lap)}</strong></div>
        <div><span className="label">Remaining</span><strong>{formatDuration(session?.time_remaining)}</strong></div>
      </div>
    </section>
  );
}

function DrivingDisplay({ player }: { player?: PlayerState }) {
  const rpmRatio = Math.min(1, (player?.rpm ?? 0) / Math.max(player?.max_rpm ?? 9000, 1));
  return (
    <section className="card span-3 driving-display compact-driving">
      <SectionTitle title="Main Driving Display" help="Shows speed, gear, revs, and driver inputs at a glance. Smooth inputs and stable RPM help preserve tyres and keep traction predictable." />
      <div className="speed-gear">
        <div><span>{fmt(player?.speed_kph, 0)}</span><small>km/h</small></div>
        <div><span>{text(player?.gear)}</span><small>gear</small></div>
      </div>
      <InputBar label={`RPM ${fmt(player?.rpm, 0)}`} value={rpmRatio} color="#ffcc4d" />
      <InputBar label="Throttle" value={player?.throttle} color="#69d28f" />
      <InputBar label="Brake" value={player?.brake} color="#ff6961" />
      <InputBar label="Steering" value={Math.abs(player?.steering ?? 0)} color="#6dd6ff" />
      <InputBar label="Clutch" value={player?.clutch} />
    </section>
  );
}

function OpponentPaceTable({ telemetry, competitors: fallbackCompetitors = [] }: { telemetry: TelemetrySnapshot | null; competitors?: CompetitorState[] }) {
  const [classFilter, setClassFilter] = useState("all");
  const competitors = useMemo(() => {
    const live = telemetry?.competitors || [];
    if (!live.length) return fallbackCompetitors;
    const rows = new Map(fallbackCompetitors.map((car) => [car.vehicle_id, car]));
    live.forEach((car) => rows.set(car.vehicle_id, car));
    return Array.from(rows.values());
  }, [telemetry?.competitors, fallbackCompetitors]);
  const history = useOpponentLapHistory(competitors);
  const playerCar = competitors.find((car) => car.is_player);
  const playerLap = playerCar?.total_laps ?? playerCar?.current_lap ?? telemetry?.player?.lap_number;
  const playerAvg3 = lastAverage(history, playerCar, 3);
  const playerAvg7 = lastAverage(history, playerCar, 7);
  const classOptions = useMemo(() => {
    return Array.from(new Set(competitors.map((car) => car.vehicle_class).filter((value): value is string => Boolean(value)))).sort();
  }, [competitors]);
  const rows = useMemo(() => {
    return competitors
      .filter((car) => classFilter === "all" || car.vehicle_class === classFilter)
      .sort((a, b) => (a.position ?? Number.POSITIVE_INFINITY) - (b.position ?? Number.POSITIVE_INFINITY));
  }, [competitors, classFilter]);
  const isOut = (car: CompetitorState) => {
    const status = String(car.finish_status || "").toLowerCase();
    const lap = car.total_laps ?? car.current_lap;
    return outStatuses.has(status) || (!car.is_player && !car.in_pits && playerLap != null && lap != null && playerLap - lap >= 3);
  };
  const rowClass = (car: CompetitorState, delta3: number | null) => {
    if (isOut(car)) return "pace-out";
    if (delta3 != null && delta3 < -0.05) return "pace-gained";
    if (delta3 != null && delta3 > 0.05) return "pace-lost-3";
    return "";
  };
  const bestLap = Math.min(...rows.map((car) => car.best_lap_time).filter((value): value is number => validLapTime(value)));
  return (
    <section className="card span-12 live-opponents">
      <div className="section-toolbar">
        <SectionTitle title="Opponent Pace" help="Prioritizes traffic while driving. Pace deltas compare each opponent's recent average against yours; green means they gained on you over the last 3 laps." />
        <label className="class-filter">
          <span>Class</span>
          <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
            <option value="all">All classes</option>
            {classOptions.map((vehicleClass) => <option value={vehicleClass} key={vehicleClass}>{vehicleClass}</option>)}
          </select>
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Pos</th><th>Driver</th><th>Car</th><th>Class</th><th>Status</th><th>Lap</th><th>Best</th><th>Last</th><th>Pace 3</th><th>Pace 7</th><th>3-lap trend</th><th>7-lap trend</th><th>Fuel</th></tr></thead>
          <tbody>
            {rows.map((car) => {
              const avg3 = lastAverage(history, car, 3);
              const avg7 = lastAverage(history, car, 7);
              const delta3 = avg3 != null && playerAvg3 != null ? avg3 - playerAvg3 : null;
              const delta7 = avg7 != null && playerAvg7 != null ? avg7 - playerAvg7 : null;
              return (
                <tr key={car.vehicle_id} className={car.is_player ? "pace-player" : rowClass(car, delta3)}>
                  <td>{text(car.position)}</td>
                  <td>{car.is_player ? "You" : text(car.driver_name)}</td>
                  <td>{text(carName(car))}</td>
                  <td>{text(car.vehicle_class)}</td>
                  <td>{isOut(car) ? "Out" : car.in_pits ? "Pit" : text(car.finish_status || "Track")}</td>
                  <td>{text(car.total_laps ?? car.current_lap)}</td>
                  <td className={car.best_lap_time === bestLap ? "best-lap-cell" : undefined}>{lapTimeText(car.best_lap_time)}</td>
                  <td>{lapTimeText(car.last_lap_time)}</td>
                  <td>{lapTimeText(avg3)}</td>
                  <td>{lapTimeText(avg7)}</td>
                  <td>{car.is_player ? playerTrendLabel(playerAvg3) : trendLabel(delta3, 3)}</td>
                  <td>{car.is_player ? playerTrendLabel(playerAvg7) : trendLabel(delta7, 7)}</td>
                  <td>{fuelColumnText(car, telemetry)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CompactLapTiming({ player, playerCar }: { player?: PlayerState; playerCar?: CompetitorState }) {
  const invalid = player?.lap_invalidated;
  return (
    <section className="card span-3 compact-panel">
      <SectionTitle title="Lap Timing" help="Compact current, last, and best lap reference for driving." />
      <div className="header-grid two">
        <div><span className="label">Current</span><strong>{formatRaceTime(player?.current_lap_time)}</strong></div>
        <div><span className="label">Last</span><strong>{lapTimeText(player?.last_lap_time ?? playerCar?.last_lap_time)}</strong></div>
        <div><span className="label">Best</span><strong>{lapTimeText(player?.best_lap_time ?? playerCar?.best_lap_time)}</strong></div>
        <div><span className="label">Delta</span><strong>{fmt(player?.delta_best, 2, " s")}</strong></div>
      </div>
      {invalid && <span className="badge red">Lap invalidated</span>}
      {player?.track_limits_steps != null && <span className="badge amber">Track limits {player.track_limits_steps}</span>}
    </section>
  );
}

export function LiveDashboard({ telemetry, strategy, recommendation, connected, readOnlyLabel, competitors = [] }: { telemetry: TelemetrySnapshot | null; strategy: StrategyState | null; recommendation: RecommendationPayload | null; connected: boolean; readOnlyLabel?: string; competitors?: CompetitorState[] }) {
  const player = telemetry?.player;
  const playerCar = telemetry?.competitors?.find((c) => c.is_player);
  const tyres = player?.tyre_state;
  const hybrid = player?.hybrid_state;
  const fuel = strategy?.fuel;
  const tyreModel = strategy?.tyres;
  const fuelLapsNeeded = Math.max(0, (fuel?.valid_laps_required ?? 3) - (fuel?.valid_laps_observed ?? 0));
  const tyreLapsNeeded = Math.max(0, (tyreModel?.laps_required ?? 3) - (tyreModel?.observed_laps ?? 0));
  const tyreFinishLap = player?.lap_number != null && tyreModel?.estimated_remaining_tyre_life_laps != null
    ? Math.floor(player.lap_number + tyreModel.estimated_remaining_tyre_life_laps)
    : null;
  return (
    <div className="page grid">
      <Header telemetry={telemetry} connected={connected} readOnlyLabel={readOnlyLabel} />
      <OpponentPaceTable telemetry={telemetry} competitors={competitors} />
      <RecommendationPanel payload={recommendation} />
      <DrivingDisplay player={player} />
      <CompactLapTiming player={player} playerCar={playerCar} />
      <section className="card span-3 compact-panel">
        <SectionTitle title="Fuel" help="Shows fuel range and margin to finish. Keep margin positive; if consumption rises, pit timing or lift-and-coast may need adjustment." />
        <div className="header-grid two">
          <div><span className="label">Current</span><strong>{fmt(player?.fuel_liters)} L</strong></div>
          <div><span className="label">Capacity</span><strong>{fmt(player?.fuel_capacity_liters)} L</strong></div>
          <div><span className="label">Last lap</span><strong>{fmt(fuel?.last_lap_fuel_used_liters, 2)} L</strong></div>
          <div><span className="label">Recent clean-lap average</span><strong>{fmt(fuel?.fuel_per_lap_liters, 2)} L/lap</strong><span className="subvalue">{fuel?.fuel_use_stddev_liters != null ? `σ ${fmt(fuel.fuel_use_stddev_liters, 3)} L over up to 5 laps` : fuelLapsNeeded > 0 ? `Need ${fuelLapsNeeded} valid lap${fuelLapsNeeded === 1 ? "" : "s"}` : `${fuel?.valid_laps_observed ?? 0} valid laps`}</span></div>
          <div><span className="label">Range</span><strong>{fmt(fuel?.fuel_laps_remaining)} laps</strong></div>
          <div><span className="label">Needed</span><strong>{fmt(fuel?.required_fuel_to_finish)} L</strong></div>
          <div><span className="label">Margin</span><strong>{fmt(fuel?.fuel_delta_to_finish)} L</strong></div>
          <div><span className="label">Virtual energy</span><strong>{pct(hybrid?.virtual_energy_fraction)}</strong><span className="subvalue">{text(hybrid?.motor_state)}</span></div>
          <div><span className="label">Battery / regen</span><strong>{percent(hybrid?.battery_percent)}</strong><span className="subvalue">{fmt(hybrid?.regen_kw, 1, " kW")}</span></div>
        </div>
      </section>
      <section className="card span-3 compact-panel">
        <SectionTitle title="Tyres" help="Shows pressure, wear, temperature, and predicted tyre life. Remaining laps are estimated from observed wear rate, so confidence improves after clean laps." />
        <div className="corner-grid compact-corners">
          <TyreCorner label="FL" tyres={tyres} keyName="fl" />
          <TyreCorner label="FR" tyres={tyres} keyName="fr" />
          <TyreCorner label="RL" tyres={tyres} keyName="rl" />
          <TyreCorner label="RR" tyres={tyres} keyName="rr" />
        </div>
        <div className="header-grid two">
          <div><span className="label">Average wear</span><strong>{pct(tyreModel?.average_wear ?? tyres?.average_wear)}</strong></div>
          <div><span className="label">Wear rate</span><strong>{pct(tyreModel?.wear_rate_per_lap)}/lap</strong><span className="subvalue">{tyreLapsNeeded > 0 ? `Need ${tyreLapsNeeded} clean lap${tyreLapsNeeded === 1 ? "" : "s"}` : `${tyreModel?.observed_laps ?? 0} observed laps`}</span></div>
          <div><span className="label">Tyre life</span><strong>{fmt(tyreModel?.estimated_remaining_tyre_life_laps)} laps</strong></div>
          <div><span className="label">Limit lap</span><strong>{text(tyreFinishLap)}</strong><span className="subvalue">{tyreModel?.confidence || "low"} confidence</span></div>
        </div>
        <span className={tyreModel?.tyre_risk_level === "high" ? "badge red" : "badge green"}>{tyreModel?.tyre_risk_level || "No tyre warning"}</span>
      </section>
      <section className="card span-3 compact-panel">
        <SectionTitle title="Brakes" help="Shows brake temperature and pressure by wheel. Overheated or imbalanced brakes can cause longer stops, locking, and unstable corner entry." />
        <div className="corner-grid compact-corners">
          {(["fl", "fr", "rl", "rr"] as const).map((wheel) => (
            <div className="corner-cell" key={wheel}>
              <strong>{wheel.toUpperCase()}</strong>
              <span>Temp {fmt(player?.[`brake_temp_${wheel}` as keyof PlayerState] as number | undefined, 0)} C</span>
              <span>Pressure {fmt(player?.[`brake_pressure_${wheel}` as keyof PlayerState] as number | undefined, 2)}</span>
            </div>
          ))}
        </div>
        <span className="badge blue">Shared-memory brake channels</span>
      </section>
      <section className="card span-3 compact-panel">
        <SectionTitle title="ABS / TC" help="Shows assist activation and onboard levels from shared memory. Frequent activation can indicate braking instability, traction stress, or an aggressive setting." />
        <div className="metric"><span className="label">ABS</span><span className="value">{assist(player?.abs_active, player?.abs_setting, player?.abs_max)}</span></div>
        <div className="metric"><span className="label">TC</span><span className="value">{assist(player?.tc_active, player?.tc_setting, player?.tc_max)}</span></div>
        <div className="header-grid two">
          <div><span className="label">TC slip</span><strong>{text(player?.tc_slip_setting)}</strong></div>
          <div><span className="label">TC cut</span><strong>{text(player?.tc_cut_setting)}</strong></div>
        </div>
      </section>
    </div>
  );
}
