import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, BatteryCharging, CircleGauge, CloudRain, Flag, Fuel, Gauge, Timer, Thermometer } from "lucide-react";
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
import { completedLapFuelUsed, currentLapFuelUsed } from "../lib/liveFuelHistory";
import { environmentTrendDirection, trackWetnessState, type EnvironmentTrendDirection } from "../lib/environmentTrend";
import { appendLapInputPoint, bestLapInputTrace, buildLapInputChartData, isCompleteLapInputTrace, type LapInputPoint, type LapInputTrace } from "../lib/lapInputTrace";
import { isHypercarClass } from "../lib/vehicleClass";
import { raceFlagState } from "../lib/raceFlagState";
import { useT } from "../i18n/I18nProvider";
import type { RecommendationPayload, StrategyState } from "../types/strategy";
import type { CompetitorState, EnvironmentState, PlayerState, TelemetrySnapshot, TyreState, TyreTemps } from "../types/telemetry";

const tyreKeys = ["fl", "fr", "rl", "rr"] as const;
const tyreLabels = { fl: "FL", fr: "FR", rl: "RL", rr: "RR" } as const;
const tyreColours = { fl: "#55c7f7", fr: "#7bb7ff", rl: "#f3b642", rr: "#ff8c69" } as const;
const brakeTempKeys = { fl: "brake_temp_fl", fr: "brake_temp_fr", rl: "brake_temp_rl", rr: "brake_temp_rr" } as const;

const finite = (value?: number | null): value is number => value != null && Number.isFinite(value);
const fmt = (value?: number | null, digits = 1, suffix = "") => finite(value) ? `${value.toFixed(digits)}${suffix}` : "--";
const lapTime = (value?: number | null) => finite(value) && value > 20 ? formatRaceTime(value) : "--";
const percent = (value?: number | null) => finite(value) ? `${Math.round(value * 100)}%` : "--";
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
const carName = (car?: CompetitorState, fallback = "Car unavailable") => car?.vehicle_model || car?.vehicle_name || fallback;
const displayFlag = (t: (key: string) => string, value?: string | null) => {
  const label = String(value ?? "").trim();
  const numericFlags: Record<string, string | undefined> = {
    "-1": undefined, "0": undefined, "1": "FCY pending", "2": "FCY · pits closed", "3": "FCY · lead lap may pit",
    "4": "FCY · pits open", "5": "FCY · last lap", "6": "Green · resume", "7": "Race halted",
  };
  Object.assign(numericFlags, {
    "1": t("liveDashboard.fcyPending"), "2": t("liveDashboard.fcyPitsClosed"), "3": t("liveDashboard.fcyLeadLapMayPit"),
    "4": t("liveDashboard.fcyPitsOpen"), "5": t("liveDashboard.fcyLastLap"), "6": t("liveDashboard.greenResume"), "7": t("liveDashboard.raceHalted"),
  });
  if (label in numericFlags) return numericFlags[label];
  return !label || ["none", "unknown", "n/a"].includes(label.toLowerCase()) ? undefined : label.replace(/_/g, " ");
};
const phaseLabel = (t: (key: string) => string, value?: string | null) => {
  const label = String(value ?? "").trim();
  const phases: Record<string, string> = { "0": t("liveDashboard.preSession"), "1": t("liveDashboard.reconnaissance"), "2": t("liveDashboard.grid"), "3": t("liveDashboard.formationLap"), "4": t("liveDashboard.startingLights"), "5": t("liveDashboard.greenFlag"), "6": t("liveDashboard.fullCourseYellow"), "7": t("liveDashboard.sessionStopped"), "8": t("liveDashboard.sessionOver"), "9": t("common.paused") };
  return phases[label] || (label ? label.replace(/_/g, " ") : t("liveDashboard.flagUnavailable"));
};
const isUnderYellow = (telemetry: TelemetrySnapshot | null) => {
  const phase = String(telemetry?.session?.game_phase ?? "").toLowerCase();
  const flag = String(telemetry?.session?.yellow_flag_state ?? "").toLowerCase();
  return phase === "6" || ["1", "2", "3", "4", "5"].includes(flag) || /yellow|safety|fcy/.test(`${phase} ${flag}`);
};

type LapSample = {
  lap: number;
  provisional?: boolean;
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
  oilTemp?: number;
  waterTemp?: number;
};

type PositionRow = { lap: number; [driver: string]: number };

const LIVE_HISTORY_KEY = "lmu-live-session-history-v1";
type StoredLiveHistory = {
  sessionId: string;
  laps: LapSample[];
  positions: PositionRow[];
  previous: { lap?: number; lapStartFuel?: number; observedFromBoundary?: boolean; session?: string };
  paceHistory?: Record<string, { laps: number[]; dirtyLaps: number[]; lastObservedLap?: number; lastPitstops?: number; lastCountLapFlag?: number; lastInvalidated?: boolean; lastUnderYellow?: boolean; wasInPits?: boolean }>;
  inputTraces?: LapInputTrace[];
  activeInputTrace?: LapInputTrace;
  gridMode?: "nearby" | "full";
};

function readStoredHistory(sessionId?: string): StoredLiveHistory | null {
  if (!sessionId) return null;
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(LIVE_HISTORY_KEY) || "null") as StoredLiveHistory | null;
    return parsed?.sessionId === sessionId ? parsed : null;
  } catch {
    return null;
  }
}

function updateStoredHistory(sessionId: string | undefined, patch: Partial<StoredLiveHistory>) {
  if (!sessionId) return;
  const current = readStoredHistory(sessionId) || { sessionId, laps: [], positions: [], previous: {} };
  window.sessionStorage.setItem(LIVE_HISTORY_KEY, JSON.stringify({ ...current, ...patch, sessionId }));
}

function representativeTemp(temp?: TyreTemps) {
  return average([temp?.left_c, temp?.center_c, temp?.right_c, temp?.carcass_c].filter(finite));
}

