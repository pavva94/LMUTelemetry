import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { formatRaceTime } from "../lib/timeFormat";
import type { ProfileLap, ProfileLapResponse, ProfileSummary } from "../types/profile";

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
  const [lapData, setLapData] = useState<ProfileLapResponse | null>(null);
  const [filters, setFilters] = useState({
    search: "",
    track: "",
    car: "",
    class: "",
    source: "",
    date_from: "",
    date_to: "",
    valid_only: false,
    track_temp_min: "",
    track_temp_max: "",
    ambient_temp_min: "",
    ambient_temp_max: "",
    fuel_min: "",
    fuel_max: "",
    lap_time_min: "",
    lap_time_max: "",
  });
  const [sort, setSort] = useState("date");
  const [direction, setDirection] = useState("desc");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.profileSummary(), api.profileBestLaps()])
      .then(([summaryData, bestData]) => {
        setSummary(summaryData);
        setBestLaps(bestData);
        setError("");
      })
      .catch((exc) => setError(exc instanceof Error ? exc.message : String(exc)));
  }, []);

  useEffect(() => {
    api.profileLaps({ ...filters, sort, direction, page, page_size: 100 })
      .then((data) => {
        setLapData(data);
        setError("");
      })
      .catch((exc) => setError(exc instanceof Error ? exc.message : String(exc)));
  }, [filters, sort, direction, page]);

  const totals = summary?.totals || {};
  const filterOptions = useMemo(() => {
    const laps = lapData?.laps || [];
    return {
      tracks: Array.from(new Set(laps.map((lap) => lap.track).filter(Boolean))).sort(),
      cars: Array.from(new Set(laps.map((lap) => lap.car).filter(Boolean))).sort(),
      classes: Array.from(new Set(laps.map((lap) => lap.car_class).filter(Boolean))).sort(),
    };
  }, [lapData]);
  const setFilter = (key: keyof typeof filters, value: string | boolean) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
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

      <section className="card span-12">
        <h2>Full Lap History</h2>
        <div className="input-grid">
          <input placeholder="Search car, track, class, session, file" value={filters.search} onChange={(event) => setFilter("search", event.target.value)} />
          <select value={filters.track} onChange={(event) => setFilter("track", event.target.value)}><option value="">All tracks</option>{filterOptions.tracks.map((track) => <option key={track}>{track}</option>)}</select>
          <select value={filters.car} onChange={(event) => setFilter("car", event.target.value)}><option value="">All cars</option>{filterOptions.cars.map((car) => <option key={car}>{car}</option>)}</select>
          <select value={filters.class} onChange={(event) => setFilter("class", event.target.value)}><option value="">All classes</option>{filterOptions.classes.map((kind) => <option key={kind}>{kind}</option>)}</select>
          <select value={filters.source} onChange={(event) => setFilter("source", event.target.value)}><option value="">All sources</option><option value="live">Live</option><option value="csv">CSV</option></select>
          <input type="date" value={filters.date_from} onChange={(event) => setFilter("date_from", event.target.value)} />
          <input type="date" value={filters.date_to} onChange={(event) => setFilter("date_to", event.target.value)} />
          <input placeholder="Min fuel" value={filters.fuel_min} onChange={(event) => setFilter("fuel_min", event.target.value)} />
          <input placeholder="Max fuel" value={filters.fuel_max} onChange={(event) => setFilter("fuel_max", event.target.value)} />
          <input placeholder="Min lap s" value={filters.lap_time_min} onChange={(event) => setFilter("lap_time_min", event.target.value)} />
          <input placeholder="Max lap s" value={filters.lap_time_max} onChange={(event) => setFilter("lap_time_max", event.target.value)} />
          <label><input type="checkbox" checked={filters.valid_only} onChange={(event) => setFilter("valid_only", event.target.checked)} /> Valid only</label>
        </div>
        <p className="subvalue">{lapData?.total ?? 0} laps found</p>
        {lapData?.laps.length ? <LapTable rows={lapData.laps} sort={sort} direction={direction} onSort={onSort} /> : <Empty detail="Adjust filters or record/import sessions." />}
        <div className="control-row">
          <button disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
          <span className="subvalue">Page {page}</span>
          <button disabled={!lapData || page * lapData.page_size >= lapData.total} onClick={() => setPage((current) => current + 1)}>Next</button>
        </div>
      </section>
    </div>
  );
}

function SimpleTable({ rows, columns }: { rows: Array<Record<string, unknown>>; columns: string[] }) {
  if (!rows.length) return <Empty />;
  return <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{column.replace(/_/g, " ")}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{formatCell(column, row[column])}</td>)}</tr>)}</tbody></table></div>;
}

function LapTable({ rows, compact = false, sort, direction, onSort }: { rows: ProfileLap[]; compact?: boolean; sort: string; direction: string; onSort: (field: string) => void }) {
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
