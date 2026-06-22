import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, CircleGauge, Flag, Fuel, Gauge, Thermometer } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDuration, formatRaceTime } from "../lib/timeFormat";
import type { RecommendationPayload, StrategyState } from "../types/strategy";
import type { CompetitorState, PlayerState, TelemetrySnapshot, TyreState, TyreTemps } from "../types/telemetry";

const tyreKeys = ["fl", "fr", "rl", "rr"] as const;
const tyreLabels = { fl: "FL", fr: "FR", rl: "RL", rr: "RR" } as const;
const tyreColours = { fl: "#55c7f7", fr: "#7bb7ff", rl: "#f3b642", rr: "#ff8c69" } as const;

const finite = (value?: number | null): value is number => value != null && Number.isFinite(value);
const fmt = (value?: number | null, digits = 1, suffix = "") => finite(value) ? `${value.toFixed(digits)}${suffix}` : "--";
const lapTime = (value?: number | null) => finite(value) && value > 20 ? formatRaceTime(value) : "--";
const percent = (value?: number | null) => finite(value) ? `${Math.round(value * 100)}%` : "--";
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
const carName = (car?: CompetitorState) => car?.vehicle_model || car?.vehicle_name || "Car unavailable";
const displayFlag = (value?: string | null) => {
  const label = String(value ?? "").trim();
  const numericFlags: Record<string, string | undefined> = {
    "-1": undefined, "0": undefined, "1": "FCY pending", "2": "FCY · pits closed", "3": "FCY · lead lap may pit",
    "4": "FCY · pits open", "5": "FCY · last lap", "6": "Green · resume", "7": "Race halted",
  };
  if (label in numericFlags) return numericFlags[label];
  return !label || ["none", "unknown", "n/a"].includes(label.toLowerCase()) ? undefined : label.replace(/_/g, " ");
};
const phaseLabel = (value?: string | null) => {
  const label = String(value ?? "").trim();
  const phases: Record<string, string> = { "0": "Pre-session", "1": "Reconnaissance", "2": "Grid", "3": "Formation lap", "4": "Starting lights", "5": "Green flag", "6": "Full course yellow", "7": "Session stopped", "8": "Session over", "9": "Paused" };
  return phases[label] || (label ? label.replace(/_/g, " ") : "Flag unavailable");
};
const isUnderYellow = (telemetry: TelemetrySnapshot | null) => {
  const phase = String(telemetry?.session?.game_phase ?? "").toLowerCase();
  const flag = String(telemetry?.session?.yellow_flag_state ?? "").toLowerCase();
  return phase === "6" || ["1", "2", "3", "4", "5"].includes(flag) || /yellow|safety|fcy/.test(`${phase} ${flag}`);
};

type LapSample = {
  lap: number;
  lapTime?: number;
  fuelUsed?: number;
  flWear?: number;
  frWear?: number;
  rlWear?: number;
  rrWear?: number;
  flTemp?: number;
  frTemp?: number;
  rlTemp?: number;
  rrTemp?: number;
};

type PositionRow = { lap: number; [driver: string]: number };

function representativeTemp(temp?: TyreTemps) {
  return average([temp?.left_c, temp?.center_c, temp?.right_c, temp?.carcass_c].filter(finite));
}

