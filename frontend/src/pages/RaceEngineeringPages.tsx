import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import { SectionTitle } from "../components/SectionTitle";
import { formatRaceGap, formatRaceTime } from "../lib/timeFormat";
import type { SessionReview } from "../types/session";
import type { RecommendationPayload, StrategyState } from "../types/strategy";
import type { CompetitorState, PlayerState, TelemetrySnapshot, TyreState, TyreTemps } from "../types/telemetry";

type EngineeringProps = {
  telemetry: TelemetrySnapshot | null;
  strategy: StrategyState | null;
  recommendation?: RecommendationPayload | null;
  competitors: CompetitorState[];
  connected?: boolean;
};

type Field = Record<string, number | string | boolean | null | undefined>;
type SortDirection = "asc" | "desc";

const wheels = [
  ["FL", "fl"],
  ["FR", "fr"],
  ["RL", "rl"],
  ["RR", "rr"],
] as const;

const classColors = ["#6dd6ff", "#e6b450", "#ff8c69", "#91e48f", "#c7a8ff", "#ff7da7"];

const fmt = (value?: number | null, digits = 1, suffix = "") =>
  value == null || Number.isNaN(value) ? "--" : `${value.toFixed(digits)}${suffix}`;
const pct = (value?: number | null) => (value == null || Number.isNaN(value) ? "--" : `${Math.round(value * 100)}%`);
const text = (value?: string | number | boolean | null) => (value == null || value === "" ? "--" : String(value));
const seconds = (value?: number | null) => formatRaceGap(value);
const tyreTemp = (value?: TyreTemps) => fmt(value?.center_c ?? value?.left_c ?? value?.right_c ?? value?.carcass_c, 1, " C");
const lapTime = (value?: number | null) => formatRaceTime(value);

const asNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const validLap = (value?: number | null) => (value != null && value > 0 ? value : null);
const classList = (cars: CompetitorState[]) => Array.from(new Set(cars.map((car) => car.vehicle_class).filter(Boolean) as string[])).sort();
const sortValue = (car: CompetitorState, key: keyof CompetitorState) => {
  const value = car[key];
  if (typeof value === "string") return value.toLowerCase();
  if (typeof value === "boolean") return value ? 1 : 0;
  return value ?? Number.POSITIVE_INFINITY;
};
const sortedCars = (cars: CompetitorState[], key: keyof CompetitorState, direction: SortDirection) =>
  [...cars].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    if (av < bv) return direction === "asc" ? -1 : 1;
    if (av > bv) return direction === "asc" ? 1 : -1;
    return 0;
  });
const normalizedProgress = (car: CompetitorState, cars: CompetitorState[]) => {
  const distance = asNumber(car.lap_distance);
  if (distance == null) return 0;
  const maxDistance = Math.max(1, ...cars.map((candidate) => asNumber(candidate.lap_distance) ?? 0));
  return Math.max(0, Math.min(1, distance / maxDistance));
};
const sampleWithLive = (review: SessionReview | null, telemetry: TelemetrySnapshot | null, limit = 160) => {
  const samples = lastSamples(review, limit);
  const player = telemetry?.player;
  if (!player) return samples;
  return [
    ...samples,
    {
      lap_number: player.lap_number,
      speed_kph: player.speed_kph,
      rpm: player.rpm,
      throttle: player.throttle,
      brake: player.brake,
      steering: player.steering,
      fuel_liters: player.fuel_liters,
      brake_temp_fl: player.brake_temp_fl,
      brake_temp_fr: player.brake_temp_fr,
      brake_temp_rl: player.brake_temp_rl,
      brake_temp_rr: player.brake_temp_rr,
      brake_pressure_fl: player.brake_pressure_fl,
      brake_pressure_fr: player.brake_pressure_fr,
      brake_pressure_rl: player.brake_pressure_rl,
      brake_pressure_rr: player.brake_pressure_rr,
      ride_height_fl: player.ride_height_fl,
      ride_height_fr: player.ride_height_fr,
      ride_height_rl: player.ride_height_rl,
      ride_height_rr: player.ride_height_rr,
      front_ride_height: player.front_ride_height,
      rear_ride_height: player.rear_ride_height,
      tyre_wear_fl: player.tyre_state?.wear_fl,
      tyre_wear_fr: player.tyre_state?.wear_fr,
      tyre_wear_rl: player.tyre_state?.wear_rl,
      tyre_wear_rr: player.tyre_state?.wear_rr,
      tyre_load_fl: player.tyre_state?.load_fl,
      tyre_load_fr: player.tyre_state?.load_fr,
      tyre_load_rl: player.tyre_state?.load_rl,
      tyre_load_rr: player.tyre_state?.load_rr,
      timestamp: telemetry?.timestamp,
    },
  ];
};
const maxField = (rows: Field[], key: string) => {
  const values = rows.map((row) => Number(row[key])).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
};
const minField = (rows: Field[], key: string) => {
  const values = rows.map((row) => Number(row[key])).filter(Number.isFinite);
  return values.length ? Math.min(...values) : null;
};
const avgField = (rows: Field[], key: string) => {
  const values = rows.map((row) => Number(row[key])).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
};
const isRaceTimeField = (key: string) => key.includes("time") || key.includes("gap");

function useSessionReview() {
  const [review, setReview] = useState<SessionReview | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let mounted = true;
    const load = () =>
      api
        .review()
        .then((data) => {
          if (mounted) {
            setReview(data);
            setError(false);
          }
        })
        .catch(() => mounted && setError(true));
    load();
    const id = window.setInterval(load, 3000);
    return () => {
      mounted = false;
      window.clearInterval(id);
    };
  }, []);
  return { review, error };
}

function EmptyState({ title = "Data not available", detail = "Waiting for live or recorded telemetry." }: { title?: string; detail?: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="metric compact">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {sub && <span className="subvalue">{sub}</span>}
    </div>
  );
}

function DataBar({ label, value, color = "#e6b450" }: { label: string; value?: number; color?: string }) {
  const width = Math.max(0, Math.min(100, (value ?? 0) * 100));
  return (
    <div className="metric">
      <div className="row"><span className="label">{label}</span><span className="subvalue">{pct(value)}</span></div>
      <div className="bar"><span style={{ width: `${width}%`, background: color }} /></div>
    </div>
  );
}

function PageHeader({ telemetry, connected }: { telemetry: TelemetrySnapshot | null; connected?: boolean }) {
  const player = telemetry?.player;
  const session = telemetry?.session;
  return (
    <section className="card span-12 page-header-card">
      <div className="header-grid">
        <Metric label="Status" value={connected && telemetry?.connected ? "Connected" : "Mock/offline"} />
        <Metric label="Track" value={text(session?.track_name)} />
        <Metric label="Session" value={text(session?.session_type)} />
        <Metric label="Car" value={text(player?.vehicle_name)} />
        <Metric label="Driver" value={text((telemetry?.competitors || []).find((c) => c.is_player)?.driver_name || "Player")} />
        <Metric label="Lap" value={text(player?.lap_number ?? session?.current_lap)} />
        <Metric label="Remaining" value={formatRaceTime(session?.time_remaining)} />
      </div>
    </section>
  );
}

