import { useEffect, useState } from "react";
import { api } from "../api/client";
import { formatRaceTime } from "../lib/timeFormat";
import type { ProfileLap, ProfileSummary } from "../types/profile";

const fmt = (value?: number | null, digits = 1, suffix = "") =>
  value == null || Number.isNaN(value) ? "--" : `${value.toFixed(digits)}${suffix}`;
const text = (value?: string | number | boolean | null) => (value == null || value === "" ? "--" : String(value));
const dateText = (value?: string | null) => value ? new Date(value).toLocaleString() : "--";

function Metric({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return <div className="metric compact"><span className="label">{label}</span><span className="value">{value}</span>{sub && <span className="subvalue">{sub}</span>}</div>;
}

function Empty({ detail = "No historical telemetry found yet." }: { detail?: string }) {
  return <div className="empty-state"><strong>No data</strong><span>{detail}</span></div>;
}

function SortButton({ label, field, sort, direction, onSort }: { label: string; field: string; sort: string; direction: string; onSort: (field: string) => void }) {
  return <button className="table-sort" onClick={() => onSort(field)}>{label}{sort === field ? ` ${direction === "asc" ? "up" : "down"}` : ""}</button>;
}

export function UserProfile() {
  const [summary, setSummary] = useState<ProfileSummary | null>(null);
  const [bestLaps, setBestLaps] = useState<ProfileLap[]>([]);
  const [sort, setSort] = useState("date");
  const [direction, setDirection] = useState("desc");
  const [error, setError] = useState("");

  useEffect(() => {
    api.profileOverview()
      .then((overview) => {
        setSummary(overview.summary);
        setBestLaps(overview.best_laps);
        setError("");
      })
      .catch((exc) => setError(exc instanceof Error ? exc.message : String(exc)));
  }, []);

  const totals = summary?.totals || {};
  const onSort = (field: string) => {
    if (sort === field) setDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSort(field);
      setDirection(field === "lap_time" ? "asc" : "desc");
    }
  };

  return (
    <div className="page grid">
      {error && <section className="card span-12"><div className="error-box">{error}</div></section>}
      <section className="card span-12">
        <h2>Career Overview</h2>
        <div className="header-grid">
          <Metric label="Distance" value={fmt(totals.total_distance_km as number, 1, " km")} />
          <Metric label="Sessions" value={text(totals.total_sessions as number)} sub={`${text(totals.live_sessions as number)} live / ${text(totals.csv_sessions as number)} csv`} />
          <Metric label="Laps" value={text(totals.total_laps as number)} sub={`${text(totals.valid_laps as number)} valid`} />
          <Metric label="Driving time" value={formatRaceTime(totals.total_driving_time as number)} />
          <Metric label="Cars" value={text(totals.different_cars as number)} />
          <Metric label="Tracks" value={text(totals.different_tracks as number)} />
          <Metric label="Avg session" value={formatRaceTime(totals.average_session_duration as number)} />
          <Metric label="Avg distance" value={fmt(totals.average_distance_per_session as number, 1, " km")} />
          <Metric label="Avg laps" value={fmt(totals.average_laps_per_session as number, 1)} />
          <Metric label="Wins" value={text(totals.wins as number)} />
          <Metric label="Podiums" value={text(totals.podiums as number)} />
          <Metric label="Top 10" value={text(totals.top10 as number)} />
          <Metric label="DNF/DNS/DQ" value={text(totals.dnf_dns as number)} />
          <Metric label="Best-lap records" value={text(totals.best_lap_count as number)} />
        </div>
      </section>

      <section className="card span-4"><h2>Distance By Class</h2><SimpleTable rows={summary?.distance_by_class || []} columns={["car_class", "distance_km", "sessions", "laps", "distance_percent"]} /></section>
      <section className="card span-4"><h2>Most Used Cars</h2><SimpleTable rows={summary?.top_cars || []} columns={["car", "car_class", "distance_km", "sessions", "laps", "tracks"]} /></section>
      <section className="card span-4"><h2>Most Driven Tracks</h2><SimpleTable rows={summary?.top_tracks || []} columns={["track", "layout", "distance_km", "sessions", "laps", "best_lap", "most_used_car"]} /></section>

      <section className="card span-12">
        <h2>Best Laps</h2>
        {bestLaps.length ? <LapTable rows={bestLaps} compact sort={sort} direction={direction} onSort={onSort} /> : <Empty detail="Best laps appear once live or CSV laps are stored." />}
      </section>
    </div>
  );
}

