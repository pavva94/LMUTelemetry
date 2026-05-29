import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";
import { SectionTitle } from "../components/SectionTitle";
import { chartLabelFormatter, chartValueFormatter, isRaceTimeField } from "../lib/telemetryFields";
import { formatRaceTime } from "../lib/timeFormat";
import type { SavedSession, SessionReview as Review } from "../types/session";

type Row = Record<string, number | string | boolean | null | undefined>;

const fmt = (value?: number | null, digits = 1, suffix = "") =>
  value == null || Number.isNaN(value) ? "--" : `${value.toFixed(digits)}${suffix}`;
const text = (value?: string | number | boolean | null) => (value == null || value === "" ? "--" : String(value));
const carName = (session?: SavedSession | null) => session?.vehicle_model || session?.vehicle_name || null;
const avg = (rows: Row[], key: string) => {
  const values = rows.map((row) => Number(row[key])).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
};
const max = (rows: Row[], key: string) => {
  const values = rows.map((row) => Number(row[key])).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
};

function EmptyState({ detail }: { detail: string }) {
  return <div className="empty-state"><strong>No data yet</strong><span>{detail}</span></div>;
}

function Metric({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return <div className="metric compact"><span className="label">{label}</span><span className="value">{value}</span>{sub && <span className="subvalue">{sub}</span>}</div>;
}

function Chart({ data, xKey = "game_time", lines, height = 240 }: { data: Row[]; xKey?: string; lines: Array<[string, string]>; height?: number }) {
  if (!data.length) return <EmptyState detail="The selected session has no samples for this chart." />;
  const yTimeAxis = lines.some(([key]) => isRaceTimeField(key));
  const xTimeAxis = isRaceTimeField(xKey);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <CartesianGrid stroke="#27313a" />
        <XAxis dataKey={xKey} stroke="#8896a3" tickFormatter={(value) => xTimeAxis ? chartLabelFormatter(value, xKey) : String(value)} />
        <YAxis stroke="#8896a3" tickFormatter={(value) => yTimeAxis ? chartLabelFormatter(value, lines[0]?.[0] || "") : String(value)} />
        <Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} labelFormatter={(value) => xTimeAxis ? chartLabelFormatter(value, xKey) : String(value)} formatter={chartValueFormatter} />
        <Legend />
        {lines.map(([key, color]) => <Line key={key} dataKey={key} stroke={color} dot={false} connectNulls />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

function PositionChart({ data }: { data: Row[] }) {
  const rows = data.filter((row) => Number.isFinite(Number(row.position)) || Number.isFinite(Number(row.class_position)));
  if (!rows.length) return <EmptyState detail="Position history is available for new saved race sessions after this update." />;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={rows}>
        <CartesianGrid stroke="#27313a" />
        <XAxis dataKey="lap_number" stroke="#8896a3" />
        <YAxis stroke="#8896a3" reversed allowDecimals={false} domain={["dataMin", "dataMax"]} tickFormatter={(value) => `P${value}`} />
        <Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} labelFormatter={(value) => `Lap ${value}`} formatter={(value, name) => [`P${value}`, name === "class_position" ? "Class position" : "Overall position"]} />
        <Legend />
        <Line type="monotone" dataKey="position" name="Overall position" stroke="#6dd6ff" dot connectNulls />
        <Line type="monotone" dataKey="class_position" name="Class position" stroke="#e6b450" dot connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SessionReview() {
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [sessionTypeFilter, setSessionTypeFilter] = useState("all");
  const [review, setReview] = useState<Review | null>(null);
  const [status, setStatus] = useState("Loading saved sessions");

  const loadSessions = () =>
    api.sessions().then((rows) => {
      setSessions(rows);
      setSelectedId((current) => current || rows[0]?.id || "");
      return rows;
    });

  useEffect(() => {
    let mounted = true;
    loadSessions().catch(() => mounted && setStatus("Could not load saved sessions"));
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let mounted = true;
    setStatus("Loading selected session");
    api.reviewSession(selectedId)
      .then((data) => {
        if (mounted) {
          setReview(data);
          setStatus("Session loaded");
        }
      })
      .catch(() => mounted && setStatus("Could not load selected session"));
    return () => {
      mounted = false;
    };
  }, [selectedId]);

  const samples = (review?.telemetry_samples || []) as Row[];
  const laps = (review?.laps || []) as Row[];
  const pitEvents = (review?.pit_events || []) as Row[];
  const sessionTypes = useMemo(() => Array.from(new Set(sessions.map((session) => session.session_type).filter(Boolean) as string[])).sort(), [sessions]);
  const filteredSessions = useMemo(
    () => sessions.filter((session) => sessionTypeFilter === "all" || session.session_type === sessionTypeFilter),
    [sessions, sessionTypeFilter],
  );
  const selectedSession = sessions.find((session) => session.id === selectedId) || review?.session;
  const isRaceSession = String(selectedSession?.session_type || "").toLowerCase().includes("race");
  useEffect(() => {
    if (filteredSessions.length && !filteredSessions.some((session) => session.id === selectedId)) {
      setSelectedId(filteredSessions[0].id);
    }
  }, [filteredSessions, selectedId]);
  const summary = useMemo(() => {
    const aggregate = review?.summary;
    const fuelUsed = laps.map((lap) => Number(lap.fuel_used)).filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
    return {
      laps: aggregate?.lap_count ?? laps.length,
      samples: samples.length,
      storedSamples: aggregate?.sample_count ?? selectedSession?.sample_count,
      avgLap: aggregate?.average_lap ?? avg(laps, "lap_time"),
      bestLap: aggregate?.best_lap ?? (() => {
        const values = laps.map((lap) => Number(lap.lap_time)).filter(Number.isFinite);
        return values.length ? Math.min(...values) : null;
      })(),
      topSpeed: aggregate?.top_speed ?? max(laps, "top_speed") ?? max(samples, "speed_kph"),
      fuelUsed: aggregate?.total_fuel_used ?? (fuelUsed || null),
      distance: aggregate?.total_distance_km,
      tyreWear: aggregate?.average_tyre_wear,
      tyreTemp: aggregate?.average_tyre_temp,
      tyrePressure: aggregate?.average_tyre_pressure,
      brakeTemp: aggregate?.average_brake_temp,
    };
  }, [laps, samples, review?.summary, selectedSession?.sample_count]);

  const storeCurrent = async () => {
    setStatus("Storing current session");
    await api.finalizeCurrentSession();
    const rows = await loadSessions();
    setSelectedId(rows[0]?.id || selectedId);
    setStatus("Current session stored");
  };

  const removeSelected = async () => {
    if (!selectedId) return;
    const session = sessions.find((item) => item.id === selectedId);
    const label = `${session?.session_type || "Session"} at ${session?.track_name || "Unknown track"}`;
    if (!window.confirm(`Remove ${label} from saved history? Lifetime profile totals will stay preserved.`)) return;
    setStatus("Removing selected session");
    await api.removeSession(selectedId);
    const rows = await loadSessions();
    const nextId = rows[0]?.id || "";
    setSelectedId(nextId);
    setReview(null);
    setStatus("Session removed from saved history");
  };

  return (
    <div className="page grid">
      <section className="card span-12">
        <SectionTitle title="Saved Session Review" help="Selects a recorded live segment for review. Finalize the current segment when you want to store the latest data for later analysis." />
        <div className="input-grid">
          <select value={sessionTypeFilter} onChange={(event) => setSessionTypeFilter(event.target.value)}>
            <option value="all">All session types</option>
            {sessionTypes.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </select>
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
            {filteredSessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.session_type || "Session"} - {session.track_name || "Unknown track"} - {carName(session) || "Unknown car"} - Lap {session.latest_lap_number ?? "--"} - {session.created_at || session.id}
              </option>
            ))}
          </select>
          <button onClick={() => void storeCurrent()}>Finalize current segment</button>
          <button disabled={!selectedId} onClick={() => void removeSelected()}>Remove selected</button>
          <input value={status} readOnly />
        </div>
      </section>

      <section className="card span-12">
        <SectionTitle title="Detected Sessions" help="Lists recorded practice, qualifying, and race segments. Session boundaries help compare the right laps under the right conditions." />
        {sessions.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Type</th><th>Track</th><th>Car</th><th>Result</th><th>Stored samples</th><th>Latest lap</th><th>Start</th><th>End</th><th>Action</th></tr></thead>
              <tbody>
                {sessions.slice(0, 12).map((session) => (
                  <tr key={session.id} onClick={() => setSelectedId(session.id)}>
                    <td>{text(session.session_type)}</td>
                    <td>{text(session.track_name)}</td>
                    <td>{text(carName(session))}</td>
                    <td>{session.final_position ? `P${session.final_position}` : "--"}{session.final_class_position ? ` / Class P${session.final_class_position}` : ""}</td>
                    <td>{text(session.sample_count)}</td>
                    <td>{text(session.latest_lap_number)}</td>
                    <td>{formatRaceTime(session.started_at_game_time)}</td>
                    <td>{formatRaceTime(session.ended_at_game_time ?? session.latest_game_time)}</td>
                    <td><button onClick={(event) => { event.stopPropagation(); setSelectedId(session.id); void api.removeSession(session.id).then(loadSessions).then((rows) => setSelectedId(rows[0]?.id || "")); }}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState detail="Practice, qualifying, and race segments will appear here as the backend records them." />}
      </section>

      <section className="card span-12">
        <div className="header-grid">
          <Metric label="Track" value={text(selectedSession?.track_name)} />
          <Metric label="Session" value={text(selectedSession?.session_type)} />
          <Metric label="Car" value={text(carName(selectedSession))} />
          <Metric label="Result" value={selectedSession?.final_position ? `P${selectedSession.final_position}` : "--"} sub={selectedSession?.final_class_position ? `Class P${selectedSession.final_class_position}` : text(selectedSession?.classified_status)} />
          <Metric label="Laps" value={summary.laps} />
          <Metric label="Samples" value={summary.samples} sub={summary.storedSamples ? `${summary.storedSamples} compacted at completion` : "aggregated saved data"} />
          <Metric label="Best lap" value={formatRaceTime(summary.bestLap)} />
          <Metric label="Average lap" value={formatRaceTime(summary.avgLap)} />
          <Metric label="Top speed" value={fmt(summary.topSpeed, 0, " km/h")} />
          <Metric label="Fuel used" value={fmt(summary.fuelUsed, 2, " L")} />
          <Metric label="Distance" value={fmt(summary.distance, 1, " km")} />
          <Metric label="Avg tyre wear" value={fmt(summary.tyreWear, 2)} />
          <Metric label="Avg tyre temp" value={fmt(summary.tyreTemp, 0, " C")} />
          <Metric label="Avg pressure" value={fmt(summary.tyrePressure, 1)} />
          <Metric label="Avg brake temp" value={fmt(summary.brakeTemp, 0, " C")} />
        </div>
      </section>

      <section className="card span-6"><SectionTitle title="Lap Times" help="Shows saved lap pace across the segment. Separate fuel effects, tyre degradation, and traffic before judging driver consistency." /><Chart data={laps} xKey="lap_number" lines={[["lap_time", "#6dd6ff"]]} /></section>
      <section className="card span-6"><SectionTitle title="Lap Fuel" help="Shows fuel used and added per lap. Spikes or jumps usually indicate refuel events, pit sequences, or unusual running." /><Chart data={laps} xKey="lap_number" lines={[["fuel_used", "#e6b450"], ["fuel_added", "#69d28f"]]} /></section>
      {isRaceSession && <section className="card span-12"><SectionTitle title="Race Position Over Time" help="Shows how the selected race result evolved lap by lap. Lower positions are better, so the chart axis is reversed." /><PositionChart data={laps} /></section>}
      <section className="card span-6"><SectionTitle title="Speed And RPM" help="Shows powertrain and speed history. Falling speed peaks with similar RPM can point to traffic, drag, or corner-exit loss." /><Chart data={samples} lines={[["speed_kph", "#e6b450"], ["rpm", "#6dd6ff"]]} /></section>
      <section className="card span-6"><SectionTitle title="Driver Inputs" help="Shows throttle, brake, and steering samples. Clean separation and smooth steering usually improve tyre life and lap repeatability." /><Chart data={samples} lines={[["throttle", "#69d28f"], ["brake", "#ff6961"], ["steering", "#c7a8ff"]]} /></section>
      <section className="card span-6"><SectionTitle title="Tyre Wear" help="Tracks tyre wear by corner. Front/rear or left/right imbalance is a useful setup and driving-style clue." /><Chart data={samples} lines={[["tyre_wear_fl", "#6dd6ff"], ["tyre_wear_fr", "#ff8c69"], ["tyre_wear_rl", "#91e48f"], ["tyre_wear_rr", "#c7a8ff"]]} /></section>
      <section className="card span-6"><SectionTitle title="Tyre Temperatures" help="Shows tyre heat by corner when available. Persistent overheating suggests pressure, camber, balance, or sliding issues." /><Chart data={samples} lines={[["tyre_temp_fl", "#6dd6ff"], ["tyre_temp_fr", "#ff8c69"], ["tyre_temp_rl", "#91e48f"], ["tyre_temp_rr", "#c7a8ff"]]} /></section>
      <section className="card span-6"><SectionTitle title="Brake Temperatures" help="Shows brake heat by corner. Front/rear or side imbalance can indicate bias, cooling, or locked-wheel behavior." /><Chart data={samples} lines={[["brake_temp_fl", "#6dd6ff"], ["brake_temp_fr", "#ff8c69"], ["brake_temp_rl", "#91e48f"], ["brake_temp_rr", "#c7a8ff"]]} /></section>
      <section className="card span-6"><SectionTitle title="Ride Heights" help="Shows platform movement when available. Low ride height under braking or high speed can indicate bottoming or aero instability." /><Chart data={samples} lines={[["ride_height_fl", "#6dd6ff"], ["ride_height_fr", "#ff8c69"], ["ride_height_rl", "#91e48f"], ["ride_height_rr", "#c7a8ff"]]} /></section>

      <section className="card span-12">
        <SectionTitle title="Lap Table" help="Lists each saved lap with fuel and speed context. Use it to identify representative laps before deeper analysis." />
        {laps.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Lap</th><th>Lap time</th><th>Position</th><th>Class pos</th><th>Start</th><th>End</th><th>Fuel start</th><th>Fuel end</th><th>Fuel used</th><th>Fuel added</th><th>Top speed</th><th>Samples</th></tr></thead>
              <tbody>
                {laps.map((lap, index) => (
                  <tr key={index}>
                    <td>{text(lap.lap_number)}</td>
                    <td>{formatRaceTime(lap.lap_time as number)}</td>
                    <td>{lap.position != null ? `P${lap.position}` : "--"}</td>
                    <td>{lap.class_position != null ? `P${lap.class_position}` : "--"}</td>
                    <td>{formatRaceTime(lap.start_time as number)}</td>
                    <td>{formatRaceTime(lap.end_time as number)}</td>
                    <td>{fmt(lap.fuel_start as number, 2, " L")}</td>
                    <td>{fmt(lap.fuel_end as number, 2, " L")}</td>
                    <td>{fmt(lap.fuel_used as number, 2, " L")}</td>
                    <td>{fmt(lap.fuel_added as number, 2, " L")}</td>
                    <td>{fmt(lap.top_speed as number, 0, " km/h")}</td>
                    <td>{text(lap.sample_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState detail="Keep the backend running while driving; saved lap summaries are derived from the recorded live samples." />}
      </section>

      <section className="card span-12">
        <SectionTitle title="Events And Recommendations" help="Connects pits and recommendations to the session timeline. Use events to explain sudden changes in pace or fuel use." />
        <div className="table-wrap">
          <table>
            <thead><tr><th>Lap</th><th>Type</th><th>Priority</th><th>Message</th></tr></thead>
            <tbody>
              {[...pitEvents, ...((review?.recommendations || []) as Row[])].map((event, index) => (
                <tr key={index}><td>{text(event.lap_number)}</td><td>{text(event.detected_from ?? event.recommendation_type ?? "Event")}</td><td>{text(event.priority)}</td><td>{text(event.message)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