function useLiveRaceHistory(telemetry: TelemetrySnapshot | null, strategy: StrategyState | null) {
  const sessionId = telemetry?.session_id;
  const initial = readStoredHistory(sessionId);
  const [laps, setLaps] = useState<LapSample[]>(initial?.laps || []);
  const [positions, setPositions] = useState<PositionRow[]>(initial?.positions || []);
  const previous = useRef<{ lap?: number; lapStartFuel?: number; observedFromBoundary?: boolean; session?: string }>(initial?.previous || {});
  const activeSession = useRef<string | undefined>(sessionId);
  const suppressPersist = useRef(false);
  const sessionKey = sessionId || `${telemetry?.session?.track_name || ""}:${telemetry?.session?.session_type || ""}`;

  useEffect(() => {
    if (!sessionId || activeSession.current === sessionId) return;
    const stored = readStoredHistory(sessionId);
    setLaps(stored?.laps || []);
    setPositions(stored?.positions || []);
    previous.current = stored?.previous || {};
    activeSession.current = sessionId;
    suppressPersist.current = true;
  }, [sessionId]);

  useEffect(() => {
    if (suppressPersist.current) {
      suppressPersist.current = false;
      return;
    }
    updateStoredHistory(sessionId, { laps, positions, previous: previous.current });
  }, [sessionId, laps, positions]);

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

    if (!finite(previous.current.lap)) {
      const positionRow: PositionRow = { lap };
      telemetry.competitors.forEach((car) => {
        if (finite(car.position)) positionRow[`${car.driver_name || `Car ${car.vehicle_id}`}#${car.vehicle_id}`] = car.position;
      });
      setPositions([positionRow]);
      previous.current.lap = lap;
      previous.current.lapStartFuel = player.fuel_liters;
      previous.current.observedFromBoundary = false;
      return;
    }

    if (previous.current.lap !== lap) {
      const completedLap = Math.max(0, lap - 1);
      if (completedLap > 0) {
        const tyres = player.tyre_state;
        const fuelUsed = completedLapFuelUsed({
          lapStartFuel: previous.current.lapStartFuel,
          currentFuel: player.fuel_liters,
          observedFromBoundary: previous.current.observedFromBoundary === true && lap === previous.current.lap + 1,
          fallbackFuelUsed: strategy?.fuel?.last_lap_fuel_used_liters,
        });
        const sample: LapSample = {
          lap: completedLap,
          lapTime: player.last_lap_time,
          fuelUsed,
          flWear: tyres?.wear_fl, frWear: tyres?.wear_fr, rlWear: tyres?.wear_rl, rrWear: tyres?.wear_rr,
          flTemp: representativeTemp(tyres?.temp_fl), frTemp: representativeTemp(tyres?.temp_fr),
          rlTemp: representativeTemp(tyres?.temp_rl), rrTemp: representativeTemp(tyres?.temp_rr),
          oilTemp: player.engine_oil_temp, waterTemp: player.engine_water_temp,
        };
        setLaps((current) => [...current.filter((row) => row.lap !== completedLap), sample].sort((a, b) => a.lap - b.lap).slice(-40));
      }
      const positionRow: PositionRow = { lap };
      telemetry.competitors.forEach((car) => {
        if (finite(car.position)) positionRow[`${car.driver_name || `Car ${car.vehicle_id}`}#${car.vehicle_id}`] = car.position;
      });
      setPositions((current) => [...current.filter((row) => row.lap !== lap), positionRow].sort((a, b) => a.lap - b.lap).slice(-60));
      previous.current.lap = lap;
      previous.current.lapStartFuel = player.fuel_liters;
      previous.current.observedFromBoundary = true;
    }
    if (!finite(previous.current.lapStartFuel)) previous.current.lapStartFuel = player.fuel_liters;
  }, [sessionKey, strategy?.fuel?.last_lap_fuel_used_liters, telemetry]);

  const player = telemetry?.player;
  const currentLap = player?.lap_number ?? telemetry?.session?.current_lap;
  const tyres = player?.tyre_state;
  const liveLap: LapSample | undefined = finite(currentLap) && player ? {
    lap: currentLap,
    provisional: true,
    lapTime: player.current_lap_time,
    fuelUsed: currentLapFuelUsed(previous.current.lap === currentLap ? previous.current.lapStartFuel : player.fuel_liters, player.fuel_liters),
    flWear: tyres?.wear_fl, frWear: tyres?.wear_fr, rlWear: tyres?.wear_rl, rrWear: tyres?.wear_rr,
    flTemp: representativeTemp(tyres?.temp_fl), frTemp: representativeTemp(tyres?.temp_fr),
    rlTemp: representativeTemp(tyres?.temp_rl), rrTemp: representativeTemp(tyres?.temp_rr),
    oilTemp: player.engine_oil_temp, waterTemp: player.engine_water_temp,
  } : undefined;
  const livePosition: PositionRow | undefined = finite(currentLap) ? { lap: currentLap } : undefined;
  if (livePosition) telemetry?.competitors.forEach((car) => {
    if (finite(car.position)) livePosition[`${car.driver_name || `Car ${car.vehicle_id}`}#${car.vehicle_id}`] = car.position;
  });

  return { laps, positions, liveLap, livePosition };
}

type LapInputHistory = { sessionId?: string; completed: LapInputTrace[]; current?: LapInputTrace };

function restoredLapInputHistory(sessionId?: string): LapInputHistory {
  const stored = readStoredHistory(sessionId);
  return { sessionId, completed: stored?.inputTraces || [], current: stored?.activeInputTrace };
}

function useLapInputHistory(telemetry: TelemetrySnapshot | null) {
  const sessionId = telemetry?.session_id;
  const [history, setHistory] = useState<LapInputHistory>(() => restoredLapInputHistory(sessionId));
  const persist = useRef({ at: 0, completed: history.completed.length });

  useEffect(() => {
    const player = telemetry?.player;
    const playerCar = telemetry?.competitors.find((car) => car.is_player);
    const lap = player?.lap_number ?? telemetry?.session?.current_lap;
    const distance = playerCar?.lap_distance;
    if (!player || !finite(lap) || !finite(distance) || (!finite(player.throttle) && !finite(player.brake))) {
      if (history.sessionId !== sessionId) setHistory(restoredLapInputHistory(sessionId));
      return;
    }
    const point: LapInputPoint = { distance: Math.max(0, distance), throttle: player.throttle ?? 0, brake: player.brake ?? 0 };
    setHistory((existing) => {
      const base = existing.sessionId === sessionId ? existing : restoredLapInputHistory(sessionId);
      if (!base.current) return { ...base, sessionId, current: { lap, invalidated: Boolean(player.lap_invalidated), points: [point] } };
      if (base.current.lap !== lap) {
        const completedTrace = { ...base.current, lapTime: player.last_lap_time };
        const completed = isCompleteLapInputTrace(completedTrace, telemetry?.session?.track_length_m)
          ? [...base.completed, completedTrace].slice(-8)
          : base.completed;
        return { sessionId, completed, current: { lap, invalidated: Boolean(player.lap_invalidated), points: [point] } };
      }
      const lastPoint = base.current.points[base.current.points.length - 1];
      if (lastPoint && point.distance + 50 < lastPoint.distance) {
        return { ...base, current: { lap, invalidated: Boolean(player.lap_invalidated), points: [point] } };
      }
      return {
        ...base,
        current: {
          ...base.current,
          invalidated: base.current.invalidated || Boolean(player.lap_invalidated),
          points: appendLapInputPoint(base.current.points, point),
        },
      };
    });
  }, [sessionId, telemetry]);

  useEffect(() => {
    if (!sessionId || history.sessionId !== sessionId) return;
    const now = Date.now();
    const completedChanged = persist.current.completed !== history.completed.length;
    if (!completedChanged && now - persist.current.at < 5_000) return;
    persist.current = { at: now, completed: history.completed.length };
    updateStoredHistory(sessionId, { inputTraces: history.completed, activeInputTrace: history.current });
  }, [history, sessionId]);

  return history;
}

