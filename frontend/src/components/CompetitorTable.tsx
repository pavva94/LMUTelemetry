import { useMemo, useState } from "react";
import { formatRaceGap, formatRaceTime } from "../lib/timeFormat";
import type { CompetitorState } from "../types/telemetry";
import { StatusBadge } from "./StatusBadge";

type SortDirection = "asc" | "desc";

function valueFor(car: CompetitorState, key: keyof CompetitorState) {
  const value = car[key];
  if (typeof value === "string") return value.toLowerCase();
  if (typeof value === "boolean") return value ? 1 : 0;
  return value ?? Number.POSITIVE_INFINITY;
}

export function CompetitorTable({ competitors }: { competitors: CompetitorState[] }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<keyof CompetitorState>("position");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...competitors]
      .filter((car) => !needle || `${car.driver_name} ${car.vehicle_name} ${car.vehicle_class}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        const av = valueFor(a, sortKey);
        const bv = valueFor(b, sortKey);
        if (av < bv) return direction === "asc" ? -1 : 1;
        if (av > bv) return direction === "asc" ? 1 : -1;
        return 0;
      });
  }, [competitors, direction, query, sortKey]);
  const sort = (key: keyof CompetitorState) => {
    if (sortKey === key) {
      setDirection((current) => current === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setDirection("asc");
    }
  };
  const head = (label: string, key: keyof CompetitorState) => (
    <button className="table-sort" onClick={() => sort(key)}>{label}{sortKey === key ? ` ${direction === "asc" ? "up" : "down"}` : ""}</button>
  );
  return (
    <section className="card span-12">
      <div className="row" style={{ alignItems: "end" }}>
        <h2>Competitors</h2>
        <input style={{ maxWidth: 280 }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search cars" />
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{head("Pos", "position")}</th><th>{head("Driver", "driver_name")}</th><th>{head("Car", "vehicle_name")}</th><th>{head("Class", "vehicle_class")}</th><th>{head("Last", "last_lap_time")}</th><th>{head("Best", "best_lap_time")}</th><th>{head("Gap", "time_behind_next")}</th><th>{head("Stops", "pitstops")}</th><th>{head("Pits", "in_pits")}</th><th>{head("Strategy", "estimated_strategy_group")}</th><th>{head("Threat", "threat_level")}</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.vehicle_id}>
                <td>{c.position}</td><td>{c.driver_name || (c.is_player ? "Player" : "--")}</td><td>{c.vehicle_name || "--"}</td><td>{c.vehicle_class || "--"}</td>
                <td>{formatRaceTime(c.last_lap_time)}</td><td>{formatRaceTime(c.best_lap_time)}</td><td>{formatRaceGap(c.time_behind_next)}</td><td>{c.pitstops ?? "--"}</td>
                <td>{c.in_pits ? "Yes" : "No"}</td><td>{c.estimated_strategy_group || "UNKNOWN"} estimated</td><td><StatusBadge value={c.threat_level} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