function useLiveRaceHistory(telemetry: TelemetrySnapshot | null, strategy: StrategyState | null) {
  const [laps, setLaps] = useState<LapSample[]>([]);
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const previous = useRef<{ lap?: number; fuel?: number; session?: string }>({});
  const sessionKey = `${telemetry?.session?.track_name || ""}:${telemetry?.session?.session_type || ""}`;

  useEffect(() => {
    const lap = telemetry?.player?.lap_number ?? telemetry?.session?.current_lap;
    const player = telemetry?.player;
    if (!finite(lap) || !player) return;
    if (previous.current.session && previous.current.session !== sessionKey) {
      setLaps([]);
      setPositions([]);
      previous.current = { session: sessionKey };
    }
    if (!previous.current.session) previous.current.session = sessionKey;

    if (previous.current.lap !== lap) {
      const completedLap = Math.max(0, lap - 1);
      if (completedLap > 0) {
        const tyres = player.tyre_state;
        const fuelUsed = finite(previous.current.fuel) && finite(player.fuel_liters) && previous.current.fuel >= player.fuel_liters
          ? previous.current.fuel - player.fuel_liters
          : strategy?.fuel?.last_lap_fuel_used_liters;
        const sample: LapSample = {
          lap: completedLap,
          lapTime: player.last_lap_time,
          fuelUsed,
          flWear: tyres?.wear_fl, frWear: tyres?.wear_fr, rlWear: tyres?.wear_rl, rrWear: tyres?.wear_rr,
          flTemp: representativeTemp(tyres?.temp_fl), frTemp: representativeTemp(tyres?.temp_fr),
          rlTemp: representativeTemp(tyres?.temp_rl), rrTemp: representativeTemp(tyres?.temp_rr),
        };
        setLaps((current) => [...current.filter((row) => row.lap !== completedLap), sample].sort((a, b) => a.lap - b.lap).slice(-40));
      }
      const positionRow: PositionRow = { lap };
      telemetry.competitors.forEach((car) => {
        if (finite(car.position)) positionRow[`${car.driver_name || `Car ${car.vehicle_id}`}#${car.vehicle_id}`] = car.position;
      });
      setPositions((current) => [...current.filter((row) => row.lap !== lap), positionRow].sort((a, b) => a.lap - b.lap).slice(-60));
      previous.current.lap = lap;
    }
    previous.current.fuel = player.fuel_liters;
  }, [sessionKey, strategy?.fuel?.last_lap_fuel_used_liters, telemetry]);

  return { laps, positions };
}

function RaceHeader({ telemetry, connected, averageLap }: { telemetry: TelemetrySnapshot | null; connected: boolean; averageLap?: number }) {
  const player = telemetry?.player;
  const session = telemetry?.session;
  const playerCar = telemetry?.competitors.find((car) => car.is_player);
  const rpm = finite(player?.rpm) ? Math.min(100, (player.rpm / Math.max(player.max_rpm || 9000, 1)) * 100) : 0;
  const caution = displayFlag(session?.yellow_flag_state);
  const flag = caution || phaseLabel(session?.game_phase);
  const currentLap = player?.lap_number ?? session?.current_lap;
  const hasRealLapLimit = finite(session?.max_laps) && session.max_laps > 0 && session.max_laps < 10_000 && (!finite(currentLap) || session.max_laps >= currentLap);
  const estimatedTotalLaps = hasRealLapLimit ? session?.max_laps : finite(currentLap) && finite(session?.time_remaining) && session.time_remaining > 0 && finite(averageLap) ? currentLap + Math.ceil(session.time_remaining / averageLap) : undefined;
  const lapProgress = finite(currentLap) ? `Lap ${currentLap}${finite(estimatedTotalLaps) ? ` / ${hasRealLapLimit ? estimatedTotalLaps : `~${estimatedTotalLaps}`}` : ""}` : undefined;
  const position = player?.position ?? playerCar?.position;
  const classPosition = player?.class_position ?? playerCar?.class_position;
  const vehicle = player?.vehicle_model || player?.vehicle_name || carName(playerCar);
  const vehicleClass = player?.vehicle_class || playerCar?.vehicle_class;
  return (
    <section className="live-hero">
      <div className="live-session-strip">
        <span className={`live-connection ${connected && telemetry?.connected ? "is-live" : "is-offline"}`}><i />{telemetry?.feed_paused ? "Paused" : connected && telemetry?.connected ? "Live" : "Reconnecting"}</span>
        {(session?.track_name || session?.session_type) && <strong>{[session.track_name, session.session_type].filter(Boolean).join(" · ")}</strong>}
        {vehicle !== "Car unavailable" && <span className="session-car"><b>{vehicle}</b>{vehicleClass && <small>{vehicleClass}</small>}</span>}
        {playerCar?.driver_name && <span className="session-driver">{playerCar.driver_name}</span>}
        {finite(session?.time_remaining) && session.time_remaining > 0 && <span>{formatDuration(session.time_remaining)} remaining</span>}
      </div>
      <div className="race-core-grid">
        <div className="race-position-block">
          <span>Race position</span><strong>{finite(position) ? `P${position}` : "--"}</strong>
          <small className="position-context">{lapProgress && <b>{lapProgress}</b>}{finite(classPosition) && <span>P{classPosition} in class</span>}</small>
        </div>
        <LapTiming player={player} playerCar={playerCar} averageLap={averageLap} />
        <div className={`race-flag-block ${caution ? "caution" : flag.toLowerCase().includes("green") ? "green" : "neutral"}`}>
          <span>Race status</span><strong><Flag size={24} />{flag}</strong>
          <small>{caution ? "Full-course procedure active" : session?.session_type || "Live session"}</small>
        </div>
        <div className="compact-car-state" aria-label="Supporting car state">
          <div><span>Speed</span><strong>{fmt(player?.speed_kph, 0)} <small>km/h</small></strong></div>
          <div><span>Gear</span><strong>{player?.gear ?? "--"}</strong></div>
          <div className="compact-rpm"><i style={{ width: `${rpm}%` }} /></div>
          <small>{fmt(player?.rpm, 0)} rpm</small>
        </div>
      </div>
    </section>
  );
}