function RaceHeader({ telemetry, connected, averageLap }: { telemetry: TelemetrySnapshot | null; connected: boolean; averageLap?: number }) {
  const t = useT();
  const player = telemetry?.player;
  const session = telemetry?.session;
  const playerCar = telemetry?.competitors.find((car) => car.is_player);
  const rpm = finite(player?.rpm) ? Math.min(100, (player.rpm / Math.max(player.max_rpm || 9000, 1)) * 100) : 0;
  const caution = displayFlag(t, session?.yellow_flag_state);
  const activeFlag = raceFlagState(telemetry);
  const flag = activeFlag.yellowProcedure ? displayFlag(t, activeFlag.yellowProcedure) || t("liveDashboard.fullCourseYellow") : activeFlag.labelKey ? t(activeFlag.labelKey) : caution || phaseLabel(t, session?.game_phase);
  const currentLap = player?.lap_number ?? session?.current_lap;
  const hasRealLapLimit = finite(session?.max_laps) && session.max_laps > 0 && session.max_laps < 10_000 && (!finite(currentLap) || session.max_laps >= currentLap);
  const estimatedTotalLaps = hasRealLapLimit ? session?.max_laps : finite(currentLap) && finite(session?.time_remaining) && session.time_remaining > 0 && finite(averageLap) ? currentLap + Math.ceil(session.time_remaining / averageLap) : undefined;
  const currentLapLabel = finite(currentLap) ? String(currentLap) : "--";
  const estimatedTotalLapsLabel = finite(estimatedTotalLaps) ? `${hasRealLapLimit ? "" : "~"}${estimatedTotalLaps}` : "--";
  const hasWideLapCount = currentLapLabel.length + estimatedTotalLapsLabel.length > 5;
  const position = player?.position ?? playerCar?.position;
  const classPosition = player?.class_position ?? playerCar?.class_position;
  const vehicle = player?.vehicle_model || player?.vehicle_name || carName(playerCar, t("liveDashboard.carUnavailable"));
  const vehicleClass = player?.vehicle_class || playerCar?.vehicle_class;
  return (
    <section className="live-hero">
      <div className="live-session-strip">
        <span className={`live-connection ${connected && telemetry?.connected ? "is-live" : "is-offline"}`}><i />{telemetry?.feed_paused ? t("common.paused") : connected && telemetry?.connected ? t("common.live") : t("common.reconnecting")}</span>
        {(session?.track_name || session?.session_type) && <strong>{[session.track_name, session.session_type].filter(Boolean).join(" · ")}</strong>}
        {vehicle !== t("liveDashboard.carUnavailable") && <span className="session-car"><b>{vehicle}</b>{vehicleClass && <small>{vehicleClass}</small>}</span>}
        {playerCar?.driver_name && <span className="session-driver">{playerCar.driver_name}</span>}
        {finite(session?.time_remaining) && session.time_remaining > 0 && <span className="live-time-remaining"><Timer size={18} /><small>{t("telemetry.remaining")}</small><strong>{formatDuration(session.time_remaining)}</strong></span>}
      </div>
      <div className="race-core-grid">
        <div className="race-position-block">
          <div className="primary-race-number"><span>{t("liveDashboard.racePosition")}</span><strong>{finite(position) ? `P${position}` : "--"}</strong>{finite(classPosition) && <small>P{classPosition} {t("standings.class").toLowerCase()}</small>}</div>
          <div className={`primary-race-number session-lap-number${hasWideLapCount ? " is-wide" : ""}`}><span>{t("liveDashboard.sessionLaps")}</span><strong><b>{currentLapLabel}</b><i>/</i><b>{estimatedTotalLapsLabel}</b></strong><small>{hasRealLapLimit ? t("liveDashboard.scheduledDistance") : t("liveDashboard.estimatedFromCleanPace")}</small></div>
        </div>
        <LapTiming player={player} playerCar={playerCar} averageLap={averageLap} />
        <div className={`race-flag-block ${activeFlag.tone}`}>
          <span>{t("liveDashboard.raceStatus")}</span><strong><Flag size={24} />{flag}</strong>
          <small>{activeFlag.detailKey ? t(activeFlag.detailKey) : session?.session_type || t("liveDashboard.liveSession")}</small>
        </div>
        <div className="compact-car-state" aria-label={t("telemetry.status")}>
          <div><span>{t("telemetry.speed")}</span><strong>{fmt(player?.speed_kph, 0)} <small>km/h</small></strong></div>
          <div><span>{t("telemetry.gear")}</span><strong>{player?.gear ?? "--"}</strong></div>
          <div className="compact-rpm"><i style={{ width: `${rpm}%` }} /></div>
          <small>{fmt(player?.rpm, 0)} rpm</small>
        </div>
      </div>
    </section>
  );
}

function LapTiming({ player, playerCar, averageLap }: { player?: PlayerState; playerCar?: CompetitorState; averageLap?: number }) {
  const t = useT();
  const delta = player?.delta_best;
  const direction = !finite(delta) || Math.abs(delta) < .01 ? "neutral" : delta < 0 ? "gain" : "loss";
  const DeltaIcon = direction === "gain" ? ArrowDown : direction === "loss" ? ArrowUp : ArrowRight;
  const deltaWidth = finite(delta) ? Math.min(100, Math.abs(delta) / 2 * 100) : 0;
  return (
    <div className="lap-now compact-lap-now">
      <div className="lap-now-main"><span>{t("liveDashboard.currentLap")}</span><strong>{lapTime(player?.current_lap_time)}</strong></div>
      <div className={`delta-now ${direction}`}><span>{t("liveDashboard.deltaBestValidLap")}</span><strong><DeltaIcon size={24} />{finite(delta) ? `${delta > 0 ? "+" : ""}${delta.toFixed(3)}` : t("common.noReference")}</strong><div className="delta-track"><i style={{ width: `${deltaWidth}%` }} /></div></div>
      <div className="lap-references"><span>{t("liveDashboard.best")} <b>{lapTime(player?.best_lap_time ?? playerCar?.best_lap_time)}</b></span><span>{t("liveDashboard.previous")} <b>{lapTime(player?.last_lap_time ?? playerCar?.last_lap_time)}</b></span><span>{t("liveDashboard.cleanAverage")} <b>{lapTime(averageLap)}</b></span>{player?.lap_invalidated && <em>{t("liveDashboard.lapInvalid")}</em>}</div>
    </div>
  );
}

type OpponentPaceHistory = Record<number, { laps: number[]; dirtyLaps: Set<number>; lastObservedLap?: number; lastPitstops?: number; lastCountLapFlag?: number; lastInvalidated?: boolean; lastUnderYellow?: boolean; wasInPits?: boolean }>;

function restorePaceHistory(sessionId?: string): OpponentPaceHistory {
  const stored = readStoredHistory(sessionId)?.paceHistory || {};
  return Object.fromEntries(Object.entries(stored).map(([id, row]) => [Number(id), { ...row, dirtyLaps: new Set(row.dirtyLaps) }]));
}

