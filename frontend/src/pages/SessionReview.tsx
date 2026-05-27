import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";
import { formatRaceTime } from "../lib/timeFormat";
import type { SavedSession, SessionReview as Review } from "../types/session";

type Row = Record<string, number | string | boolean | null | undefined>;

const fmt = (value?: number | null, digits = 1, suffix = "") =>
  value == null || Number.isNaN(value) ? "--" : `${value.toFixed(digits)}${suffix}`;
const text = (value?: string | number | boolean | null) => (value == null || value === "" ? "--" : String(value));
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
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <CartesianGrid stroke="#27313a" />
        <XAxis dataKey={xKey} stroke="#8896a3" />
        <YAxis stroke="#8896a3" />
        <Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} />
        <Legend />
        {lines.map(([key, color]) => <Line key={key} dataKey={key} stroke={color} dot={false} connectNulls />)}
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
    const load = () =>
      api
        .reviewSession(selectedId)
        .then((data) => {
          if (mounted) {
            setReview(data);
            setStatus("Session loaded");
          }
        })
        .catch(() => mounted && setStatus("Could not load selected session"));
    load();
    const id = window.setInterval(load, 5000);
    return () => {
      mounted = false;
      window.clearInterval(id);
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
  useEffect(() => {
    if (filteredSessions.length && !filteredSessions.some((session) => session.id === selectedId)) {
      setSelectedId(filteredSessions[0].id);
    }
  }, [filteredSessions, selectedId]);
  const summary = useMemo(() => {
    const fuelUsed = laps.map((lap) => Number(lap.fuel_used)).filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
    return {
      laps: laps.length,
      samples: samples.length,
      avgLap: avg(laps, "lap_time"),
      bestLap: (() => {
        const values = laps.map((lap) => Number(lap.lap_time)).filter(Number.isFinite);
        return values.length ? Math.min(...values) : null;
      })(),
      topSpeed: max(laps, "top_speed") ?? max(samples, "speed_kph"),
      fuelUsed: fuelUsed || null,
    };
  }, [laps, samples]);

  const storeCurrent = async () => {
    setStatus("Storing current session");
    await api.finalizeCurrentSession();
    const rows = await loadSessions();
    setSelectedId(rows[0]?.id || selectedId);
    setStatus("Current session stored");
  };

  return (
    <div className="page grid">
      <section className="card span-12">
        <h2>Saved Session Review</h2>
        <div className="input-grid">
          <select value={sessionTypeFilter} onChange={(event) => setSessionTypeFilter(event.target.value)}>
            <option value="all">All session types</option>
            {sessionTypes.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </select>
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
            {filteredSessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.session_type || "Session"} - {session.track_name || "Unknown track"} - {session.vehicle_name || "Unknown car"} - Lap {session.latest_lap_number ?? "--"} - {session.created_at || session.id}
              </option>
            ))}
          </select>
          <button onClick={() => void storeCurrent()}>Finalize current segment</button>
          <input value={status} readOnly />
        </div>
      </section>

      <section className="card span-12">
        <h2>Detected Sessions</h2>
        {sessions.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Type</th><th>Track</th><th>Car</th><th>Samples</th><th>Latest lap</th><th>Start</th><th>End</th></tr></thead>
              <tbody>
                {sessions.slice(0, 12).map((session) => (
                  <tr key={session.id} onClick={() => setSelectedId(session.id)}>
                    <td>{text(session.session_type)}</td>
                    <td>{text(session.track_name)}</td>
                    <td>{text(session.vehicle_name)}</td>
                    <td>{text(session.sample_count)}</td>
                    <td>{text(session.latest_lap_number)}</td>
                    <td>{formatRaceTime(session.started_at_game_time)}</td>
                    <td>{formatRaceTime(session.ended_at_game_time ?? session.latest_game_time)}</td>
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
          <Metric label="Car" value={text(selectedSession?.vehicle_name)} />
          <Metric label="Laps" value={summary.laps} />
          <Metric label="Samples" value={summary.samples} sub={selectedSession?.sample_count ? `${selectedSession.sample_count} stored` : undefined} />
          <Metric label="Best lap" value={formatRaceTime(summary.bestLap)} />
          <Metric label="Average lap" value={formatRaceTime(summary.avgLap)} />
          <Metric label="Top speed" value={fmt(summary.topSpeed, 0, " km/h")} />
          <Metric label="Fuel used" value={fmt(summary.fuelUsed, 2, " L")} />
        </div>
      </section>

      <section className="card span-6"><h2>Lap Times</h2><Chart data={laps} xKey="lap_number" lines={[["lap_time", "#6dd6ff"]]} /></section>
      <section className="card span-6"><h2>Lap Fuel</h2><Chart data={laps} xKey="lap_number" lines={[["fuel_used", "#e6b450"], ["fuel_added", "#69d28f"]]} /></section>
      <section className="card span-6"><h2>Speed And RPM</h2><Chart data={samples} lines={[["speed_kph", "#e6b450"], ["rpm", "#6dd6ff"]]} /></section>
      <section className="card span-6"><h2>Driver Inputs</h2><Chart data={samples} lines={[["throttle", "#69d28f"], ["brake", "#ff6961"], ["steering", "#c7a8ff"]]} /></section>
      <section className="card span-6"><h2>Tyre Wear</h2><Chart data={samples} lines={[["tyre_wear_fl", "#6dd6ff"], ["tyre_wear_fr", "#ff8c69"], ["tyre_wear_rl", "#91e48f"], ["tyre_wear_rr", "#c7a8ff"]]} /></section>
      <section className="card span-6"><h2>Tyre Temperatures</h2><Chart data={samples} lines={[["tyre_temp_fl", "#6dd6ff"], ["tyre_temp_fr", "#ff8c69"], ["tyre_temp_rl", "#91e48f"], ["tyre_temp_rr", "#c7a8ff"]]} /></section>
      <section className="card span-6"><h2>Brake Temperatures</h2><Chart data={samples} lines={[["brake_temp_fl", "#6dd6ff"], ["brake_temp_fr", "#ff8c69"], ["brake_temp_rl", "#91e48f"], ["brake_temp_rr", "#c7a8ff"]]} /></section>
      <section className="card span-6"><h2>Ride Heights</h2><Chart data={samples} lines={[["ride_height_fl", "#6dd6ff"], ["ride_height_fr", "#ff8c69"], ["ride_height_rl", "#91e48f"], ["ride_height_rr", "#c7a8ff"]]} /></section>

      <section className="card span-12">
        <h2>Lap Table</h2>
        {laps.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Lap</th><th>Lap time</th><th>Start</th><th>End</th><th>Fuel start</th><th>Fuel end</th><th>Fuel used</th><th>Fuel added</th><th>Top speed</th><th>Samples</th></tr></thead>
              <tbody>
                {laps.map((lap, index) => (
                  <tr key={index}>
                    <td>{text(lap.lap_number)}</td>
                    <td>{formatRaceTime(lap.lap_time as number)}</td>
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
        <h2>Events And Recommendations</h2>
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