function LapTiming({ player, playerCar, averageLap }: { player?: PlayerState; playerCar?: CompetitorState; averageLap?: number }) {
  const delta = player?.delta_best;
  const direction = !finite(delta) || Math.abs(delta) < .01 ? "neutral" : delta < 0 ? "gain" : "loss";
  const DeltaIcon = direction === "gain" ? ArrowDown : direction === "loss" ? ArrowUp : ArrowRight;
  const deltaWidth = finite(delta) ? Math.min(100, Math.abs(delta) / 2 * 100) : 0;
  return (
    <div className="lap-now compact-lap-now">
      <div className="lap-now-main"><span>Current lap</span><strong>{lapTime(player?.current_lap_time)}</strong></div>
      <div className={`delta-now ${direction}`}><span>Delta · best valid lap</span><strong><DeltaIcon size={24} />{finite(delta) ? `${delta > 0 ? "+" : ""}${delta.toFixed(3)}` : "No reference"}</strong><div className="delta-track"><i style={{ width: `${deltaWidth}%` }} /></div></div>
      <div className="lap-references"><span>Best <b>{lapTime(player?.best_lap_time ?? playerCar?.best_lap_time)}</b></span><span>Previous <b>{lapTime(player?.last_lap_time ?? playerCar?.last_lap_time)}</b></span><span>Clean average <b>{lapTime(averageLap)}</b></span>{player?.lap_invalidated && <em>Lap invalid</em>}</div>
    </div>
  );
}

type OpponentPaceHistory = Record<number, { laps: number[]; dirtyLaps: Set<number>; lastObservedLap?: number; lastPitstops?: number; lastCountLapFlag?: number; lastInvalidated?: boolean; lastUnderYellow?: boolean; wasInPits?: boolean }>;

function useOpponentPaceHistory(cars: CompetitorState[], playerInvalidated: boolean, underYellow: boolean) {
  const history = useRef<OpponentPaceHistory>({});
  const [, setRevision] = useState(0);
  useEffect(() => {
    let changed = false;
    cars.forEach((car) => {
      const lap = car.total_laps ?? car.current_lap;
      if (!finite(lap)) return;
      const row = history.current[car.vehicle_id] || { laps: [], dirtyLaps: new Set<number>() };
      const completedLap = lap > 0 ? lap - 1 : undefined;
      const lapAdvanced = finite(row.lastObservedLap) && lap > row.lastObservedLap;
      if (car.in_pits) {
        row.dirtyLaps.add(lap);
        if (finite(completedLap)) row.dirtyLaps.add(completedLap);
      }
      if (row.wasInPits && !car.in_pits) row.dirtyLaps.add(lap);
      if (finite(car.pitstops) && finite(row.lastPitstops) && car.pitstops > row.lastPitstops) {
        row.dirtyLaps.add(lap);
        if (finite(completedLap)) row.dirtyLaps.add(completedLap);
      }
      if (lapAdvanced && finite(completedLap) && finite(car.last_lap_time) && car.last_lap_time > 20 && car.last_lap_time < 1200) {
        const officiallyTimed = row.lastCountLapFlag === 2;
        const validPlayerLap = !car.is_player || !row.lastInvalidated;
        if (officiallyTimed && validPlayerLap && !row.lastUnderYellow && !row.dirtyLaps.has(completedLap)) row.laps = [...row.laps, car.last_lap_time].slice(-14);
        changed = true;
      }
      row.lastObservedLap = lap;
      row.lastPitstops = car.pitstops;
      row.lastCountLapFlag = car.count_lap_flag;
      row.lastInvalidated = car.is_player ? playerInvalidated : false;
      row.lastUnderYellow = underYellow;
      row.wasInPits = Boolean(car.in_pits);
      history.current[car.vehicle_id] = row;
    });
    if (changed) setRevision((current) => current + 1);
  }, [cars, playerInvalidated, underYellow]);
  return history.current;
}