function useOpponentPaceHistory(cars: CompetitorState[], playerInvalidated: boolean, underYellow: boolean, sessionId?: string) {
  const history = useRef<OpponentPaceHistory>(restorePaceHistory(sessionId));
  const activeSession = useRef(sessionId);
  const [, setRevision] = useState(0);
  useEffect(() => {
    if (sessionId && activeSession.current !== sessionId) {
      history.current = restorePaceHistory(sessionId);
      activeSession.current = sessionId;
    }
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
    if (sessionId) {
      const serializable = Object.fromEntries(Object.entries(history.current).map(([id, row]) => [id, { ...row, dirtyLaps: [...row.dirtyLaps] }]));
      updateStoredHistory(sessionId, { paceHistory: serializable });
    }
  }, [cars, playerInvalidated, sessionId, underYellow]);
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
  const t = useT();
  const sessionId = telemetry?.session_id;
  const playerCar = mergedCars.find((car) => car.is_player);
  const playerClass = playerCar?.vehicle_class?.trim();
  const initialGridMode = readStoredHistory(sessionId)?.gridMode || "nearby";
  const [gridMode, setGridMode] = useState<"nearby" | "full">(initialGridMode);
  const [classFilter, setClassFilter] = useState(initialGridMode === "nearby" && playerClass ? playerClass : "all");
  const classFilterManuallyChanged = useRef(false);
  useEffect(() => {
    const mode = readStoredHistory(sessionId)?.gridMode || "nearby";
    classFilterManuallyChanged.current = false;
    setGridMode(mode);
    setClassFilter(mode === "nearby" && playerClass ? playerClass : "all");
  }, [sessionId]);
  useEffect(() => {
    if (!classFilterManuallyChanged.current) setClassFilter(gridMode === "nearby" && playerClass ? playerClass : "all");
  }, [gridMode, playerClass]);
  const changeGridMode = (mode: "nearby" | "full") => {
    classFilterManuallyChanged.current = false;
    setGridMode(mode);
    setClassFilter(mode === "nearby" && playerClass ? playerClass : "all");
    updateStoredHistory(sessionId, { gridMode: mode });
  };
  const playerPace3 = rollingPace(paceHistory, playerCar, 3);
  const playerPace7 = rollingPace(paceHistory, playerCar, 7);
  const classes = useMemo(() => [...new Set(mergedCars.map((car) => car.vehicle_class?.trim()).filter((value): value is string => Boolean(value)))].sort(), [mergedCars]);
  const calculatedClassPositions = useMemo(() => {
    const positions = new Map<number, number>();
    const grouped = new Map<string, CompetitorState[]>();
    mergedCars.forEach((car) => {
      const className = car.vehicle_class?.trim().toLocaleLowerCase();
      if (!className || !finite(car.position) || car.position < 1) return;
      grouped.set(className, [...(grouped.get(className) || []), car]);
    });
    grouped.forEach((cars) => {
      cars.sort((a, b) => (a.position as number) - (b.position as number)).forEach((car, index) => positions.set(car.vehicle_id, index + 1));
    });
    return positions;
  }, [mergedCars]);
  useEffect(() => {
    if (classFilter !== "all" && !classes.includes(classFilter)) setClassFilter("all");
  }, [classFilter, classes]);
  const rows = useMemo(() => {
    const sorted = mergedCars.filter((car) => classFilter === "all" || car.vehicle_class?.trim() === classFilter).sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
    const playerIndex = sorted.findIndex((car) => car.is_player);
    if (gridMode === "full") return sorted;
    return playerIndex < 0 ? sorted.slice(0, 13) : sorted.slice(Math.max(0, playerIndex - 6), playerIndex + 7);
  }, [classFilter, gridMode, mergedCars]);
  const currentLap = telemetry?.player?.lap_number ?? telemetry?.session?.current_lap;
  return (
    <section className="live-section nearby-card">
      <div className="live-section-heading"><div><span>{t("liveDashboard.raceOrder")}</span><h2>{gridMode === "full" ? t("liveDashboard.fullGrid") : t("liveDashboard.nearbyDrivers")}</h2></div><div className="control-row">{classes.length > 0 && <label className="live-class-filter"><span>{t("liveDashboard.classFilter")}</span><select value={classFilter} onChange={(event) => { classFilterManuallyChanged.current = true; setClassFilter(event.target.value); }}><option value="all">{t("standings.allClasses")}</option>{classes.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}<button type="button" className={gridMode === "nearby" ? "active-control" : ""} onClick={() => changeGridMode("nearby")}>{t("liveDashboard.nearby")}</button><button type="button" className={gridMode === "full" ? "active-control" : ""} onClick={() => changeGridMode("full")}>{t("liveDashboard.fullGrid")}</button><small>{gridMode === "full" ? t("common.drivers", { count: rows.length }) : t("liveDashboard.upToSix")}</small></div></div>
      {rows.length ? <div className="table-wrap"><table className="nearby-table"><thead><tr><th>{t("liveDashboard.pos")}</th><th>{t("liveDashboard.classPos")}</th><th>{t("liveDashboard.driverCar")}</th>{classes.length > 0 && <th>{t("standings.class")}</th>}<th>{t("liveDashboard.laps")}</th><th>{t("liveDashboard.lastLap")}</th><th>{t("liveDashboard.fastestLap")}</th><th>{t("liveDashboard.threeLapPace")}</th><th>{t("liveDashboard.sevenLapPace")}</th><th>{t("liveDashboard.deltaThreeVsYou")}</th><th>{t("liveDashboard.deltaSevenVsYou")}</th><th>{t("liveDashboard.pit")}</th></tr></thead><tbody>{rows.map((car) => {
        const pace3 = rollingPace(paceHistory, car, 3);
        const pace7 = rollingPace(paceHistory, car, 7);
        const delta3 = !car.is_player && finite(pace3) && finite(playerPace3) ? pace3 - playerPace3 : undefined;
        const delta7 = !car.is_player && finite(pace7) && finite(playerPace7) ? pace7 - playerPace7 : undefined;
        const driverPaceClass = finite(delta3) && delta3 > .05 ? "driver-pace-gain" : finite(delta3) && delta3 < -.05 ? "driver-pace-loss" : "";
        const recentlyPitted = finite(currentLap) && finite(car.last_pit_lap) && currentLap - car.last_pit_lap <= 2;
        return <tr key={car.vehicle_id} className={car.is_player ? "is-player" : ""}>
          <td><strong>P{car.position ?? "--"}</strong></td>
          <td><strong>{calculatedClassPositions.has(car.vehicle_id) ? `P${calculatedClassPositions.get(car.vehicle_id)}` : "--"}</strong></td>
          <td className={driverPaceClass} title={finite(delta3) ? delta3 > 0 ? t("liveDashboard.gainingThree") : t("liveDashboard.losingThree") : t("liveDashboard.threeUnavailable")}><div className="driver-cell"><strong>{car.is_player ? t("common.you") : car.driver_name || `${t("standings.car")} ${car.vehicle_id}`}</strong><small>{carName(car, t("liveDashboard.carUnavailable"))}</small></div></td>
          {classes.length > 0 && <td><span className="car-class-label">{car.vehicle_class?.trim() || "--"}</span></td>}
          <td>{car.total_laps ?? car.current_lap ?? "--"}</td>
          <td>{lapTime(car.last_lap_time)}</td>
          <td className="best-lap-column">{lapTime(car.best_lap_time)}</td>
          <td>{lapTime(pace3)}</td>
          <td>{lapTime(pace7)}</td>
          <td className="pace-delta-cell">{car.is_player ? t("liveDashboard.ref") : paceDeltaText(delta3)}</td>
          <td className="pace-delta-cell">{car.is_player ? t("liveDashboard.ref") : paceDeltaText(delta7)}</td>
          <td>{car.in_pits ? <span className="pit-pill active">PIT</span> : recentlyPitted ? <span className="pit-pill recent">{t("liveDashboard.out")}</span> : finite(car.pitstops) && car.pitstops > 0 ? <span className="pit-count">{t("common.stops", { count: car.pitstops })}</span> : "—"}</td>
        </tr>;
      })}</tbody></table></div> : <EmptyState label={t("liveDashboard.nearbyTimingAvailable")} />}
    </section>
  );
}

function InputsCard({ player }: { player?: PlayerState }) {
  const t = useT();
  const controls = [{ label: t("telemetry.throttle"), value: player?.throttle, colour: "#6ee7a8" }, { label: t("telemetry.brake"), value: player?.brake, colour: "#ff6f68" }];
  return <section className="status-card input-card"><CardTitle icon={Gauge} eyebrow={t("liveDashboard.control")} title={t("liveDashboard.inputs")} />
    <div className="input-gauges">{controls.map((control) => <div key={control.label}><div className="vertical-gauge"><i style={{ height: `${Math.max(0, Math.min(100, (control.value || 0) * 100))}%`, background: control.colour }} /></div><strong>{percent(control.value)}</strong><span>{control.label}</span></div>)}</div>
    {finite(player?.steering) && <div className="steering-line"><i style={{ left: `${50 + Math.max(-.5, Math.min(.5, player.steering)) * 100}%` }} /><span>{t("telemetry.steering")}</span></div>}
  </section>;
}

function heatColour(value?: number) {
  if (!finite(value)) return "#24313d";
  const hue = Math.max(0, Math.min(210, 210 - ((value - 30) / 100) * 210));
  return `hsl(${hue} 72% 48%)`;
}

function brakeHeatColour(value?: number) {
  if (!finite(value)) return "#24313d";
  if (value < 200) return "#2d78d6";
  if (value < 400) return "#24a7c7";
  if (value <= 600) return "#34a96b";
  if (value <= 700) return "#e6b450";
  if (value <= 800) return "#f28c3a";
  return "#e65353";
}

function TyreCard({ player }: { player?: PlayerState }) {
  const t = useT();
  const tyres = player?.tyre_state;
  const hasTyreData = tyreKeys.some((key) => finite(representativeTemp(tyres?.[`temp_${key}`])));
  const hasBrakeData = tyreKeys.some((key) => finite(player?.[brakeTempKeys[key]]));
  const rearBrakeBias = finite(player?.brake_bias_rear) ? Math.max(0, Math.min(1, Number(player?.brake_bias_rear))) : undefined;
  const frontBrakeBias = finite(rearBrakeBias) ? 1 - rearBrakeBias : undefined;
  const hasBrakeBalance = finite(rearBrakeBias);
  return <section className="status-card tyre-card"><CardTitle icon={Thermometer} eyebrow={t("liveDashboard.condition")} title={t("liveDashboard.tyres")} />
    {hasTyreData || hasBrakeData || hasBrakeBalance ? <div className="vehicle-tyres">{tyreKeys.map((key) => {
      const temp = tyres?.[`temp_${key}`] as TyreTemps | undefined;
      const surfaceZones = [temp?.left_c, temp?.center_c, temp?.right_c];
      const carcassTemp = temp?.carcass_c;
      const wear = tyres?.[`wear_${key}`] as number | undefined;
      const brakeTemp = player?.[brakeTempKeys[key]];
      return <div className={`visual-tyre tyre-${key}`} key={key}><header><strong>{tyreLabels[key]}</strong>{finite(wear) && <span>{percent(wear)} {t("liveDashboard.life")}</span>}</header><div className="surface-temperature">{surfaceZones.map((value, index) => <span key={index} style={{ background: heatColour(value) }}>{finite(value) ? Math.round(value) : "--"}°</span>)}</div><div className="carcass-temperature" style={{ background: heatColour(carcassTemp) }}><span>{t("liveDashboard.carcass")}</span><strong>{finite(carcassTemp) ? `${Math.round(carcassTemp)}°C` : "--"}</strong></div><footer style={{ background: brakeHeatColour(brakeTemp) }}><span>{t("telemetry.brake")}</span><strong>{finite(brakeTemp) ? `${Math.round(brakeTemp)}°C` : "--"}</strong></footer></div>;
    })}<div className="brake-balance" aria-label={t("liveDashboard.brakeBalance")}>
      <span>F</span>
      <strong>{finite(frontBrakeBias) ? `${(frontBrakeBias * 100).toFixed(1)}%` : "--"}</strong>
      <div className="brake-balance-scale" aria-hidden="true"><i style={{ height: `${(frontBrakeBias || 0) * 100}%` }} /><b style={{ height: `${(rearBrakeBias || 0) * 100}%` }} /></div>
      <strong>{finite(rearBrakeBias) ? `${(rearBrakeBias * 100).toFixed(1)}%` : "--"}</strong>
      <span>R</span>
      <small>{t("liveDashboard.brakeBalanceShort")}</small>
    </div></div> : <EmptyState label={t("liveDashboard.tyreTempsUnavailable")} compact />}
    {hasTyreData && <div className="heat-key"><span>{t("liveDashboard.cool")}</span><i /><span>{t("liveDashboard.hot")}</span></div>}
  </section>;
}

type EnvironmentSample = EnvironmentState & { sampledAt: number };

function useEnvironmentHistory(environment?: EnvironmentState, timestamp?: string, sessionId?: string) {
  const [samples, setSamples] = useState<EnvironmentSample[]>([]);
  const activeSession = useRef(sessionId);
  const lastSampleAt = useRef(0);

  useEffect(() => {
    if (activeSession.current !== sessionId) {
      activeSession.current = sessionId;
      lastSampleAt.current = 0;
      setSamples([]);
    }
    if (!environment) return;
    const sampleAt = Date.parse(timestamp || "") || Date.now();
    if (sampleAt - lastSampleAt.current < 5_000) return;
    lastSampleAt.current = sampleAt;
    setSamples((current) => [...current.filter((sample) => sampleAt - sample.sampledAt <= 60_000), { ...environment, sampledAt: sampleAt }].slice(-13));
  }, [environment, sessionId, timestamp]);

  return samples;
}

function gripLabel(t: (key: string) => string, value?: number) {
  if (!finite(value)) return "--";
  const level = Math.round(value);
  return level >= 0 && level <= 4 ? t(`liveDashboard.gripLevel${level}`) : fmt(value, 0);
}

function EnvironmentTrend({ direction }: { direction: EnvironmentTrendDirection }) {
  const t = useT();
  const Icon = direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : ArrowRight;
  const label = direction === "unavailable" ? t("liveDashboard.trendBuilding") : t(`liveDashboard.trend${direction[0].toUpperCase()}${direction.slice(1)}`);
  return <small className={`environment-trend ${direction}`}><Icon size={13} />{label}</small>;
}

function EnvironmentCard({ telemetry }: { telemetry: TelemetrySnapshot | null }) {
  const t = useT();
  const environment = telemetry?.connected ? telemetry.environment : undefined;
  const samples = useEnvironmentHistory(environment, telemetry?.timestamp, telemetry?.session_id);
  const wetnessState = trackWetnessState(environment?.avg_wetness);
  const metrics = [
    { key: "track_temp_c", label: t("liveDashboard.trackTemperature"), value: environment?.track_temp_c, display: fmt(environment?.track_temp_c, 1, "°C"), deadband: 0.1 },
    { key: "ambient_temp_c", label: t("liveDashboard.ambientTemperature"), value: environment?.ambient_temp_c, display: fmt(environment?.ambient_temp_c, 1, "°C"), deadband: 0.1 },
    { key: "track_grip", label: t("liveDashboard.trackGrip"), value: environment?.track_grip, display: gripLabel(t, environment?.track_grip), deadband: 0.05 },
    { key: "raining", label: t("liveDashboard.rainIntensity"), value: environment?.raining, display: finite(environment?.raining) ? `${Math.round(environment.raining * 100)}%` : "--", deadband: 0.01 },
  ] as const;
  const hasData = metrics.some((metric) => finite(metric.value));
  return <section className="status-card environment-card"><CardTitle icon={CloudRain} eyebrow={t("liveDashboard.conditions")} title={t("liveDashboard.trackWeather")} />
    {hasData ? <div className="environment-metrics">{metrics.map((metric) => {
      const direction = environmentTrendDirection(samples.map((sample) => sample[metric.key]), metric.deadband);
      return <div className="environment-metric" key={metric.key}><span>{metric.label}</span><strong>{metric.display}</strong><EnvironmentTrend direction={direction} /></div>;
    })}</div> : <EmptyState label={t("liveDashboard.environmentUnavailable")} compact />}
    {environment && <div className="wetness-summary"><div><span>{t("liveDashboard.averagePathWetness")}</span><strong>{wetnessState === "unavailable" ? "--" : t(`liveDashboard.wetness${wetnessState[0].toUpperCase()}${wetnessState.slice(1)}`)}</strong><small>{finite(environment.avg_wetness) ? `${Math.round(environment.avg_wetness * 100)}%` : "--"}</small></div><p><span><b>0.00–0.05</b>{t("liveDashboard.wetnessDry")}</span><span><b>0.05–0.20</b>{t("liveDashboard.wetnessSlightlyDamp")}</span><span><b>0.20–0.50</b>{t("liveDashboard.wetnessWet")}</span><span><b>0.50–0.80</b>{t("liveDashboard.wetnessVeryWet")}</span><span><b>0.80–1.00</b>{t("liveDashboard.wetnessSaturated")}</span></p></div>}
  </section>;
}

function HypercarEnergyCard({ player }: { player?: PlayerState }) {
  const t = useT();
  const hybrid = player?.hybrid_state;
  const batteryFraction = hybrid?.battery_charge_fraction ?? (finite(hybrid?.battery_percent) ? hybrid.battery_percent / 100 : undefined);
  const metrics = [
    { label: t("liveDashboard.batteryChargeFraction"), value: finite(batteryFraction) ? `${Math.round(batteryFraction * 100)}%` : "--" },
    { label: t("liveDashboard.stateOfCharge"), value: fmt(hybrid?.state_of_charge_percent ?? hybrid?.battery_percent, 1, "%") },
    { label: t("liveDashboard.regenerationPower"), value: fmt(hybrid?.regen_kw, 1, " kW") },
    { label: t("liveDashboard.boostMotorTorque"), value: fmt(hybrid?.motor_torque_nm, 1, " Nm") },
  ];
  return <section className="status-card energy-card"><CardTitle icon={BatteryCharging} eyebrow={t("liveDashboard.hybridSystem")} title={t("liveDashboard.energy")} />
    <div className="energy-metrics">{metrics.map((metric) => <div className="energy-metric" key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}</div>
  </section>;
}

function FuelCard({ telemetry, strategy }: { telemetry: TelemetrySnapshot | null; strategy: StrategyState | null }) {
  const t = useT();
  const player = telemetry?.player;
  const fuel = strategy?.fuel;
  const energy = strategy?.energy;
  const tyres = strategy?.tyres;
  const pitLap = strategy?.pit_window?.optimal_pit_lap ?? strategy?.stint?.recommended_stint_end_lap;
  const confidence = fuel?.confidence?.toLowerCase();
  const currentLap = player?.lap_number ?? telemetry?.session?.current_lap;
  const lapsToPit = finite(pitLap) && finite(currentLap) ? Math.max(0, pitLap - currentLap) : undefined;
  const fuelAtPit = finite(player?.fuel_liters) && finite(fuel?.fuel_per_lap_liters) && finite(lapsToPit) ? Math.max(0, player.fuel_liters - fuel.fuel_per_lap_liters * lapsToPit) : undefined;
  const energyAtPit = finite(energy?.current_virtual_energy_fraction) && finite(energy?.virtual_energy_per_lap) && finite(lapsToPit) ? Math.max(0, energy.current_virtual_energy_fraction - energy.virtual_energy_per_lap * lapsToPit) : undefined;
  const wearAtPit = finite(tyres?.average_wear) && finite(tyres?.wear_rate_per_lap) && finite(lapsToPit) ? Math.min(1, tyres.average_wear + tyres.wear_rate_per_lap * lapsToPit) : undefined;
  const fuelLimit = strategy?.stint?.fuel_limited_stint_end_lap;
  const energyLimit = strategy?.stint?.virtual_energy_limited_stint_end_lap;
  const tyreLimit = strategy?.stint?.tyre_limited_stint_end_lap;
  const limits = [{ value: energyLimit, label: t("liveDashboard.energyLimited") }, { value: fuelLimit, label: t("liveDashboard.fuelLimited") }, { value: tyreLimit, label: t("liveDashboard.tyreLimited") }].filter((item) => finite(item.value)).sort((a, b) => Number(a.value) - Number(b.value));
  const trigger = limits.length > 1 && Math.abs(Number(limits[0].value) - Number(limits[1].value)) <= 1 ? `${limits[0].label} + ${limits[1].label}` : limits[0]?.label ?? t("liveDashboard.buildingEstimate");
  const maximumLaps = telemetry?.session?.max_laps;
  const validFinishLap = finite(maximumLaps) && maximumLaps > 0 && maximumLaps < 10_000 ? maximumLaps : finite(currentLap) && finite(fuel?.estimated_laps_remaining) ? currentLap + Math.ceil(fuel.estimated_laps_remaining) : undefined;
  const noStopNeeded = finite(pitLap) && finite(validFinishLap) ? pitLap >= validFinishLap : !finite(pitLap) && finite(fuel?.fuel_delta_to_finish) && fuel.fuel_delta_to_finish >= 0;
  const projectedCornerWear = (key: typeof tyreKeys[number]) => {
    const current = player?.tyre_state?.[`wear_${key}`] as number | undefined;
    return finite(current) && finite(tyres?.wear_rate_per_lap) && finite(lapsToPit) ? Math.min(1, current + tyres.wear_rate_per_lap * lapsToPit) : undefined;
  };
  return <section className="status-card fuel-card"><CardTitle icon={Fuel} eyebrow={t("liveDashboard.strategy")} title={t("liveDashboard.fuelPit")} />
    <div className="strategy-live-values"><div className="fuel-primary"><strong>{fmt(player?.fuel_liters, 1)}</strong><span>{t("liveDashboard.litresNow")}</span></div><div><span>{t("liveDashboard.virtualEnergy")}</span><strong>{finite(energy?.current_virtual_energy_fraction) ? percent(energy.current_virtual_energy_fraction) : "--"}</strong></div><div><span>{t("liveDashboard.fuelEnergyRatio")}</span><strong>{finite(energy?.fuel_to_virtual_energy_ratio) ? energy.fuel_to_virtual_energy_ratio.toFixed(2) : "--"}</strong></div></div>
    <div className="resource-rates"><span>{t("liveDashboard.fuelUseShort")} <b>{fmt(fuel?.fuel_per_lap_liters, 2, " L/lap")}</b></span><span>{t("liveDashboard.energyUseShort")} <b>{finite(energy?.virtual_energy_per_lap) ? percent(energy.virtual_energy_per_lap) : "--"} / {t("telemetry.lap").toLowerCase()}</b></span></div>
    <div className={`pit-call ${noStopNeeded ? "safe" : finite(pitLap) ? "action" : "unknown"}`}><span>{noStopNeeded ? t("liveDashboard.noStopRequired") : finite(pitLap) ? t("liveDashboard.estimatedPitLap") : t("liveDashboard.pitEstimate")}</span><strong>{noStopNeeded ? t("liveDashboard.runToFinish") : finite(pitLap) ? t("liveDashboard.lapWithTrigger", { lap: Math.round(pitLap), trigger }) : t("liveDashboard.needMoreCleanLaps")}</strong></div>
    {finite(lapsToPit) && !noStopNeeded && <div className="stint-projection"><div className="projection-axis"><span>{t("liveDashboard.nowLap", { lap: currentLap ?? "--" })}</span><i><b style={{ width: "100%" }} /></i><span>{t("liveDashboard.pitLapShort", { lap: pitLap ?? "--" })}</span></div><div className="projection-values"><div><span>{t("liveDashboard.fuelAtStop")}</span><strong>{fmt(fuelAtPit, 1, " L")}</strong><small>{t("liveDashboard.fromRate", { rate: fmt(fuel?.fuel_per_lap_liters, 2, " L/lap") })}</small></div><div><span>{t("liveDashboard.energyAtStop")}</span><strong>{finite(energyAtPit) ? percent(energyAtPit) : "--"}</strong><small>{t("liveDashboard.refillToFull")}</small></div><div><span>{t("liveDashboard.tyreWearAtStop")}</span><strong>{finite(wearAtPit) ? percent(wearAtPit) : "--"}</strong><small>+{finite(tyres?.wear_rate_per_lap) ? percent(tyres.wear_rate_per_lap) : "--"} / {t("telemetry.lap").toLowerCase()}</small></div></div></div>}
    {finite(lapsToPit) && !noStopNeeded && <div className="projected-corner-wear">{tyreKeys.map((key) => <span key={key}><b>{tyreLabels[key]}</b>{percent(projectedCornerWear(key))}</span>)}</div>}
    <small className={`confidence ${confidence || "low"}`}>{t("liveDashboard.confidenceSummary", { fuelConfidence: t(`common.${confidence || "low"}`), tyreConfidence: t(`common.${tyres?.confidence || "low"}`), range: finite(fuel?.fuel_laps_remaining) ? t("liveDashboard.fuelRange", { laps: fuel.fuel_laps_remaining.toFixed(1) }) : t("liveDashboard.rangeUnavailable") })}</small>
  </section>;
}

function AlertsCard({ telemetry, recommendation }: { telemetry: TelemetrySnapshot | null; recommendation: RecommendationPayload | null }) {
  const t = useT();
  const player = telemetry?.player;
  const penalties = telemetry?.competitors.find((car) => car.is_player)?.penalties;
  const caution = displayFlag(t, telemetry?.session?.yellow_flag_state);
  const alerts = [
    caution && !caution.toLowerCase().includes("green") ? caution : undefined,
    finite(penalties) && penalties > 0 ? t("liveDashboard.activePenalties", { count: penalties }) : undefined,
    player?.lap_invalidated ? t("liveDashboard.currentLapInvalid") : undefined,
    recommendation?.current?.priority === "critical" || recommendation?.current?.priority === "high" ? recommendation.current.title : undefined,
  ].filter(Boolean) as string[];
  if (!alerts.length) return null;
  return <section className="status-card alert-card"><CardTitle icon={AlertTriangle} eyebrow={t("liveDashboard.attention")} title={t("liveDashboard.raceAlerts")} /><div className="alert-list">{alerts.map((alert) => <span key={alert}><AlertTriangle size={15} />{alert}</span>)}</div></section>;
}

function CardTitle({ icon: Icon, eyebrow, title }: { icon: typeof Gauge; eyebrow: string; title: string }) {
  return <div className="status-title"><Icon size={18} /><div><span>{eyebrow}</span><h3>{title}</h3></div></div>;
}

function EmptyState({ label, compact = false }: { label: string; compact?: boolean }) {
  return <div className={`live-empty ${compact ? "compact" : ""}`}><CircleGauge size={20} /><span>{label}</span></div>;
}

function LapInputComparison({ history, trackLength }: { history: LapInputHistory; trackLength?: number }) {
  const t = useT();
  const completeTraces = useMemo(() => history.completed.filter((trace) => isCompleteLapInputTrace(trace, trackLength)), [history.completed, trackLength]);
  const last = completeTraces[completeTraces.length - 1];
  const best = bestLapInputTrace(completeTraces);
  const series = useMemo(() => [
    { id: "best", label: t("liveDashboard.bestLap"), colour: "#6ee7a8", trace: best },
    { id: "last", label: t("liveDashboard.lastLapTrace"), colour: "#55c7f7", trace: last },
    { id: "current", label: t("liveDashboard.currentLapLive"), colour: "#f3b642", trace: history.current },
  ], [best, history.current, last, t]);
  const data = useMemo(() => buildLapInputChartData(series, trackLength), [series, trackLength]);
  return <section className="trend-card input-comparison-card">
    <div className="live-section-heading input-comparison-heading"><div><span>{t("liveDashboard.drivingInputs")}</span><h2>{t("liveDashboard.lapInputComparison")}</h2></div><div className="input-trace-legend">{series.map((item) => <span className={item.trace ? "available" : "unavailable"} key={item.id} style={{ "--trace-colour": item.colour } as React.CSSProperties}><i />{item.label}{item.trace && <small>L{item.trace.lap}</small>}</span>)}</div></div>
    <div className="input-channel-key"><span className="solid"><i />{t("telemetry.throttle")}</span><span className="dashed"><i />{t("telemetry.brake")}</span><small>{t("liveDashboard.lapDistance")}</small></div>
    {data.length > 1 ? <ResponsiveContainer width="100%" height={280}><LineChart data={data} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 4" vertical={false} />
      <XAxis type="number" dataKey="progress" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(value) => `${value}%`} tickLine={false} />
      <YAxis domain={[0, 1]} ticks={[0, .5, 1]} width={44} tickFormatter={(value) => `${Math.round(value * 100)}%`} tickLine={false} />
      <Tooltip labelFormatter={(value) => `${t("liveDashboard.lapDistance")} ${Number(value).toFixed(1)}%`} formatter={(value: number, name: string) => [`${Math.round(value * 100)}%`, name]} />
      {series.flatMap((item) => [
        <Line key={`${item.id}-throttle`} type="linear" dataKey={`${item.id}Throttle`} name={`${item.label} · ${t("telemetry.throttle")}`} stroke={item.colour} strokeWidth={2.4} dot={false} connectNulls isAnimationActive={false} />,
        <Line key={`${item.id}-brake`} type="linear" dataKey={`${item.id}Brake`} name={`${item.label} · ${t("telemetry.brake")}`} stroke={item.colour} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} />,
      ])}
    </LineChart></ResponsiveContainer> : <EmptyState label={t("liveDashboard.inputTraceWaiting")} compact />}
  </section>;
}

