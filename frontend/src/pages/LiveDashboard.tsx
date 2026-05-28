import { CompetitorTable } from "../components/CompetitorTable";
import { RecommendationPanel } from "../components/RecommendationPanel";
import { SectionTitle } from "../components/SectionTitle";
import { formatRaceTime } from "../lib/timeFormat";
import type { RecommendationPayload, StrategyState } from "../types/strategy";
import type { PlayerState, TelemetrySnapshot, TyreState, TyreTemps } from "../types/telemetry";

const fmt = (value?: number | null, digits = 1, suffix = "") =>
  value == null || Number.isNaN(value) ? "--" : `${value.toFixed(digits)}${suffix}`;
const pct = (value?: number | null) => (value == null || Number.isNaN(value) ? "--" : `${Math.round(value * 100)}%`);
const text = (value?: string | number | boolean | null) => (value == null || value === "" ? "--" : String(value));
const tyreTemp = (value?: TyreTemps) => fmt(value?.center_c ?? value?.left_c ?? value?.right_c ?? value?.carcass_c, 0);
const tyreIOM = (value?: TyreTemps) => `${fmt(value?.left_c, 0)} / ${fmt(value?.center_c, 0)} / ${fmt(value?.right_c, 0)} C`;
const assist = (active?: boolean | null, setting?: number | null, max?: number | null) => {
  const level = setting == null ? "--" : max != null && max > 0 ? `${setting}/${max}` : String(setting);
  return `${active ? "Active" : "Ready"} (${level})`;
};

function InputBar({ label, value, color = "#e6b450" }: { label: string; value?: number; color?: string }) {
  return (
    <div className="metric">
      <div className="row"><span className="label">{label}</span><span className="subvalue">{pct(value)}</span></div>
      <div className="bar"><span style={{ width: `${Math.max(0, Math.min(100, (value ?? 0) * 100))}%`, background: color }} /></div>
    </div>
  );
}

function TyreCorner({ label, tyres, keyName }: { label: string; tyres?: TyreState; keyName: "fl" | "fr" | "rl" | "rr" }) {
  return (
    <div className="corner-cell">
      <strong>{label}</strong>
      <span>Pressure {fmt(tyres?.[`pressure_${keyName}` as keyof TyreState] as number | undefined, 1)}</span>
      <span>Wear {pct(tyres?.[`wear_${keyName}` as keyof TyreState] as number | undefined)}</span>
      <span>I/M/O {tyreIOM(tyres?.[`temp_${keyName}` as keyof TyreState] as TyreTemps | undefined)}</span>
      <span>Carcass {tyreTemp(tyres?.[`temp_${keyName}` as keyof TyreState] as TyreTemps | undefined)} C</span>
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
        <div><span className="label">Car</span><strong>{text(player?.vehicle_name)}</strong></div>
        <div><span className="label">Driver</span><strong>{driver}</strong></div>
        <div><span className="label">Position</span><strong>{position != null ? `P${position}` : "--"}</strong></div>
        <div><span className="label">Lap</span><strong>{text(player?.lap_number ?? session?.current_lap)}</strong></div>
        <div><span className="label">Remaining</span><strong>{formatRaceTime(session?.time_remaining)}</strong></div>
      </div>
    </section>
  );
}