function rollingPace(history: OpponentPaceHistory, car: CompetitorState | undefined, count: number) {
  const laps = car ? history[car.vehicle_id]?.laps || [] : [];
  return laps.length >= count ? average(laps.slice(-count)) : undefined;
}

function cleanAveragePace(history: OpponentPaceHistory, car: CompetitorState | undefined) {
  const laps = car ? history[car.vehicle_id]?.laps || [] : [];
  return average(laps);
}

function paceDeltaText(value?: number) {
  return finite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(3)}s` : "--";
}

function NearbyStandings({ mergedCars, paceHistory, telemetry }: { mergedCars: CompetitorState[]; paceHistory: OpponentPaceHistory; telemetry: TelemetrySnapshot | null }) {
  const playerCar = mergedCars.find((car) => car.is_player);
  const playerPace3 = rollingPace(paceHistory, playerCar, 3);
  const playerPace7 = rollingPace(paceHistory, playerCar, 7);
  const rows = useMemo(() => {
    const sorted = [...mergedCars].sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
    const playerIndex = sorted.findIndex((car) => car.is_player);
    return playerIndex < 0 ? sorted.slice(0, 13) : sorted.slice(Math.max(0, playerIndex - 6), playerIndex + 7);
  }, [mergedCars]);
  const currentLap = telemetry?.player?.lap_number ?? telemetry?.session?.current_lap;
  return (
    <section className="live-section nearby-card">
      <div className="live-section-heading"><div><span>Race order</span><h2>Nearby drivers</h2></div><small>Up to 6 ahead · 6 behind</small></div>
      {rows.length ? <div className="table-wrap"><table className="nearby-table"><thead><tr><th>Pos</th><th>Driver / car</th><th>Laps</th><th>3-lap pace</th><th>7-lap pace</th><th>Δ3 vs you</th><th>Δ7 vs you</th><th>Pit</th></tr></thead><tbody>{rows.map((car) => {
        const pace3 = rollingPace(paceHistory, car, 3);
        const pace7 = rollingPace(paceHistory, car, 7);
        const delta3 = !car.is_player && finite(pace3) && finite(playerPace3) ? pace3 - playerPace3 : undefined;
        const delta7 = !car.is_player && finite(pace7) && finite(playerPace7) ? pace7 - playerPace7 : undefined;
        const driverPaceClass = finite(delta3) && delta3 > .05 ? "driver-pace-gain" : finite(delta3) && delta3 < -.05 ? "driver-pace-loss" : "";
        const recentlyPitted = finite(currentLap) && finite(car.last_pit_lap) && currentLap - car.last_pit_lap <= 2;
        return <tr key={car.vehicle_id} className={car.is_player ? "is-player" : ""}>
          <td><strong>P{car.position ?? "--"}</strong></td>
          <td className={driverPaceClass} title={finite(delta3) ? delta3 > 0 ? "You are gaining over the last 3 laps" : "You are losing over the last 3 laps" : "Three-lap comparison unavailable"}><div className="driver-cell"><strong>{car.is_player ? "You" : car.driver_name || `Car ${car.vehicle_id}`}</strong><small>{carName(car)}</small></div></td>
          <td>{car.total_laps ?? car.current_lap ?? "--"}</td>
          <td>{lapTime(pace3)}</td>
          <td>{lapTime(pace7)}</td>
          <td className="pace-delta-cell">{car.is_player ? "REF" : paceDeltaText(delta3)}</td>
          <td className="pace-delta-cell">{car.is_player ? "REF" : paceDeltaText(delta7)}</td>
          <td>{car.in_pits ? <span className="pit-pill active">PIT</span> : recentlyPitted ? <span className="pit-pill recent">OUT</span> : finite(car.pitstops) && car.pitstops > 0 ? <span className="pit-count">{car.pitstops} stop{car.pitstops === 1 ? "" : "s"}</span> : "—"}</td>
        </tr>;
      })}</tbody></table></div> : <EmptyState label="Nearby timing appears when competitor telemetry is available." />}
    </section>
  );
}

function InputsCard({ player }: { player?: PlayerState }) {
  const controls = [{ label: "Throttle", value: player?.throttle, colour: "#6ee7a8" }, { label: "Brake", value: player?.brake, colour: "#ff6f68" }];
  return <section className="status-card input-card"><CardTitle icon={Gauge} eyebrow="Control" title="Inputs" />
    <div className="input-gauges">{controls.map((control) => <div key={control.label}><div className="vertical-gauge"><i style={{ height: `${Math.max(0, Math.min(100, (control.value || 0) * 100))}%`, background: control.colour }} /></div><strong>{percent(control.value)}</strong><span>{control.label}</span></div>)}</div>
    {finite(player?.steering) && <div className="steering-line"><i style={{ left: `${50 + Math.max(-.5, Math.min(.5, player.steering)) * 100}%` }} /><span>Steering</span></div>}
  </section>;
}

function heatColour(value?: number) {
  if (!finite(value)) return "#24313d";
  const hue = Math.max(0, Math.min(210, 210 - ((value - 30) / 100) * 210));
  return `hsl(${hue} 72% 48%)`;
}

function TyreCard({ tyres }: { tyres?: TyreState }) {
  const hasData = tyreKeys.some((key) => representativeTemp(tyres?.[`temp_${key}`]));
  return <section className="status-card tyre-card"><CardTitle icon={Thermometer} eyebrow="Condition" title="Tyres" />
    {hasData ? <div className="vehicle-tyres">{tyreKeys.map((key) => {
      const temp = tyres?.[`temp_${key}`] as TyreTemps | undefined;
      const zones = [temp?.left_c, temp?.center_c ?? temp?.carcass_c, temp?.right_c];
      const wear = tyres?.[`wear_${key}`] as number | undefined;
      return <div className={`visual-tyre tyre-${key}`} key={key}><header><strong>{tyreLabels[key]}</strong>{finite(wear) && <span>{percent(wear)} life</span>}</header><div>{zones.map((value, index) => <span key={index} style={{ background: heatColour(value) }}>{finite(value) ? Math.round(value) : "--"}°</span>)}</div></div>;
    })}<div className="car-spine"><i /><span>FRONT</span></div></div> : <EmptyState label="Tyre temperatures unavailable" compact />}
    <div className="heat-key"><span>Cool</span><i /><span>Hot</span></div>
  </section>;
}

function FuelCard({ telemetry, strategy }: { telemetry: TelemetrySnapshot | null; strategy: StrategyState | null }) {
  const player = telemetry?.player;
  const fuel = strategy?.fuel;
  const tyres = strategy?.tyres;
  const pitLap = strategy?.pit_window?.optimal_pit_lap ?? strategy?.stint?.recommended_stint_end_lap;
  const confidence = fuel?.confidence?.toLowerCase();
  const currentLap = player?.lap_number ?? telemetry?.session?.current_lap;
  const lapsToPit = finite(pitLap) && finite(currentLap) ? Math.max(0, pitLap - currentLap) : undefined;
  const fuelAtPit = finite(player?.fuel_liters) && finite(fuel?.fuel_per_lap_liters) && finite(lapsToPit) ? Math.max(0, player.fuel_liters - fuel.fuel_per_lap_liters * lapsToPit) : undefined;
  const wearAtPit = finite(tyres?.average_wear) && finite(tyres?.wear_rate_per_lap) && finite(lapsToPit) ? Math.min(1, tyres.average_wear + tyres.wear_rate_per_lap * lapsToPit) : undefined;
  const fuelLimit = strategy?.stint?.fuel_limited_stint_end_lap;
  const tyreLimit = strategy?.stint?.tyre_limited_stint_end_lap;
  const trigger = finite(fuelLimit) && finite(tyreLimit) && Math.abs(fuelLimit - tyreLimit) <= 1 ? "Fuel + tyres" : finite(tyreLimit) && (!finite(fuelLimit) || tyreLimit < fuelLimit) ? "Tyre-limited" : finite(fuelLimit) ? "Fuel-limited" : "Building estimate";
  const maximumLaps = telemetry?.session?.max_laps;
  const validFinishLap = finite(maximumLaps) && maximumLaps > 0 && maximumLaps < 10_000 ? maximumLaps : finite(currentLap) && finite(fuel?.estimated_laps_remaining) ? currentLap + Math.ceil(fuel.estimated_laps_remaining) : undefined;
  const noStopNeeded = finite(pitLap) && finite(validFinishLap) ? pitLap >= validFinishLap : !finite(pitLap) && finite(fuel?.fuel_delta_to_finish) && fuel.fuel_delta_to_finish >= 0;
  const projectedCornerWear = (key: typeof tyreKeys[number]) => {
    const current = player?.tyre_state?.[`wear_${key}`] as number | undefined;
    return finite(current) && finite(tyres?.wear_rate_per_lap) && finite(lapsToPit) ? Math.min(1, current + tyres.wear_rate_per_lap * lapsToPit) : undefined;
  };
  return <section className="status-card fuel-card"><CardTitle icon={Fuel} eyebrow="Strategy" title="Fuel & pit" />
    <div className="strategy-live-values"><div className="fuel-primary"><strong>{fmt(player?.fuel_liters, 1)}</strong><span>litres now</span></div><div><span>Measured average</span><strong>{fmt(fuel?.fuel_per_lap_liters, 2, " L/lap")}</strong></div></div>
    <div className={`pit-call ${noStopNeeded ? "safe" : finite(pitLap) ? "action" : "unknown"}`}><span>{noStopNeeded ? "No stop required before finish" : finite(pitLap) ? "Estimated pit lap" : "Pit estimate"}</span><strong>{noStopNeeded ? "Run to finish" : finite(pitLap) ? `Lap ${Math.round(pitLap)} · ${trigger}` : "Need more clean laps"}</strong></div>
    {finite(lapsToPit) && !noStopNeeded && <div className="stint-projection"><div className="projection-axis"><span>Now · L{currentLap}</span><i><b style={{ width: "100%" }} /></i><span>Pit · L{pitLap}</span></div><div className="projection-values"><div><span>Fuel at stop</span><strong>{fmt(fuelAtPit, 1, " L")}</strong><small>from {fmt(fuel?.fuel_per_lap_liters, 2, " L/lap")}</small></div><div><span>Tyre wear at stop</span><strong>{finite(wearAtPit) ? percent(wearAtPit) : "--"}</strong><small>+{finite(tyres?.wear_rate_per_lap) ? percent(tyres.wear_rate_per_lap) : "--"} / lap</small></div></div></div>}
    {finite(lapsToPit) && !noStopNeeded && <div className="projected-corner-wear">{tyreKeys.map((key) => <span key={key}><b>{tyreLabels[key]}</b>{percent(projectedCornerWear(key))}</span>)}</div>}
    <small className={`confidence ${confidence || "low"}`}>{confidence || "low"} fuel confidence · {tyres?.confidence || "low"} tyre confidence · {finite(fuel?.fuel_laps_remaining) ? `${fuel.fuel_laps_remaining.toFixed(1)} laps fuel range` : "range unavailable"}</small>
  </section>;
}

function AlertsCard({ telemetry, recommendation }: { telemetry: TelemetrySnapshot | null; recommendation: RecommendationPayload | null }) {
  const player = telemetry?.player;
  const penalties = telemetry?.competitors.find((car) => car.is_player)?.penalties;
  const caution = displayFlag(telemetry?.session?.yellow_flag_state);
  const alerts = [
    caution && !caution.toLowerCase().includes("green") ? caution : undefined,
    finite(penalties) && penalties > 0 ? `${penalties} active penalt${penalties === 1 ? "y" : "ies"}` : undefined,
    player?.lap_invalidated ? "Current lap invalid" : undefined,
    recommendation?.current?.priority === "critical" || recommendation?.current?.priority === "high" ? recommendation.current.title : undefined,
  ].filter(Boolean) as string[];
  if (!alerts.length) return null;
  return <section className="status-card alert-card"><CardTitle icon={AlertTriangle} eyebrow="Attention" title="Race alerts" /><div className="alert-list">{alerts.map((alert) => <span key={alert}><AlertTriangle size={15} />{alert}</span>)}</div></section>;
}

function CardTitle({ icon: Icon, eyebrow, title }: { icon: typeof Gauge; eyebrow: string; title: string }) {
  return <div className="status-title"><Icon size={18} /><div><span>{eyebrow}</span><h3>{title}</h3></div></div>;
}

function EmptyState({ label, compact = false }: { label: string; compact?: boolean }) {
  return <div className={`live-empty ${compact ? "compact" : ""}`}><CircleGauge size={20} /><span>{label}</span></div>;
}

const TrendChart = memo(function TrendChart({ title, eyebrow, data, lines, averageLine, invert = false, formatter }: { title: string; eyebrow: string; data: Record<string, unknown>[]; lines: { key: string; label: string; colour: string }[]; averageLine?: number; invert?: boolean; formatter?: (value: number) => string }) {
  return <section className="trend-card"><div className="live-section-heading"><div><span>{eyebrow}</span><h3>{title}</h3></div></div>{data.length > 1 ? <ResponsiveContainer width="100%" height={230}><LineChart data={data} margin={{ top: 6, right: 10, left: -12, bottom: 0 }}><CartesianGrid strokeDasharray="3 4" vertical={false} /><XAxis dataKey="lap" tickLine={false} /><YAxis reversed={invert} tickLine={false} tickFormatter={formatter} domain={["auto", "auto"]} /><Tooltip formatter={(value: number, name: string) => [formatter ? formatter(value) : fmt(value, 2), name]} /><Legend />{finite(averageLine) && <ReferenceLine y={averageLine} stroke="#edf4f8" strokeDasharray="5 5" label="Average" />}{lines.map((line) => <Line key={line.key} type="monotone" dataKey={line.key} name={line.label} stroke={line.colour} strokeWidth={2.3} dot={{ r: 2 }} connectNulls />)}</LineChart></ResponsiveContainer> : <EmptyState label="Trend begins after two completed laps." />}</section>;
});

function RacePositionChart({ positions, competitors }: { positions: PositionRow[]; competitors: CompetitorState[] }) {
  const [focus, setFocus] = useState("player");
  const drivers = useMemo(() => {
    const keys = new Set<string>(); positions.forEach((row) => Object.keys(row).filter((key) => key !== "lap").forEach((key) => keys.add(key)));
    return [...keys];
  }, [positions]);
  const player = competitors.find((car) => car.is_player);
  const playerKey = drivers.find((key) => key.endsWith(`#${player?.vehicle_id}`));
  return <section className="trend-card position-chart"><div className="live-section-heading"><div><span>Race evolution</span><h3>Position history</h3></div>{drivers.length > 1 && <select value={focus} onChange={(event) => setFocus(event.target.value)}><option value="player">Focus current driver</option><option value="all">Show all drivers</option>{drivers.map((driver) => <option value={driver} key={driver}>{driver.split("#")[0]}</option>)}</select>}</div>
    {positions.length > 1 ? <ResponsiveContainer width="100%" height={310}><LineChart data={positions} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}><CartesianGrid strokeDasharray="3 4" vertical={false} /><XAxis dataKey="lap" tickLine={false} /><YAxis reversed domain={[1, "dataMax"]} allowDecimals={false} tickLine={false} /><Tooltip /><Legend formatter={(value) => String(value).split("#")[0]} />{drivers.map((driver, index) => {
      const selected = focus === "all" || focus === driver || (focus === "player" && driver === playerKey);
      return <Line key={driver} type="linear" dataKey={driver} name={driver.split("#")[0]} stroke={driver === playerKey ? "#f3b642" : `hsl(${(index * 47) % 360} 62% 62%)`} strokeWidth={driver === playerKey ? 3.5 : selected ? 2 : 1} strokeOpacity={selected ? 1 : .18} dot={false} connectNulls />;
    })}</LineChart></ResponsiveContainer> : <EmptyState label="Position history builds as race laps change." />}
  </section>;
}

