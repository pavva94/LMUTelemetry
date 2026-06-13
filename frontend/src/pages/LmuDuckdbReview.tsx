import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";
import { SectionTitle } from "../components/SectionTitle";
import { chartLabelFormatter, chartValueFormatter, isRaceTimeField } from "../lib/telemetryFields";
import { formatRaceTime } from "../lib/timeFormat";
import type { LmuDuckdbSession } from "../types/lmuDuckdb";
import type { SessionReview as Review } from "../types/session";

type Row = Record<string, number | string | boolean | null | undefined>;
type GpsPoint = {
  lap: string;
  lapLabel: string;
  progress: number;
  x: number;
  y: number;
  lat: number;
  lon: number;
  throttle: number | null;
  brake: number | null;
  speed: number | null;
  time: number | null;
};
type TrackSegment = { from: GpsPoint; to: GpsPoint; color: string; delta: number | null };

const DEFAULT_FOLDER = "G:\\SteamLibrary\\steamapps\\common\\Le Mans Ultimate\\UserData\\Telemetry";
const SCAN_LIMIT = 250;

const fmt = (value?: number | null, digits = 1, suffix = "") =>
  value == null || Number.isNaN(value) ? "--" : `${value.toFixed(digits)}${suffix}`;
const text = (value?: string | number | boolean | null) => (value == null || value === "" ? "--" : String(value));
const dateText = (value?: string | null) => value ? new Date(value).toLocaleString() : "--";
const carName = (session?: LmuDuckdbSession | null) => session?.vehicle_model || session?.vehicle_name || null;
const fileSize = (bytes?: number | null) => {
  if (bytes == null) return "--";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};
const sessionTitle = (session?: LmuDuckdbSession | null) =>
  [session?.session_type, session?.track_name, carName(session)].filter(Boolean).join(" - ") || session?.file_name || "DuckDB session";
const percentDelta = (a?: number | null, b?: number | null) => {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return "--";
  const scale = Math.max(Math.abs(a), Math.abs(b)) <= 1 ? 100 : 1;
  const delta = (a - b) * scale;
  return `${delta > 0 ? "+" : ""}${delta.toFixed(0)} pp`;
};
const pointNumber = (row: Row, key: string) => {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : null;
};

function EmptyState({ detail }: { detail: string }) {
  return <div className="empty-state"><strong>No data yet</strong><span>{detail}</span></div>;
}

function Metric({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return <div className="metric compact"><span className="label">{label}</span><span className="value">{value}</span>{sub && <span className="subvalue">{sub}</span>}</div>;
}

function avg(rows: Row[], key: string) {
  const values = rows.map((row) => Number(row[key])).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function max(rows: Row[], key: string) {
  const values = rows.map((row) => Number(row[key])).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

function averageFiveLapPace(laps: Row[]) {
  const lapTimes = laps
    .filter((lap) => !lap.in_pit)
    .map((lap) => Number(lap.lap_time))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (lapTimes.length < 5) return null;
  const windowAverages = lapTimes.slice(0, -4).map((_, index) => {
    const window = lapTimes.slice(index, index + 5);
    return window.reduce((sum, value) => sum + value, 0) / window.length;
  });
  return windowAverages.reduce((sum, value) => sum + value, 0) / windowAverages.length;
}

function quantile(values: number[], fraction: number) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const position = (ordered.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return ordered[lower];
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower);
}

function withoutOutliers(values: number[]) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 4) return clean;
  const q1 = quantile(clean, 0.25);
  const q3 = quantile(clean, 0.75);
  if (q1 != null && q3 != null && q3 > q1) {
    const iqr = q3 - q1;
    const lower = Math.max(0, q1 - (1.5 * iqr));
    const upper = q3 + (1.5 * iqr);
    const filtered = clean.filter((value) => value >= lower && value <= upper);
    return filtered.length ? filtered : clean;
  }
  const median = quantile(clean, 0.5);
  if (median == null) return clean;
  const mad = quantile(clean.map((value) => Math.abs(value - median)), 0.5);
  if (!mad) return clean;
  const filtered = clean.filter((value) => Math.abs(value - median) / mad <= 3.5);
  return filtered.length ? filtered : clean;
}

function nearestByPosition(points: GpsPoint[], target: GpsPoint) {
  if (!points.length) return null;
  return points.reduce((best, point) => {
    const bestDistance = ((best.x - target.x) ** 2) + ((best.y - target.y) ** 2);
    const pointDistance = ((point.x - target.x) ** 2) + ((point.y - target.y) ** 2);
    return pointDistance < bestDistance ? point : best;
  }, points[0]);
}

function lapElapsed(point: GpsPoint, lapStart: number | null) {
  return point.time != null && lapStart != null ? point.time - lapStart : null;
}

function deltaColor(delta: number | null) {
  if (delta == null || !Number.isFinite(delta)) return "#6fa8ff";
  if (Math.abs(delta) <= 0.05) return "#6fa8ff";
  return delta < 0 ? "#69d28f" : "#ff6961";
}

function deltaSegments(primary: GpsPoint[], comparison: GpsPoint[]): TrackSegment[] {
  const segments: TrackSegment[] = [];
  const primaryStart = primary[0]?.time ?? null;
  const comparisonStart = comparison[0]?.time ?? null;
  for (let index = 0; index < primary.length - 1; index += 1) {
    const point = primary[index];
    const matched = nearestByPosition(comparison, point);
    const primaryElapsed = lapElapsed(point, primaryStart);
    const comparisonElapsed = matched ? lapElapsed(matched, comparisonStart) : null;
    const delta = primaryElapsed != null && comparisonElapsed != null ? primaryElapsed - comparisonElapsed : null;
    segments.push({ from: point, to: primary[index + 1], color: deltaColor(delta), delta });
  }
  return segments;
}