const TrendChart = memo(function TrendChart({ title, eyebrow, data, lines, averageLine, invert = false, formatter }: { title: string; eyebrow: string; data: Record<string, unknown>[]; lines: { key: string; label: string; colour: string }[]; averageLine?: number; invert?: boolean; formatter?: (value: number) => string }) {
  const t = useT();
  return <section className="trend-card"><div className="live-section-heading"><div><span>{eyebrow}</span><h3>{title}</h3></div></div>{data.length > 0 ? <ResponsiveContainer width="100%" height={230}><LineChart data={data} margin={{ top: 6, right: 10, left: 4, bottom: 0 }}><CartesianGrid strokeDasharray="3 4" vertical={false} /><XAxis dataKey="lap" tickLine={false} /><YAxis width={72} tickMargin={8} reversed={invert} tickLine={false} tickFormatter={formatter} domain={["auto", "auto"]} /><Tooltip formatter={(value: number, name: string) => [formatter ? formatter(value) : fmt(value, 2), name]} /><Legend />{finite(averageLine) && <ReferenceLine y={averageLine} stroke="#edf4f8" strokeDasharray="5 5" label={t("liveDashboard.average")} />}{lines.map((line) => <Line key={line.key} type="monotone" dataKey={line.key} name={line.label} stroke={line.colour} strokeWidth={2.3} dot={{ r: 2 }} connectNulls />)}</LineChart></ResponsiveContainer> : <EmptyState label={t("common.waitingLiveTelemetry")} />}</section>;
});

