import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { formatDuration, formatRaceTime } from "../lib/timeFormat";
import type { LmuDuckdbSettings } from "../types/lmuDuckdb";
import type { ProfileLap, ProfileOverview, ProfileSummary } from "../types/profile";

const DEFAULT_FOLDER = "G:\\SteamLibrary\\steamapps\\common\\Le Mans Ultimate\\UserData\\Telemetry";

const fmt = (value?: number | null, digits = 1, suffix = "") =>
  value == null || Number.isNaN(value) ? "--" : `${value.toFixed(digits)}${suffix}`;
const text = (value?: string | number | boolean | null) => (value == null || value === "" ? "--" : String(value));
const dateText = (value?: string | null) => value ? new Date(value).toLocaleString() : "--";
const wearText = (value?: number | null) => fmt(value == null ? null : value * 100, 1, "%");

function Metric({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return <div className="metric compact"><span className="label">{label}</span><span className="value">{value}</span>{sub && <span className="subvalue">{sub}</span>}</div>;
}

function Empty({ detail = "No historical telemetry found yet." }: { detail?: string }) {
  return <div className="empty-state"><strong>No data</strong><span>{detail}</span></div>;
}

function SortButton({ label, field, sort, direction, onSort }: { label: string; field: string; sort: string; direction: string; onSort: (field: string) => void }) {
  return <button className="table-sort" onClick={() => onSort(field)}>{label}{sort === field ? ` ${direction === "asc" ? "up" : "down"}` : ""}</button>;
}

type LapFilterKey =
  | "date"
  | "session"
  | "track"
  | "layout"
  | "car"
  | "class"
  | "lap"
  | "lap_time"
  | "valid"
  | "fuel"
  | "fuel_used"
  | "tyre_wear"
  | "tyre_pressure"
  | "brake_temp"
  | "track_temp"
  | "ambient"
  | "engine"
  | "speed"
  | "source";

type LapFilters = Record<LapFilterKey, string>;

const emptyLapFilters = (): LapFilters => ({
  date: "",
  session: "",
  track: "",
  layout: "",
  car: "",
  class: "",
  lap: "",
  lap_time: "",
  valid: "",
  fuel: "",
  fuel_used: "",
  tyre_wear: "",
  tyre_pressure: "",
  brake_temp: "",
  track_temp: "",
  ambient: "",
  engine: "",
  speed: "",
  source: "",
});

export function UserProfile() {
  const [summary, setSummary] = useState<ProfileSummary | null>(null);
  const [bestLaps, setBestLaps] = useState<ProfileLap[]>([]);
  const [quality, setQuality] = useState<ProfileOverview["data_quality"] | null>(null);
  const [excludedLaps, setExcludedLaps] = useState<ProfileLap[]>([]);
  const [showExcluded, setShowExcluded] = useState(false);
  const [sort, setSort] = useState("date");
  const [direction, setDirection] = useState("desc");
  const [error, setError] = useState("");
  const [folder, setFolder] = useState(DEFAULT_FOLDER);
  const [settings, setSettings] = useState<LmuDuckdbSettings | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loadingOverview, setLoadingOverview] = useState(true);

  const loadOverview = async () => {
    setLoadingOverview(true);
    try {
      const overview = await api.profileOverview();
      setSummary(overview.summary);
      setBestLaps(overview.best_laps);
      setQuality(overview.data_quality);
      setError("");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoadingOverview(false);
    }
  };

  useEffect(() => {
    api.lmuDuckdbSettings()
      .then((data) => {
        setSettings(data);
        if (data.folder_path) setFolder(data.folder_path);
      })
      .catch((exc) => setError(exc instanceof Error ? exc.message : String(exc)));
    void loadOverview();
  }, []);

  const saveAndSync = async () => {
    if (!folder.trim()) return;
    setSyncing(true);
    try {
      await api.saveLmuDuckdbSettings(folder.trim());
      const result = await api.syncLmuDuckdb();
      setSettings(result);
      if (result.folder_path) setFolder(result.folder_path);
      await loadOverview();
      setError("");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setSyncing(false);
    }
  };

  const revalidate = async () => {
    setLoadingOverview(true);
    try {
      const result = await api.revalidateProfileBestLaps();
      setBestLaps(result.best_laps);
      setQuality(result.data_quality);
      setExcludedLaps(await api.excludedProfileBestLapCandidates());
      setError("");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoadingOverview(false);
    }
  };

  const toggleExcluded = async () => {
    const next = !showExcluded;
    setShowExcluded(next);
    if (next && !excludedLaps.length) {
      setExcludedLaps(await api.excludedProfileBestLapCandidates());
    }
  };

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
      <LoadingOverlay show={syncing || loadingOverview} title={syncing ? "Syncing DuckDB sessions" : "Loading profile"} detail={syncing ? "Scanning the LMU telemetry folder and refreshing the local cache." : "Reading cached DuckDB profile totals and best laps."} />
      {error && <section className="card span-12"><div className="error-box">{error}</div></section>}
      <section className="card span-12">
        <h2>LMU DuckDB Source</h2>
        <div className="duckdb-path-grid profile-source">
          <label>Telemetry folder<input value={folder} onChange={(event) => setFolder(event.target.value)} placeholder={DEFAULT_FOLDER} /></label>
          <button className="primary" disabled={syncing || !folder.trim()} onClick={() => void saveAndSync()}>{syncing ? "Syncing" : "Save and sync"}</button>
          <input value={settings?.last_sync_status || "No sync has run yet"} readOnly />
        </div>
        <div className="header-grid">
          <Metric label="Cached sessions" value={text(settings?.active_sessions)} sub={`${text(settings?.cached_sessions)} total records`} />
          <Metric label="Warnings" value={text(settings?.warning_count)} />
          <Metric label="Last sync" value={dateText(settings?.last_sync_at)} />
        </div>
        {(settings?.warnings || []).slice(0, 5).map((warning) => <p className="motec-warning" key={warning}>{warning}</p>)}
      </section>
      <section className="card span-12">
        <h2>Career Overview</h2>
        <div className="header-grid">
          <Metric label="Distance" value={fmt(totals.total_distance_km as number, 1, " km")} />
          <Metric label="Sessions" value={text(totals.total_sessions as number)} sub={`${text(totals.duckdb_sessions as number)} DuckDB`} />
          <Metric label="Detected laps" value={text(totals.total_laps as number)} sub={`${text(totals.completed_laps as number)} completed; ${text(totals.valid_laps as number)} ranking-valid`} />
          <Metric label="Completed driving time" value={formatDuration(totals.total_driving_time as number)} />
          <Metric label="Cars" value={text(totals.different_cars as number)} />
          <Metric label="Tracks" value={text(totals.different_tracks as number)} />
          <Metric label="Avg session" value={formatDuration(totals.average_session_duration as number)} />
          <Metric label="Avg distance" value={fmt(totals.average_distance_per_session as number, 1, " km")} />
          <Metric label="Avg laps" value={fmt(totals.average_laps_per_session as number, 1)} />
          <Metric label="Wins" value={text(totals.wins as number)} sub={`${text(totals.positioned_race_sessions as number)} races with position data`} />
          <Metric label="Podiums" value={text(totals.podiums as number)} sub={`${text(totals.positioned_race_sessions as number)} races with position data`} />
          <Metric label="Top 10" value={text(totals.top10 as number)} sub={`${text(totals.positioned_race_sessions as number)} races with position data`} />
          <Metric label="DNF/DNS/DQ" value={text(totals.dnf_dns as number)} sub={`${text(totals.status_race_sessions as number)} races with status data`} />
          <Metric label="Best-lap records" value={text(totals.best_lap_count as number)} />
        </div>
      </section>

      <section className="card span-4"><h2>Distance By Class</h2><SimpleTable rows={summary?.distance_by_class || []} columns={["car_class", "distance_km", "sessions", "laps", "distance_percent"]} /></section>
      <section className="card span-4"><h2>Most Used Cars</h2><SimpleTable rows={summary?.top_cars || []} columns={["car", "car_class", "distance_km", "sessions", "laps", "tracks"]} /></section>
      <section className="card span-4"><h2>Most Driven Tracks</h2><SimpleTable rows={summary?.top_tracks || []} columns={["track", "layout", "distance_km", "sessions", "laps", "best_lap", "most_used_car"]} /></section>

      <section className="card span-12">
        <h2>Best Laps</h2>
        <p className="section-copy">One fastest validated lap for every session type, circuit, layout, and exact car combination. Every record links back to its source session and lap.</p>
        <div className="header-grid profile-quality-grid">
          <Metric label="Valid candidates" value={text(quality?.valid_candidates)} />
          <Metric label="Personal bests" value={text(quality?.personal_bests)} />
          <Metric label="Excluded laps" value={text(quality?.excluded_laps)} />
          <Metric label="Needs review" value={text(quality?.suspicious_laps)} />
        </div>
        <div className="control-row profile-quality-actions">
          <button type="button" onClick={() => void revalidate()}>Revalidate history</button>
          <button type="button" className={showExcluded ? "active-control" : ""} onClick={() => void toggleExcluded()}>{showExcluded ? "Show personal bests" : "Data quality / excluded laps"}</button>
          {quality?.revalidated_at && <span>Last validated {dateText(quality.revalidated_at)}</span>}
        </div>
        {showExcluded
          ? (excludedLaps.length ? <LapTable rows={excludedLaps} sort={sort} direction={direction} onSort={onSort} /> : <Empty detail="No excluded or suspicious laps were found." />)
          : (bestLaps.length ? <LapTable rows={bestLaps} compact sort={sort} direction={direction} onSort={onSort} /> : <Empty detail="Best laps appear once the configured LMU DuckDB folder is synced." />)}
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
  const [filters, setFilters] = useState<LapFilters>(() => emptyLapFilters());
  const filteredRows = useMemo(() => {
    const activeFilters = Object.entries(filters).filter(([, value]) => value.trim() !== "") as Array<[LapFilterKey, string]>;
    const filtered = activeFilters.length
      ? rows.filter((lap) => activeFilters.every(([key, value]) => {
        const query = value.trim().toLowerCase();
        const haystack = lapFilterText(lap, key);
        return key === "valid" || key === "source" ? haystack === query : haystack.includes(query);
      }))
      : rows;
    return [...filtered].sort((a, b) => compareLapRows(a, b, sort, direction));
  }, [direction, filters, rows, sort]);
  const hasFilters = Object.values(filters).some((value) => value.trim() !== "");
  const updateFilter = (key: LapFilterKey, value: string) => setFilters((current) => ({ ...current, [key]: value }));

  return (
    <>
      <div className="control-row duckdb-count">
        <span>{filteredRows.length} of {rows.length} best laps shown</span>
        {hasFilters && <button type="button" onClick={() => setFilters(emptyLapFilters())}>Clear filters</button>}
      </div>
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
              <th><SortButton label="Lap" field="lap" sort={sort} direction={direction} onSort={onSort} /></th>
              <th><SortButton label="Lap time" field="lap_time" sort={sort} direction={direction} onSort={onSort} /></th>
              <th>Valid</th>
              <th><SortButton label="Fuel" field="fuel" sort={sort} direction={direction} onSort={onSort} /></th>
              <th><SortButton label="Fuel used" field="fuel_used" sort={sort} direction={direction} onSort={onSort} /></th>
              <th><SortButton label="Tyre wear" field="tyre_wear" sort={sort} direction={direction} onSort={onSort} /></th>
              <th>Tyre pressure (kPa)</th>
              {!compact && <th>Brake temp</th>}
              <th><SortButton label="Track temp" field="track_temp" sort={sort} direction={direction} onSort={onSort} /></th>
              <th>Ambient</th>
              <th>Oil / Water</th>
              <th><SortButton label="Max / Avg speed" field="speed" sort={sort} direction={direction} onSort={onSort} /></th>
              <th>Source</th>
            </tr>
            <tr className="filter-row">
              <th><ColumnFilter value={filters.date} onChange={(value) => updateFilter("date", value)} placeholder="Date" /></th>
              <th><ColumnFilter value={filters.session} onChange={(value) => updateFilter("session", value)} placeholder="Session" /></th>
              <th><ColumnFilter value={filters.track} onChange={(value) => updateFilter("track", value)} placeholder="Track" /></th>
              <th><ColumnFilter value={filters.layout} onChange={(value) => updateFilter("layout", value)} placeholder="Layout" /></th>
              <th><ColumnFilter value={filters.car} onChange={(value) => updateFilter("car", value)} placeholder="Car" /></th>
              <th><ColumnFilter value={filters.class} onChange={(value) => updateFilter("class", value)} placeholder="Class" /></th>
              <th><ColumnFilter value={filters.lap} onChange={(value) => updateFilter("lap", value)} placeholder="Lap" /></th>
              <th><ColumnFilter value={filters.lap_time} onChange={(value) => updateFilter("lap_time", value)} placeholder="Time" /></th>
              <th><ColumnSelect value={filters.valid} onChange={(value) => updateFilter("valid", value)} options={["valid", "invalid"]} /></th>
              <th><ColumnFilter value={filters.fuel} onChange={(value) => updateFilter("fuel", value)} placeholder="Fuel" /></th>
              <th><ColumnFilter value={filters.fuel_used} onChange={(value) => updateFilter("fuel_used", value)} placeholder="Used" /></th>
              <th><ColumnFilter value={filters.tyre_wear} onChange={(value) => updateFilter("tyre_wear", value)} placeholder="Wear" /></th>
              <th><ColumnFilter value={filters.tyre_pressure} onChange={(value) => updateFilter("tyre_pressure", value)} placeholder="Pressure" /></th>
              {!compact && <th><ColumnFilter value={filters.brake_temp} onChange={(value) => updateFilter("brake_temp", value)} placeholder="Brake" /></th>}
              <th><ColumnFilter value={filters.track_temp} onChange={(value) => updateFilter("track_temp", value)} placeholder="Track C" /></th>
              <th><ColumnFilter value={filters.ambient} onChange={(value) => updateFilter("ambient", value)} placeholder="Ambient" /></th>
              <th><ColumnFilter value={filters.engine} onChange={(value) => updateFilter("engine", value)} placeholder="Oil/water" /></th>
              <th><ColumnFilter value={filters.speed} onChange={(value) => updateFilter("speed", value)} placeholder="Speed" /></th>
              <th><ColumnSelect value={filters.source} onChange={(value) => updateFilter("source", value)} options={["duckdb", "live", "csv"]} /></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((lap) => (
              <tr key={lap.id}>
                <td>{dateText(lap.date)}</td>
                <td>{text(lap.session_type)}</td>
                <td>{text(lap.track)}</td>
                <td>{text(lap.layout)}</td>
                <td>{text(lap.car)}</td>
                <td>{text(lap.car_class)}</td>
                <td>{text(lap.lap_number)}</td>
                <td>{formatRaceTime(lap.lap_time)}</td>
                <td>{validityBadge(lap)}</td>
                <td>{fmt(lap.fuel_start, 2, " L")} / {fmt(lap.fuel_end, 2, " L")}</td>
                <td>{fmt(lap.fuel_used, 2, " L")}</td>
                <td>{wearText(lap.tyre_wear_fl)} / {wearText(lap.tyre_wear_fr)} / {wearText(lap.tyre_wear_rl)} / {wearText(lap.tyre_wear_rr)}</td>
                <td>{fmt(lap.tyre_pressure_fl, 1)} / {fmt(lap.tyre_pressure_fr, 1)} / {fmt(lap.tyre_pressure_rl, 1)} / {fmt(lap.tyre_pressure_rr, 1)}</td>
                {!compact && <td>{fmt(lap.brake_temp_fl, 0)} / {fmt(lap.brake_temp_fr, 0)} / {fmt(lap.brake_temp_rl, 0)} / {fmt(lap.brake_temp_rr, 0)}</td>}
                <td>{fmt(lap.track_temp, 1, " C")}</td>
                <td>{fmt(lap.ambient_temp, 1, " C")}</td>
                <td>{fmt(lap.engine_oil_temp, 0, " C")} / {fmt(lap.engine_water_temp, 0, " C")}</td>
                <td>{fmt(lap.max_speed, 0, " km/h")} / {fmt(lap.average_speed, 0, " km/h")}</td>
                <td>{sourceBadge(lap.source)}</td>
              </tr>
            ))}
            {!filteredRows.length && (
              <tr>
                <td colSpan={compact ? 18 : 19}><Empty detail="No best laps match the active column filters." /></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ColumnFilter({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <input className="table-filter" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />;
}

function ColumnSelect({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <select className="table-filter" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">All</option>
      {options.map((option) => <option value={option} key={option}>{option}</option>)}
    </select>
  );
}

function searchable(value?: string | number | boolean | null) {
  return text(value).toLowerCase();
}

function searchableNumber(value?: number | null, digits = 1, suffix = "") {
  return `${fmt(value, digits, suffix)} ${value ?? ""}`.toLowerCase();
}

function lapFilterText(lap: ProfileLap, key: LapFilterKey) {
  switch (key) {
    case "date":
      return `${searchable(lap.date)} ${searchable(dateText(lap.date))}`;
    case "session":
      return `${searchable(lap.session_type)} ${searchable(lap.session_name)}`;
    case "track":
      return searchable(lap.track);
    case "layout":
      return searchable(lap.layout);
    case "car":
      return searchable(lap.car);
    case "class":
      return searchable(lap.car_class);
    case "lap":
      return searchable(lap.lap_number);
    case "lap_time":
      return `${formatRaceTime(lap.lap_time)} ${lap.lap_time ?? ""}`.toLowerCase();
    case "valid":
      return lap.valid_lap ? "valid" : "invalid";
    case "fuel":
      return `${searchableNumber(lap.fuel_start, 2, " L")} ${searchableNumber(lap.fuel_end, 2, " L")}`;
    case "fuel_used":
      return searchableNumber(lap.fuel_used, 2, " L");
    case "tyre_wear":
      return [lap.tyre_wear_fl, lap.tyre_wear_fr, lap.tyre_wear_rl, lap.tyre_wear_rr].map((value) => searchableNumber(value == null ? null : value * 100, 1, "%")).join(" ");
    case "tyre_pressure":
      return [lap.tyre_pressure_fl, lap.tyre_pressure_fr, lap.tyre_pressure_rl, lap.tyre_pressure_rr].map((value) => searchableNumber(value, 1)).join(" ");
    case "brake_temp":
      return [lap.brake_temp_fl, lap.brake_temp_fr, lap.brake_temp_rl, lap.brake_temp_rr].map((value) => searchableNumber(value, 0)).join(" ");
    case "track_temp":
      return searchableNumber(lap.track_temp, 1, " C");
    case "ambient":
      return searchableNumber(lap.ambient_temp, 1, " C");
    case "engine":
      return `${searchableNumber(lap.engine_oil_temp, 0, " C")} ${searchableNumber(lap.engine_water_temp, 0, " C")}`;
    case "speed":
      return `${searchableNumber(lap.max_speed, 0, " km/h")} ${searchableNumber(lap.average_speed, 0, " km/h")}`;
    case "source":
      return searchable(lap.source);
  }
}

function lapSortValue(lap: ProfileLap, field: string) {
  if (field === "date") return lap.date ? Date.parse(lap.date) || 0 : 0;
  if (field === "track") return lap.track?.toLowerCase() || "";
  if (field === "car") return lap.car?.toLowerCase() || "";
  if (field === "lap") return Number(lap.lap_number) || 0;
  if (field === "lap_time") return lap.lap_time ?? Number.POSITIVE_INFINITY;
  if (field === "fuel") return lap.fuel_start ?? lap.fuel_end ?? Number.NEGATIVE_INFINITY;
  if (field === "fuel_used") return lap.fuel_used ?? Number.NEGATIVE_INFINITY;
  if (field === "tyre_wear") return averageNumbers([lap.tyre_wear_fl, lap.tyre_wear_fr, lap.tyre_wear_rl, lap.tyre_wear_rr]);
  if (field === "track_temp") return lap.track_temp ?? Number.NEGATIVE_INFINITY;
  if (field === "speed") return lap.max_speed ?? lap.average_speed ?? Number.NEGATIVE_INFINITY;
  return lapFilterText(lap, field as LapFilterKey);
}

function averageNumbers(values: Array<number | null | undefined>) {
  const clean = values.filter((value): value is number => value != null && Number.isFinite(value));
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : Number.NEGATIVE_INFINITY;
}

function compareLapRows(a: ProfileLap, b: ProfileLap, sort: string, direction: string) {
  const left = lapSortValue(a, sort);
  const right = lapSortValue(b, sort);
  const multiplier = direction === "asc" ? 1 : -1;
  if (typeof left === "number" && typeof right === "number") return (left - right) * multiplier;
  return String(left).localeCompare(String(right)) * multiplier;
}

function sourceBadge(source: ProfileLap["source"]) {
  if (source === "live") return <span className="badge blue">Live</span>;
  if (source === "csv") return <span className="badge amber">CSV</span>;
  return <span className="badge green">DuckDB</span>;
}

function validityBadge(lap: ProfileLap) {
  const label = (lap.validation_status || (lap.valid_lap ? "valid" : "invalid")).replace("_", " ");
  const ratio = lap.lap_time_ratio ? `${fmt(lap.lap_time_ratio * 100, 0, "%")} of normal` : "no estimate";
  const reason = lap.validation_reason || (lap.lap_quality ? lap.lap_quality.replace(/_/g, " ") : ratio);
  const color = lap.valid_lap ? "green" : lap.validation_status === "suspicious" ? "amber" : "red";
  return <span className={`badge ${color}`} title={`${reason} Source: ${lap.source_lap_key || `${lap.source}:${lap.session_id}:${lap.lap_number}`}`}>{label}</span>;
}

function formatCell(column: string, value: unknown) {
  if (typeof value === "number") {
    if (column.includes("percent")) return fmt(value, 1, "%");
    if (column.includes("distance")) return fmt(value, 1, " km");
    if (column.includes("lap")) return column === "best_lap" ? formatRaceTime(value) : fmt(value, 0);
    return fmt(value, 1);
  }
  return text(value as string | number | boolean | null);
}