function FourCornerTyres({ tyres, dense = false }: { tyres?: TyreState; dense?: boolean }) {
  return (
    <div className="corner-grid">
      {wheels.map(([label, key]) => (
        <div className="corner-cell" key={key}>
          <strong>{label}</strong>
          <span>Wear {pct(tyres?.[`wear_${key}` as keyof TyreState] as number | undefined)}</span>
          <span>Press {fmt(tyres?.[`pressure_${key}` as keyof TyreState] as number | undefined, 1, " kPa")}</span>
          <span>Temp {tyreTemp(tyres?.[`temp_${key}` as keyof TyreState] as TyreTemps | undefined)}</span>
          {dense && (
            <>
              <span>Inner --</span>
              <span>Middle --</span>
              <span>Outer --</span>
              <span>Load {fmt(tyres?.[`load_${key}` as keyof TyreState] as number | undefined, 0, " N")}</span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function BrakeGrid({ player, dense = false }: { player?: PlayerState; dense?: boolean }) {
  return (
    <div className="corner-grid">
      {wheels.map(([label, key]) => (
        <div className="corner-cell" key={label}>
          <strong>{label}</strong>
          <span>Temp {fmt(player?.[`brake_temp_${key}` as keyof PlayerState] as number | undefined, 0, " C")}</span>
          <span>Pressure {fmt(player?.[`brake_pressure_${key}` as keyof PlayerState] as number | undefined, 2)}</span>
          {dense && <span>Status {(player?.[`brake_temp_${key}` as keyof PlayerState] as number | undefined) ? "Live" : "Not exposed"}</span>}
        </div>
      ))}
    </div>
  );
}

function CompetitorRows({ competitors, limit = 10, filter = "all" }: { competitors: CompetitorState[]; limit?: number; filter?: string }) {
  const [sortKey, setSortKey] = useState<keyof CompetitorState>("position");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const filtered = competitors.filter((car) => filter === "all" || car.vehicle_class === filter);
  const rows = sortedCars(filtered, sortKey, direction).slice(0, limit);
  const sort = (key: keyof CompetitorState) => {
    if (sortKey === key) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection("asc");
    }
  };
  if (!rows.length) return <EmptyState detail="No competitor timing has arrived yet." />;
  const heading = (label: string, key: keyof CompetitorState) => (
    <button className="table-sort" onClick={() => sort(key)}>{label}{sortKey === key ? ` ${direction === "asc" ? "up" : "down"}` : ""}</button>
  );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{heading("Pos", "position")}</th>
            <th>{heading("Class", "vehicle_class")}</th>
            <th>{heading("Driver", "driver_name")}</th>
            <th>{heading("Car", "vehicle_name")}</th>
            <th>{heading("Lap", "total_laps")}</th>
            <th>{heading("Last", "last_lap_time")}</th>
            <th>{heading("Best", "best_lap_time")}</th>
            <th>{heading("Gap", "time_behind_next")}</th>
            <th>{heading("Pits", "pitstops")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((car) => (
            <tr key={car.vehicle_id}>
              <td>{text(car.position)}</td>
              <td>{text(car.vehicle_class)}</td>
              <td>{text(car.driver_name || (car.is_player ? "Player" : ""))}</td>
              <td>{text(car.vehicle_name)}</td>
              <td>{text(car.total_laps ?? car.current_lap)}</td>
              <td>{lapTime(car.last_lap_time)}</td>
              <td>{lapTime(car.best_lap_time)}</td>
              <td>{seconds(car.time_behind_next ?? car.gap_to_player)}</td>
              <td>{car.in_pits ? "Pit" : text(car.pitstops)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BasicLineChart({ data, lines, xKey = "lap_number", height = 220 }: { data: Field[]; lines: Array<[string, string]>; xKey?: string; height?: number }) {
  const timeAxis = lines.some(([key]) => isRaceTimeField(key));
  if (!data.length) return <EmptyState />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <CartesianGrid stroke="#27313a" />
        <XAxis dataKey={xKey} stroke="#8896a3" />
        <YAxis stroke="#8896a3" tickFormatter={(value) => timeAxis ? formatRaceTime(Number(value)) : String(value)} />
        <Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} formatter={(value, name) => isRaceTimeField(String(name)) ? formatRaceTime(Number(value)) : value} />
        <Legend />
        {lines.map(([key, color]) => <Line key={key} dataKey={key} stroke={color} dot={false} connectNulls />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

function lastSamples(review: SessionReview | null, limit = 40) {
  return (review?.telemetry_samples || []).slice(-limit) as Field[];
}

function sampleLapRows(review: SessionReview | null) {
  const laps = review?.laps?.length ? review.laps : [];
  return (laps as Field[]).slice(-12);
}

function numericSampleFields(samples: Field[]) {
  const preferred = [
    "game_time",
    "lap_number",
    "speed_kph",
    "gear",
    "rpm",
    "fuel_liters",
    "throttle",
    "brake",
    "steering",
    "brake_temp_fl",
    "brake_temp_fr",
    "brake_temp_rl",
    "brake_temp_rr",
    "brake_pressure_fl",
    "brake_pressure_fr",
    "brake_pressure_rl",
    "brake_pressure_rr",
    "tyre_wear_fl",
    "tyre_wear_fr",
    "tyre_wear_rl",
    "tyre_wear_rr",
    "tyre_load_fl",
    "tyre_load_fr",
    "tyre_load_rl",
    "tyre_load_rr",
    "ride_height_fl",
    "ride_height_fr",
    "ride_height_rl",
    "ride_height_rr",
    "tyre_temp_fl",
    "tyre_temp_fr",
    "tyre_temp_rl",
    "tyre_temp_rr",
    "track_temp",
    "ambient_temp",
    "rain",
    "wetness",
  ];
  const discovered = new Set<string>();
  samples.forEach((sample) => {
    Object.entries(sample).forEach(([key, value]) => {
      if (typeof value === "number" && Number.isFinite(value)) discovered.add(key);
    });
  });
  return [...preferred.filter((key) => discovered.has(key)), ...[...discovered].filter((key) => !preferred.includes(key)).sort()];
}

function buildStints(laps: Field[]) {
  const stints: Array<{ number: number; rows: Field[]; summary: Field }> = [];
  let current: Field[] = [];
  laps.forEach((lap) => {
    if (current.length && Number(lap.fuel_added || 0) > 2) {
      stints.push({ number: stints.length + 1, rows: current, summary: {} });
      current = [];
    }
    current.push(lap);
  });
  if (current.length) stints.push({ number: stints.length + 1, rows: current, summary: {} });
  return stints.map((stint) => {
    const rows = stint.rows;
    const fuelUsed = rows.map((row) => Number(row.fuel_used)).filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
    const summary = {
      stint_number: stint.number,
      start_lap: rows[0]?.lap_number,
      end_lap: rows[rows.length - 1]?.lap_number,
      lap_count: rows.length,
      fastest_lap: minField(rows, "lap_time"),
      average_lap: avgField(rows, "lap_time"),
      top_speed: maxField(rows, "top_speed"),
      fuel_used: fuelUsed || null,
      fuel_per_lap: fuelUsed && rows.length ? fuelUsed / rows.length : null,
      tyre_wear_delta: (Number(rows[rows.length - 1]?.tyre_wear_end) || 0) - (Number(rows[0]?.tyre_wear_start) || 0),
    };
    return { ...stint, summary };
  });
}

export function RaceInfo({ telemetry, strategy }: EngineeringProps) {
  const { review } = useSessionReview();
  const player = telemetry?.player;
  const fuel = strategy?.fuel;
  const tyres = telemetry?.player?.tyre_state;
  const rows = sampleWithLive(review, telemetry, 80);
  const lapRows = sampleLapRows(review);
  const playerCar = (telemetry?.competitors || []).find((c) => c.is_player);
  return (
    <div className="page grid">
      <section className="card span-4">
        <SectionTitle title="Fuel Strategy" help="Estimates fuel range, margin, and pit pressure. A negative margin means the current pace or consumption cannot safely reach the target." />
        <Metric label="Current fuel" value={`${fmt(player?.fuel_liters)} L`} />
        <Metric label="Fuel capacity" value={`${fmt(player?.fuel_capacity_liters)} L`} />
        <Metric label="Last lap used" value={`${fmt(fuel?.fuel_per_lap_liters, 2)} L`} />
        <Metric label="3-lap average" value={`${fmt(fuel?.fuel_per_lap_liters, 2)} L`} />
        <Metric label="Laps remaining" value={fmt(fuel?.fuel_laps_remaining)} />
        <Metric label="Needed to finish" value={`${fmt(fuel?.required_fuel_to_finish)} L`} />
        <Metric label="Fuel margin" value={`${fmt(fuel?.fuel_delta_to_finish)} L`} />
        <Metric label="Suggested pit lap" value={text(strategy?.pit_window?.optimal_pit_lap)} />
      </section>
      <section className="card span-4">
        <SectionTitle title="Tyre Strategy" help="Tracks tyre wear rate and remaining life. Faster rear wear suggests traction stress; faster front wear suggests understeer or overworking entry speed." />
        <FourCornerTyres tyres={tyres} />
        <Metric label="Wear per lap" value={pct(strategy?.tyres?.wear_rate_per_lap)} />
        <Metric label="Estimated life" value={`${fmt(strategy?.tyres?.estimated_remaining_tyre_life_laps)} laps`} />
        <Metric label="Front/rear delta" value="Estimate pending" />
        <Metric label="Left/right delta" value="Estimate pending" />
      </section>
      <section className="card span-4">
        <SectionTitle title="Pit Strategy" help="Combines fuel, tyre life, and traffic into a pit window. The safest stop is inside the window with acceptable rejoin traffic." />
        <Metric label="Current stint lap" value={text(strategy?.stint?.current_stint_lap)} />
        <Metric label="Pit window" value={`${text(strategy?.pit_window?.earliest_viable_pit_lap)}-${text(strategy?.pit_window?.latest_safe_pit_lap)}`} />
        <Metric label="Remaining stint laps" value={fmt(strategy?.tyres?.estimated_remaining_tyre_life_laps)} />
        <Metric label="Pit stop count" value={text(playerCar?.pitstops)} />
        <Metric label="Pit status" value={text(playerCar?.pit_state || (playerCar?.in_pits ? "In pit" : "Not pitting"))} />
      </section>
      <section className="card span-6">
        <SectionTitle title="Lap Pace Trend" help="Shows completed-lap pace and fuel used. Rising lap times with stable fuel usually point to tyre degradation, traffic, or consistency loss." />
        <BasicLineChart data={lapRows} lines={[["lap_time", "#e6b450"], ["fuel_used", "#6dd6ff"]]} />
      </section>
      <section className="card span-6">
        <SectionTitle title="Stint Summary" help="Summarizes current stint pace and top speed. Compare best, last, and average pace to judge whether the stint is improving or fading." />
        <div className="header-grid two">
          <Metric label="Current lap" value={text(player?.lap_number)} />
          <Metric label="Last lap" value={lapTime(playerCar?.last_lap_time)} />
          <Metric label="Best lap" value={lapTime(playerCar?.best_lap_time)} />
          <Metric label="Current stint" value={text(strategy?.stint?.current_stint_lap)} />
          <Metric label="Top speed" value={fmt(maxField(rows, "speed_kph"), 0, " km/h")} />
          <Metric label="Saved laps" value={lapRows.length} />
        </div>
        <p className="muted">Lap pace is derived from the recorded live session samples. Use Session Review to open older saved sessions.</p>
      </section>
    </div>
  );
}

export function Driving({ telemetry }: EngineeringProps) {
  const player = telemetry?.player;
  return (
    <div className="page grid">
      <section className="card span-3">
        <SectionTitle title="Driver Inputs" help="Shows throttle, brake, steering, and overlap. Smooth separated inputs generally improve tyre life and car balance." />
        <DataBar label="Throttle" value={player?.throttle} color="#69d28f" />
        <DataBar label="Brake" value={player?.brake} color="#ff6961" />
        <DataBar label="Steering" value={Math.abs(player?.steering ?? 0)} color="#6dd6ff" />
        <DataBar label="Clutch" value={player?.clutch} />
        <Metric label="Overlap" value={(player?.throttle ?? 0) > 0.05 && (player?.brake ?? 0) > 0.05 ? "Active" : "Clear"} />
        <Metric label="Smoothness" value="Estimate pending" />
      </section>
      <section className="card span-3">
        <SectionTitle title="Powertrain" help="Shows gear, RPM, speed, limiter, ABS, and TC state. Frequent assists or limiter use can signal traction or gearing inefficiency." />
        <Metric label="Gear" value={text(player?.gear)} />
        <Metric label="RPM" value={fmt(player?.rpm, 0)} />
        <Metric label="Max RPM" value={fmt(player?.max_rpm, 0)} />
        <Metric label="Speed" value={`${fmt(player?.speed_kph, 0)} km/h`} />
        <Metric label="Torque" value={fmt(player?.engine_torque, 0)} />
        <Metric label="Limiter" value={player?.speed_limiter ? "On" : "Off"} />
        <Metric label="ABS / TC" value={`${player?.abs_active ? "ABS" : "--"} / ${player?.tc_active ? "TC" : "--"}`} />
      </section>
      <section className="card span-6">
        <SectionTitle title="Suspension And Aero" help="Shows ride-height and platform signals. Low ride heights or large front/rear changes suggest bottoming, pitch sensitivity, or aero instability." />
        <div className="header-grid">
          <Metric label="Front ride" value={fmt(player?.front_ride_height ?? avgField([{ value: player?.ride_height_fl }, { value: player?.ride_height_fr }], "value"), 3, " m")} />
          <Metric label="Rear ride" value={fmt(player?.rear_ride_height ?? avgField([{ value: player?.ride_height_rl }, { value: player?.ride_height_rr }], "value"), 3, " m")} />
          <Metric label="FL / FR ride" value={`${fmt(player?.ride_height_fl, 3, " m")} / ${fmt(player?.ride_height_fr, 3, " m")}`} />
          <Metric label="RL / RR ride" value={`${fmt(player?.ride_height_rl, 3, " m")} / ${fmt(player?.ride_height_rr, 3, " m")}`} />
          <Metric label="Deflection" value={fmt(player?.suspension_deflection_fl, 3, " m")} />
          <Metric label="Camber" value="--" />
          <Metric label="Front DF" value={fmt(player?.front_downforce, 0)} />
          <Metric label="Rear DF" value={fmt(player?.rear_downforce, 0)} />
          <Metric label="Drag" value={fmt(player?.drag, 2)} />
        </div>
      </section>
      <section className="card span-6"><SectionTitle title="Tyre Engineering" help="Compares per-corner tyre state. Watch pressure, load, and wear balance to spot setup imbalance or overdriving one axle." /><FourCornerTyres tyres={player?.tyre_state} dense /></section>
      <section className="card span-3"><SectionTitle title="Brake Engineering" help="Shows brake temperatures and pressure by wheel. Front/rear or left/right imbalance can explain locking and entry instability." /><BrakeGrid player={player} dense /></section>
      <section className="card span-3"><SectionTitle title="Ahead Telemetry" help="Reserved for selected-car comparison. When available, use it to compare inputs and speed against traffic ahead." /><EmptyState detail="Selected-car live inputs are not exposed by the current shared-memory layer." /></section>
    </div>
  );
}

export function TrackMap({ telemetry, competitors }: EngineeringProps) {
  const cars = competitors.length ? competitors : telemetry?.competitors || [];
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [classFilter, setClassFilter] = useState("all");
  const [nearbyOnly, setNearbyOnly] = useState(false);
  const [showPitCars, setShowPitCars] = useState(true);
  const classes = classList(cars);
  const playerPosition = cars.find((c) => c.is_player)?.position ?? 0;
  const visibleCars = cars.filter((car) =>
    (classFilter === "all" || car.vehicle_class === classFilter) &&
    (showPitCars || !car.in_pits) &&
    (!nearbyOnly || Math.abs((car.position ?? 0) - playerPosition) <= 5 || car.is_player)
  );
  const selected = visibleCars.find((c) => c.vehicle_id === selectedId) || visibleCars.find((c) => c.is_player) || visibleCars[0];
  return (
    <div className="page grid">
      <section className="card span-8">
        <h2>Track Map</h2>
        <div className="track-map">
          <svg viewBox="0 0 640 360" role="img" aria-label="Generated track map">
            <path d="M110 220 C80 80 255 45 360 70 C525 105 585 210 500 285 C400 370 150 335 110 220Z" fill="none" stroke="#33414d" strokeWidth="22" />
            <path d="M110 220 C80 80 255 45 360 70 C525 105 585 210 500 285 C400 370 150 335 110 220Z" fill="none" stroke="#11161b" strokeWidth="12" />
            {visibleCars.slice(0, 40).map((car, index) => {
              const angle = normalizedProgress(car, visibleCars) * Math.PI * 2 + index * 0.02;
              const x = 320 + Math.cos(angle) * (210 + Math.sin(angle * 2) * 35);
              const y = 185 + Math.sin(angle) * 105;
              const color = classColors[Math.abs((car.vehicle_class || "").length + index) % classColors.length];
              return (
                <g key={car.vehicle_id} onClick={() => setSelectedId(car.vehicle_id)} className="svg-clickable">
                  <circle cx={x} cy={y} r={car.is_player ? 9 : 6} fill={color} stroke={car.in_pits ? "#fff" : car.is_player ? "#e6edf3" : "#0c0f12"} strokeWidth={car.is_player ? 3 : 2} />
                  {showLabels && <text x={x + 10} y={y + 4} fill="#dce6ee" fontSize="11">{car.position ?? index + 1}</text>}
                </g>
              );
            })}
          </svg>
        </div>
      </section>
      <section className="card span-4">
        <h2>Selected Car</h2>
        {selected ? (
          <>
            <Metric label="Driver" value={text(selected.driver_name || (selected.is_player ? "Player" : ""))} />
            <Metric label="Car" value={text(selected.vehicle_name)} />
            <Metric label="Class" value={text(selected.vehicle_class)} />
            <Metric label="Position" value={text(selected.position)} />
            <Metric label="Class position" value={text(selected.class_position)} />
            <Metric label="Best / last" value={`${lapTime(selected.best_lap_time)} / ${lapTime(selected.last_lap_time)}`} />
            <Metric label="Pit state" value={text(selected.pit_state || (selected.in_pits ? "In pit" : "Track"))} />
            <Metric label="Penalties" value={text(selected.penalties)} />
          </>
        ) : <EmptyState />}
      </section>
      <section className="card span-12">
        <h2>Map Controls</h2>
        <div className="control-row">
          <button onClick={() => setSelectedId(cars.find((c) => c.is_player)?.vehicle_id ?? null)}>Follow player</button>
          <label><input type="checkbox" checked={showLabels} onChange={(event) => setShowLabels(event.target.checked)} /> Labels</label>
          <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
            <option value="all">All classes</option>
            {classes.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <label><input type="checkbox" checked={nearbyOnly} onChange={(event) => setNearbyOnly(event.target.checked)} /> Nearby only</label>
          <label><input type="checkbox" checked={showPitCars} onChange={(event) => setShowPitCars(event.target.checked)} /> Pit cars</label>
          <span className="muted">{visibleCars.length} cars shown</span>
        </div>
      </section>
    </div>
  );
}

export function CircleMap({ telemetry, competitors, strategy }: EngineeringProps) {
  const cars = competitors.length ? competitors : telemetry?.competitors || [];
  const player = telemetry?.player;
  return (
    <div className="page grid">
      <section className="card span-8">
        <SectionTitle title="Circle Map" help="Places cars around a simplified lap circle by track progress. Use it to understand nearby traffic without needing real track geometry." />
        <div className="circle-map">
          {cars.slice(0, 48).map((car, index) => {
            const angle = (normalizedProgress(car, cars) * Math.PI * 2) - Math.PI / 2;
            const x = 50 + Math.cos(angle) * 42;
            const y = 50 + Math.sin(angle) * 42;
            return <span key={car.vehicle_id} className={car.is_player ? "car-dot player" : "car-dot"} style={{ left: `${x}%`, top: `${y}%`, background: classColors[index % classColors.length] }}>{car.position}</span>;
          })}
          <div className="circle-center">
            <strong>{seconds(player?.gap_car_ahead)}</strong>
            <span>ahead</span>
            <strong>{seconds(player?.gap_car_behind)}</strong>
            <span>behind</span>
          </div>
        </div>
      </section>
      <section className="card span-4">
        <SectionTitle title="Traffic And Fuel" help="Combines nearby gaps with fuel and pit state. Close gaps and low fuel should influence risk, pace targets, and pit timing." />
        <Metric label="Fuel remaining" value={`${fmt(player?.fuel_liters)} L`} />
        <Metric label="Estimated laps" value={fmt(strategy?.fuel?.fuel_laps_remaining)} />
        <Metric label="Pit status" value={text(cars.find((c) => c.is_player)?.pit_state || "Track")} />
        <Metric label="Current lap" value={text(player?.lap_number)} />
        <Metric label="Warnings" value={player?.gap_car_behind != null && player.gap_car_behind < 1 ? "Close car behind" : "Clear"} />
      </section>
      <section className="card span-6"><SectionTitle title="Cars Ahead" help="Shows immediate traffic targets. Compare last laps and gaps to decide whether to attack, save, or wait." /><CompetitorRows competitors={cars.filter((c) => !c.is_player).slice(0, 3)} /></section>
      <section className="card span-6"><SectionTitle title="Cars Behind" help="Shows pressure from behind. A faster car behind may require defensive positioning or earlier traffic planning." /><CompetitorRows competitors={cars.filter((c) => !c.is_player).slice(3, 6)} /></section>
    </div>
  );
}

export function LapCompare({ telemetry }: EngineeringProps) {
  const { review } = useSessionReview();
  const [lapA, setLapA] = useState("");
  const [lapB, setLapB] = useState("");
  const samples: Field[] = sampleWithLive(review, telemetry, 220).map((sample, index) => ({ distance: index, ...sample }));
  const lapOptions = Array.from(new Set(samples.map((sample) => text(sample.lap_number)).filter((value) => value !== "--")));
  const selectedSamples = samples.filter((sample) => !lapA || text(sample.lap_number) === lapA || text(sample.lap_number) === lapB);
  const playerCar = telemetry?.competitors?.find((car) => car.is_player);
  return (
    <div className="page grid">
      <section className="card span-12">
        <SectionTitle title="Lap Selectors" help="Choose two laps from the recorded live session. Comparing similar fuel and tyre states gives the clearest driving conclusions." />
        <div className="input-grid">
          <input value="Current session" readOnly />
          <input value="Player" readOnly />
          <select value={lapA} onChange={(event) => setLapA(event.target.value)}><option value="">Lap A: latest</option>{lapOptions.map((lap) => <option key={lap} value={lap}>Lap {lap}</option>)}</select>
          <select value={lapB} onChange={(event) => setLapB(event.target.value)}><option value="">Lap B: previous</option>{lapOptions.map((lap) => <option key={lap} value={lap}>Lap {lap}</option>)}</select>
          <input value="Tyre/fuel when available" readOnly />
        </div>
      </section>
      <section className="card span-4"><SectionTitle title="Comparison Summary" help="Summarizes the selected laps. Look for speed, fuel, and timing differences before judging driving changes." /><Metric label="Lap A" value={lapA || text(playerCar?.total_laps)} /><Metric label="Lap B" value={lapB || "previous"} /><Metric label="Difference" value="Sector data pending" /><Metric label="Top speed" value={fmt(maxField(selectedSamples, "speed_kph"), 0, " km/h")} /><Metric label="Fuel delta" value="Needs complete lap samples" /></section>
      <section className="card span-8"><SectionTitle title="Speed vs Lap Distance" help="Compares speed, throttle, and brake across the lap. Time is often gained by braking cleanly, carrying minimum speed, and applying throttle earlier." /><BasicLineChart data={selectedSamples} xKey="distance" lines={[["speed_kph", "#e6b450"], ["throttle", "#69d28f"], ["brake", "#ff6961"]]} /></section>
      <section className="card span-6"><SectionTitle title="Telemetry Comparison" help="Compares RPM, steering, and gear choice. Extra steering or wrong gear selection can cost exit speed and increase tyre stress." /><BasicLineChart data={selectedSamples} xKey="distance" lines={[["rpm", "#6dd6ff"], ["steering", "#ff8c69"], ["gear", "#c7a8ff"]]} /></section>
      <section className="card span-3"><SectionTitle title="Sector Breakdown" help="Breaks time loss into track sections. Focus first on the largest loss area rather than chasing every corner." /><Metric label="Sector 1 delta" value="--" /><Metric label="Sector 2 delta" value="--" /><Metric label="Sector 3 delta" value="--" /><Metric label="Largest loss" value="Not enough lap data" /></section>
      <section className="card span-3"><SectionTitle title="Coaching Insight" help="Uses simple driving rules to point at likely improvements. Treat it as a starting hypothesis to confirm in the charts." /><p className="muted">Collect complete lap samples to compare braking, minimum speed, throttle pickup, exits, and steering consistency.</p></section>
    </div>
  );
}

export function OneLapTiming({ competitors }: EngineeringProps) {
  const [filter, setFilter] = useState("overall");
  const playerPosition = competitors.find((car) => car.is_player)?.position ?? 0;
  const playerClass = competitors.find((car) => car.is_player)?.vehicle_class;
  const rows = competitors.filter((car) => {
    if (filter === "same-class") return car.vehicle_class === playerClass;
    if (filter === "ahead") return (car.position ?? 999) < playerPosition;
    if (filter === "behind") return (car.position ?? 0) > playerPosition;
    if (filter === "pit") return Boolean(car.in_pits);
    if (filter === "track") return !car.in_pits;
    return true;
  });
  return (
    <div className="page grid">
      <section className="card span-12">
        <SectionTitle title="Reference Lap And Filters" help="Sets the timing comparison context. Use same-class and ahead/behind filters to focus on the cars that matter tactically." />
        <div className="control-row">
          <select defaultValue="player-best"><option value="player-best">Player best</option><option value="session-best">Session best</option><option value="saved">Saved lap</option></select>
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="overall">Overall</option>
            <option value="same-class">Same class only</option>
            <option value="ahead">Cars ahead</option>
            <option value="behind">Cars behind</option>
            <option value="pit">In pit</option>
            <option value="track">Not in pit</option>
          </select>
          <span className="muted">{rows.length} cars</span>
        </div>
      </section>
      <section className="card span-12">
        <SectionTitle title="Timing Table" help="Shows current pace and position for visible cars. Look for pit state, invalid laps, and sector loss to understand who is genuinely fast." />
        <CompetitorRows competitors={rows} limit={60} />
      </section>
    </div>
  );
}

export function FieldSpread({ telemetry, competitors }: EngineeringProps) {
  const cars = competitors.length ? competitors : telemetry?.competitors || [];
  const [sameClassOnly, setSameClassOnly] = useState(false);
  const [showPitCars, setShowPitCars] = useState(true);
  const [gapMode, setGapMode] = useState<"leader" | "player">("leader");
  const leader = cars.find((c) => c.position === 1) || cars[0];
  const player = cars.find((c) => c.is_player);
  const visibleCars = sortedCars(
    cars.filter((car) => (!sameClassOnly || car.vehicle_class === player?.vehicle_class) && (showPitCars || !car.in_pits)),
    "position",
    "asc",
  );
  return (
    <div className="page grid">
      <section className="card span-12">
        <SectionTitle title="Controls" help="Changes how the field is grouped. Same-class and pit filters make race gaps easier to read during traffic." />
        <div className="control-row">
          <select value={gapMode} onChange={(event) => setGapMode(event.target.value as "leader" | "player")}>
            <option value="leader">Gaps to leader</option>
            <option value="player">Gaps to player</option>
          </select>
          <label><input type="checkbox" checked={sameClassOnly} onChange={(event) => setSameClassOnly(event.target.checked)} /> Same class only</label>
          <label><input type="checkbox" checked={showPitCars} onChange={(event) => setShowPitCars(event.target.checked)} /> Show pit cars</label>
        </div>
      </section>
      <section className="card span-12">
        <SectionTitle title="Field Spread" help="Plots cars by race gap rather than track position. Clusters show traffic packs, safety-car compression, or pit-cycle groups." />
        <div className="spread-chart">
          {visibleCars.slice(0, 50).map((car, index) => {
            const rawGap = gapMode === "player" ? Math.abs((car.position ?? 0) - (player?.position ?? 0)) * 3 : (car.time_behind_leader ?? car.time_behind_next ?? index * 4);
            const left = Math.min(96, Math.max(2, (rawGap as number) / Math.max(1, visibleCars.length * 4) * 96));
            return <span key={car.vehicle_id} className={car.is_player ? "spread-car player" : "spread-car"} style={{ left: `${left}%`, background: classColors[index % classColors.length] }} title={car.driver_name}>{car.position}</span>;
          })}
        </div>
      </section>
      <section className="card span-4"><SectionTitle title="Race State" help="Summarizes the current race picture. Use it to judge whether to attack, defend, save fuel, or react to pit traffic." /><Metric label="Leader" value={text(leader?.driver_name || leader?.vehicle_name)} /><Metric label="Player position" value={text(player?.position)} /><Metric label="Player class" value={text(player?.class_position)} /><Metric label="Gap ahead" value={seconds(telemetry?.player?.gap_car_ahead)} /><Metric label="Cars in pits" value={cars.filter((c) => c.in_pits).length} /></section>
      <section className="card span-8"><SectionTitle title="Gap Table" help="Lists gaps in race order. Gaps to next car show immediate battle pressure, while leader gaps show overall race spread." /><CompetitorRows competitors={visibleCars} limit={60} /></section>
    </div>
  );
}

export function RaceHistory({ telemetry }: EngineeringProps) {
  const { review, error } = useSessionReview();
  const samples = sampleWithLive(review, telemetry, 300);
  const laps = sampleLapRows(review);
  if (error && !samples.length) return <div className="page"><section className="card"><EmptyState title="No saved sessions" detail="Session history will appear after recording telemetry samples." /></section></div>;
  return (
    <div className="page grid">
      <section className="card span-6"><SectionTitle title="Lap Time History" help="Shows pace evolution over the session. Rising lap times can indicate tyre degradation, fuel saving, traffic, or inconsistency." /><BasicLineChart data={laps} lines={[["lap_time", "#6dd6ff"]]} /></section>
      <section className="card span-6"><SectionTitle title="Lap Fuel Usage" help="Shows fuel burned per completed lap. Stable values improve strategy confidence; spikes often mean traffic, draft, or driving style changes." /><BasicLineChart data={laps} lines={[["fuel_used", "#e6b450"]]} /></section>
      <section className="card span-6"><SectionTitle title="Fuel Over Session" help="Tracks remaining fuel through time. A linear slope makes finish estimates reliable; jumps usually mark refuelling or session changes." /><BasicLineChart data={samples} xKey="game_time" lines={[["fuel_liters", "#e6b450"]]} /></section>
      <section className="card span-6"><SectionTitle title="Tyre Wear History" help="Tracks tyre condition by corner. Uneven wear points to balance, setup, or driving load concentrated on one axle or side." /><BasicLineChart data={samples} xKey="game_time" lines={[["tyre_wear_fl", "#6dd6ff"], ["tyre_wear_fr", "#ff8c69"], ["tyre_wear_rl", "#91e48f"], ["tyre_wear_rr", "#c7a8ff"]]} /></section>
      <section className="card span-6"><SectionTitle title="Speed Trace" help="Shows speed and RPM over the session. Compare peaks and drops to spot traffic, mistakes, gearing limits, or changing conditions." /><BasicLineChart data={samples} xKey="game_time" lines={[["speed_kph", "#e6b450"], ["rpm", "#6dd6ff"]]} /></section>
      <section className="card span-6"><SectionTitle title="Driver Inputs" help="Shows throttle, brake, and steering history. Smooth, separated inputs usually help tyre life and repeatable lap times." /><BasicLineChart data={samples} xKey="game_time" lines={[["throttle", "#69d28f"], ["brake", "#ff6961"], ["steering", "#c7a8ff"]]} /></section>
      <section className="card span-12"><SectionTitle title="Event Timeline" help="Lists recorded session events and recommendations. Use it to connect pace changes with pits, warnings, or notable moments." /><EventList review={review} /></section>
    </div>
  );
}

function EventList({ review }: { review: SessionReview | null }) {
  const events = [...(review?.recommendations || []), ...(review?.pit_events || [])] as Field[];
  if (!events.length) return <EmptyState detail="Lap, pit, flag, penalty, and incident events will appear as they are recorded." />;
  return <div className="table-wrap"><table><tbody>{events.slice(-20).map((event, index) => <tr key={index}><td>{text(event.timestamp ?? event.lap_number)}</td><td>{text(event.recommendation_type ?? event.type ?? "Event")}</td><td>{text(event.message ?? event.priority ?? "")}</td></tr>)}</tbody></table></div>;
}

export function StintData({ telemetry, strategy }: EngineeringProps) {
  const { review } = useSessionReview();
  const [selectedStint, setSelectedStint] = useState(1);
  const laps = sampleLapRows(review);
  const stints = buildStints((review?.laps || []) as Field[]);
  const selected = stints.find((stint) => stint.number === selectedStint) || stints[0];
  const rows = selected?.rows || laps;
  const summary = selected?.summary || {};
  return (
    <div className="page grid">
      <section className="card span-12"><SectionTitle title="Stint Selector" help="Chooses the stint to inspect. Splits are inferred from pit stops or fuel increases, so check unusual short stints manually." /><div className="control-row">{stints.length ? stints.map((stint) => <button key={stint.number} className={selectedStint === stint.number ? "active-control" : ""} onClick={() => setSelectedStint(stint.number)}>Stint {stint.number}</button>) : <button className="active-control">Current stint</button>}<button>Compare stints</button><span className="muted">Splits are inferred from fuel increases greater than 2 L.</span></div></section>
      <section className="card span-3"><SectionTitle title="Summary" help="Condenses stint length, pace, and fuel. Compare fastest and average lap to judge consistency across the run." /><Metric label="Stint length" value={text(summary.lap_count ?? strategy?.stint?.current_stint_lap)} /><Metric label="Fastest lap" value={lapTime(summary.fastest_lap as number)} /><Metric label="Average lap" value={lapTime(summary.average_lap as number)} /><Metric label="Fuel used" value={`${fmt(summary.fuel_used as number ?? telemetry?.player?.fuel_liters)} L`} /></section>
      <section className="card span-3"><SectionTitle title="Tyres" help="Summarizes wear and compound state. High wear rate with stable pace may be acceptable; high wear plus pace loss needs attention." /><Metric label="Wear delta" value={pct(strategy?.tyres?.average_wear)} /><Metric label="Deg per lap" value={pct(strategy?.tyres?.wear_rate_per_lap)} /><Metric label="Compound" value={text(telemetry?.player?.tyre_state?.compound_front)} /></section>
      <section className="card span-6"><SectionTitle title="Stint Comparison" help="Compares lap time, fuel use, and tyre change across the stint. Look for degradation trends after fuel load falls." /><BasicLineChart data={rows} lines={[["lap_time", "#e6b450"], ["fuel_used", "#6dd6ff"], ["tyre_wear_delta", "#ff8c69"]]} /></section>
      <section className="card span-12"><SectionTitle title="Stint Lap Table" help="Shows every lap in the selected stint. Sort the story by lap time, fuel used, and events before changing setup assumptions." /><LapTable rows={rows} /></section>
    </div>
  );
}

function LapTable({ rows }: { rows: Field[] }) {
  if (!rows.length) return <EmptyState />;
  return <div className="table-wrap"><table><thead><tr><th>Lap</th><th>Lap time</th><th>Start</th><th>End</th><th>Fuel used</th><th>Tyre wear delta</th><th>Top speed</th><th>Samples</th><th>Valid</th><th>Notes</th></tr></thead><tbody>{rows.map((row, index) => <tr key={index}><td>{text(row.lap_number)}</td><td>{lapTime(row.lap_time as number)}</td><td>{formatRaceTime(row.start_time as number)}</td><td>{formatRaceTime(row.end_time as number)}</td><td>{fmt(row.fuel_used as number, 2, " L")}</td><td>{pct(row.tyre_wear_delta as number)}</td><td>{fmt((row.top_speed ?? row.speed_kph) as number, 0, " km/h")}</td><td>{text(row.sample_count)}</td><td>{row.valid_lap === false ? "Invalid" : "Valid/unknown"}</td><td>{Number(row.fuel_added || 0) > 2 ? `Refuel +${fmt(row.fuel_added as number, 1, " L")}` : text(row.event)}</td></tr>)}</tbody></table></div>;
}

export function OpponentStats({ competitors }: EngineeringProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | "">("");
  const filtered = competitors.filter((c) => `${c.driver_name} ${c.vehicle_name} ${c.vehicle_class}`.toLowerCase().includes(query.toLowerCase()));
  const selected = filtered.find((c) => c.vehicle_id === selectedId) || filtered.find((c) => !c.is_player) || filtered[0];
  return (
    <div className="page grid">
      <section className="card span-12">
        <h2>Opponent Selector</h2>
        <div className="input-grid">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search driver, car, or class" />
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value === "" ? "" : Number(event.target.value))}>
            <option value="">Auto-select nearest opponent</option>
            {filtered.map((car) => <option key={car.vehicle_id} value={car.vehicle_id}>{car.position ?? "--"} - {car.driver_name || car.vehicle_name}</option>)}
          </select>
        </div>
      </section>
      <section className="card span-4"><h2>Opponent Overview</h2>{selected ? <><Metric label="Driver" value={text(selected.driver_name)} /><Metric label="Car" value={text(selected.vehicle_name)} /><Metric label="Class" value={text(selected.vehicle_class)} /><Metric label="Position" value={text(selected.position)} /><Metric label="Best / last" value={`${lapTime(selected.best_lap_time)} / ${lapTime(selected.last_lap_time)}`} /><Metric label="Gaps" value={`${seconds(selected.gap_to_player)} player / ${seconds(selected.time_behind_leader)} leader`} /><Metric label="Pit stops" value={text(selected.pitstops)} /></> : <EmptyState />}</section>
      <section className="card span-4"><h2>Pace</h2><Metric label="Last 5 laps" value="Live history pending" /><Metric label="Average stint pace" value="--" /><Metric label="Consistency" value="--" /><Metric label="Current pace" value={lapTime(selected?.estimated_lap_time)} /></section>
      <section className="card span-4"><h2>Strategy</h2><Metric label="Fuel fraction" value={pct(selected?.fuel_fraction)} /><Metric label="Tyre wear" value="Unavailable" /><Metric label="Last pit lap" value={text(selected?.last_pit_lap)} /><Metric label="Current stint lap" value={text(selected?.current_stint_lap)} /></section>
      <section className="card span-12"><h2>Opponent Tyres And Brakes</h2><EmptyState detail="Per-wheel opponent tyre and brake channels are not available from the current data source." /></section>
    </div>
  );
}

export function XYPlotter({ telemetry }: EngineeringProps) {
  const { review } = useSessionReview();
  const [xKey, setXKey] = useState("lap_number");
  const [yKey, setYKey] = useState("speed_kph");
  const samples = sampleWithLive(review, telemetry, 600);
  const options = numericSampleFields(samples);
  const stats = useMemo(() => {
    const values = samples.map((sample) => Number(sample[yKey])).filter((value) => Number.isFinite(value));
    const avg = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
    const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / Math.max(values.length, 1);
    return { min: Math.min(...values), max: Math.max(...values), avg, sd: Math.sqrt(variance), count: values.length };
  }, [samples, yKey]);
  useEffect(() => {
    if (options.length && !options.includes(xKey)) setXKey(options[0]);
    if (options.length && !options.includes(yKey)) setYKey(options.includes("speed_kph") ? "speed_kph" : options[0]);
  }, [options, xKey, yKey]);
  const presets: Array<[string, string, string]> = [
    ["Speed vs time", "game_time", "speed_kph"],
    ["Speed vs lap", "lap_number", "speed_kph"],
    ["Brake vs lap", "lap_number", "brake"],
    ["Throttle vs lap", "lap_number", "throttle"],
    ["Steering vs lap", "lap_number", "steering"],
    ["RPM vs lap", "lap_number", "rpm"],
    ["Speed vs steering", "steering", "speed_kph"],
    ["Fuel vs lap", "lap_number", "fuel_liters"],
  ];
  return (
    <div className="page grid">
      <section className="card span-12"><SectionTitle title="Data Selectors" help="Chooses numeric channels for custom plots. Put cause on X and response on Y to test setup or driving relationships." /><div className="input-grid"><select value={xKey} onChange={(e) => setXKey(e.target.value)}>{options.map((o) => <option key={o}>{o}</option>)}</select><select value={yKey} onChange={(e) => setYKey(e.target.value)}>{options.map((o) => <option key={o}>{o}</option>)}</select><input value={`${options.length} numeric fields available`} readOnly /><input value="Compare lap off" readOnly /></div></section>
      <section className="card span-8"><SectionTitle title="Plot Area" help="Shows the selected relationship. Tight patterns indicate consistent behavior; wide scatter often points to traffic, mistakes, or changing conditions." />{samples.length ? <ResponsiveContainer width="100%" height={320}><ScatterChart><CartesianGrid stroke="#27313a" /><XAxis dataKey={xKey} name={xKey} stroke="#8896a3" /><YAxis dataKey={yKey} name={yKey} stroke="#8896a3" /><Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} /><Scatter data={samples} fill="#e6b450" line /></ScatterChart></ResponsiveContainer> : <EmptyState detail="Choose fields after recorded samples are available." />}</section>
      <section className="card span-4"><SectionTitle title="Stats" help="Summarizes the selected Y channel. Use spread and sample count to judge whether the plot is meaningful." /><Metric label="Min" value={Number.isFinite(stats.min) ? fmt(stats.min) : "--"} /><Metric label="Max" value={Number.isFinite(stats.max) ? fmt(stats.max) : "--"} /><Metric label="Average" value={fmt(stats.avg)} /><Metric label="Std dev" value={fmt(stats.sd)} /><Metric label="Samples" value={stats.count} /></section>
      <section className="card span-12"><SectionTitle title="Preset Plots" help="Quickly loads common engineering relationships. Presets help validate braking, throttle, steering, fuel, and speed behavior." /><div className="control-row">{presets.filter(([, x, y]) => options.includes(x) && options.includes(y)).map(([label, x, y]) => <button key={label} onClick={() => { setXKey(x); setYKey(y); }}>{label}</button>)}</div></section>
    </div>
  );
}

export function RaceControl({ telemetry }: EngineeringProps) {
  const player = telemetry?.player;
  const session = telemetry?.session;
  const { review } = useSessionReview();
  return (
    <div className="page grid">
      <section className="card span-4"><h2>Current Race Status</h2><Metric label="Game phase" value={text(session?.game_phase)} /><Metric label="Session" value={text(session?.session_type)} /><Metric label="Flags" value={text(session?.yellow_flag_state || "Green/unknown")} /><Metric label="Rain" value={fmt(telemetry?.environment?.raining)} /><Metric label="Wetness" value={fmt(telemetry?.environment?.avg_wetness)} /></section>
      <section className="card span-4"><h2>Player Warnings</h2><Metric label="Lap invalidated" value={player?.lap_invalidated ? "Yes" : "No"} /><Metric label="Track limits" value={text(player?.track_limits_steps)} /><Metric label="Penalties" value={text((telemetry?.competitors || []).find((c) => c.is_player)?.penalties)} /><Metric label="Pit limiter" value={player?.speed_limiter ? "On" : "Off"} /><Metric label="Blue / yellow / black" value="Unavailable" /></section>
      <section className="card span-4"><h2>Penalty Panel</h2><Metric label="Count" value={text((telemetry?.competitors || []).find((c) => c.is_player)?.penalties)} /><Metric label="Type" value="Not available" /><Metric label="Served" value="Not available" /><Metric label="Suggested action" value="Monitor race control messages" /></section>
      <section className="card span-12"><h2>Event Log</h2><EventList review={review} /></section>
    </div>
  );
}

export function SettingsPage({ telemetry, strategy }: EngineeringProps) {
  const [settings, setSettings] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem("lmu-settings") || "{}") as Record<string, string | number | boolean>;
    } catch {
      return {};
    }
  });
  const set = (key: string, value: string | number | boolean) => setSettings((current) => {
    const next = { ...current, [key]: value };
    window.localStorage.setItem("lmu-settings", JSON.stringify(next));
    return next;
  });
  return (
    <div className="page grid">
      <section className="card span-4"><SectionTitle title="Connection" help="Controls how live telemetry is read. A stable connection and sensible refresh rate matter more than chasing maximum update speed." /><Metric label="Data source" value={text(settings.source || "Mock/LMU auto")} /><Metric label="Status" value={telemetry?.connected ? "Connected" : "Not connected"} /><label>Refresh rate<input type="number" min="1" max="60" value={Number(settings.refreshRate || 10)} onChange={(e) => set("refreshRate", Math.max(1, Number(e.target.value)))} /></label><label><input type="checkbox" checked={Boolean(settings.autoReconnect ?? true)} onChange={(e) => set("autoReconnect", e.target.checked)} /> Auto-reconnect</label></section>
      <section className="card span-4"><SectionTitle title="Recording" help="Controls historical data capture. Higher sample rates improve analysis but increase storage and processing cost." /><label><input type="checkbox" checked={Boolean(settings.recording ?? true)} onChange={(e) => set("recording", e.target.checked)} /> Enable recording</label><label>Sample rate<input type="number" min="1" max="60" value={Number(settings.sampleRate || 5)} onChange={(e) => set("sampleRate", Math.max(1, Number(e.target.value)))} /></label><Metric label="Data folder" value="data/sessions" /><label><input type="checkbox" checked={Boolean(settings.validOnly)} onChange={(e) => set("validOnly", e.target.checked)} /> Save only valid laps</label></section>
      <section className="card span-4"><SectionTitle title="UI" help="Changes display preferences. Use smoothing for trend reading, and advanced data when you want engineering detail over simplicity." /><Metric label="Theme" value={text(settings.theme || "dark")} /><Metric label="Units" value={text(settings.units || "metric")} /><label><input type="checkbox" checked={Boolean(settings.smoothing ?? true)} onChange={(e) => set("smoothing", e.target.checked)} /> Chart smoothing</label><label><input type="checkbox" checked={Boolean(settings.advanced ?? true)} onChange={(e) => set("advanced", e.target.checked)} /> Advanced engineering data</label></section>
      <section className="card span-4"><SectionTitle title="Strategy" help="Sets assumptions used by fuel and pit calculations. Conservative margins are useful when traffic, weather, or safety cars are uncertain." /><Metric label="Fuel margin" value={text(strategy?.assumptions?.fuel_safety_margin_liters ?? settings.fuelMargin ?? "--")} /><Metric label="Pit loss" value={formatRaceTime(Number(strategy?.assumptions?.pit_loss_seconds ?? settings.pitLoss ?? NaN))} /><Metric label="Race length" value={formatRaceTime(Number(strategy?.assumptions?.race_duration_minutes ?? settings.raceLength ?? NaN) * 60)} /><Metric label="Tyre warning" value={text(settings.tyreWarning || "75%")} /></section>
      <section className="card span-4"><SectionTitle title="Track Map" help="Controls map generation and labels. Clear labels help traffic awareness, but hiding them can make crowded races easier to scan." /><label><input type="checkbox" checked={Boolean(settings.autoMap ?? true)} onChange={(e) => set("autoMap", e.target.checked)} /> Auto-generate map</label><button>Rebuild current map</button><label><input type="checkbox" checked={Boolean(settings.mapLabels ?? true)} onChange={(e) => set("mapLabels", e.target.checked)} /> Show labels</label><Metric label="Class colors" value="Default palette" /></section>
      <section className="card span-4"><SectionTitle title="AI And Coaching" help="Controls rule-based and future AI hints. Deterministic insights should explain evidence before suggesting setup or driving changes." /><label><input type="checkbox" checked={Boolean(settings.ruleInsights ?? true)} onChange={(e) => set("ruleInsights", e.target.checked)} /> Rule-based insights</label><label><input type="checkbox" checked={Boolean(settings.aiInsights)} onChange={(e) => set("aiInsights", e.target.checked)} /> AI insights later</label><Metric label="Insight frequency" value={text(settings.insightFrequency || "Per lap")} /><Metric label="Modes" value="Driving coach / race engineer" /></section>
    </div>
  );
}
