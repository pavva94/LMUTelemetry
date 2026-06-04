import { useEffect, useMemo, useState } from "react";
import { AlertOctagon, CheckCircle2, Wrench } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import { SectionTitle } from "../components/SectionTitle";
import { damperRows, finite, sampleAt, splitInsights, tempColor, wheels, type Wheel } from "../lib/liveTelemetryEngine";
import { formatRaceTime } from "../lib/timeFormat";
import type { LiveLapAnalysis as LiveLapAnalysisPayload, LiveLapSample, TelemetryInsight } from "../types/liveLapAnalysis";

const colors: Record<Wheel, string> = { fl: "#6dd6ff", fr: "#ff8c69", rl: "#91e48f", rr: "#c7a8ff" };
const wheelLabels: Record<Wheel, string> = { fl: "FL", fr: "FR", rl: "RL", rr: "RR" };
const fmt = (value?: number | null, digits = 1, suffix = "") => value == null || Number.isNaN(value) ? "--" : `${value.toFixed(digits)}${suffix}`;
const signed = (value?: number | null) => value == null || Number.isNaN(value) ? "--" : `${value >= 0 ? "+" : ""}${value.toFixed(3)}s`;
const timeOf = (sample: LiveLapSample) => finite(sample.lap_time ?? sample.timestamp);

function EmptyState({ detail }: { detail: string }) {
  return <div className="empty-state"><strong>No valid live laps yet</strong><span>{detail}</span></div>;
}

function InsightIcon({ insight }: { insight: TelemetryInsight }) {
  if (insight.icon === "check") return <CheckCircle2 size={18} />;
  if (insight.icon === "wrench") return <Wrench size={18} />;
  return <AlertOctagon size={18} />;
}

function InsightCard({ title, insights, selectedTimestamp, onSelect }: { title: string; insights: TelemetryInsight[]; selectedTimestamp: number | null; onSelect: (insight: TelemetryInsight) => void }) {
  return (
    <section className="card span-6 lap-analysis-notepad-card">
      <SectionTitle title={title} help="Rule-based findings from the selected valid live lap. Click a row to synchronize the deep-dive charts to that event." />
      {insights.length ? (
        <div className="lap-insight-list">
          {insights.map((insight, index) => {
            const active = selectedTimestamp != null && insight.timestamp != null && Math.abs(selectedTimestamp - insight.timestamp) < 0.05;
            return (
              <button key={`${insight.message}-${index}`} className={`lap-insight-row ${insight.severity} ${active ? "active" : ""}`} onClick={() => onSelect(insight)}>
                <span className="lap-insight-icon"><InsightIcon insight={insight} /></span>
                <span>
                  <strong>{insight.message}</strong>
                  <small>{formatRaceTime(insight.lap_time)} {insight.evidence?.length ? `/ ${insight.evidence.join(" / ")}` : ""}</small>
                </span>
              </button>
            );
          })}
        </div>
      ) : <EmptyState detail="Complete a clean lap to populate the engineer notepad." />}
    </section>
  );
}