function LiveGraphs({ laps, positions, competitors }: { laps: LapSample[]; positions: PositionRow[]; competitors: CompetitorState[] }) {
  const fuelAverage = average(laps.map((row) => row.fuelUsed).filter(finite));
  const fuelData = laps.map((row) => ({ ...row, average: fuelAverage }));
  return <section className="live-trends"><div className="live-section-heading trends-heading"><div><span>Stint analysis</span><h2>Race evolution</h2></div><small>Completed laps only</small></div><div className="trend-grid">
    <TrendChart eyebrow="Consumption" title="Fuel usage" data={fuelData} lines={[{ key: "fuelUsed", label: "Fuel / lap", colour: "#55c7f7" }]} averageLine={fuelAverage} formatter={(value) => `${value.toFixed(2)} L`} />
    <TrendChart eyebrow="Degradation" title="Tyre condition" data={laps} lines={tyreKeys.map((key) => ({ key: `${key}Wear`, label: tyreLabels[key], colour: tyreColours[key] }))} formatter={(value) => `${Math.round(value * 100)}%`} />
    <TrendChart eyebrow="Pace" title="Lap-time trend" data={laps} lines={[{ key: "lapTime", label: "Lap time", colour: "#f3b642" }]} formatter={(value) => formatRaceTime(value)} />
    <TrendChart eyebrow="Thermal state" title="Tyre temperatures" data={laps} lines={tyreKeys.map((key) => ({ key: `${key}Temp`, label: tyreLabels[key], colour: tyreColours[key] }))} formatter={(value) => `${Math.round(value)}°`} />
    <RacePositionChart positions={positions} competitors={competitors} />
  </div></section>;
}