function RacePositionChart({ positions, competitors }: { positions: PositionRow[]; competitors: CompetitorState[] }) {
  const t = useT();
  const [focus, setFocus] = useState("player");
  const drivers = useMemo(() => {
    const keys = new Set<string>(); positions.forEach((row) => Object.keys(row).filter((key) => key !== "lap").forEach((key) => keys.add(key)));
    return [...keys];
  }, [positions]);
  const player = competitors.find((car) => car.is_player);
  const playerKey = drivers.find((key) => key.endsWith(`#${player?.vehicle_id}`));
  return <section className="trend-card position-chart"><div className="live-section-heading"><div><span>{t("liveDashboard.raceEvolution")}</span><h3>{t("liveDashboard.positionHistory")}</h3></div>{drivers.length > 1 && <select value={focus} onChange={(event) => setFocus(event.target.value)}><option value="player">{t("liveDashboard.focusCurrentDriver")}</option><option value="all">{t("liveDashboard.showAllDrivers")}</option>{drivers.map((driver) => <option value={driver} key={driver}>{driver.split("#")[0]}</option>)}</select>}</div>
    {positions.length > 0 ? <ResponsiveContainer width="100%" height={310}><LineChart data={positions} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}><CartesianGrid strokeDasharray="3 4" vertical={false} /><XAxis dataKey="lap" tickLine={false} /><YAxis width={44} tickMargin={8} reversed domain={[1, "dataMax"]} allowDecimals={false} tickLine={false} /><Tooltip /><Legend formatter={(value) => String(value).split("#")[0]} />{drivers.map((driver, index) => {
      const selected = focus === "all" || focus === driver || (focus === "player" && driver === playerKey);
      return <Line key={driver} type="linear" dataKey={driver} name={driver.split("#")[0]} stroke={driver === playerKey ? "#f3b642" : `hsl(${(index * 47) % 360} 62% 62%)`} strokeWidth={driver === playerKey ? 3.5 : selected ? 2 : 1} strokeOpacity={selected ? 1 : .18} dot={false} connectNulls />;
    })}</LineChart></ResponsiveContainer> : <EmptyState label={t("liveDashboard.positionHistoryBuilds")} />}
  </section>;
}