function ContextHeader({ payload, selectedLap, referenceLap, setSelectedLap, setReferenceLap }: {
  payload: LiveLapAnalysisPayload;
  selectedLap: number | null;
  referenceLap: number | null;
  setSelectedLap: (lap: number | null) => void;
  setReferenceLap: (lap: number | null) => void;
}) {
  const sessionLabel = [payload.session.session_type, payload.session.track_name, payload.session.vehicle_model || payload.session.vehicle_name].filter(Boolean).join(" - ") || "Live session";
  return (
    <section className="card span-12 lap-analysis-sticky">
      <div className="lap-context-grid">
        <label>Session<input value={sessionLabel} readOnly /></label>
        <label>Lap<select value={selectedLap ?? ""} onChange={(event) => setSelectedLap(event.target.value ? Number(event.target.value) : null)}>
          {payload.laps.map((lap) => <option value={lap.lap_number} key={lap.lap_number}>Lap {lap.lap_number} - {formatRaceTime(lap.lap_time)}</option>)}
        </select></label>
        <label>Ghost lap<select value={referenceLap ?? ""} onChange={(event) => setReferenceLap(event.target.value ? Number(event.target.value) : null)}>
          {payload.laps.map((lap) => <option value={lap.lap_number} key={lap.lap_number}>Lap {lap.lap_number} - {formatRaceTime(lap.lap_time)}</option>)}
        </select></label>
        <div className="lap-metric"><span className="label">Peak combined G</span><strong>{fmt(payload.metrics.session_peak_combined_g, 2, "G")}</strong></div>
        <div className="lap-metric"><span className="label">K_US</span><strong>{fmt(payload.metrics.understeer_gradient, 4)}</strong></div>
        <div className="lap-metric"><span className="label">W_latGeom</span><strong>{fmt(payload.metrics.load_transfer_geom, 0, "N")}</strong></div>
      </div>
      <div className="table-wrap lap-sector-table">
        <table>
          <thead><tr><th>Sector</th><th>Selected</th><th>Ghost</th><th>Delta</th></tr></thead>
          <tbody>{payload.sectors.map((sector) => (
            <tr key={sector.sector}><td>S{sector.sector}</td><td>{formatRaceTime(sector.time)}</td><td>{formatRaceTime(sector.reference_time)}</td><td className={sector.delta != null && sector.delta <= 0 ? "ok-text" : "warn-text"}>{signed(sector.delta)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

function FrictionCircle({ current, ghost, selectedTimestamp }: { current: LiveLapSample[]; ghost: LiveLapSample[]; selectedTimestamp: number | null }) {
  const currentData = current.map((sample) => ({ x: sample.g_force_lat, y: sample.g_force_long, t: timeOf(sample) })).filter((row) => row.x != null && row.y != null);
  const ghostData = ghost.map((sample) => ({ x: sample.g_force_lat, y: sample.g_force_long })).filter((row) => row.x != null && row.y != null);
  const selected = sampleAt(current, selectedTimestamp);
  return (
    <section className="card span-6 lap-chart-card">
      <SectionTitle title="Friction Circle" help="Longitudinal G versus lateral G. The faint gray ghost shows the reference lap." />
      <ResponsiveContainer width="100%" height={310}>
        <ScatterChart>
          <CartesianGrid stroke="#27313a" />
          <XAxis type="number" dataKey="x" name="Lat G" stroke="#8896a3" domain={["dataMin - 0.2", "dataMax + 0.2"]} />
          <YAxis type="number" dataKey="y" name="Long G" stroke="#8896a3" domain={["dataMin - 0.2", "dataMax + 0.2"]} />
          <Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} />
          <Scatter name="Ghost lap" data={ghostData} fill="#7f8c98" opacity={0.18} />
          <Scatter name="Selected lap" data={currentData} fill="#e6b450" />
          {selected?.g_force_lat != null && selected.g_force_long != null && <Scatter name="Event" data={[{ x: selected.g_force_lat, y: selected.g_force_long }]} fill="#ff6961" />}
        </ScatterChart>
      </ResponsiveContainer>
    </section>
  );
}

function TireHealthMatrix({ samples, selectedTimestamp }: { samples: LiveLapSample[]; selectedTimestamp: number | null }) {
  const sample = sampleAt(samples, selectedTimestamp);
  return (
    <section className="card span-6 lap-chart-card">
      <SectionTitle title="Tire Health Matrix" help="Inner, center, and outer tire temperatures at the selected timestamp, with live pressure overlaid." />
      {sample ? (
        <div className="tire-matrix">
          {wheels.map((wheel) => {
            const inner = finite(sample[`tyre_temp_${wheel}_inner` as keyof LiveLapSample]);
            const center = finite(sample[`tyre_temp_${wheel}_center` as keyof LiveLapSample]);
            const outer = finite(sample[`tyre_temp_${wheel}_outer` as keyof LiveLapSample]);
            const pressure = finite(sample[`tyre_pressure_${wheel}` as keyof LiveLapSample]);
            return (
              <div className={`tire-block tire-${wheel}`} key={wheel}>
                <strong>{wheelLabels[wheel]}</strong>
                <div className="tire-zones">
                  {[inner, center, outer].map((temp, index) => <span key={index} style={{ background: tempColor(temp) }}>{fmt(temp, 0)}</span>)}
                </div>
                <small>{fmt(pressure, 1)} psi</small>
              </div>
            );
          })}
        </div>
      ) : <EmptyState detail="Tire data will appear once the selected lap has live tire samples." />}
    </section>
  );
}

function HandlingDiagram({ current, selectedTimestamp, kus }: { current: LiveLapSample[]; selectedTimestamp: number | null; kus?: number | null }) {
  const selectedLatG = finite(sampleAt(current, selectedTimestamp)?.g_force_lat);
  const rows = current.map((sample) => ({
    x: sample.g_force_lat,
    y: sample.front_rear_slip_delta ?? (sample.steering_angle != null && sample.g_force_lat != null ? Number(sample.steering_angle) - Math.abs(Number(sample.g_force_lat)) * 0.02 : null),
    t: timeOf(sample),
  })).filter((row) => row.x != null && row.y != null);
  if (!rows.length) return <section className="card span-6"><SectionTitle title="Handling Diagram" help="Plots front minus rear slip angle against lateral G when available." /><EmptyState detail="Slip-angle channels are unavailable; K_US is shown in the sticky context when estimable." /></section>;
  return (
    <section className="card span-6 lap-chart-card">
      <SectionTitle title="Handling Diagram" help={`Front minus rear slip proxy against lateral G. K_US ${fmt(kus, 4)}.`} />
      <ResponsiveContainer width="100%" height={310}>
        <LineChart data={rows}>
          <CartesianGrid stroke="#27313a" />
          <XAxis dataKey="x" stroke="#8896a3" />
          <YAxis stroke="#8896a3" />
          <Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} />
          <Line dataKey="y" name="Front - rear slip" stroke="#6dd6ff" dot={false} connectNulls />
          {selectedLatG != null && <ReferenceLine x={selectedLatG} stroke="#ff6961" strokeDasharray="4 4" />}
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}

function SuspensionPlatform({ current, ghost, selectedTimestamp }: { current: LiveLapSample[]; ghost: LiveLapSample[]; selectedTimestamp: number | null }) {
  const rows = current.map((sample) => ({ x: timeOf(sample), ...sample }));
  const ghostRows = ghost.map((sample) => ({ x: timeOf(sample), ...sample }));
  const dampers = damperRows(current);
  return (
    <section className="card span-6 lap-chart-card">
      <SectionTitle title="Suspension & Platform" help="Top chart shows damper velocity. Bottom chart shows ride heights with ghost overlay." />
      <ResponsiveContainer width="100%" height={145}>
        <LineChart data={dampers}>
          <CartesianGrid stroke="#27313a" />
          <XAxis dataKey="x" stroke="#8896a3" hide />
          <YAxis stroke="#8896a3" />
          <Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} />
          {wheels.map((wheel) => <Line key={wheel} dataKey={`damper_${wheel}`} name={`${wheelLabels[wheel]} damper`} stroke={colors[wheel]} dot={false} connectNulls />)}
          {selectedTimestamp != null && <ReferenceLine x={selectedTimestamp} stroke="#ff6961" strokeDasharray="4 4" />}
        </LineChart>
      </ResponsiveContainer>
      <ResponsiveContainer width="100%" height={170}>
        <LineChart data={rows}>
          <CartesianGrid stroke="#27313a" />
          <XAxis dataKey="x" stroke="#8896a3" />
          <YAxis stroke="#8896a3" />
          <Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} />
          {wheels.map((wheel) => <Line key={`${wheel}-ghost`} data={ghostRows} dataKey={`ride_height_${wheel}_mm`} name={`${wheelLabels[wheel]} ghost`} stroke="#7f8c98" opacity={0.22} dot={false} connectNulls />)}
          {wheels.map((wheel) => <Line key={wheel} dataKey={`ride_height_${wheel}_mm`} name={`${wheelLabels[wheel]} ride`} stroke={colors[wheel]} dot={false} connectNulls />)}
          {selectedTimestamp != null && <ReferenceLine x={selectedTimestamp} stroke="#ff6961" strokeDasharray="4 4" />}
          <Legend />
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}

export function LiveLapAnalysis() {
  const [payload, setPayload] = useState<LiveLapAnalysisPayload | null>(null);
  const [selectedLap, setSelectedLap] = useState<number | null>(null);
  const [referenceLap, setReferenceLap] = useState<number | null>(null);
  const [selectedTimestamp, setSelectedTimestamp] = useState<number | null>(null);
  const [status, setStatus] = useState("Waiting for valid live laps");

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void api.liveLapAnalysis(selectedLap, referenceLap).then((data) => {
        if (cancelled) return;
        setPayload(data);
        setSelectedLap((current) => data.laps.some((lap) => lap.lap_number === current) ? current : data.selected_lap_number ?? null);
        setReferenceLap((current) => data.laps.some((lap) => lap.lap_number === current) ? current : data.reference_lap_number ?? null);
        setSelectedTimestamp((current) => current ?? data.insights.find((item) => item.timestamp != null)?.timestamp ?? data.current_lap_data[0]?.lap_time ?? null);
        setStatus(data.laps.length ? "Live valid lap analysis ready" : "Complete a valid lap to unlock analysis");
      }).catch((exc) => !cancelled && setStatus(exc instanceof Error ? exc.message : String(exc)));
    };
    load();
    const id = window.setInterval(load, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [selectedLap, referenceLap]);

  const insights = useMemo(() => splitInsights(payload?.insights || []), [payload?.insights]);
  if (!payload) return <div className="page grid"><section className="card span-12"><EmptyState detail={status} /></section></div>;
  const handleInsight = (insight: TelemetryInsight) => {
    if (insight.timestamp != null) setSelectedTimestamp(insight.timestamp);
  };
  return (
    <div className="page grid lap-analysis-page">
      <ContextHeader payload={payload} selectedLap={selectedLap} referenceLap={referenceLap} setSelectedLap={setSelectedLap} setReferenceLap={setReferenceLap} />
      {!payload.laps.length && <section className="card span-12"><EmptyState detail={status} /></section>}
      <InsightCard title="Driver Feedback" insights={insights.driver} selectedTimestamp={selectedTimestamp} onSelect={handleInsight} />
      <InsightCard title="Car Setup Diagnostics" insights={insights.setup} selectedTimestamp={selectedTimestamp} onSelect={handleInsight} />
      <FrictionCircle current={payload.current_lap_data} ghost={payload.reference_lap_data} selectedTimestamp={selectedTimestamp} />
      <TireHealthMatrix samples={payload.current_lap_data} selectedTimestamp={selectedTimestamp} />
      <HandlingDiagram current={payload.current_lap_data} selectedTimestamp={selectedTimestamp} kus={payload.metrics.understeer_gradient} />
      <SuspensionPlatform current={payload.current_lap_data} ghost={payload.reference_lap_data} selectedTimestamp={selectedTimestamp} />
    </div>
  );
}