function hasLineData(rows: Row[], lines: Array<[string, string]>) {
  return rows.some((row) => lines.some(([key]) => Number.isFinite(Number(row[key]))));
}

function lapFallbackRow(lap: Row): Row {
  return {
    ...lap,
    game_time: lap.end_time ?? lap.start_time ?? lap.lap_number,
    speed_kph: lap.speed_kph ?? lap.top_speed,
    rpm: lap.rpm ?? lap.max_rpm,
    tyre_wear_fl: lap.tyre_wear_end_fl ?? lap.tyre_wear_end,
    tyre_wear_fr: lap.tyre_wear_end_fr ?? lap.tyre_wear_end,
    tyre_wear_rl: lap.tyre_wear_end_rl ?? lap.tyre_wear_end,
    tyre_wear_rr: lap.tyre_wear_end_rr ?? lap.tyre_wear_end,
  };
}

function Chart({ data, xKey = "game_time", lines, height = 240 }: { data: Row[]; xKey?: string; lines: Array<[string, string]>; height?: number }) {
  if (!data.length) return <EmptyState detail="The selected DuckDB session has no samples for this chart." />;
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

function ChannelSummary({ review }: { review: Review | null }) {
  const manifest = review?.channel_manifest || [];
  if (!manifest.length) return null;
  const mapped = manifest.filter((channel) => channel.mapped_fields?.length);
  const byKind = manifest.reduce<Record<string, number>>((acc, channel) => {
    acc[channel.kind] = (acc[channel.kind] || 0) + 1;
    return acc;
  }, {});
  return (
    <section className="card span-12">
      <SectionTitle title="Available Channels" help="Shows DuckDB tables discovered in the selected file and how many are currently mapped into review fields." />
      <div className="header-grid">
        <Metric label="Tables" value={manifest.length} />
        <Metric label="Mapped" value={mapped.length} />
        {Object.entries(byKind).map(([kind, count]) => <Metric key={kind} label={kind.replace(/_/g, " ")} value={count} />)}
      </div>
      <div className="channel-chip-row">
        {mapped.slice(0, 40).map((channel) => (
          <span className="badge blue" key={channel.table}>{channel.table}</span>
        ))}
      </div>
    </section>
  );
}

function hasFields(rows: Row[], keys: string[]) {
  return rows.some((row) => keys.some((key) => row[key] != null && row[key] !== ""));
}

function LatestValues({ rows, fields }: { rows: Row[]; fields: Array<[string, string]> }) {
  const latest = [...rows].reverse().find((row) => fields.some(([key]) => row[key] != null));
  if (!latest) return <EmptyState detail="No values were found for this section in the selected DuckDB file." />;
  return (
    <div className="motec-value-grid">
      {fields.map(([key, label]) => (
        <div key={key}><span className="label">{label}</span><strong>{text(latest[key])}</strong></div>
      ))}
    </div>
  );
}

function LapTrajectoryMap({ sessionId, samples, laps }: { sessionId: string; samples: Row[]; laps: Row[] }) {
  const fastestPair = useMemo(() => {
    return laps
      .map((lap) => ({ lap: String(lap.lap_number ?? ""), time: Number(lap.lap_time), inPit: Boolean(lap.in_pit) }))
      .filter((lap) => lap.lap && Number.isFinite(lap.time) && lap.time > 0 && !lap.inPit)
      .sort((a, b) => a.time - b.time)
      .slice(0, 2)
      .map((lap) => lap.lap);
  }, [laps]);
  const lapOptions = useMemo(() => {
    const fromLaps = laps.map((lap) => String(lap.lap_number ?? "")).filter(Boolean);
    const fromSamples = samples.map((sample) => String(sample.lap_number ?? "")).filter(Boolean);
    return Array.from(new Set([...fromLaps, ...fromSamples])).sort((a, b) => Number(a) - Number(b));
  }, [laps, samples]);
  const [lapA, setLapA] = useState("");
  const [lapB, setLapB] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selectedPoint, setSelectedPoint] = useState<GpsPoint | null>(null);
  const [trajectoryRows, setTrajectoryRows] = useState<Row[]>([]);
  const [trajectoryStatus, setTrajectoryStatus] = useState("");
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const width = 760;
  const height = 620;

  useEffect(() => {
    setLapA(fastestPair[0] || lapOptions[0] || "");
    setLapB(fastestPair[1] || fastestPair[0] || lapOptions[1] || lapOptions[0] || "");
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSelectedPoint(null);
  }, [fastestPair, lapOptions]);

  const lapMeta = useMemo(() => {
    return laps.reduce<Record<string, { time?: number | null; samples?: number | string | boolean | null }>>((acc, lap) => {
      const key = String(lap.lap_number ?? "");
      if (key) acc[key] = { time: pointNumber(lap, "lap_time"), samples: lap.sample_count };
      return acc;
    }, {});
  }, [laps]);

  useEffect(() => {
    if (!sessionId || !lapA) return;
    let mounted = true;
    setTrajectoryStatus("Loading GPS trajectory");
    api.lmuDuckdbTrajectory(sessionId, lapA, lapB, 1800)
      .then((payload) => {
        if (!mounted) return;
        setTrajectoryRows((payload.points || []) as Row[]);
        setTrajectoryStatus(payload.warnings?.[0] || "GPS trajectory loaded");
      })
      .catch((exc) => {
        if (!mounted) return;
        setTrajectoryRows([]);
        setTrajectoryStatus(exc instanceof Error ? exc.message : String(exc));
      });
    return () => {
      mounted = false;
    };
  }, [sessionId, lapA, lapB]);

  const mapData = useMemo(() => {
    const selected = new Set([lapA, lapB].filter(Boolean));
    const raw = trajectoryRows
      .filter((sample) => selected.has(String(sample.lap_number ?? "")))
      .map((sample) => ({
        lap: String(sample.lap_number ?? ""),
        lat: pointNumber(sample, "gps_latitude"),
        lon: pointNumber(sample, "gps_longitude"),
        throttle: pointNumber(sample, "throttle"),
        brake: pointNumber(sample, "brake"),
        speed: pointNumber(sample, "speed_kph"),
        time: pointNumber(sample, "game_time"),
      }))
      .filter((sample): sample is Omit<GpsPoint, "x" | "y" | "lapLabel"> => sample.lat != null && sample.lon != null);
    if (!raw.length) return { byLap: {} as Record<string, GpsPoint[]>, count: 0 };
    const rawLats = raw.map((point) => point.lat);
    const rawLons = raw.map((point) => point.lon);
    const coordinatesAreRadians = Math.max(...rawLats.map(Math.abs)) <= Math.PI / 2 && Math.max(...rawLons.map(Math.abs)) <= Math.PI;
    const latDegrees = coordinatesAreRadians ? rawLats.map((value) => value * 180 / Math.PI) : rawLats;
    const lonDegrees = coordinatesAreRadians ? rawLons.map((value) => value * 180 / Math.PI) : rawLons;
    const centerLat = latDegrees.reduce((sum, value) => sum + value, 0) / latDegrees.length;
    const centerLon = lonDegrees.reduce((sum, value) => sum + value, 0) / lonDegrees.length;
    const metersPerDegreeLat = 111_132;
    const metersPerDegreeLon = Math.max(1, 111_320 * Math.cos(centerLat * Math.PI / 180));
    const local = raw.map((point, index) => ({
      ...point,
      mx: (lonDegrees[index] - centerLon) * metersPerDegreeLon,
      my: (latDegrees[index] - centerLat) * metersPerDegreeLat,
    }));
    const xs = local.map((point) => point.mx);
    const ys = local.map((point) => point.my);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const xSpan = Math.max(maxX - minX, 1);
    const ySpan = Math.max(maxY - minY, 1);
    const innerW = width - 80;
    const innerH = height - 80;
    const scale = Math.min(innerW / xSpan, innerH / ySpan);
    const drawW = xSpan * scale;
    const drawH = ySpan * scale;
    const offsetX = (width - drawW) / 2;
    const offsetY = (height - drawH) / 2;
    const byLapRaw = local.reduce<Record<string, typeof local>>((acc, point) => {
      (acc[point.lap] ||= []).push(point);
      return acc;
    }, {});
    const byLap: Record<string, GpsPoint[]> = {};
    Object.entries(byLapRaw).forEach(([lap, lapPoints]) => {
      const orderedPoints = [...lapPoints].sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
      const denominator = Math.max(1, lapPoints.length - 1);
      byLap[lap] = orderedPoints.map((point, index) => ({
        ...point,
        lapLabel: `Lap ${point.lap}`,
        progress: index / denominator,
        x: offsetX + (point.mx - minX) * scale,
        y: offsetY + drawH - (point.my - minY) * scale,
      }));
    });
    return {
      byLap,
      count: Object.values(byLap).reduce((sum, points) => sum + points.length, 0),
    };
  }, [trajectoryRows, lapA, lapB]);

  const pairedHover = useMemo(() => {
    if (!selectedPoint) return null;
    const otherLap = selectedPoint.lap === lapA ? lapB : lapA;
    const candidates = mapData.byLap[otherLap] || [];
    return nearestByPosition(candidates, selectedPoint);
  }, [selectedPoint, lapA, lapB, mapData.byLap]);

  const activePoints = [selectedPoint, pairedHover].filter((point): point is GpsPoint => Boolean(point));

  const viewWidth = width / zoom;
  const viewHeight = height / zoom;
  const maxPanX = (width - viewWidth) / 2;
  const maxPanY = (height - viewHeight) / 2;
  const clampedPan = {
    x: Math.max(-maxPanX, Math.min(maxPanX, pan.x)),
    y: Math.max(-maxPanY, Math.min(maxPanY, pan.y)),
  };
  const viewBox = `${(width - viewWidth) / 2 + clampedPan.x} ${(height - viewHeight) / 2 + clampedPan.y} ${viewWidth} ${viewHeight}`;
  const lapStyles: Record<string, { stroke: string; marker: string }> = {
    [lapA]: { stroke: "#6dd6ff", marker: "#d8f3ff" },
    [lapB]: { stroke: "#e6b450", marker: "#ffedba" },
  };
  const hintX = selectedPoint ? Math.max(14, Math.min(width - 274, selectedPoint.x + 14)) : 0;
  const hintY = selectedPoint ? Math.max(14, Math.min(height - 122, selectedPoint.y - 60)) : 0;
  const primaryPoints = mapData.byLap[lapA] || [];
  const comparisonPoints = mapData.byLap[lapB] || [];
  const selectableStep = Math.max(1, Math.ceil(primaryPoints.length / 180));
  const segmentData = deltaSegments(primaryPoints, comparisonPoints);
  const selectedDelta = selectedPoint && pairedHover
    ? (() => {
      const primaryStart = primaryPoints[0]?.time ?? null;
      const comparisonStart = comparisonPoints[0]?.time ?? null;
      const selectedElapsed = lapElapsed(selectedPoint, primaryStart);
      const pairedElapsed = lapElapsed(pairedHover, comparisonStart);
      return selectedElapsed != null && pairedElapsed != null ? selectedElapsed - pairedElapsed : null;
    })()
    : null;

  if (!lapOptions.length) {
    return <EmptyState detail="No completed laps were found for GPS comparison." />;
  }

  if (!mapData.count) {
    return <EmptyState detail={trajectoryStatus || "Loading GPS trajectory for the selected laps."} />;
  }

  return (
    <div className="gps-compare">
      <div className="gps-compare-toolbar">
        <label>Primary lap
          <select value={lapA} onChange={(event) => setLapA(event.target.value)}>
            {lapOptions.map((lap) => <option key={lap} value={lap}>Lap {lap} {lapMeta[lap]?.time ? `- ${formatRaceTime(lapMeta[lap].time)}` : ""}</option>)}
          </select>
        </label>
        <label>Comparison lap
          <select value={lapB} onChange={(event) => setLapB(event.target.value)}>
            {lapOptions.map((lap) => <option key={lap} value={lap}>Lap {lap} {lapMeta[lap]?.time ? `- ${formatRaceTime(lapMeta[lap].time)}` : ""}</option>)}
          </select>
        </label>
        <label>Zoom
          <input type="range" min="1" max="8" step="0.1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
        </label>
        <button type="button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Reset view</button>
      </div>
      <div className="gps-legend">
        {[lapA, lapB].filter(Boolean).map((lap) => (
          <span key={lap} style={{ borderColor: lapStyles[lap]?.stroke }}>{`Lap ${lap} / ${formatRaceTime(lapMeta[lap]?.time ?? null)} / ${text(lapMeta[lap]?.samples)} samples`}</span>
        ))}
        {trajectoryStatus && <span>{trajectoryStatus}</span>}
        <span>{mapData.count} GPS points</span>
        <span className="gps-delta-key faster">Primary faster</span>
        <span className="gps-delta-key similar">Similar</span>
        <span className="gps-delta-key slower">Primary slower</span>
      </div>
      <div className="gps-map-shell">
        <svg
          className="gps-compare-map"
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          onWheel={(event) => {
            event.preventDefault();
            const next = Math.max(1, Math.min(8, zoom + (event.deltaY < 0 ? 0.35 : -0.35)));
            setZoom(next);
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
          }}
          onPointerMove={(event) => {
            if (!dragRef.current) return;
            const factor = 1 / zoom;
            setPan({
              x: dragRef.current.panX - (event.clientX - dragRef.current.x) * factor,
              y: dragRef.current.panY - (event.clientY - dragRef.current.y) * factor,
            });
          }}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerLeave={() => { dragRef.current = null; }}
        >
          <rect x="0" y="0" width={width} height={height} fill="transparent" />
          <defs>
            <filter id="gps-track-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#000000" floodOpacity="0.55" />
            </filter>
          </defs>
          {Object.entries(mapData.byLap).map(([lap, points]) => (
            <g key={lap}>
              <polyline
                points={points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ")}
                fill="none"
                stroke="#05080b"
                strokeWidth={lap === lapA ? 13 : 10}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={lap === lapA ? 0.94 : 0.78}
                filter="url(#gps-track-glow)"
              />
              <polyline
                points={points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ")}
                fill="none"
                stroke={lapStyles[lap]?.stroke || "#d9e3ea"}
                strokeWidth={lap === lapA ? 5.5 : 4}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={lap === lapA ? 0.95 : 0.74}
                strokeDasharray={lap === lapA ? undefined : "12 9"}
              />
            </g>
          ))}
          {segmentData.map((segment, index) => (
            <line
              key={`delta-segment-${index}`}
              x1={segment.from.x}
              y1={segment.from.y}
              x2={segment.to.x}
              y2={segment.to.y}
              stroke={segment.color}
              strokeWidth="4.2"
              strokeLinecap="round"
              opacity="0.96"
              pointerEvents="none"
            />
          ))}
          {primaryPoints.map((point, index) => (
            index % selectableStep === 0 || index === primaryPoints.length - 1 ? (
                <circle
                  key={`hit-${point.lap}-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r="10"
                  fill="transparent"
                  stroke="#ffffff"
                  strokeWidth="1"
                  opacity="0"
                  pointerEvents="auto"
                  className="gps-selectable-point"
                  onClick={() => setSelectedPoint(point)}
                />
            ) : null
          ))}
          {selectedPoint && pairedHover && (
            <line
              x1={selectedPoint.x}
              y1={selectedPoint.y}
              x2={pairedHover.x}
              y2={pairedHover.y}
              stroke="#ffffff"
              strokeWidth="1.5"
              strokeDasharray="6 5"
              opacity="0.78"
            />
          )}
          {activePoints.map((point) => (
            <circle
              key={`active-${point.lap}`}
              cx={point.x}
              cy={point.y}
              r="8"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2"
              pointerEvents="none"
            />
          ))}
          {selectedPoint && pairedHover && (
            <foreignObject x={hintX} y={hintY} width="260" height="108" pointerEvents="none">
              <div className="gps-point-hint">
                <strong>{Math.round(selectedPoint.progress * 100)}% lap distance</strong>
                <span>Delta {selectedDelta == null ? "--" : `${selectedDelta > 0 ? "+" : ""}${selectedDelta.toFixed(3)}s`}</span>
                <span>Throttle diff {percentDelta(selectedPoint.throttle, pairedHover.throttle)}</span>
                <span>Brake diff {percentDelta(selectedPoint.brake, pairedHover.brake)}</span>
              </div>
            </foreignObject>
          )}
        </svg>
      </div>
    </div>
  );
}

export function LmuDuckdbReview() {
  const [folder, setFolder] = useState(DEFAULT_FOLDER);
  const [sessions, setSessions] = useState<LmuDuckdbSession[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [currentOffset, setCurrentOffset] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [status, setStatus] = useState("Paste the LMU telemetry folder and scan");
  const [busy, setBusy] = useState(false);

  const loadPage = async (offset = 0) => {
    setBusy(true);
    setStatus(offset ? "Loading cached DuckDB page" : "Loading cached DuckDB sessions");
    if (!offset) {
      setWarnings([]);
      setReview(null);
      setNextOffset(null);
      setTotal(null);
    }
    try {
      const payload = await api.lmuDuckdbSessions(SCAN_LIMIT, offset);
      setSessions(payload.sessions);
      setWarnings(payload.warnings || []);
      setNextOffset(payload.next_offset ?? null);
      setCurrentOffset(payload.offset);
      setTotal(payload.total);
      const firstId = payload.sessions[0]?.id || "";
      setSelectedId(firstId);
      const loaded = offset + payload.sessions.length;
      setStatus(payload.total ? `Showing ${offset + 1}-${loaded} of ${payload.total} cached DuckDB sessions` : "No cached DuckDB sessions found");
    } catch (exc) {
      if (!offset) {
        setSessions([]);
        setSelectedId("");
      }
      setStatus(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(false);
    }
  };

  const useFolder = async () => {
    if (!folder.trim()) return;
    setBusy(true);
    setStatus("Saving DuckDB folder");
    try {
      const settings = await api.saveLmuDuckdbSettings(folder.trim());
      if (settings.folder_path) setFolder(settings.folder_path);
      await loadPage(0);
    } catch (exc) {
      setStatus(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    api.lmuDuckdbSettings()
      .then((settings) => {
        if (!mounted) return;
        if (settings.folder_path) setFolder(settings.folder_path);
        setStatus(settings.last_sync_status || "Sync the LMU telemetry folder from User Profile");
        return loadPage(0);
      })
      .catch((exc) => mounted && setStatus(exc instanceof Error ? exc.message : String(exc)));
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let mounted = true;
    setStatus("Loading selected DuckDB session");
    api.reviewCachedLmuDuckdbSession(selectedId, 300)
      .then((data) => {
        if (!mounted) return;
        setReview(data);
        const extraWarnings = ((data as Review & { warnings?: string[] }).warnings || []);
        setWarnings((current) => Array.from(new Set([...current, ...extraWarnings])));
        setStatus("DuckDB session loaded");
      })
      .catch((exc) => mounted && setStatus(exc instanceof Error ? exc.message : String(exc)));
    return () => {
      mounted = false;
    };
  }, [selectedId]);

  const selectedSession = ((review?.session?.id === selectedId ? review.session : null) || sessions.find((session) => session.id === selectedId) || null) as LmuDuckdbSession | null;
  const metadataRows = Object.entries(selectedSession?.metadata || {}).slice(0, 16);
  const samples = (review?.telemetry_samples || []) as Row[];
  const laps = (review?.laps || []) as Row[];
  const lapFallbackRows = useMemo(() => laps.map(lapFallbackRow), [laps]);
  const chartRows = (lines: Array<[string, string]>) => {
    if (hasLineData(samples, lines)) return { data: samples, xKey: "game_time" };
    if (hasLineData(lapFallbackRows, lines)) return { data: lapFallbackRows, xKey: "lap_number" };
    return { data: [], xKey: "game_time" };
  };

  const summary = useMemo(() => {
    const aggregate = review?.summary;
    const validFuelUsed = laps
      .filter((lap) => !lap.in_pit && Number(lap.lap_time) > 0)
      .map((lap) => Number(lap.fuel_used))
      .filter((value) => Number.isFinite(value) && value > 0);
    const fuelUsedForAverage = withoutOutliers(validFuelUsed);
    const fuelUsed = validFuelUsed.reduce((sum, value) => sum + value, 0);
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
      avgFuelPerLap: aggregate?.average_fuel_per_lap ?? (fuelUsedForAverage.length ? fuelUsedForAverage.reduce((sum, value) => sum + value, 0) / fuelUsedForAverage.length : null),
      fiveLapPace: aggregate?.average_five_lap_pace ?? averageFiveLapPace(laps),
      fuelUsed: aggregate?.total_fuel_used ?? (fuelUsed || null),
      distance: aggregate?.total_distance_km,
      tyreWear: aggregate?.average_tyre_wear,
      tyreLifeRemaining: aggregate?.average_tyre_life_remaining,
      tyreTemp: aggregate?.average_tyre_temp,
      tyrePressure: aggregate?.average_tyre_pressure,
      brakeTemp: aggregate?.average_brake_temp,
    };
  }, [laps, samples, review?.summary, selectedSession?.sample_count]);

  const speedLines: Array<[string, string]> = [["speed_kph", "#e6b450"], ["rpm", "#6dd6ff"]];
  const inputLines: Array<[string, string]> = [["throttle", "#69d28f"], ["brake", "#ff6961"], ["steering", "#c7a8ff"]];
  const tyreWearLines: Array<[string, string]> = [["tyre_wear_fl", "#6dd6ff"], ["tyre_wear_fr", "#ff8c69"], ["tyre_wear_rl", "#91e48f"], ["tyre_wear_rr", "#c7a8ff"]];
  const tyreTempLines: Array<[string, string]> = [["tyre_temp_fl", "#6dd6ff"], ["tyre_temp_fr", "#ff8c69"], ["tyre_temp_rl", "#91e48f"], ["tyre_temp_rr", "#c7a8ff"]];
  const brakeTempLines: Array<[string, string]> = [["brake_temp_fl", "#6dd6ff"], ["brake_temp_fr", "#ff8c69"], ["brake_temp_rl", "#91e48f"], ["brake_temp_rr", "#c7a8ff"]];
  const rideHeightLines: Array<[string, string]> = [["ride_height_fl", "#6dd6ff"], ["ride_height_fr", "#ff8c69"], ["ride_height_rl", "#91e48f"], ["ride_height_rr", "#c7a8ff"]];
  const sectorLines: Array<[string, string]> = [["sector", "#6dd6ff"], ["sector1", "#e6b450"], ["sector2", "#69d28f"], ["last_sector1", "#ff8c69"], ["last_sector2", "#c7a8ff"]];
  const flagLines: Array<[string, string]> = [["sector1_flag", "#6dd6ff"], ["sector2_flag", "#e6b450"], ["sector3_flag", "#69d28f"], ["yellow_flag_state", "#ff6961"]];
  const assistLines: Array<[string, string]> = [["abs_active", "#6dd6ff"], ["tc_active", "#69d28f"], ["abs_level", "#e6b450"], ["tc_level", "#c7a8ff"], ["brake_bias_rear", "#ff8c69"], ["brake_migration", "#ff6961"]];
  const gpsLines: Array<[string, string]> = [["gps_latitude", "#6dd6ff"], ["gps_longitude", "#ff8c69"], ["g_force_lat", "#e6b450"], ["g_force_long", "#69d28f"], ["g_force_vert", "#c7a8ff"], ["path_lateral", "#ff6961"], ["track_edge", "#9cc9ff"]];
  const brakeDetailLines: Array<[string, string]> = [["brake_air_temp_fl", "#6dd6ff"], ["brake_air_temp_fr", "#ff8c69"], ["brake_force_fl", "#e6b450"], ["brake_force_fr", "#69d28f"], ["brake_thickness_fl", "#c7a8ff"], ["brake_thickness_fr", "#ff6961"]];
  const tyreDetailLines: Array<[string, string]> = [["tyre_temp_carcass_fl", "#6dd6ff"], ["tyre_temp_rim_fl", "#ff8c69"], ["tyre_temp_rubber_fl", "#e6b450"], ["tyre_temp_left_fl", "#69d28f"], ["tyre_temp_right_fl", "#c7a8ff"]];
  const energyLines: Array<[string, string]> = [["soc", "#6dd6ff"], ["virtual_energy", "#e6b450"], ["regen_rate", "#69d28f"], ["turbo_boost_pressure", "#ff8c69"], ["clutch", "#c7a8ff"], ["clutch_rpm", "#ff6961"]];
  const environmentLines: Array<[string, string]> = [["minimum_path_wetness", "#6dd6ff"], ["offpath_wetness", "#e6b450"], ["cloud_darkness", "#69d28f"], ["wind_speed", "#ff8c69"], ["wind_heading", "#c7a8ff"], ["speed_limiter", "#ff6961"]];
  const speedChart = chartRows(speedLines);
  const inputChart = chartRows(inputLines);
  const tyreWearChart = chartRows(tyreWearLines);
  const tyreTempChart = chartRows(tyreTempLines);
  const brakeTempChart = chartRows(brakeTempLines);
  const rideHeightChart = chartRows(rideHeightLines);
  const sectorChart = chartRows(sectorLines);
  const flagChart = chartRows(flagLines);
  const assistChart = chartRows(assistLines);
  const gpsChart = chartRows(gpsLines);
  const brakeDetailChart = chartRows(brakeDetailLines);
  const tyreDetailChart = chartRows(tyreDetailLines);
  const energyChart = chartRows(energyLines);
  const environmentChart = chartRows(environmentLines);
  const available = review?.available_fields || {};
  const showPosition = Boolean(available.position);
  const showClassPosition = Boolean(available.class_position);

  return (
    <div className="duckdb-workspace">
      <aside className="duckdb-browser">
        <SectionTitle title="Session Review" help="Read-only review of cached Le Mans Ultimate DuckDB sessions. Raw chart samples are loaded from the selected DuckDB file on demand." />
        <div className="duckdb-path-grid">
          <label>Telemetry folder<input value={folder} onChange={(event) => setFolder(event.target.value)} placeholder={DEFAULT_FOLDER} /></label>
          <button disabled={busy || !folder.trim()} onClick={() => void useFolder()}>Use folder</button>
          <button className="primary" disabled={busy} onClick={() => void loadPage(0)}>Refresh list</button>
          <input value={status} readOnly />
        </div>
        {warnings.map((warning) => <p className="motec-warning" key={warning}>{warning}</p>)}
        <div className="duckdb-pager">
          <button disabled={busy || currentOffset <= 0} onClick={() => void loadPage(Math.max(0, currentOffset - SCAN_LIMIT))}>Previous {SCAN_LIMIT}</button>
          <button disabled={busy || nextOffset == null} onClick={() => nextOffset != null && void loadPage(nextOffset)}>Next {SCAN_LIMIT}</button>
        </div>
        {total != null && <div className="muted duckdb-count">{sessions.length ? `${currentOffset + 1}-${currentOffset + sessions.length}` : "0"} of {total}</div>}
        {sessions.length ? (
          <div className="duckdb-session-list">
            {sessions.map((session) => (
              <button key={session.id} className={selectedId === session.id ? "active" : ""} onClick={() => setSelectedId(session.id)}>
                <strong>{sessionTitle(session)}</strong>
                <span>{text(session.file_name)}</span>
                <small>{dateText(session.created_at)} / {fileSize(session.file_size_bytes)}</small>
              </button>
            ))}
          </div>
        ) : <EmptyState detail="No sessions cached yet. Set and sync the LMU DuckDB folder from User Profile." />}
      </aside>

      <main className="duckdb-analysis page grid">
      <section className="card span-12">
        <div className="header-grid">
          <Metric label="Database" value={sessionTitle(selectedSession)} />
          <Metric label="File" value={text(selectedSession?.file_name)} />
          <Metric label="Size" value={fileSize(selectedSession?.file_size_bytes)} />
          <Metric label="Track" value={text(selectedSession?.track_name)} />
          <Metric label="Session" value={text(selectedSession?.session_type)} />
          <Metric label="Car" value={text(carName(selectedSession))} />
          <Metric label="Laps" value={summary.laps} />
          <Metric label="Samples" value={summary.samples} sub={summary.storedSamples ? `${summary.storedSamples} native rows` : "mapped review samples"} />
          <Metric label="Best lap" value={formatRaceTime(summary.bestLap)} />
          <Metric label="Average lap" value={formatRaceTime(summary.avgLap)} />
          <Metric label="Avg 5-lap pace" value={formatRaceTime(summary.fiveLapPace)} />
          <Metric label="Top speed" value={fmt(summary.topSpeed, 0, " km/h")} />
          <Metric label="Fuel used" value={fmt(summary.fuelUsed, 2, " L")} />
          <Metric label="Avg fuel/lap" value={fmt(summary.avgFuelPerLap, 2, " L")} />
          <Metric label="Distance" value={fmt(summary.distance, 1, " km")} />
          <Metric label="Avg tyre wear used" value={fmt(summary.tyreWear, 2, "%")} sub={summary.tyreLifeRemaining != null ? `${fmt(summary.tyreLifeRemaining, 1, "%")} life left` : undefined} />
          <Metric label="Avg tyre temp" value={fmt(summary.tyreTemp, 0, " C")} />
          <Metric label="Avg pressure" value={fmt(summary.tyrePressure, 1)} />
          <Metric label="Avg brake temp" value={fmt(summary.brakeTemp, 0, " C")} />
        </div>
      </section>
      {metadataRows.length > 0 && (
        <section className="card span-12">
          <SectionTitle title="Database Metadata" help="Values read from the native DuckDB metadata table for the selected session." />
          <div className="motec-value-grid">
            {metadataRows.map(([key, value]) => <div key={key}><span className="label">{key}</span><strong>{value}</strong></div>)}
          </div>
        </section>
      )}
      <ChannelSummary review={review} />

      <section className="card span-6"><SectionTitle title="Lap Times" help="Shows detected lap pace from native LMU telemetry." /><Chart data={laps} xKey="lap_number" lines={[["lap_time", "#6dd6ff"]]} /></section>
      <section className="card span-6"><SectionTitle title="Lap Fuel" help="Shows fuel used and added per detected lap." /><Chart data={laps} xKey="lap_number" lines={[["fuel_used", "#e6b450"], ["fuel_added", "#69d28f"]]} /></section>
      <section className="card span-6"><SectionTitle title="Speed And RPM" help="Shows powertrain and speed history from mapped DuckDB channels." /><Chart data={speedChart.data} xKey={speedChart.xKey} lines={speedLines} /></section>
      <section className="card span-6"><SectionTitle title="Driver Inputs" help="Shows throttle, brake, and steering channels when available." /><Chart data={inputChart.data} xKey={inputChart.xKey} lines={inputLines} /></section>
      <section className="card span-6"><SectionTitle title="Tyre Wear" help="Tracks detected tyre wear by corner." /><Chart data={tyreWearChart.data} xKey={tyreWearChart.xKey} lines={tyreWearLines} /></section>
      <section className="card span-6"><SectionTitle title="Tyre Temperatures" help="Shows tyre heat by corner when available." /><Chart data={tyreTempChart.data} xKey={tyreTempChart.xKey} lines={tyreTempLines} /></section>
      <section className="card span-6"><SectionTitle title="Brake Temperatures" help="Shows brake heat by corner when available." /><Chart data={brakeTempChart.data} xKey={brakeTempChart.xKey} lines={brakeTempLines} /></section>
      <section className="card span-6"><SectionTitle title="Ride Heights" help="Shows platform movement when available." /><Chart data={rideHeightChart.data} xKey={rideHeightChart.xKey} lines={rideHeightLines} /></section>
      {available.sectors && <section className="card span-6"><SectionTitle title="Sectors" help="Shows current, last, and best sector timing channels when LMU stores them." /><Chart data={sectorChart.data} xKey={sectorChart.xKey} lines={sectorLines} /></section>}
      {available.flags && <section className="card span-6"><SectionTitle title="Flags" help="Shows sector and yellow flag state channels when available." /><Chart data={flagChart.data} xKey={flagChart.xKey} lines={flagLines} /></section>}
      {available.assists && <section className="card span-6"><SectionTitle title="Assists And Settings" help="Shows ABS, TC, fuel map, brake bias, and brake migration channels." /><Chart data={assistChart.data} xKey={assistChart.xKey} lines={assistLines} /></section>}
      {available.gps && <section className="card span-6"><SectionTitle title="GPS, G-Force, And Path" help="Shows GPS, G-force, distance, and path channels from the native DuckDB." /><Chart data={gpsChart.data} xKey={gpsChart.xKey} lines={gpsLines} /></section>}
      {available.brake_detail && <section className="card span-6"><SectionTitle title="Brake Detail" help="Shows brake air temperature, force, and thickness channels when available." /><Chart data={brakeDetailChart.data} xKey={brakeDetailChart.xKey} lines={brakeDetailLines} /></section>}
      {available.tyre_detail && <section className="card span-6"><SectionTitle title="Tyre Detail" help="Shows additional tyre carcass, rim, rubber, and tread temperature channels." /><Chart data={tyreDetailChart.data} xKey={tyreDetailChart.xKey} lines={tyreDetailLines} /></section>}
      {available.energy && <section className="card span-6"><SectionTitle title="Energy And Powertrain" help="Shows SoC, virtual energy, regen, turbo boost, clutch, and clutch RPM channels." /><Chart data={energyChart.data} xKey={energyChart.xKey} lines={energyLines} /></section>}
      {available.environment && <section className="card span-6"><SectionTitle title="Environment And Status" help="Shows wetness, wind, limiter, flap, and status channels when available." /><Chart data={environmentChart.data} xKey={environmentChart.xKey} lines={environmentLines} /></section>}
      {(hasFields(samples, ["headlights", "front_flap_active", "rear_flap_active", "rear_flap_legal", "surface_type_fl", "surface_type_fr", "wheels_detached_fl", "wheels_detached_fr", "tyre_compound_fl", "tyre_compound_fr"]) || available.environment || available.tyre_detail) && (
        <section className="card span-12">
          <SectionTitle title="Latest Status Values" help="Shows the latest sparse or event-style values mapped from the selected DuckDB file." />
          <LatestValues rows={samples} fields={[
            ["headlights", "Headlights"],
            ["speed_limiter", "Speed limiter"],
            ["front_flap_active", "Front flap"],
            ["rear_flap_active", "Rear flap"],
            ["rear_flap_legal", "Rear flap legal"],
            ["surface_type_fl", "Surface FL"],
            ["surface_type_fr", "Surface FR"],
            ["wheels_detached_fl", "Wheel detached FL"],
            ["wheels_detached_fr", "Wheel detached FR"],
            ["tyre_compound_fl", "Tyre compound FL"],
            ["tyre_compound_fr", "Tyre compound FR"],
          ]} />
        </section>
      )}

      <section className="card span-12">
        <SectionTitle title="Lap Table" help="Lists detected laps with fuel and speed context." />
        {laps.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Lap</th><th>Lap time</th>{showPosition && <th>Position</th>}{showClassPosition && <th>Class pos</th>}<th>Start</th><th>End</th><th>Fuel start</th><th>Fuel end</th><th>Fuel used</th><th>Fuel added</th><th>Top speed</th><th>Samples</th></tr></thead>
              <tbody>
                {laps.map((lap, index) => (
                  <tr key={index}>
                    <td>{text(lap.lap_number)}</td>
                    <td>{formatRaceTime(lap.lap_time as number)}</td>
                    {showPosition && <td>{lap.position != null ? `P${lap.position}` : "--"}</td>}
                    {showClassPosition && <td>{lap.class_position != null ? `P${lap.class_position}` : "--"}</td>}
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
        ) : <EmptyState detail="No laps could be derived from the selected DuckDB file." />}
      </section>

      <section className="card span-12">
        <SectionTitle title="Events" help="Shows pit events detected from native telemetry when the channel is available." />
        <div className="table-wrap">
          <table>
            <thead><tr><th>Lap</th><th>Type</th><th>Message</th></tr></thead>
            <tbody>
              {((review?.pit_events || []) as Row[]).map((event, index) => (
                <tr key={index}><td>{text(event.lap_number)}</td><td>{text(event.detected_from ?? "Event")}</td><td>{text(event.message)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {available.gps && (
        <section className="card span-12">
          <SectionTitle title="Lap Trajectory Compare" help="Compares two GPS lap traces from the selected DuckDB session. Green means the primary lap reached that point sooner than the comparison lap, red means it was slower, and blue means the delta is very similar." />
          <LapTrajectoryMap sessionId={selectedId} samples={samples} laps={laps} />
        </section>
      )}
      </main>
    </div>
  );
}