function LiveGraphs({ laps, positions, competitors }: { laps: LapSample[]; positions: PositionRow[]; competitors: CompetitorState[] }) {
  const t = useT();
  const fuelAverage = average(laps.filter((row) => !row.provisional).map((row) => row.fuelUsed).filter(finite));
  const fuelData = laps.map((row) => ({ ...row, average: fuelAverage }));
  return <section className="live-trends"><div className="live-section-heading trends-heading"><div><span>{t("liveDashboard.stintAnalysis")}</span><h2>{t("liveDashboard.raceEvolution")}</h2></div><small>{t("liveDashboard.liveLapCompleted")}</small></div><div className="trend-grid">
    <TrendChart eyebrow={t("liveDashboard.consumption")} title={t("liveDashboard.fuelUsage")} data={fuelData} lines={[{ key: "fuelUsed", label: t("liveDashboard.fuelPerLap"), colour: "#55c7f7" }]} averageLine={fuelAverage} formatter={(value) => `${value.toFixed(2)} L`} />
    <TrendChart eyebrow={t("liveDashboard.degradation")} title={t("liveDashboard.tyreCondition")} data={laps} lines={tyreKeys.map((key) => ({ key: `${key}Wear`, label: tyreLabels[key], colour: tyreColours[key] }))} formatter={(value) => `${Math.round(value * 100)}%`} />
    <TrendChart eyebrow={t("liveDashboard.pace")} title={t("liveDashboard.lapTimeTrend")} data={laps} lines={[{ key: "lapTime", label: t("telemetry.lap"), colour: "#f3b642" }]} formatter={(value) => formatRaceTime(value)} />
    <TrendChart eyebrow={t("liveDashboard.thermalState")} title={t("liveDashboard.tyreTemperatures")} data={laps} lines={tyreKeys.map((key) => ({ key: `${key}Temp`, label: tyreLabels[key], colour: tyreColours[key] }))} formatter={(value) => `${Math.round(value)}°`} />
    <TrendChart eyebrow={t("liveDashboard.thermalState")} title={t("liveDashboard.engineTemperatures")} data={laps} lines={[{ key: "oilTemp", label: t("liveDashboard.oilTemperature"), colour: "#f3b642" }, { key: "waterTemp", label: t("liveDashboard.waterTemperature"), colour: "#55c7f7" }]} formatter={(value) => `${Math.round(value)}°C`} />
    <RacePositionChart positions={positions} competitors={competitors} />
  </div></section>;
}

