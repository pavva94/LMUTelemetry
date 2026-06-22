import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AlertOctagon, ArrowDownRight, ArrowUpRight, CheckCircle2, ChevronRight, CircleGauge, Filter, Flag, Gauge, Info, LineChart as LineChartIcon, ShieldCheck, Sparkles, Target, TrendingDown, TrendingUp, Wrench } from "lucide-react";
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
import type { CoachingFinding, CornerOpportunity, LiveLapAnalysis as LiveLapAnalysisPayload, LiveLapSample, LiveLapSummary, TelemetryInsight } from "../types/liveLapAnalysis";

const colors: Record<Wheel, string> = { fl: "#6dd6ff", fr: "#ff8c69", rl: "#91e48f", rr: "#c7a8ff" };
const wheelLabels: Record<Wheel, string> = { fl: "FL", fr: "FR", rl: "RL", rr: "RR" };
const fmt = (value?: number | null, digits = 1, suffix = "") => value == null || Number.isNaN(value) ? "--" : `${value.toFixed(digits)}${suffix}`;
const signed = (value?: number | null) => value == null || Number.isNaN(value) ? "--" : `${value >= 0 ? "+" : ""}${value.toFixed(3)}s`;
const timeOf = (sample: LiveLapSample) => finite(sample.lap_time ?? sample.timestamp);

function EmptyState({ detail }: { detail: string }) {
  return <div className="empty-state"><strong>No completed live laps yet</strong><span>{detail}</span></div>;
}

const lapStatus = (lap?: LiveLapSummary) => {
  if (!lap) return "No lap selected";
  return lap.valid_lap === false ? lap.reason || "Marked lap" : "Clean lap";
};

const lapOptionLabel = (lap: LiveLapSummary) => `Lap ${lap.lap_number} - ${formatRaceTime(lap.lap_time)} - ${lapStatus(lap)}`;

function InsightIcon({ insight }: { insight: TelemetryInsight }) {
  if (insight.icon === "check") return <CheckCircle2 size={18} />;
  if (insight.icon === "wrench") return <Wrench size={18} />;
  return <AlertOctagon size={18} />;
}