function SimpleTable({ rows, columns }: { rows: Array<Record<string, unknown>>; columns: string[] }) {
  if (!rows.length) return <Empty />;
  return <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{column.replace(/_/g, " ")}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{formatCell(column, row[column])}</td>)}</tr>)}</tbody></table></div>;
}

function LapTable({
  rows,
  compact = false,
  sort,
  direction,
  onSort,
}: {
  rows: ProfileLap[];
  compact?: boolean;
  sort: string;
  direction: string;
  onSort: (field: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th><SortButton label="Date" field="date" sort={sort} direction={direction} onSort={onSort} /></th>
            <th>Session</th>
            <th><SortButton label="Track" field="track" sort={sort} direction={direction} onSort={onSort} /></th>
            <th>Layout</th>
            <th><SortButton label="Car" field="car" sort={sort} direction={direction} onSort={onSort} /></th>
            <th>Class</th>
            <th>Lap</th>
            <th><SortButton label="Lap time" field="lap_time" sort={sort} direction={direction} onSort={onSort} /></th>
            <th>Valid</th>
            <th><SortButton label="Fuel" field="fuel" sort={sort} direction={direction} onSort={onSort} /></th>
            <th>Fuel used</th>
            <th><SortButton label="Tyre wear" field="tyre_wear" sort={sort} direction={direction} onSort={onSort} /></th>
            <th>Tyre pressure</th>
            {!compact && <th>Brake temp</th>}
            <th><SortButton label="Track temp" field="track_temp" sort={sort} direction={direction} onSort={onSort} /></th>
            <th>Ambient</th>
            <th>Oil / Water</th>
            <th>Max / Avg speed</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((lap) => (
            <tr key={lap.id}>
              <td>{dateText(lap.date)}</td>
              <td>{text(lap.session_name)}</td>
              <td>{text(lap.track)}</td>
              <td>{text(lap.layout)}</td>
              <td>{text(lap.car)}</td>
              <td>{text(lap.car_class)}</td>
              <td>{text(lap.lap_number)}</td>
              <td>{formatRaceTime(lap.lap_time)}</td>
              <td>{validityBadge(lap)}</td>
              <td>{fmt(lap.fuel_start, 2, " L")} / {fmt(lap.fuel_end, 2, " L")}</td>
              <td>{fmt(lap.fuel_used, 2, " L")}</td>
              <td>{fmt(lap.tyre_wear_fl, 1)} / {fmt(lap.tyre_wear_fr, 1)} / {fmt(lap.tyre_wear_rl, 1)} / {fmt(lap.tyre_wear_rr, 1)}</td>
              <td>{fmt(lap.tyre_pressure_fl, 1)} / {fmt(lap.tyre_pressure_fr, 1)} / {fmt(lap.tyre_pressure_rl, 1)} / {fmt(lap.tyre_pressure_rr, 1)}</td>
              {!compact && <td>{fmt(lap.brake_temp_fl, 0)} / {fmt(lap.brake_temp_fr, 0)} / {fmt(lap.brake_temp_rl, 0)} / {fmt(lap.brake_temp_rr, 0)}</td>}
              <td>{fmt(lap.track_temp, 1, " C")}</td>
              <td>{fmt(lap.ambient_temp, 1, " C")}</td>
              <td>{fmt(lap.engine_oil_temp, 0, " C")} / {fmt(lap.engine_water_temp, 0, " C")}</td>
              <td>{fmt(lap.max_speed, 0, " km/h")} / {fmt(lap.average_speed, 0, " km/h")}</td>
              <td>{lap.source === "live" ? <span className="badge blue">Live</span> : <span className="badge amber">CSV</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function validityBadge(lap: ProfileLap) {
  const label = lap.valid_lap ? "Valid" : "Invalid";
  const ratio = lap.lap_time_ratio ? `${fmt(lap.lap_time_ratio * 100, 0, "%")} of normal` : "no estimate";
  const reason = lap.lap_quality ? lap.lap_quality.replace(/_/g, " ") : ratio;
  return <span className={`badge ${lap.valid_lap ? "green" : "red"}`} title={`Expected lap: ${formatRaceTime(lap.expected_lap_time)}; ${ratio}; ${reason}`}>{label}</span>;
}

function formatCell(column: string, value: unknown) {
  if (typeof value === "number") {
    if (column.includes("distance")) return fmt(value, 1, " km");
    if (column.includes("percent")) return fmt(value, 1, "%");
    if (column.includes("lap")) return column === "best_lap" ? formatRaceTime(value) : fmt(value, 0);
    return fmt(value, 1);
  }
  return text(value as string | number | boolean | null);
}