export function LiveDashboard({ telemetry, strategy, recommendation, connected, competitors = [] }: { telemetry: TelemetrySnapshot | null; strategy: StrategyState | null; recommendation: RecommendationPayload | null; connected: boolean; readOnlyLabel?: string; competitors?: CompetitorState[] }) {
  const { laps, positions, liveLap, livePosition } = useLiveRaceHistory(telemetry, strategy);
  const lapInputHistory = useLapInputHistory(telemetry);
  const graphLaps = liveLap ? [...laps.filter((row) => row.lap !== liveLap.lap), liveLap].sort((a, b) => a.lap - b.lap) : laps;
  const graphPositions = livePosition ? [...positions.filter((row) => row.lap !== livePosition.lap), livePosition].sort((a, b) => a.lap - b.lap) : positions;
  const mergedCompetitors = useMemo(() => {
    const merged = new Map(competitors.map((car) => [car.vehicle_id, car]));
    telemetry?.competitors?.forEach((car) => merged.set(car.vehicle_id, car));
    return [...merged.values()];
  }, [competitors, telemetry?.competitors]);
  const paceHistory = useOpponentPaceHistory(mergedCompetitors, Boolean(telemetry?.player?.lap_invalidated), isUnderYellow(telemetry), telemetry?.session_id);
  const playerCar = mergedCompetitors.find((car) => car.is_player);
  const playerClass = telemetry?.player?.vehicle_class || playerCar?.vehicle_class || "";
  const isHypercar = isHypercarClass(playerClass);
  const observedAverage = cleanAveragePace(paceHistory, playerCar);
  const averageLap = observedAverage ?? ((strategy?.pace?.sample_laps ?? 0) > 0 ? strategy?.pace?.weighted_recent_pace : undefined);
  return <div className="page live-dashboard">
    <RaceHeader telemetry={telemetry} connected={connected} averageLap={averageLap} />
    <NearbyStandings mergedCars={mergedCompetitors} paceHistory={paceHistory} telemetry={telemetry} />
    <div className={`live-status-row ${isHypercar ? "has-hybrid" : ""}`}>
      <InputsCard player={telemetry?.player} />
      {isHypercar && <HypercarEnergyCard player={telemetry?.player} />}
      <TyreCard player={telemetry?.player} />
      <EnvironmentCard telemetry={telemetry} />
      <FuelCard telemetry={telemetry} strategy={strategy} />
      <AlertsCard telemetry={telemetry} recommendation={recommendation} />
    </div>
    <LapInputComparison history={lapInputHistory} trackLength={telemetry?.session?.track_length_m} />
    <LiveGraphs laps={graphLaps} positions={graphPositions} competitors={mergedCompetitors} />
  </div>;
}