function InsightCard({ title, insights, selectedTimestamp, onSelect }: { title: string; insights: TelemetryInsight[]; selectedTimestamp: number | null; onSelect: (insight: TelemetryInsight) => void }) {
  return (
    <section className="card span-6 lap-analysis-notepad-card">
      <SectionTitle title={title} help="Rule-based findings from the selected live lap. Click a row to synchronize the deep-dive charts to that event." />
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
  const selectedSummary = payload.laps.find((lap) => lap.lap_number === selectedLap);
  const referenceSummary = payload.laps.find((lap) => lap.lap_number === referenceLap);
  const validCount = payload.laps.filter((lap) => lap.valid_lap !== false).length;
  return (
    <section className="card span-12 lap-analysis-sticky">
      <div className="lap-context-grid">
        <label>Session<input value={sessionLabel} readOnly /></label>
        <label>Lap<select value={selectedLap ?? ""} onChange={(event) => setSelectedLap(event.target.value ? Number(event.target.value) : null)}>
          {payload.laps.map((lap) => <option value={lap.lap_number} key={lap.lap_number}>{lapOptionLabel(lap)}</option>)}
        </select></label>
        <label>Ghost lap<select value={referenceLap ?? ""} onChange={(event) => setReferenceLap(event.target.value ? Number(event.target.value) : null)}>
          {payload.laps.map((lap) => <option value={lap.lap_number} key={lap.lap_number}>{lapOptionLabel(lap)}</option>)}
        </select></label>
        <div className="lap-metric"><span className="label">Peak combined G</span><strong>{fmt(payload.metrics.session_peak_combined_g, 2, "G")}</strong></div>
        <div className="lap-metric"><span className="label">K_US</span><strong>{fmt(payload.metrics.understeer_gradient, 4)}</strong></div>
        <div className="lap-metric"><span className="label">W_latGeom</span><strong>{fmt(payload.metrics.load_transfer_geom, 0, "N")}</strong></div>
      </div>
      <div className="lap-validity-note">
        <span>{payload.laps.length} completed laps, {validCount} clean</span>
        <span>Selected: {lapStatus(selectedSummary)}</span>
        <span>Ghost: {lapStatus(referenceSummary)}</span>
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

function PowerOutputChart({ current, ghost, selectedTimestamp }: { current: LiveLapSample[]; ghost: LiveLapSample[]; selectedTimestamp: number | null }) {
  const currentData = current.map((sample) => ({
    rpm: finite(sample.rpm),
    power_kw: finite(sample.power_kw),
    power_hp: finite(sample.power_hp),
    t: timeOf(sample),
  })).filter((row) => row.rpm != null && row.rpm > 0 && (row.power_hp != null || row.power_kw != null));
  if (!currentData.length) return null;

  const useHp = currentData.some((row) => row.power_hp != null);
  const powerKey = useHp ? "power_hp" : "power_kw";
  const unit = useHp ? "hp" : "kW";
  const ghostData = ghost.map((sample) => ({
    rpm: finite(sample.rpm),
    power_kw: finite(sample.power_kw),
    power_hp: finite(sample.power_hp),
  })).filter((row) => row.rpm != null && row.rpm > 0 && row[powerKey] != null);
  const selected = sampleAt(current, selectedTimestamp);
  const selectedPower = selected ? finite(selected[powerKey]) : null;
  const selectedRpm = selected ? finite(selected.rpm) : null;

  return (
    <section className="card span-6 lap-chart-card">
      <SectionTitle title="Power Output" help="Derived engine power over RPM when live RPM and engine torque channels are available." />
      <ResponsiveContainer width="100%" height={310}>
        <ScatterChart>
          <CartesianGrid stroke="#27313a" />
          <XAxis type="number" dataKey="rpm" name="RPM" stroke="#8896a3" domain={["dataMin - 250", "dataMax + 250"]} tickFormatter={(value) => Number(value).toFixed(0)} />
          <YAxis type="number" dataKey={powerKey} name={`Power (${unit})`} stroke="#8896a3" domain={["dataMin - 25", "dataMax + 25"]} tickFormatter={(value) => Number(value).toFixed(0)} />
          <Tooltip
            contentStyle={{ background: "#141a20", border: "1px solid #27313a" }}
            formatter={(value, name) => {
              const numeric = Number(value);
              if (name === "rpm") return [numeric.toFixed(0), "RPM"];
              return [numeric.toFixed(useHp ? 0 : 1), `Power (${unit})`];
            }}
          />
          <Scatter name="Ghost power" data={ghostData} fill="#7f8c98" opacity={0.18} />
          <Scatter name={`Power (${unit})`} data={currentData} fill="#e6b450" />
          {selectedRpm != null && selectedPower != null && <Scatter name="Event" data={[{ rpm: selectedRpm, [powerKey]: selectedPower }]} fill="#ff6961" />}
        </ScatterChart>
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

const qualityClass = (value?: string | null) => value === "Valid" ? "good" : value === "Valid but noisy" ? "watch" : "bad";
const trendIcon = (trend?: string | null) => trend === "Improving" ? <TrendingUp size={14} /> : trend === "Worsening" || trend === "Degrading" ? <TrendingDown size={14} /> : <ChevronRight size={14} />;
const sampleDistance = (sample: LiveLapSample) => finite(sample.distance_pct) ?? 0;

function SessionControls({ payload, selectedLap, referenceLap, setSelectedLap, setReferenceLap, mode, setMode }: {
  payload: LiveLapAnalysisPayload;
  selectedLap: number | null;
  referenceLap: number | null;
  setSelectedLap: (lap: number | null) => void;
  setReferenceLap: (lap: number | null) => void;
  mode: "session" | "compare";
  setMode: (mode: "session" | "compare") => void;
}) {
  const sessionLabel = payload.session.session_type || "Live session";
  const car = payload.session.vehicle_model || payload.session.vehicle_name || "Car unavailable";
  const track = payload.session.track_name || "Track unavailable";
  return (
    <header className="coach-context" aria-label="Session analysis controls">
      <div className="coach-context-identity">
        <span>{sessionLabel}</span>
        <strong>{track}</strong>
        <small>{car}</small>
      </div>
      <div className="coach-control-group">
        <div className="coach-mode-switch" aria-label="Analysis mode">
          <button className={mode === "session" ? "active" : ""} onClick={() => setMode("session")} aria-pressed={mode === "session"}>Session analysis</button>
          <button className={mode === "compare" ? "active" : ""} onClick={() => setMode("compare")} aria-pressed={mode === "compare"}>Compare laps</button>
        </div>
        {mode === "session" ? <div className="coach-scope"><Target size={15} /><span><strong>All clean laps</strong><small>{payload.quality?.clean_laps ?? 0} laps build this coaching model</small></span></div> : <>
          <label><span>Lap</span><select value={selectedLap ?? ""} onChange={(event) => setSelectedLap(Number(event.target.value))}>
            {payload.laps.map((lap) => <option value={lap.lap_number} key={lap.lap_number}>{lapOptionLabel(lap)}</option>)}
          </select></label>
          <label><span>Reference</span><select value={referenceLap ?? ""} onChange={(event) => setReferenceLap(Number(event.target.value))}>
            {payload.laps.filter((lap) => lap.valid_lap !== false).map((lap) => <option value={lap.lap_number} key={lap.lap_number}>Lap {lap.lap_number} · {lap.role || lapStatus(lap)}</option>)}
          </select></label>
        </>}
      </div>
      <div className="coach-context-counts">
        <span><b>{payload.quality?.clean_laps ?? 0}</b> clean</span>
        <span><b>{payload.quality?.excluded_laps ?? 0}</b> excluded</span>
        <span className={qualityClass(payload.quality?.status)}><ShieldCheck size={14} /> {payload.quality?.status || "Collecting"}</span>
      </div>
    </header>
  );
}

function SessionVerdict({ payload }: { payload: LiveLapAnalysisPayload }) {
  const summary = payload.session_summary;
  const quality = payload.quality;
  const potential = summary?.time_to_theoretical;
  return (
    <section className="coach-verdict" aria-labelledby="session-verdict-title">
      <div className="coach-verdict-copy">
        <span className="eyebrow"><Sparkles size={14} /> Session verdict</span>
        <h2 id="session-verdict-title">{summary?.pace_trend === "Improving" ? "You got faster." : summary?.pace_trend === "Degrading" ? "Your pace dropped later." : "Your pace is stable."}</h2>
        <p>{summary?.largest_opportunity_corner ? `Main gain: ${summary.largest_opportunity_corner}.` : "Drive more clean laps to build your coaching plan."}</p>
        <div className={`coach-trust ${qualityClass(quality?.status)}`}><ShieldCheck size={17} /><span><strong>{quality?.status || "Collecting telemetry"}</strong><small>{quality ? `${quality.flagged_samples} of ${quality.total_samples} samples flagged · preserved for inspection` : "Quality checks will appear after a completed lap"}</small></span></div>
      </div>
      <div className="coach-kpi-grid">
        <div><span>Best valid</span><strong>{formatRaceTime(summary?.best_valid_lap)}</strong><small>{summary?.best_valid_lap_number ? `Lap ${summary.best_valid_lap_number}` : "No clean lap"}</small></div>
        <div><span>Typical pace</span><strong>{formatRaceTime(summary?.representative_pace)}</strong><small>Median clean pace</small></div>
        <div><span>Consistency</span><strong>{fmt(summary?.robust_consistency, 3, "s")}</strong><small>Robust spread</small></div>
        <div className="opportunity"><span>Available</span><strong>{potential != null ? `${potential.toFixed(2)}s` : "--"}</strong><small>To theoretical best</small></div>
      </div>
    </section>
  );
}

function OpportunityMap({ corners, selectedCorner, onSelect }: { corners: CornerOpportunity[]; selectedCorner: number | null; onSelect: (corner: number) => void }) {
  const max = Math.max(...corners.map((corner) => corner.opportunity), 0.01);
  return (
    <section className="coach-opportunity-map" aria-labelledby="opportunity-map-title">
      <div className="coach-section-heading"><div><span>02 · Circuit read</span><h2 id="opportunity-map-title">Where the time goes</h2></div><p>All clean laps · repeatable loss only</p></div>
      {corners.length ? <div className="corner-ribbon" role="list" aria-label="Circuit corner opportunities">
        {corners.map((corner) => (
          <button key={corner.id} role="listitem" className={`corner-node ${selectedCorner === corner.id ? "active" : ""}`} onClick={() => onSelect(corner.id)} style={{ "--loss": `${Math.max(18, corner.opportunity / max * 100)}%` } as CSSProperties}>
            <span className="corner-node-index">T{corner.id}</span><i aria-hidden="true" />
            <span className="corner-node-top"><strong>{corner.opportunity.toFixed(2)}s</strong><em>{corner.affected_laps}/{corner.clean_laps} laps</em></span>
            <span className="corner-signals">{(corner.signals || [{ category: corner.category, phase: corner.phase, opportunity: corner.opportunity }]).slice(0, 2).map((signal) => <span key={`${signal.phase}-${signal.category}`}><small>{signal.phase} · {signal.category}</small><b>{signal.opportunity.toFixed(2)}s</b></span>)}</span>
            <em>{corner.confidence} confidence · {trendIcon(corner.trend)} {corner.trend}</em>
          </button>
        ))}
      </div> : <EmptyState detail="Corner opportunities appear after enough clean laps establish a repeatable reference." />}
    </section>
  );
}

function FindingList({ findings, activeId, onSelect, showAll, setShowAll }: { findings: CoachingFinding[]; activeId: string | null; onSelect: (finding: CoachingFinding) => void; showAll: boolean; setShowAll: (value: boolean) => void }) {
  const visible = showAll ? findings : findings.slice(0, 8);
  return (
    <aside className="coach-findings" aria-labelledby="findings-title">
      <div className="coach-findings-head"><div><span>03 · Priorities</span><h2 id="findings-title">Next gains</h2></div><small>{findings.length} supported findings</small></div>
      <div className="coach-finding-list">
        {visible.map((finding, index) => <button key={finding.id} className={`coach-finding ${activeId === finding.id ? "active" : ""}`} onClick={() => onSelect(finding)}>
          <span className="finding-rank">0{index + 1}</span>
          <span className="finding-main"><small>{finding.phase} · {finding.category}</small><strong>{finding.title}</strong></span>
          <span className="finding-proof"><b>{finding.opportunity.toFixed(2)}s</b><small>{finding.confidence} confidence</small><em>{trendIcon(finding.trend)} {finding.trend}</em></span>
        </button>)}
        {!visible.length && <EmptyState detail="No repeatable coaching opportunity clears the current confidence floor." />}
      </div>
      {findings.length > 8 && <button className="coach-show-all" onClick={() => setShowAll(!showAll)}>{showAll ? "Show top eight" : `Show all ${findings.length}`}</button>}
    </aside>
  );
}

function focusedRows(current: LiveLapSample[], reference: LiveLapSample[], finding: CoachingFinding) {
  const ref = reference.filter((sample) => sampleDistance(sample) >= finding.start_pct && sampleDistance(sample) <= finding.end_pct);
  const nearest = (distance: number) => ref.reduce<LiveLapSample | null>((best, sample) => !best || Math.abs(sampleDistance(sample) - distance) < Math.abs(sampleDistance(best) - distance) ? sample : best, null);
  return current.filter((sample) => sampleDistance(sample) >= finding.start_pct && sampleDistance(sample) <= finding.end_pct).map((sample) => {
    const ghost = nearest(sampleDistance(sample));
    return {
      x: sampleDistance(sample), speed: finite(sample.speed_kph), speedRef: finite(ghost?.speed_kph), brake: finite(sample.brake_pct), brakeRef: finite(ghost?.brake_pct),
      throttle: finite(sample.throttle_pct), throttleRef: finite(ghost?.throttle_pct), steering: finite(sample.steering_angle) != null ? Number(sample.steering_angle) * 100 : null,
      steeringRef: finite(ghost?.steering_angle) != null ? Number(ghost?.steering_angle) * 100 : null, g: finite(sample.g_force_lat) != null ? Math.abs(Number(sample.g_force_lat)) * 35 : null,
      gRef: finite(ghost?.g_force_lat) != null ? Math.abs(Number(ghost?.g_force_lat)) * 35 : null,
    };
  });
}

const metricLabel: Record<string, string> = { segment_time_delta: "Segment delta", brake_release_delta_pct: "Brake release", throttle_delta_pct: "Throttle point", exit_speed_delta: "Exit speed", coast_time_delta: "Coasting", steering_correction_delta: "Corrections" };
function metricValue(key: string, value?: number | null) {
  if (value == null) return "--";
  if (key === "segment_time_delta" || key === "coast_time_delta") return `${value >= 0 ? "+" : ""}${value.toFixed(2)}s`;
  if (key === "exit_speed_delta") return `${value >= 0 ? "+" : ""}${value.toFixed(1)} km/h`;
  if (key === "steering_correction_delta") return `${value >= 0 ? "+" : ""}${value.toFixed(0)}`;
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}% lap`;
}

function FindingDetail({ finding, current, reference }: { finding: CoachingFinding | null; current: LiveLapSample[]; reference: LiveLapSample[] }) {
  if (!finding) return <section className="coach-detail"><EmptyState detail="Select a coaching finding to inspect the exact telemetry evidence." /></section>;
  const rows = focusedRows(current, reference, finding);
  const channels = new Set(finding.relevant_channels);
  return (
    <section className="coach-detail" aria-labelledby="finding-detail-title">
      <div className="coach-detail-title"><div><span>04 · Corner coach</span><h2 id="finding-detail-title">{finding.title}</h2><p>{finding.summary}{finding.affected_lap_numbers?.length ? ` Seen on laps ${finding.affected_lap_numbers.join(", ")}.` : ""}</p></div><div className={`confidence-stamp ${finding.confidence.toLowerCase()}`}><strong>{finding.confidence}</strong><span>{finding.confidence_score}% confidence</span><small>{finding.affected_laps}/{finding.clean_laps} clean laps</small></div></div>
      <div className="coach-explanation">
        <div><span>Seen</span><p>{finding.what_happened}</p></div>
        <div className="coach-try"><span>Do this</span><p>{finding.primary_action}</p></div>
        {finding.avoid && <div className="coach-avoid"><span>Avoid</span><p>{finding.avoid}</p></div>}
      </div>
      <div className="coach-trace-wrap">
        <div className="coach-trace-head"><div><LineChartIcon size={17} /><span><strong>{finding.phase} evidence</strong><small>Representative pattern vs strongest clean pass</small></span></div><span className="trace-range">{finding.start_pct.toFixed(1)}–{finding.end_pct.toFixed(1)}%</span></div>
        {rows.length ? <ResponsiveContainer width="100%" height={330}><LineChart data={rows} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid stroke="#253039" vertical={false} /><XAxis dataKey="x" stroke="#72808a" tickFormatter={(value) => `${Number(value).toFixed(1)}%`} /><YAxis yAxisId="speed" stroke="#8d999f" width={42} /><YAxis yAxisId="input" orientation="right" domain={[0, 100]} stroke="#8d999f" width={38} />
          <Tooltip contentStyle={{ background: "#0c1115", border: "1px solid #34414a" }} labelFormatter={(value) => `${Number(value).toFixed(2)}% lap distance`} />
          {channels.has("speed") && <><Line yAxisId="speed" dataKey="speedRef" name="Reference speed" stroke="#55c7f7" strokeWidth={2} dot={false} connectNulls /><Line yAxisId="speed" dataKey="speed" name="Selected speed" stroke="#f0eadc" strokeWidth={2.4} dot={false} connectNulls /></>}
          {channels.has("brake") && <><Line yAxisId="input" dataKey="brakeRef" name="Reference brake" stroke="#55c7f7" strokeDasharray="4 4" dot={false} /><Line yAxisId="input" dataKey="brake" name="Selected brake" stroke="#ff8c69" dot={false} /></>}
          {channels.has("throttle") && <><Line yAxisId="input" dataKey="throttleRef" name="Reference throttle" stroke="#55c7f7" strokeDasharray="4 4" dot={false} /><Line yAxisId="input" dataKey="throttle" name="Selected throttle" stroke="#6ee7a8" dot={false} /></>}
          {channels.has("steering") && <Line yAxisId="input" dataKey="steering" name="Steering ×100" stroke="#f3b642" dot={false} />}
          {channels.has("g_force") && <Line yAxisId="input" dataKey="g" name="Sustained lateral G" stroke="#b59cff" dot={false} />}
          <Legend />
        </LineChart></ResponsiveContainer> : <EmptyState detail="This lap does not contain enough clean samples inside the selected segment." />}
      </div>
      <div className="coach-evidence-footer">
        <div className="segment-minimap"><span>Segment location</span><div><i style={{ left: `${finding.start_pct}%`, width: `${Math.max(2, finding.end_pct - finding.start_pct)}%` }} /></div><small>Start / finish</small></div>
        <div className="coach-metrics">{Object.entries(finding.metrics).filter(([, value]) => value != null && Math.abs(Number(value)) > 0.001).map(([key, value]) => <div key={key}><span>{metricLabel[key] || key}</span><strong>{metricValue(key, value)}</strong></div>)}</div>
      </div>
    </section>
  );
}

function LapQualityLedger({ laps }: { laps: LiveLapSummary[] }) {
  return <section className="coach-ledger" aria-labelledby="session-laps-title"><div className="coach-ledger-head"><span><ShieldCheck size={17} /><strong id="session-laps-title">Session laps</strong></span><small>{laps.filter((lap) => lap.valid_lap !== false).length} used · {laps.filter((lap) => lap.valid_lap === false).length} excluded</small></div>
    <div className="table-wrap"><table><thead><tr><th>Lap</th><th>Use</th><th>Time</th><th>Data</th><th>Vs usual</th><th>Reason</th></tr></thead><tbody>{laps.map((lap) => <tr key={lap.lap_number}><td><strong>#{lap.lap_number}</strong></td><td>{lap.role || "--"}</td><td>{formatRaceTime(lap.lap_time)}</td><td><span className={`quality-word ${qualityClass(lap.quality_state)}`}>{lap.quality_state || lapStatus(lap)}</span></td><td>{signed(lap.gap_to_representative)}</td><td>{lap.reason || `${lap.flagged_samples || 0} samples ignored · ${lap.quality_score ?? "--"}% quality`}</td></tr>)}</tbody></table></div>
  </section>;
}

export function LiveLapAnalysis() {
  const [payload, setPayload] = useState<LiveLapAnalysisPayload | null>(null);
  const [selectedLap, setSelectedLap] = useState<number | null>(null);
  const [referenceLap, setReferenceLap] = useState<number | null>(null);
  const [selectedTimestamp, setSelectedTimestamp] = useState<number | null>(null);
  const [status, setStatus] = useState("Waiting for valid live laps");
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [selectedCorner, setSelectedCorner] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<"session" | "compare">("session");

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const data = await api.liveLapAnalysis(selectedLap, referenceLap);
        if (cancelled) return;
        setPayload(data);
        setSelectedLap((current) => data.laps.some((lap) => lap.lap_number === current) ? current : data.selected_lap_number ?? null);
        setReferenceLap((current) => data.laps.some((lap) => lap.lap_number === current) ? current : data.reference_lap_number ?? null);
        setSelectedTimestamp((current) => {
          const stillInLap = current != null && data.current_lap_data.some((sample) => {
            const time = timeOf(sample);
            return time != null && Math.abs(time - current) < 0.05;
          });
          return stillInLap ? current : data.insights.find((item) => item.timestamp != null)?.timestamp ?? data.current_lap_data[0]?.lap_time ?? null;
        });
        setStatus(data.laps.length ? "Live lap analysis ready" : "Complete a lap to unlock analysis");
      } catch (exc) {
        if (!cancelled) setStatus(exc instanceof Error ? exc.message : String(exc));
      } finally {
        if (!cancelled) timer = window.setTimeout(load, 2500);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [selectedLap, referenceLap]);

  const insights = useMemo(() => splitInsights(payload?.insights || []), [payload?.insights]);
  const findings = useMemo(() => (payload?.findings || []).filter((finding) => selectedCorner == null || finding.corner_id === selectedCorner), [payload?.findings, selectedCorner]);
  const selectedFinding = useMemo(() => (payload?.findings || []).find((finding) => finding.id === selectedFindingId) || findings[0] || null, [payload?.findings, selectedFindingId, findings]);
  useEffect(() => {
    if (selectedFinding && selectedFinding.id !== selectedFindingId) setSelectedFindingId(selectedFinding.id);
  }, [selectedFinding, selectedFindingId]);
  if (!payload) return <div className="page grid"><section className="card span-12"><EmptyState detail={status} /></section></div>;
  const handleInsight = (insight: TelemetryInsight) => {
    if (insight.timestamp != null) setSelectedTimestamp(insight.timestamp);
  };
  const chooseCorner = (corner: number) => { setSelectedCorner((current) => current === corner ? null : corner); const match = (payload.findings || []).find((finding) => finding.corner_id === corner); if (match) setSelectedFindingId(match.id); };
  const changeMode = (mode: "session" | "compare") => {
    setAnalysisMode(mode);
    if (mode === "session") {
      setSelectedLap(payload.references?.representative_pace_lap ?? payload.session_summary?.representative_lap_number ?? selectedLap);
      setReferenceLap(payload.references?.personal_best_lap ?? referenceLap);
    }
  };
  return <div className="page lap-analysis-page coach-page">
    <SessionControls payload={payload} selectedLap={selectedLap} referenceLap={referenceLap} setSelectedLap={setSelectedLap} setReferenceLap={setReferenceLap} mode={analysisMode} setMode={changeMode} />
    {!payload.laps.length ? <section className="coach-empty"><Flag size={26} /><EmptyState detail={status} /></section> : <>
      <SessionVerdict payload={payload} />
      <OpportunityMap corners={payload.corner_opportunities || []} selectedCorner={selectedCorner} onSelect={chooseCorner} />
      <div className="coach-workspace">
        <FindingList findings={findings} activeId={selectedFinding?.id || null} onSelect={(finding) => setSelectedFindingId(finding.id)} showAll={showAll} setShowAll={setShowAll} />
        <FindingDetail finding={selectedFinding} current={payload.current_lap_data} reference={payload.reference_lap_data} />
      </div>
      <section className="coach-explorer" aria-labelledby="telemetry-explorer-title">
        <div className="coach-section-heading"><div><span>05 · Telemetry explorer</span><h2 id="telemetry-explorer-title">Inspect the engineering layer</h2></div><p>These full-lap views preserve the raw comparison tools. Flagged samples remain visible but are excluded from coaching baselines.</p></div>
        <div className="coach-graph-notes"><div><Gauge size={17} /><span><strong>G-force</strong><small>Robust P99: {fmt(payload.session_summary?.robust_peak_combined_g, 2, "G")}. Sustained load matters more than an isolated spike.</small></span></div><div><CircleGauge size={17} /><span><strong>Handling</strong><small>Compare the selected lap with your own clean reference; inferred balance signatures are possibilities, not setup verdicts.</small></span></div><div><Info size={17} /><span><strong>Selection sync</strong><small>Legacy event findings still move the event marker across these full-lap engineering plots.</small></span></div></div>
        <div className="grid coach-explorer-grid">
          <FrictionCircle current={payload.current_lap_data} ghost={payload.reference_lap_data} selectedTimestamp={selectedTimestamp} />
          <TireHealthMatrix samples={payload.current_lap_data} selectedTimestamp={selectedTimestamp} />
          <HandlingDiagram current={payload.current_lap_data} selectedTimestamp={selectedTimestamp} kus={payload.metrics.understeer_gradient} />
          <PowerOutputChart current={payload.current_lap_data} ghost={payload.reference_lap_data} selectedTimestamp={selectedTimestamp} />
          <SuspensionPlatform current={payload.current_lap_data} ghost={payload.reference_lap_data} selectedTimestamp={selectedTimestamp} />
          <InsightCard title="Secondary diagnostics" insights={[...insights.driver, ...insights.setup]} selectedTimestamp={selectedTimestamp} onSelect={handleInsight} />
        </div>
      </section>
      <LapQualityLedger laps={payload.laps} />
    </>}
  </div>;
}