export function LiveDashboard({ telemetry, strategy, recommendation, connected, competitors = [] }: { telemetry: TelemetrySnapshot | null; strategy: StrategyState | null; recommendation: RecommendationPayload | null; connected: boolean; readOnlyLabel?: string; competitors?: CompetitorState[] }) {
  const { laps, positions } = useLiveRaceHistory(telemetry, strategy);
  const mergedCompetitors = useMemo(() => {
    const merged = new Map(competitors.map((car) => [car.vehicle_id, car]));
    telemetry?.competitors?.forEach((car) => merged.set(car.vehicle_id, car));
    return [...merged.values()];
  }, [competitors, telemetry?.competitors]);
  const paceHistory = useOpponentPaceHistory(mergedCompetitors, Boolean(telemetry?.player?.lap_invalidated), isUnderYellow(telemetry));
  const playerCar = mergedCompetitors.find((car) => car.is_player);
  const observedAverage = cleanAveragePace(paceHistory, playerCar);
  const averageLap = observedAverage ?? ((strategy?.pace?.sample_laps ?? 0) > 0 ? strategy?.pace?.weighted_recent_pace : undefined);
  return <div className="page live-dashboard">
    <RaceHeader telemetry={telemetry} connected={connected} averageLap={averageLap} />
    <NearbyStandings mergedCars={mergedCompetitors} paceHistory={paceHistory} telemetry={telemetry} />
    <div className="live-status-row">
      <InputsCard player={telemetry?.player} />
      <TyreCard tyres={telemetry?.player?.tyre_state} />
      <FuelCard telemetry={telemetry} strategy={strategy} />
      <AlertsCard telemetry={telemetry} recommendation={recommendation} />
    </div>
    <LiveGraphs laps={laps} positions={positions} competitors={mergedCompetitors} />
  </div>;
}
