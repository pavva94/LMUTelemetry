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
import { CompetitorTable } from "../components/CompetitorTable";
import { SectionTitle } from "../components/SectionTitle";
import { useI18n } from "../i18n/I18nProvider";
import { chartLabelFormatter, chartValueFormatter, formatTelemetryValue, isRaceTimeField } from "../lib/telemetryFields";
import { toFiniteNumber } from "../lib/sessionAnalysis";
import { formatDuration, formatRaceGap, formatRaceTime } from "../lib/timeFormat";
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
const carName = (car?: { vehicle_model?: string | null; vehicle_name?: string | null }) => car?.vehicle_model || car?.vehicle_name || null;
const seconds = (value?: number | null) => formatRaceGap(value);
const interval = (value?: number | null) => value == null || Number.isNaN(value) || !Number.isFinite(value) ? "--" : formatRaceTime(value);
const tyreTemp = (value?: TyreTemps) => fmt(value?.center_c ?? value?.left_c ?? value?.right_c ?? value?.carcass_c, 1, " C");
const lapTime = (value?: number | null) => formatRaceTime(value);
const assistSetting = (active?: boolean | null, setting?: number | null, max?: number | null) => {
  const settingText = setting == null ? "--" : max != null && max > 0 ? `${setting}/${max}` : String(setting);
  return `${active ? "Active" : "Ready"} (${settingText})`;
};

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
  const values = rows.map((row) => toFiniteNumber(row[key])).filter((value): value is number => value != null);
  return values.length ? Math.max(...values) : null;
};
const minField = (rows: Field[], key: string) => {
  const values = rows.map((row) => toFiniteNumber(row[key])).filter((value): value is number => value != null);
  return values.length ? Math.min(...values) : null;
};
const avgField = (rows: Field[], key: string) => {
  const values = rows.map((row) => toFiniteNumber(row[key])).filter((value): value is number => value != null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
};
const medianField = (rows: Field[], key: string) => {
  const values = rows.map((row) => toFiniteNumber(row[key])).filter((value): value is number => value != null).sort((a, b) => a - b);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
};
const avgNumbers = (values: Array<number | null | undefined>) => {
  const clean = values.filter((value): value is number => value != null && Number.isFinite(value));
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
};
function useSessionReview() {
  const [review, setReview] = useState<SessionReview | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let mounted = true;
    const load = () =>
      api
        .review(900)
        .then((data) => {
          if (mounted) {
            setReview(data);
            setError(false);
          }
        })
        .catch(() => mounted && setError(true));
    load();
    const id = window.setInterval(load, 6000);
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
        <Metric label="Car" value={text(carName(player))} />
        <Metric label="Driver" value={text((telemetry?.competitors || []).find((c) => c.is_player)?.driver_name || "Player")} />
        <Metric label="Lap" value={text(player?.lap_number ?? session?.current_lap)} />
        <Metric label="Remaining" value={formatDuration(session?.time_remaining)} />
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

function CompetitorRows({ competitors, limit = 10, filter = "all", showGap = true }: { competitors: CompetitorState[]; limit?: number; filter?: string; showGap?: boolean }) {
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
            <th>{heading("Car", "vehicle_model")}</th>
            <th>{heading("Lap", "total_laps")}</th>
            <th>{heading("Last", "last_lap_time")}</th>
            <th>{heading("Best", "best_lap_time")}</th>
            {showGap && <th>{heading("Gap to you", "gap_to_player")}</th>}
            <th>{heading("Pits", "pitstops")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((car) => (
            <tr key={car.vehicle_id}>
              <td>{text(car.position)}</td>
              <td>{text(car.vehicle_class)}</td>
              <td>{text(car.driver_name || (car.is_player ? "Player" : ""))}</td>
              <td>{text(carName(car))}</td>
              <td>{text(car.total_laps ?? car.current_lap)}</td>
              <td>{lapTime(car.last_lap_time)}</td>
              <td>{lapTime(car.best_lap_time)}</td>
              {showGap && <td>{seconds(car.gap_to_player)}</td>}
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
  const singleSeriesKey = lines.length === 1 ? lines[0][0] : null;
  const xTimeAxis = isRaceTimeField(xKey);
  if (!data.length) return <EmptyState />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <CartesianGrid stroke="#27313a" />
        <XAxis dataKey={xKey} stroke="#8896a3" tickFormatter={(value) => xTimeAxis ? chartLabelFormatter(value, xKey) : String(value)} />
        <YAxis stroke="#8896a3" tickFormatter={(value) => singleSeriesKey ? formatTelemetryValue(value, singleSeriesKey) : timeAxis ? formatRaceTime(Number(value)) : String(value)} />
        <Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} labelFormatter={(value) => xTimeAxis ? chartLabelFormatter(value, xKey) : String(value)} formatter={chartValueFormatter} />
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

function validPaceRows(rows: Field[]) {
  const candidates = rows.filter((row) => {
    const lapTime = Number(row.lap_time);
    return Number.isFinite(lapTime) && lapTime >= 40 && lapTime <= 900 && row.valid_lap !== false && row.in_pit !== true;
  });
  const normal = medianField(candidates, "lap_time");
  if (normal == null) return candidates;
  return candidates.filter((row) => {
    const lapTime = Number(row.lap_time);
    return lapTime >= normal * 0.75 && lapTime <= normal * 1.8;
  });
}

function averageLapDelta(rows: Field[], key: string) {
  if (rows.length < 4) return null;
  const middle = Math.floor(rows.length / 2);
  const first = avgField(rows.slice(0, middle), key);
  const second = avgField(rows.slice(middle), key);
  return first != null && second != null ? second - first : null;
}

export function bestConsecutivePace(rows: Field[], windowSize: number) {
  if (!Number.isInteger(windowSize) || windowSize < 1) return null;
  const ordered = validPaceRows(rows)
    .map((row) => ({ lap: Number(row.lap_number), time: Number(row.lap_time) }))
    .filter((row) => Number.isInteger(row.lap) && row.lap > 0 && Number.isFinite(row.time))
    .sort((a, b) => a.lap - b.lap);
  let best: { average: number; startLap: number; endLap: number } | null = null;
  for (let index = 0; index <= ordered.length - windowSize; index += 1) {
    const window = ordered.slice(index, index + windowSize);
    if (!window.every((row, offset) => row.lap === window[0].lap + offset)) continue;
    const windowAverage = window.reduce((sum, row) => sum + row.time, 0) / windowSize;
    if (!best || windowAverage < best.average) best = { average: windowAverage, startLap: window[0].lap, endLap: window[window.length - 1].lap };
  }
  return best;
}

function signedPaceDelta(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  return `${sign}${Math.abs(value).toFixed(3)} s`;
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

export function buildStints(laps: Field[]) {
  const stints: Array<{ number: number; rows: Field[]; summary: Field }> = [];
  let current: Field[] = [];
  laps.forEach((lap) => {
    if (current.length && lap.in_pit === true) {
      stints.push({ number: stints.length + 1, rows: current, summary: {} });
      current = [];
    }
    current.push(lap);
  });
  if (current.length) stints.push({ number: stints.length + 1, rows: current, summary: {} });
  return stints.map((stint) => {
    const rows = stint.rows;
    const paceRows = validPaceRows(rows);
    const fuelValues = paceRows.map((row) => toFiniteNumber(row.fuel_used)).filter((value): value is number => value != null && value >= 0);
    const fuelUsed = fuelValues.reduce((sum, value) => sum + value, 0);
    const tyreWearDeltas = paceRows.map((row) => {
      const wheelDeltas = ["fl", "fr", "rl", "rr"]
        .map((wheel) => toFiniteNumber(row[`tyre_wear_delta_${wheel}`]))
        .filter((value): value is number => value != null && value > 0 && value < 0.2);
      const fallback = toFiniteNumber(row.tyre_wear_delta);
      return wheelDeltas.length ? avgNumbers(wheelDeltas) : fallback != null && fallback > 0 && fallback < 0.2 ? fallback : null;
    }).filter((value): value is number => value != null);
    const summary = {
      stint_number: stint.number,
      start_lap: rows[0]?.lap_number,
      end_lap: rows[rows.length - 1]?.lap_number,
      lap_count: paceRows.length,
      detected_lap_count: rows.length,
      fastest_lap: minField(paceRows, "lap_time"),
      average_lap: avgField(paceRows, "lap_time"),
      top_speed: maxField(paceRows, "top_speed"),
      fuel_used: fuelUsed || null,
      fuel_per_lap: fuelValues.length ? fuelUsed / fuelValues.length : null,
      tyre_wear_delta: avgNumbers(tyreWearDeltas),
    };
    return { ...stint, summary };
  });
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
        <Metric label="ABS" value={assistSetting(player?.abs_active, player?.abs_setting, player?.abs_max)} />
        <Metric label="TC" value={assistSetting(player?.tc_active, player?.tc_setting, player?.tc_max)} sub={`Slip ${text(player?.tc_slip_setting)} / Cut ${text(player?.tc_cut_setting)}`} />
      </section>
      <section className="card span-6">
        <SectionTitle title="Suspension And Aero" help="Shows ride-height and platform signals. Low ride heights or large front/rear changes suggest bottoming, pitch sensitivity, or aero instability." />
        <div className="header-grid">
          <Metric label="Front ride" value={fmt(player?.front_ride_height ?? avgField([{ value: player?.ride_height_fl }, { value: player?.ride_height_fr }], "value"), 3, " m")} />
          <Metric label="Rear ride" value={fmt(player?.rear_ride_height ?? avgField([{ value: player?.ride_height_rl }, { value: player?.ride_height_rr }], "value"), 3, " m")} />
          <Metric label="FL / FR ride" value={`${fmt(player?.ride_height_fl, 3, " m")} / ${fmt(player?.ride_height_fr, 3, " m")}`} />
          <Metric label="RL / RR ride" value={`${fmt(player?.ride_height_rl, 3, " m")} / ${fmt(player?.ride_height_rr, 3, " m")}`} />
          <Metric label="FL / FR deflection" value={`${fmt(player?.suspension_deflection_fl, 3, " m")} / ${fmt(player?.suspension_deflection_fr, 3, " m")}`} />
          <Metric label="RL / RR deflection" value={`${fmt(player?.suspension_deflection_rl, 3, " m")} / ${fmt(player?.suspension_deflection_rr, 3, " m")}`} />
          <Metric label="3rd spring F/R" value={`${fmt(player?.front_third_deflection, 3, " m")} / ${fmt(player?.rear_third_deflection, 3, " m")}`} />
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
            <Metric label="Car" value={text(carName(selected))} />
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
  const playerCar = cars.find((car) => car.is_player);
  const playerPosition = player?.position ?? playerCar?.position;
  const carsOnTrack = cars
    .filter((car) => !car.in_pits)
    .sort((a, b) => (a.position ?? Number.POSITIVE_INFINITY) - (b.position ?? Number.POSITIVE_INFINITY));
  const gapToPlayer = (car: CompetitorState) => {
    if (car.is_player) return null;
    if (car.gap_to_player != null) return car.gap_to_player;
    if (car.time_behind_leader != null && playerCar?.time_behind_leader != null) {
      return car.time_behind_leader - playerCar.time_behind_leader;
    }
    if (car.position != null && playerPosition != null) {
      if (car.position === playerPosition - 1) return player?.gap_car_ahead != null ? -player.gap_car_ahead : null;
      if (car.position === playerPosition + 1) return player?.gap_car_behind ?? null;
    }
    return null;
  };
  return (
    <div className="page grid">
      <section className="card span-8">
        <SectionTitle title="Circle Map" help="Places cars around a simplified lap circle by track progress. Use it to understand nearby traffic without needing real track geometry." />
        <div className="circle-map">
          {cars.slice(0, 48).map((car, index) => {
            const angle = (normalizedProgress(car, cars) * Math.PI * 2) - Math.PI / 2;
            const x = 50 + Math.cos(angle) * 42;
            const y = 50 + Math.sin(angle) * 42;
            const gapAhead = car.is_player ? player?.gap_car_ahead ?? car.time_behind_next : car.time_behind_next;
            const title = `${car.is_player ? "You" : car.driver_name || carName(car) || `Car ${car.vehicle_id}`} - gap ahead ${interval(gapAhead)}`;
            return (
              <span key={car.vehicle_id} className={car.is_player ? "car-dot player" : "car-dot"} style={{ left: `${x}%`, top: `${y}%`, background: classColors[index % classColors.length] }} title={title}>
                {car.position}
                {gapAhead != null && <small className="car-gap-label">{interval(gapAhead)}</small>}
              </span>
            );
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
        <Metric label="Cars on track" value={carsOnTrack.length || "--"} sub={`${cars.length - carsOnTrack.length} in pits filtered`} />
        <Metric label="Warnings" value={player?.gap_car_behind != null && player.gap_car_behind < 1 ? "Close car behind" : "Clear"} />
      </section>
      <section className="card span-12">
        <SectionTitle title="Cars On Track" help="Lists cars currently circulating and filters out pit-lane cars. Gaps are relative to the player when LMU exposes enough timing data." />
        {carsOnTrack.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Pos</th><th>Driver</th><th>Car</th><th>Class</th><th>Lap</th><th>Gap ahead</th><th>Gap to you</th><th>Last</th><th>Best</th></tr></thead>
              <tbody>
                {carsOnTrack.map((car) => {
                  const gap = gapToPlayer(car);
                  return (
                    <tr key={car.vehicle_id}>
                      <td>{text(car.position)}</td>
                      <td>{car.is_player ? "You" : text(car.driver_name)}</td>
                      <td>{text(carName(car))}</td>
                      <td>{text(car.vehicle_class)}</td>
                      <td>{text(car.total_laps ?? car.current_lap)}</td>
                      <td>{car.is_player ? interval(player?.gap_car_ahead ?? car.time_behind_next) : interval(car.time_behind_next)}</td>
                      <td>{car.is_player ? "You" : gap == null ? "--" : seconds(gap)}</td>
                      <td>{lapTime(car.last_lap_time)}</td>
                      <td>{lapTime(car.best_lap_time)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState detail="No cars are currently marked as on track." />}
      </section>
      <section className="card span-6"><SectionTitle title="Cars Ahead" help="Shows immediate traffic targets. Compare last laps and gaps to decide whether to attack, save, or wait." /><CompetitorRows competitors={cars.filter((c) => !c.is_player).slice(0, 3)} /></section>
      <section className="card span-6"><SectionTitle title="Cars Behind" help="Shows pressure from behind. A faster car behind may require defensive positioning or earlier traffic planning." /><CompetitorRows competitors={cars.filter((c) => !c.is_player).slice(3, 6)} /></section>
    </div>
  );
}

export function LapCompare({ telemetry }: EngineeringProps) {
  const { review } = useSessionReview();
  const laps = validPaceRows((review?.laps || []) as Field[]);
  const fastestLapTime = minField(laps, "lap_time");
  const slowestLapTime = maxField(laps, "lap_time");
  const averageLapTime = avgField(laps, "lap_time");
  const bestFiveLapPace = bestConsecutivePace(laps, 5);
  const bestTenLapPace = bestConsecutivePace(laps, 10);
  const fastestLap = laps.find((lap) => Number(lap.lap_time) === fastestLapTime);
  const trend = averageLapDelta(laps, "lap_time");
  const fuelTrend = averageLapDelta(laps, "fuel_used");
  const tyreTrend = averageLapDelta(laps, "tyre_wear_delta");
  const insights = [
    laps.length < 3
      ? "Need at least three valid laps before the comparison becomes useful."
      : trend != null && trend > 0.25
        ? `Pace is fading by ${formatRaceTime(trend)} between the first and second half of the run. Check tyre temperature, traffic, and fuel-save behavior.`
        : trend != null && trend < -0.25
          ? `Pace is improving by ${formatRaceTime(Math.abs(trend))} in the second half. The car or driver rhythm is coming toward the lap.`
          : "Lap pace is broadly stable across the valid laps.",
    fastestLap
      ? `Best valid lap is lap ${text(fastestLap.lap_number)} at ${formatRaceTime(fastestLapTime)}. Use it as the clean reference for the current session.`
      : "No clean fastest lap is available yet.",
    fuelTrend != null && Math.abs(fuelTrend) > 0.15
      ? `Fuel use ${fuelTrend > 0 ? "increases" : "drops"} by ${fmt(Math.abs(fuelTrend), 2, " L/lap")} later in the run.`
      : "Fuel use is not showing a large half-run shift.",
    tyreTrend != null && Math.abs(tyreTrend) > 0.005
      ? `Tyre wear delta ${tyreTrend > 0 ? "rises" : "falls"} later in the run. Compare it against lap-time trend before changing stint length.`
      : "Tyre wear per lap is not showing a strong trend yet.",
  ];
  return (
    <div className="page grid">
      <section className="card span-12">
        <SectionTitle title="Valid Lap Comparison" help="Compares every valid lap in the current live session. Invalid laps, pit laps, and timing outliers are filtered out before charts and insights are calculated." />
        <div className="header-grid">
          <Metric label="Valid laps" value={laps.length || "--"} />
          <Metric label="Fastest" value={lapTime(fastestLapTime)} sub={fastestLap ? `Lap ${text(fastestLap.lap_number)}` : undefined} />
          <Metric label="Average" value={lapTime(averageLapTime)} />
          <Metric label="Best 5-lap pace" value={lapTime(bestFiveLapPace?.average)} sub={bestFiveLapPace && averageLapTime != null ? `Laps ${bestFiveLapPace.startLap}–${bestFiveLapPace.endLap} · Δ ${signedPaceDelta(bestFiveLapPace.average - averageLapTime)} vs average` : "Needs 5 consecutive valid laps"} />
          <Metric label="Best 10-lap pace" value={lapTime(bestTenLapPace?.average)} sub={bestTenLapPace && averageLapTime != null ? `Laps ${bestTenLapPace.startLap}–${bestTenLapPace.endLap} · Δ ${signedPaceDelta(bestTenLapPace.average - averageLapTime)} vs average` : "Needs 10 consecutive valid laps"} />
          <Metric label="Spread" value={fastestLapTime != null && slowestLapTime != null ? formatRaceTime(slowestLapTime - fastestLapTime) : "--"} />
          <Metric label="Avg fuel" value={fmt(avgField(laps, "fuel_used"), 2, " L")} />
          <Metric label="Top speed" value={fmt(maxField(laps, "top_speed"), 0, " km/h")} />
          <Metric label="Current lap" value={text(telemetry?.player?.lap_number)} />
        </div>
      </section>
      <section className="card span-8"><SectionTitle title="Lap Time Trend" help="Shows valid lap pace over the session. Use the shape to separate warm-up, consistency, traffic, and degradation." /><BasicLineChart data={laps} lines={[["lap_time", "#e6b450"]]} /></section>
      <section className="card span-4"><SectionTitle title="Insights" help="Summarizes the session-wide comparison. These notes use filtered valid laps, so bad timing samples do not dominate the story." /><div className="insight-list">{insights.map((item) => <p key={item}>{item}</p>)}</div></section>
      <section className="card span-6"><SectionTitle title="Fuel And Tyre Trend" help="Compares consumption and tyre wear across valid laps. Rising wear with slower laps points toward degradation; stable wear with slower laps often points to traffic or mistakes." /><BasicLineChart data={laps} lines={[["fuel_used", "#6dd6ff"], ["tyre_wear_delta", "#ff8c69"]]} /></section>
      <section className="card span-6"><SectionTitle title="Pace And Speed" help="Compares lap time against top speed. If top speed is stable while lap time grows, losses are likely in corners, traffic, or traction rather than straight-line pace." /><BasicLineChart data={laps} lines={[["lap_time", "#e6b450"], ["top_speed", "#69d28f"]]} /></section>
      <section className="card span-12"><SectionTitle title="Valid Lap Table" help="Lists the laps included in this comparison after invalid, pit, and outlier filtering." /><LapTable rows={laps} /></section>
    </div>
  );
}

export function OneLapTiming({ competitors }: EngineeringProps) {
  return <div className="page grid standings-page"><CompetitorTable competitors={competitors} /></div>;
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
      <section className="card span-4"><SectionTitle title="Race State" help="Summarizes the current race picture. Use it to judge whether to attack, defend, save fuel, or react to pit traffic." /><Metric label="Leader" value={text(leader?.driver_name || carName(leader))} /><Metric label="Player position" value={text(player?.position)} /><Metric label="Player class" value={text(player?.class_position)} /><Metric label="Gap ahead" value={seconds(telemetry?.player?.gap_car_ahead)} /><Metric label="Cars in pits" value={cars.filter((c) => c.in_pits).length} /></section>
      <section className="card span-8"><SectionTitle title="Gap Table" help="Lists gaps in race order. Gaps to next car show immediate battle pressure, while leader gaps show overall race spread." /><CompetitorRows competitors={visibleCars} limit={60} /></section>
    </div>
  );
}

export function RaceHistory({ telemetry, strategy }: EngineeringProps) {
  const { review, error } = useSessionReview();
  const [selectedStint, setSelectedStint] = useState(1);
  const laps = (review?.laps || []) as Field[];
  const stints = buildStints(laps);
  if (error && !stints.length) return <div className="page"><section className="card"><EmptyState title="No stint history" detail="Stint summaries will appear after recording completed laps." /></section></div>;
  const sessionFuel = stints.reduce((sum, stint) => sum + (Number(stint.summary.fuel_used) || 0), 0);
  const fastest = minField(stints.map((stint) => stint.summary), "fastest_lap");
  const average = avgField(stints.map((stint) => stint.summary), "average_lap");
  const selected = stints.find((stint) => stint.number === selectedStint) || stints[0];
  const rows = selected?.rows || sampleLapRows(review);
  const summary = selected?.summary || {};
  return (
    <div className="page grid">
      <section className="card span-12">
        <SectionTitle title="Stint History" help="Summarizes each run between pit stops. Compare stint length, pace, fuel use, tyre change, and top speed to understand the session." />
        <div className="header-grid">
          <Metric label="Stints" value={stints.length || "--"} />
          <Metric label="Completed laps" value={laps.length || text(strategy?.stint?.current_stint_lap)} />
          <Metric label="Fastest lap" value={lapTime(fastest)} />
          <Metric label="Average lap" value={lapTime(average)} />
          <Metric label="Fuel used" value={fmt(sessionFuel || null, 2, " L")} />
          <Metric label="Current lap" value={text(telemetry?.player?.lap_number)} />
        </div>
      </section>
      <section className="card span-12">
        <SectionTitle title="Stint Summary" help="Lists all detected stints. Telemetry pit entries start a new stint, and returning to the main menu starts a new session." />
        {stints.length ? <StintSummaryTable stints={stints} /> : <EmptyState detail="Complete laps and pit cycles will populate the stint history." />}
      </section>
      <section className="card span-12"><SectionTitle title="Stint Selector" help="Chooses the stint to inspect. Splits come from telemetry pit entries, and returning to the main menu starts a new session." /><div className="control-row">{stints.length ? stints.map((stint) => <button key={stint.number} className={selectedStint === stint.number ? "active-control" : ""} onClick={() => setSelectedStint(stint.number)}>Stint {stint.number}</button>) : <button className="active-control">Current stint</button>}<span className="muted">Stints split only on pit entry or a new session.</span></div></section>
      <section className="card span-3"><SectionTitle title="Summary" help="Condenses clean-lap stint length, pace, and fuel. Compare fastest and average lap to judge consistency across the run." /><Metric label="Valid / detected laps" value={`${text(summary.lap_count ?? strategy?.stint?.current_stint_lap)} / ${text(summary.detected_lap_count ?? summary.lap_count)}`} /><Metric label="Fastest lap" value={lapTime(summary.fastest_lap as number)} /><Metric label="Average lap" value={lapTime(summary.average_lap as number)} /><Metric label="Clean-lap fuel used" value={fmt(summary.fuel_used as number, 2, " L")} /></section>
      <section className="card span-3"><SectionTitle title="Tyres" help="Summarizes eligible lap-to-lap wear and compound state. High wear rate with stable pace may be acceptable; high wear plus pace loss needs attention." /><Metric label="Avg wear / valid lap" value={pct(summary.tyre_wear_delta as number)} /><Metric label="Model wear rate" value={pct(strategy?.tyres?.wear_rate_per_lap)} /><Metric label="Compound" value={text(telemetry?.player?.tyre_state?.compound_front)} /></section>
      <section className="card span-4"><SectionTitle title="Lap time" help="Shows lap-time evolution across the selected stint, isolated from fuel and tyre scales so pace changes are easier to read." /><BasicLineChart data={rows} lines={[["lap_time", "#e6b450"]]} height={240} /></section>
      <section className="card span-4"><SectionTitle title="Fuel used" help="Shows fuel consumed on each lap of the selected stint. Compare consistent laps to identify consumption changes or anomalous readings." /><BasicLineChart data={rows} lines={[["fuel_used", "#6dd6ff"]]} height={240} /></section>
      <section className="card span-4"><SectionTitle title="Tyre wear delta" help="Shows the lap-to-lap tyre wear change for the selected stint, independently scaled to make degradation trends visible." /><BasicLineChart data={rows} lines={[["tyre_wear_delta", "#ff8c69"]]} height={240} /></section>
      <section className="card span-12"><SectionTitle title="Stint Lap Table" help="Shows every lap in the selected stint. Sort the story by lap time, fuel used, and events before changing setup assumptions." /><LapTable rows={rows} /></section>
    </div>
  );
}

function StintSummaryTable({ stints }: { stints: Array<{ number: number; rows: Field[]; summary: Field }> }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Stint</th><th>Valid / detected laps</th><th>Lap range</th><th>Fastest</th><th>Average</th><th>Clean fuel used</th><th>Fuel/valid lap</th><th>Avg wear/valid lap</th><th>Top speed</th></tr></thead>
        <tbody>{stints.map((stint) => (
          <tr key={stint.number}>
            <td>{stint.number}</td>
            <td>{text(stint.summary.lap_count)} / {text(stint.summary.detected_lap_count)}</td>
            <td>{text(stint.summary.start_lap)}-{text(stint.summary.end_lap)}</td>
            <td>{lapTime(stint.summary.fastest_lap as number)}</td>
            <td>{lapTime(stint.summary.average_lap as number)}</td>
            <td>{fmt(stint.summary.fuel_used as number, 2, " L")}</td>
            <td>{fmt(stint.summary.fuel_per_lap as number, 3, " L")}</td>
            <td>{pct(stint.summary.tyre_wear_delta as number)}</td>
            <td>{fmt(stint.summary.top_speed as number, 0, " km/h")}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function EventList({ review }: { review: SessionReview | null }) {
  const events = [...(review?.recommendations || []), ...(review?.pit_events || [])] as Field[];
  if (!events.length) return <EmptyState detail="Lap, pit, flag, penalty, and incident events will appear as they are recorded." />;
  return <div className="table-wrap"><table><tbody>{events.slice(-20).map((event, index) => <tr key={index}><td>{text(event.timestamp ?? event.lap_number)}</td><td>{text(event.recommendation_type ?? event.type ?? "Event")}</td><td>{text(event.message ?? event.priority ?? "")}</td></tr>)}</tbody></table></div>;
}

function LapTable({ rows }: { rows: Field[] }) {
  if (!rows.length) return <EmptyState />;
  return <div className="table-wrap"><table><thead><tr><th>Lap</th><th>Lap time</th><th>Start</th><th>End</th><th>Fuel used</th><th>Tyre wear delta</th><th>Top speed</th><th>Samples</th><th>Valid</th><th>Notes</th></tr></thead><tbody>{rows.map((row, index) => <tr key={index}><td>{text(row.lap_number)}</td><td>{lapTime(row.lap_time as number)}</td><td>{formatRaceTime(row.start_time as number)}</td><td>{formatRaceTime(row.end_time as number)}</td><td>{fmt(row.fuel_used as number, 2, " L")}</td><td>{pct(row.tyre_wear_delta as number)}</td><td>{fmt((row.top_speed ?? row.speed_kph) as number, 0, " km/h")}</td><td>{text(row.sample_count)}</td><td>{row.valid_lap === false ? "Invalid" : "Valid/unknown"}</td><td>{row.in_pit === true ? "Pit entry" : text(row.event)}</td></tr>)}</tbody></table></div>;
}

export function OpponentStats({ competitors }: EngineeringProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | "">("");
  const filtered = competitors.filter((c) => `${c.driver_name} ${c.vehicle_model} ${c.vehicle_name} ${c.vehicle_class}`.toLowerCase().includes(query.toLowerCase()));
  const selected = filtered.find((c) => c.vehicle_id === selectedId) || filtered.find((c) => !c.is_player) || filtered[0];
  return (
    <div className="page grid">
      <section className="card span-12">
        <h2>Opponent Selector</h2>
        <div className="input-grid">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search driver, car, or class" />
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value === "" ? "" : Number(event.target.value))}>
            <option value="">Auto-select nearest opponent</option>
            {filtered.map((car) => <option key={car.vehicle_id} value={car.vehicle_id}>{car.position ?? "--"} - {car.driver_name || carName(car)}</option>)}
          </select>
        </div>
      </section>
      <section className="card span-4"><h2>Opponent Overview</h2>{selected ? <><Metric label="Driver" value={text(selected.driver_name)} /><Metric label="Car" value={text(carName(selected))} /><Metric label="Class" value={text(selected.vehicle_class)} /><Metric label="Position" value={text(selected.position)} /><Metric label="Best / last" value={`${lapTime(selected.best_lap_time)} / ${lapTime(selected.last_lap_time)}`} /><Metric label="Gaps" value={`${seconds(selected.gap_to_player)} player / ${seconds(selected.time_behind_leader)} leader`} /><Metric label="Pit stops" value={text(selected.pitstops)} /></> : <EmptyState />}</section>
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
      <section className="card span-8"><SectionTitle title="Plot Area" help="Shows the selected relationship. Tight patterns indicate consistent behavior; wide scatter often points to traffic, mistakes, or changing conditions." />{samples.length ? <ResponsiveContainer width="100%" height={320}><ScatterChart><CartesianGrid stroke="#27313a" /><XAxis dataKey={xKey} name={xKey} stroke="#8896a3" tickFormatter={(value) => formatTelemetryValue(value, xKey)} /><YAxis dataKey={yKey} name={yKey} stroke="#8896a3" tickFormatter={(value) => formatTelemetryValue(value, yKey)} /><Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} formatter={chartValueFormatter} labelFormatter={(value) => formatTelemetryValue(value, xKey)} /><Scatter data={samples} fill="#e6b450" line /></ScatterChart></ResponsiveContainer> : <EmptyState detail="Choose fields after recorded samples are available." />}</section>
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
  const { language, setLanguage, languages, t } = useI18n();
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
      <section className="card span-4">
        <SectionTitle title={t("settings.languageTitle")} help={t("settings.languageHelp")} />
        <label>{t("settings.languageLabel")}
          <select value={language} onChange={(event) => setLanguage(event.target.value as typeof language)}>
            {Object.entries(languages).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <p className="subvalue">{t("settings.languageNativeNameHelp")}</p>
      </section>
      <section className="card span-4"><SectionTitle title={t("settings.connectionTitle")} help={t("settings.connectionHelp")} /><Metric label={t("settings.dataSource")} value={text(settings.source || "Mock/LMU auto")} /><Metric label={t("settings.status")} value={telemetry?.connected ? t("common.connected") : t("common.disconnected")} /><label>{t("settings.refreshRate")}<input type="number" min="1" max="60" value={Number(settings.refreshRate || 10)} onChange={(e) => set("refreshRate", Math.max(1, Number(e.target.value)))} /></label><label><input type="checkbox" checked={Boolean(settings.autoReconnect ?? true)} onChange={(e) => set("autoReconnect", e.target.checked)} /> {t("settings.autoReconnect")}</label></section>
      <section className="card span-4"><SectionTitle title={t("settings.recordingTitle")} help={t("settings.recordingHelp")} /><label><input type="checkbox" checked={Boolean(settings.recording ?? true)} onChange={(e) => set("recording", e.target.checked)} /> {t("settings.enableRecording")}</label><label>{t("settings.sampleRate")}<input type="number" min="1" max="60" value={Number(settings.sampleRate || 5)} onChange={(e) => set("sampleRate", Math.max(1, Number(e.target.value)))} /></label><Metric label={t("settings.dataFolder")} value="data/sessions" /><label><input type="checkbox" checked={Boolean(settings.validOnly)} onChange={(e) => set("validOnly", e.target.checked)} /> {t("settings.saveOnlyValidLaps")}</label></section>
      <section className="card span-4"><SectionTitle title={t("settings.uiTitle")} help={t("settings.uiHelp")} /><Metric label={t("settings.theme")} value={text(settings.theme || "dark")} /><Metric label={t("settings.units")} value={text(settings.units || "metric")} /><label><input type="checkbox" checked={Boolean(settings.smoothing ?? true)} onChange={(e) => set("smoothing", e.target.checked)} /> {t("settings.chartSmoothing")}</label><label><input type="checkbox" checked={Boolean(settings.advanced ?? true)} onChange={(e) => set("advanced", e.target.checked)} /> {t("settings.advancedEngineeringData")}</label></section>
      <section className="card span-4"><SectionTitle title={t("settings.strategyTitle")} help={t("settings.strategyHelp")} /><Metric label={t("settings.fuelMargin")} value={text(strategy?.assumptions?.fuel_safety_margin_liters ?? settings.fuelMargin ?? "--")} /><Metric label={t("settings.pitLoss")} value={formatRaceTime(Number(strategy?.assumptions?.pit_loss_seconds ?? settings.pitLoss ?? NaN))} /><Metric label={t("settings.raceLength")} value={formatRaceTime(Number(strategy?.assumptions?.race_duration_minutes ?? settings.raceLength ?? NaN) * 60)} /><Metric label={t("settings.tyreWarning")} value={text(settings.tyreWarning || "75%")} /></section>
      <section className="card span-4"><SectionTitle title={t("settings.trackMapTitle")} help={t("settings.trackMapHelp")} /><label><input type="checkbox" checked={Boolean(settings.autoMap ?? true)} onChange={(e) => set("autoMap", e.target.checked)} /> {t("settings.autoGenerateMap")}</label><button>{t("settings.rebuildCurrentMap")}</button><label><input type="checkbox" checked={Boolean(settings.mapLabels ?? true)} onChange={(e) => set("mapLabels", e.target.checked)} /> {t("settings.showLabels")}</label><Metric label={t("settings.classColors")} value={t("settings.defaultPalette")} /></section>
      <section className="card span-4"><SectionTitle title={t("settings.aiTitle")} help={t("settings.aiHelp")} /><label><input type="checkbox" checked={Boolean(settings.ruleInsights ?? true)} onChange={(e) => set("ruleInsights", e.target.checked)} /> {t("settings.ruleBasedInsights")}</label><label><input type="checkbox" checked={Boolean(settings.aiInsights)} onChange={(e) => set("aiInsights", e.target.checked)} /> {t("settings.aiInsightsLater")}</label><Metric label={t("settings.insightFrequency")} value={text(settings.insightFrequency || t("settings.perLap"))} /><Metric label={t("settings.modes")} value={t("settings.coachModes")} /></section>
    </div>
  );
}
