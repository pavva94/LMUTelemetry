import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";
import { formatRaceTime } from "../lib/timeFormat";
import type { CompetitorState } from "../types/telemetry";
import { SectionTitle } from "./SectionTitle";

type SortDirection = "asc" | "desc";

const UNCLASSIFIED_CLASS = "__unclassified__";

function classKey(car: CompetitorState) {
  return car.vehicle_class || UNCLASSIFIED_CLASS;
}

function validLapTime(value?: number | null): value is number {
  return value != null && Number.isFinite(value) && value > 20;
}

function valueFor(car: CompetitorState, key: keyof CompetitorState) {
  const value = car[key];
  if (typeof value === "string") return value.toLowerCase();
  if (typeof value === "boolean") return value ? 1 : 0;
  return value ?? Number.POSITIVE_INFINITY;
}

function paceState(car: CompetitorState) {
  if (car.last_lap_time == null || car.best_lap_time == null) return { label: "No reference", kind: "neutral", Icon: ArrowRight };
  const loss = car.last_lap_time - car.best_lap_time;
  if (loss <= .35) return { label: "On pace", kind: "gain", Icon: ArrowUp };
  if (loss >= 1.5) return { label: `+${loss.toFixed(1)}s`, kind: "loss", Icon: ArrowDown };
  return { label: "Stable", kind: "neutral", Icon: ArrowRight };
}

export function CompetitorTable({ competitors }: { competitors: CompetitorState[] }) {
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [sortKey, setSortKey] = useState<keyof CompetitorState>("position");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const classes = useMemo(() => [...new Set(competitors.map((car) => car.vehicle_class).filter((value): value is string => Boolean(value)))].sort(), [competitors]);
  const fastestLapByClass = useMemo(() => {
    const fastest = new Map<string, number>();
    competitors.forEach((car) => {
      if (!validLapTime(car.best_lap_time)) return;
      const key = classKey(car);
      const current = fastest.get(key);
      if (current == null || car.best_lap_time < current) fastest.set(key, car.best_lap_time);
    });
    return fastest;
  }, [competitors]);
  const currentLap = Math.max(0, ...competitors.map((car) => car.total_laps ?? car.current_lap ?? 0));
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...competitors]
      .filter((car) => classFilter === "all" || car.vehicle_class === classFilter)
      .filter((car) => !needle || `${car.driver_name} ${car.vehicle_model} ${car.vehicle_name} ${car.vehicle_class}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        const av = valueFor(a, sortKey); const bv = valueFor(b, sortKey);
        if (av < bv) return direction === "asc" ? -1 : 1;
        if (av > bv) return direction === "asc" ? 1 : -1;
        return 0;
      });
  }, [classFilter, competitors, direction, query, sortKey]);
  const sort = (key: keyof CompetitorState) => {
    if (sortKey === key) setDirection((current) => current === "asc" ? "desc" : "asc");
    else { setSortKey(key); setDirection("asc"); }
  };
  const head = (label: string, key: keyof CompetitorState) => <button className="table-sort" onClick={() => sort(key)}>{label}{sortKey === key ? ` ${direction === "asc" ? "↑" : "↓"}` : ""}</button>;
  return <section className="card span-12 standings-table-card">
    <div className="section-toolbar">
      <SectionTitle title="Full Session Standings" help="Complete classification, pace, gaps, and pit impact for every driver in the active session." />
      <div className="standings-controls"><label><span>Class</span><select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}><option value="all">All classes</option>{classes.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label><span>Find driver</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Driver or car" /></label></div>
    </div>
    <div className="table-wrap"><table className="standings-table"><thead><tr><th>{head("Pos", "position")}</th><th>{head("Driver / car", "driver_name")}</th><th>{head("Class", "vehicle_class")}</th><th>{head("Laps", "total_laps")}</th><th>{head("Gap / interval", "time_behind_leader")}</th><th>{head("Best", "best_lap_time")}</th><th>{head("Recent pace", "last_lap_time")}</th><th>Pace state</th><th>{head("Stops", "pitstops")}</th><th>Pit impact</th></tr></thead><tbody>{rows.map((car) => {
      const pace = paceState(car); const recentlyPitted = car.last_pit_lap != null && currentLap - car.last_pit_lap <= 2;
      const classFastest = fastestLapByClass.get(classKey(car));
      const isClassFastest = validLapTime(car.best_lap_time) && classFastest != null && car.best_lap_time === classFastest;
      return <tr key={car.vehicle_id} className={car.is_player ? "standings-player" : ""}>
        <td><strong>P{car.position ?? "--"}</strong></td>
        <td><div className="driver-cell"><strong>{car.is_player ? `${car.driver_name || "Player"} · You` : car.driver_name || `Car ${car.vehicle_id}`}</strong><small>{car.vehicle_model || car.vehicle_name || "Car unavailable"}</small></div></td>
        <td>{car.vehicle_class || "--"}</td><td>{car.total_laps ?? car.current_lap ?? "--"}</td>
        <td className="gap-cell">{car.position === 1 ? "Leader" : car.time_behind_leader != null ? `+${car.time_behind_leader.toFixed(1)}s` : car.time_behind_next != null ? `+${car.time_behind_next.toFixed(1)}s int` : car.gap_to_player != null ? `${car.gap_to_player > 0 ? "+" : ""}${car.gap_to_player.toFixed(1)}s to you` : "--"}</td>
        <td className={`best-lap-column ${isClassFastest ? "class-fastest-lap" : ""}`} title={isClassFastest ? `Fastest ${car.vehicle_class || "unclassified"} lap` : undefined}>{formatRaceTime(car.best_lap_time)}</td><td>{formatRaceTime(car.last_lap_time ?? car.estimated_lap_time)}</td>
        <td><span className={`trend-pill ${pace.kind}`}><pace.Icon size={13} />{pace.label}</span></td>
        <td>{car.pitstops ?? "--"}</td><td>{car.in_pits ? <span className="pit-pill active">In pits</span> : recentlyPitted ? <span className="pit-pill recent">Recently pitted</span> : car.pit_state || "On track"}</td>
      </tr>;
    })}</tbody></table></div>
  </section>;
}
