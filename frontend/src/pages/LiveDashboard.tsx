import { CompetitorTable } from "../components/CompetitorTable";
import { RecommendationPanel } from "../components/RecommendationPanel";
import { formatRaceTime } from "../lib/timeFormat";
import type { RecommendationPayload, StrategyState } from "../types/strategy";
import type { PlayerState, TelemetrySnapshot, TyreState, TyreTemps } from "../types/telemetry";

const fmt = (value?: number | null, digits = 1, suffix = "") =>
  value == null || Number.isNaN(value) ? "--" : `${value.toFixed(digits)}${suffix}`;
const pct = (value?: number | null) => (value == null || Number.isNaN(value) ? "--" : `${Math.round(value * 100)}%`);
const text = (value?: string | number | boolean | null) => (value == null || value === "" ? "--" : String(value));
const tyreTemp = (value?: TyreTemps) => fmt(value?.center_c ?? value?.left_c ?? value?.right_c ?? value?.carcass_c, 0);
const tyreIOM = (value?: TyreTemps) => `${fmt(value?.left_c, 0)} / ${fmt(value?.center_c, 0)} / ${fmt(value?.right_c, 0)} C`;

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

function Header({ telemetry, connected }: { telemetry: TelemetrySnapshot | null; connected: boolean }) {
  const player = telemetry?.player;
  const session = telemetry?.session;
  const driver = telemetry?.competitors?.find((car) => car.is_player)?.driver_name || "Player";
  return (
    <section className="card span-12 page-header-card">
      <div className="header-grid">
        <div><span className="label">Connection</span><strong className={connected && telemetry?.connected ? "ok-text" : "warn-text"}>{connected && telemetry?.connected ? "Live" : "Mock/offline"}</strong></div>
        <div><span className="label">Track</span><strong>{text(session?.track_name)}</strong></div>
        <div><span className="label">Session</span><strong>{text(session?.session_type)}</strong></div>
        <div><span className="label">Car</span><strong>{text(player?.vehicle_name)}</strong></div>
        <div><span className="label">Driver</span><strong>{driver}</strong></div>
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
      <h2>Main Driving Display</h2>
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

export function LiveDashboard({ telemetry, strategy, recommendation, connected }: { telemetry: TelemetrySnapshot | null; strategy: StrategyState | null; recommendation: RecommendationPayload | null; connected: boolean }) {
  const player = telemetry?.player;
  const tyres = player?.tyre_state;
  const fuel = strategy?.fuel;
  const invalid = player?.lap_invalidated;
  return (
    <div className="page grid">
      <Header telemetry={telemetry} connected={connected} />
      <DrivingDisplay player={player} />
      <section className="card span-3">
        <h2>Lap Timing</h2>
        <div className="metric"><span className="label">Current lap</span><span className="value">--</span></div>
        <div className="metric"><span className="label">Last lap</span><span className="value">{formatRaceTime(telemetry?.competitors?.find((c) => c.is_player)?.last_lap_time)}</span></div>
        <div className="metric"><span className="label">Best lap</span><span className="value">{formatRaceTime(telemetry?.competitors?.find((c) => c.is_player)?.best_lap_time)}</span></div>
        <div className="row"><span className="subvalue">Delta best --</span><span className="subvalue">S1/S2/S3 --</span></div>
        {invalid && <span className="badge red">Lap invalidated</span>}
        {player?.track_limits_steps != null && <span className="badge amber">Track limits {player.track_limits_steps}</span>}
      </section>
      <section className="card span-4">
        <h2>Fuel</h2>
        <div className="header-grid two">
          <div><span className="label">Current</span><strong>{fmt(player?.fuel_liters)} L</strong></div>
          <div><span className="label">Capacity</span><strong>{fmt(player?.fuel_capacity_liters)} L</strong></div>
          <div><span className="label">Last lap</span><strong>{fmt(fuel?.fuel_per_lap_liters, 2)} L</strong></div>
          <div><span className="label">Average</span><strong>{fmt(fuel?.fuel_per_lap_liters, 2)} L/lap</strong></div>
          <div><span className="label">Range</span><strong>{fmt(fuel?.fuel_laps_remaining)} laps</strong></div>
          <div><span className="label">Needed</span><strong>{fmt(fuel?.required_fuel_to_finish)} L</strong></div>
          <div><span className="label">Margin</span><strong>{fmt(fuel?.fuel_delta_to_finish)} L</strong></div>
        </div>
      </section>
      <section className="card span-6">
        <h2>Tyres</h2>
        <div className="corner-grid">
          <TyreCorner label="FL" tyres={tyres} keyName="fl" />
          <TyreCorner label="FR" tyres={tyres} keyName="fr" />
          <TyreCorner label="RL" tyres={tyres} keyName="rl" />
          <TyreCorner label="RR" tyres={tyres} keyName="rr" />
        </div>
        <span className={strategy?.tyres?.tyre_risk_level === "high" ? "badge red" : "badge green"}>{strategy?.tyres?.tyre_risk_level || "No tyre warning"}</span>
      </section>
      <section className="card span-3">
        <h2>Brakes</h2>
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
      <RecommendationPanel payload={recommendation} />
      <CompetitorTable competitors={(telemetry?.competitors || []).slice(0, 8)} />
    </div>
  );
}