function DrivingDisplay({ player }: { player?: PlayerState }) {
  const rpmRatio = Math.min(1, (player?.rpm ?? 0) / Math.max(player?.max_rpm ?? 9000, 1));
  return (
    <section className="card span-5 driving-display">
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

export function LiveDashboard({ telemetry, strategy, recommendation, connected, readOnlyLabel }: { telemetry: TelemetrySnapshot | null; strategy: StrategyState | null; recommendation: RecommendationPayload | null; connected: boolean; readOnlyLabel?: string }) {
  const player = telemetry?.player;
  const playerCar = telemetry?.competitors?.find((c) => c.is_player);
  const tyres = player?.tyre_state;
  const fuel = strategy?.fuel;
  const fuelLapsNeeded = Math.max(0, (fuel?.valid_laps_required ?? 3) - (fuel?.valid_laps_observed ?? 0));
  const invalid = player?.lap_invalidated;
  return (
    <div className="page grid">
      <Header telemetry={telemetry} connected={connected} readOnlyLabel={readOnlyLabel} />
      <DrivingDisplay player={player} />
      <section className="card span-3">
        <SectionTitle title="Lap Timing" help="Shows current pace markers against recent and best laps. A growing delta usually means traffic, tyre drop-off, mistakes, or worse exits." />
        <div className="metric"><span className="label">Current lap</span><span className="value">{formatRaceTime(player?.current_lap_time)}</span></div>
        <div className="metric"><span className="label">Last lap</span><span className="value">{formatRaceTime(player?.last_lap_time ?? playerCar?.last_lap_time)}</span></div>
        <div className="metric"><span className="label">Best lap</span><span className="value">{formatRaceTime(player?.best_lap_time ?? playerCar?.best_lap_time)}</span></div>
        <div className="row"><span className="subvalue">Delta best {fmt(player?.delta_best, 2, " s")}</span><span className="subvalue">Sector {text(player?.current_sector)}</span></div>
        {invalid && <span className="badge red">Lap invalidated</span>}
        {player?.track_limits_steps != null && <span className="badge amber">Track limits {player.track_limits_steps}</span>}
      </section>
      <section className="card span-4">
        <SectionTitle title="Fuel" help="Shows fuel range and margin to finish. Keep margin positive; if consumption rises, pit timing or lift-and-coast may need adjustment." />
        <div className="header-grid two">
          <div><span className="label">Current</span><strong>{fmt(player?.fuel_liters)} L</strong></div>
          <div><span className="label">Capacity</span><strong>{fmt(player?.fuel_capacity_liters)} L</strong></div>
          <div><span className="label">Last lap</span><strong>{fmt(fuel?.last_lap_fuel_used_liters, 2)} L</strong></div>
          <div><span className="label">Session average</span><strong>{fmt(fuel?.fuel_per_lap_liters, 2)} L/lap</strong><span className="subvalue">{fuelLapsNeeded > 0 ? `Need ${fuelLapsNeeded} valid lap${fuelLapsNeeded === 1 ? "" : "s"}` : `${fuel?.valid_laps_observed ?? 0} valid laps`}</span></div>
          <div><span className="label">Range</span><strong>{fmt(fuel?.fuel_laps_remaining)} laps</strong></div>
          <div><span className="label">Needed</span><strong>{fmt(fuel?.required_fuel_to_finish)} L</strong></div>
          <div><span className="label">Margin</span><strong>{fmt(fuel?.fuel_delta_to_finish)} L</strong></div>
        </div>
      </section>
      <section className="card span-6">
        <SectionTitle title="Tyres" help="Shows pressure, wear, and temperature by corner. Large left/right or front/rear differences point to balance, setup, or driving-load issues." />
        <div className="corner-grid">
          <TyreCorner label="FL" tyres={tyres} keyName="fl" />
          <TyreCorner label="FR" tyres={tyres} keyName="fr" />
          <TyreCorner label="RL" tyres={tyres} keyName="rl" />
          <TyreCorner label="RR" tyres={tyres} keyName="rr" />
        </div>
        <span className={strategy?.tyres?.tyre_risk_level === "high" ? "badge red" : "badge green"}>{strategy?.tyres?.tyre_risk_level || "No tyre warning"}</span>
      </section>
      <section className="card span-3">
        <SectionTitle title="Brakes" help="Shows brake temperature and pressure by wheel. Overheated or imbalanced brakes can cause longer stops, locking, and unstable corner entry." />
        <div className="corner-grid">
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
      <section className="card span-3">
        <SectionTitle title="ABS / TC" help="Shows assist activation and onboard levels from shared memory. Frequent activation can indicate braking instability, traction stress, or an aggressive setting." />
        <div className="metric"><span className="label">ABS</span><span className="value">{assist(player?.abs_active, player?.abs_setting, player?.abs_max)}</span></div>
        <div className="metric"><span className="label">TC</span><span className="value">{assist(player?.tc_active, player?.tc_setting, player?.tc_max)}</span></div>
        <div className="header-grid two">
          <div><span className="label">TC slip</span><strong>{text(player?.tc_slip_setting)}</strong></div>
          <div><span className="label">TC cut</span><strong>{text(player?.tc_cut_setting)}</strong></div>
        </div>
      </section>
      <RecommendationPanel payload={recommendation} />
      <CompetitorTable competitors={(telemetry?.competitors || []).slice(0, 8)} />
    </div>
  );
}
