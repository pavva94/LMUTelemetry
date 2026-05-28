import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import { SectionTitle } from "../components/SectionTitle";
import { channelByName, numeric } from "../lib/motecCsv";
import { formatRaceTime } from "../lib/timeFormat";
import type { ChannelDefinition, MotecSample, MotecSession } from "../types/motec";

type WorksheetKey =
  | "import" | "laps" | "compare" | "driver" | "tyre-temp" | "tyre-pressure" | "brakes" | "ride-height"
  | "g-force" | "map" | "histograms" | "xy" | "powertrain" | "fuel-strategy" | "race-engineer" | "wheel-speeds" | "environment" | "speed-delta" | "inputs";

const worksheets: Array<[WorksheetKey, string]> = [
  ["import", "CSV Import"],
  ["laps", "Lap Browser"],
  ["compare", "Compare"],
  ["driver", "Driver"],
  ["tyre-temp", "Tyre Temperatures"],
  ["tyre-pressure", "Tyre Pressure / Wear"],
  ["brakes", "Brakes"],
  ["ride-height", "Ride Height"],
  ["g-force", "G-Force"],
  ["map", "Map / GPS"],
  ["histograms", "Histograms"],
  ["xy", "X-Y Plotter"],
  ["powertrain", "Powertrain"],
  ["fuel-strategy", "Fuel Strategy"],
  ["race-engineer", "Race Engineer"],
  ["wheel-speeds", "Wheel Speeds"],
  ["environment", "Environment"],
  ["speed-delta", "Speed / Delta"],
  ["inputs", "Inputs"],
];

const colors = ["#e6b450", "#6dd6ff", "#ff6961", "#91e48f", "#c7a8ff", "#ff8c69", "#ff7da7"];
const lmuCars = [
  ["Alpine A424", "Hypercar (LMDh)"],
  ["Aston Martin Valkyrie AMR-LMH", "Hypercar (LMH)"],
  ["Aston Martin Vantage AMR", "GTE"],
  ["Aston Martin Vantage AMR LMGT3 Evo", "LMGT3"],
  ["BMW M Hybrid V8", "Hypercar (LMDh)"],
  ["BMW M4 LMGT3 Evo", "LMGT3"],
  ["Cadillac V-Series.R", "Hypercar (LMDh)"],
  ["Chevrolet Corvette C8.R", "GTE"],
  ["Chevrolet Corvette Z06 LMGT3.R", "LMGT3"],
  ["Duqueine D09", "LMP3"],
  ["Ferrari 296 LMGT3", "LMGT3"],
  ["Ferrari 488 GTE Evo", "GTE"],
  ["Ferrari 499P", "Hypercar (LMH)"],
  ["Ford Mustang LMGT3", "LMGT3"],
  ["Ginetta G61-LT-P325 Evo", "LMP3"],
  ["Glickenhaus SCG 007", "Hypercar (LMH)"],
  ["Isotta Fraschini Tipo 6", "Hypercar (LMH)"],
  ["Lamborghini Huracan LMGT3 Evo II", "LMGT3"],
  ["Lamborghini SC63", "Hypercar (LMDh)"],
  ["Lexus RC F LMGT3", "LMGT3"],
  ["Ligier JS P325", "LMP3"],
  ["McLaren 720S LMGT3 Evo", "LMGT3"],
  ["Mercedes-AMG LMGT3 Evo", "LMGT3"],
  ["Oreca 07", "LMP2"],
  ["Oreca 07 (derestricted)", "LMP2"],
  ["Peugeot 9X8", "Hypercar (LMH)"],
  ["Peugeot 9X8 2024", "Hypercar (LMH)"],
  ["Porsche 911 LMGT3 R (992)", "LMGT3"],
  ["Porsche 911 RSR-19", "GTE"],
  ["Porsche 963", "Hypercar (LMDh)"],
  ["Toyota GR010 Hybrid", "Hypercar (LMH)"],
  ["Vanwall-Vandervell 680", "Hypercar (LMH)"],
] as const;
const lmuCarClasses = Array.from(new Set(lmuCars.map(([, carClass]) => carClass))).sort();
const lmuTracks = [
  ["Bahrain", ["Default", "Endurance", "Outer", "Paddock"]],
  ["Circuit de Barcelona-Catalunya", ["TBD"]],
  ["Circuit de La Sarthe - Le Mans", ["Le Mans 24h", "Mulsanne Circuit (no chicanes)"]],
  ["Circuit Paul Ricard", ["Default"]],
  ["COTA", ["Default", "National Circuit"]],
  ["Fuji", ["Default", "Classic Circuit"]],
  ["Imola", ["Default"]],
  ["Interlagos", ["Default"]],
  ["Lusail (Qatar)", ["Default", "Short Circuit"]],
  ["Monza", ["Default", "Curva Grande Circuit"]],
  ["Portimao", ["Default"]],
  ["Sebring", ["Default", "School Circuit"]],
  ["Silverstone", ["Default"]],
  ["Spa-Francorchamps", ["Default", "Endurance pitlane"]],
] as const;
const lmuTrackLayouts = Array.from(new Set(lmuTracks.flatMap(([, layouts]) => layouts))).sort();
const fmt = (value: number | null | undefined, digits = 1) => value == null || Number.isNaN(value) ? "--" : value.toFixed(digits);
const timeValue = (value: number | null | undefined) => formatRaceTime(value);
const worksheetHelp = (title: string) => {
  const key = title.toLowerCase();
  if (key.includes("speed") || key.includes("delta")) return "Shows pace and time gain/loss over the lap. Compare braking, minimum speed, and exits where the delta worsens.";
  if (key.includes("throttle") || key.includes("brake") || key.includes("input")) return "Shows driver input behavior. Smooth, decisive inputs usually improve tyre life and repeatable lap time.";
  if (key.includes("tyre") || key.includes("tire")) return "Shows tyre condition and balance. Persistent corner or axle differences point to setup, pressure, camber, or driving load.";
  if (key.includes("ride") || key.includes("platform")) return "Shows platform movement and ride height. Low values at speed or braking can indicate bottoming or aero instability.";
  if (key.includes("fuel") || key.includes("pit")) return "Shows consumption and pit strategy. Stable fuel per lap makes stint and finish estimates more trustworthy.";
  if (key.includes("g-force") || key.includes("g-g")) return "Shows vehicle acceleration usage. Strong, smooth combined G usually means the tyre is being used efficiently.";
  if (key.includes("gps") || key.includes("map")) return "Shows where telemetry happens on track. Use colored traces to connect driving inputs with specific corners.";
  if (key.includes("histogram")) return "Shows how often a channel sits in each range. Peaks reveal dominant operating windows and outliers reveal risk.";
  if (key.includes("x-y") || key.includes("plot")) return "Compares two channels directly. Tight patterns suggest a real relationship; scatter suggests mixed conditions or inconsistent driving.";
  if (key.includes("powertrain") || key.includes("rpm") || key.includes("gear")) return "Shows engine, gear, and energy behavior. Use it to spot limiter use, poor gear choice, or thermal drift.";
  if (key.includes("engineer")) return "Summarizes rule-based findings from the data. Treat each hint as a hypothesis supported by the listed evidence.";
  return "Shows this worksheet's telemetry context. Look for trends, outliers, and repeatable changes before making setup decisions.";
};
const isTimeChannel = (name: string) => ["Time", "Session Elapsed Time", "Lap-relative time", "Delta Best", "Realtime Loss"].includes(name) || name.toLowerCase().includes("time");
const displayChannelValue = (sample: MotecSample, channel: string, session: MotecSession | null) => {
  const value = numeric(sample, channel);
  if (isTimeChannel(channel)) return timeValue(value);
  return `${fmt(value, channelByName(session, channel)?.defaultPrecision ?? 1)} ${channelByName(session, channel)?.unit || ""}`.trim();
};

function metric(samples: MotecSample[], channel: string) {
  const values = samples.map((sample) => numeric(sample, channel)).filter((value): value is number => value != null);
  const avg = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  return {
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    avg: values.length ? avg : null,
    count: values.length,
  };
}

function valueAt(samples: MotecSample[], channel: string, cursor: number) {
  if (!samples.length) return null;
  const index = Math.max(0, Math.min(samples.length - 1, Math.round((cursor / 100) * (samples.length - 1))));
  return samples[index]?.[channel] ?? null;
}

function useMotecSamples(session: MotecSession | null, lap: string, channels: string[], maxPoints = 3000) {
  const [samples, setSamples] = useState<MotecSample[]>([]);
  const key = channels.join(",");
  useEffect(() => {
    if (!session || (!lap && lap !== "__all__") || channels.length === 0) {
      setSamples([]);
      return;
    }
    let cancelled = false;
    void api.motecSamples(session.id, channels, lap === "__all__" ? undefined : lap, maxPoints).then((payload) => {
      if (!cancelled) setSamples(payload.samples);
    }).catch(() => {
      if (!cancelled) setSamples([]);
    });
    return () => {
      cancelled = true;
    };
  }, [session?.id, lap, key, maxPoints]);
  return samples;
}

function Empty({ message = "Import a telemetry CSV to use this worksheet." }: { message?: string }) {
  return <div className="empty-state"><strong>Data not available</strong><span>{message}</span></div>;
}

function Missing({ channels, session }: { channels: string[]; session: MotecSession | null }) {
  const missing = channels.filter((name) => !channelByName(session, name));
  if (!missing.length) return null;
  return <div className="motec-warning">Missing channels: {missing.join(", ")}</div>;
}

function LapSelectors({ session, lapA, lapB, setLapA, setLapB }: { session: MotecSession | null; lapA: string; lapB: string; setLapA: (lap: string) => void; setLapB: (lap: string) => void }) {
  return (
    <div className="motec-toolbar">
      <label>Primary lap<select value={lapA} onChange={(event) => setLapA(event.target.value)}>{session?.laps.map((lap) => <option key={lap.lapNumber} value={lap.lapNumber}>Lap {lap.lapNumber}</option>)}</select></label>
      <label>Compare lap<select value={lapB} onChange={(event) => setLapB(event.target.value)}><option value="">None</option>{session?.laps.map((lap) => <option key={lap.lapNumber} value={lap.lapNumber}>Lap {lap.lapNumber}</option>)}</select></label>
      <span className="muted">{session ? `${session.sampleCount ?? 0} samples, ${session.laps.length} laps` : "No session loaded"}</span>
    </div>
  );
}

function ChartBlock({ session, title, channels, lapA, lapB, xKey = "Lap-relative time", cursor, setCursor, height = 150 }: {
  session: MotecSession | null;
  title: string;
  channels: string[];
  lapA: string;
  lapB?: string;
  xKey?: string;
  cursor: number;
  setCursor: (value: number) => void;
  height?: number;
}) {
  if (!session) return <section className="card span-12"><SectionTitle title={title} help={worksheetHelp(title)} /><Empty /></section>;
  const dataA = useMotecSamples(session, lapA, channels);
  const dataB = useMotecSamples(session, lapB || "", channels);
  const unit = channelByName(session, channels[0])?.unit || "";
  const chartData = dataA.map((sample, index) => {
    const row: Record<string, number | string | null> = { x: numeric(sample, xKey) ?? index };
    channels.forEach((channel) => row[channel] = numeric(sample, channel));
    if (dataB[index]) channels.forEach((channel) => row[`${channel} B`] = numeric(dataB[index], channel));
    return row;
  });
  return (
    <section className="card span-12 motec-chart">
      <div className="row"><SectionTitle title={<>{title} {unit && <span className="muted">({unit})</span>}</>} help={worksheetHelp(title)} /><span className="muted">Cursor {cursor.toFixed(0)}%</span></div>
      <Missing channels={channels} session={session} />
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} onMouseMove={(state) => state && typeof state.activeTooltipIndex === "number" && setCursor((state.activeTooltipIndex / Math.max(chartData.length - 1, 1)) * 100)}>
          <CartesianGrid stroke="#27313a" />
          <XAxis dataKey="x" stroke="#8896a3" tickFormatter={(value) => isTimeChannel(xKey) ? timeValue(Number(value)) : String(value)} />
          <YAxis stroke="#8896a3" />
          <Tooltip
            contentStyle={{ background: "#141a20", border: "1px solid #27313a" }}
            labelFormatter={(value) => isTimeChannel(xKey) ? timeValue(Number(value)) : String(value)}
            formatter={(value, name) => isTimeChannel(String(name).replace(" B", "")) ? timeValue(Number(value)) : value}
          />
          {channels.map((channel, index) => <Line key={channel} dataKey={channel} stroke={colors[index % colors.length]} dot={false} connectNulls />)}
          {lapB && channels.map((channel, index) => <Line key={`${channel} B`} dataKey={`${channel} B`} stroke={colors[index % colors.length]} strokeDasharray="4 4" dot={false} connectNulls />)}
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}

function CursorValues({ session, lapA, channels, cursor }: { session: MotecSession | null; lapA: string; channels: string[]; cursor: number }) {
  const samples = useMotecSamples(session, lapA, channels);
  return (
    <section className="card span-12">
      <SectionTitle title="Cursor Values" help="Shows channel values at the shared cursor. Use it to compare exactly what the car and driver were doing at one point in the lap." />
      <div className="motec-value-grid">
        {channels.map((channel) => <div key={channel}><span className="label">{channel}</span><strong>{displayChannelValue({ [channel]: valueAt(samples, channel, cursor) }, channel, session)}</strong></div>)}
      </div>
    </section>
  );
}

function AnalysisCards({ samples, channels }: { samples: MotecSample[]; channels: string[] }) {
  return (
    <section className="card span-12">
      <SectionTitle title="Key Values" help="Summarizes min, max, average, and sample count. Use it to spot outliers before diving into full traces." />
      <div className="motec-value-grid">
        {channels.map((channel) => {
          const stats = metric(samples, channel);
          return <div key={channel}><span className="label">{channel}</span><strong>max {fmt(stats.max)}</strong><span className="subvalue">avg {fmt(stats.avg)} / n {stats.count}</span></div>;
        })}
      </div>
    </section>
  );
}

function ImportPage({ onImported }: { onImported: (session: MotecSession, openAnalysis?: boolean) => void }) {
  const [preview, setPreview] = useState<MotecSession | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState({
    session_name: "",
    track_name: "",
    track_layout: "",
    car_name: "",
    car_class: "",
    session_type: "Race",
    finish_position: "",
    finish_status: "",
  });
  const [imported, setImported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const handleFile = async (file: File | null) => {
    if (!file) return;
    setFile(file);
    setPreview(null);
    setImported(false);
    setError("");
    setProgress(`${file.name} selected (${Math.round(file.size / 1024 / 1024)} MB). Click Import Session to stream it to the backend.`);
    setMetadata((current) => ({ ...current, session_name: current.session_name || file.name.replace(/\.[^.]+$/, "") }));
  };
  const updateCar = (carName: string) => {
    const matched = lmuCars.find(([name]) => name === carName);
    setMetadata((current) => ({
      ...current,
      car_name: carName,
      car_class: matched?.[1] || current.car_class,
    }));
  };
  const updateTrack = (trackName: string) => {
    const matched = lmuTracks.find(([name]) => name === trackName);
    setMetadata((current) => ({
      ...current,
      track_name: trackName,
      track_layout: matched && !matched[1].some((layout) => layout === current.track_layout) ? matched[1][0] : current.track_layout,
    }));
  };
  const layoutOptions = lmuTracks.find(([name]) => name === metadata.track_name)?.[1] || lmuTrackLayouts;
  const requiredReady = Boolean(metadata.session_name.trim() && metadata.track_name.trim() && metadata.car_name.trim() && metadata.car_class.trim() && metadata.session_type.trim());
  const importPreview = async () => {
    if (!file || !requiredReady) return;
    try {
      setBusy(true);
      setError("");
      setProgress("Uploading and importing CSV in the backend. Large files can take a while...");
      const importedSession = await api.motecImport(file, metadata);
      setPreview(importedSession);
      setImported(true);
      onImported(importedSession, false);
      setProgress("Saved. Open Analysis is ready.");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page grid">
      <section className="card span-4">
        <SectionTitle title="CSV Import" help="Imports a two-header telemetry CSV as an analysis session. Add track and car metadata so laps are useful in history and comparisons." />
        <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => void handleFile(event.target.files?.[0] || null)} />
        <label>Session name<input value={metadata.session_name} onChange={(event) => setMetadata((current) => ({ ...current, session_name: event.target.value }))} /></label>
        <label>Track<input list="lmu-track-options" value={metadata.track_name} onChange={(event) => updateTrack(event.target.value)} placeholder="Search LMU track" /></label>
        <datalist id="lmu-track-options">{lmuTracks.map(([name]) => <option key={name} value={name} />)}</datalist>
        <label>Layout<input list="lmu-layout-options" value={metadata.track_layout} onChange={(event) => setMetadata((current) => ({ ...current, track_layout: event.target.value }))} placeholder="Optional" /></label>
        <datalist id="lmu-layout-options">{layoutOptions.map((layout) => <option key={layout} value={layout} />)}</datalist>
        <label>Car<input list="lmu-car-options" value={metadata.car_name} onChange={(event) => updateCar(event.target.value)} placeholder="Search LMU car" /></label>
        <datalist id="lmu-car-options">{lmuCars.map(([name, carClass]) => <option key={name} value={name} label={carClass} />)}</datalist>
        <label>Class<input list="lmu-class-options" value={metadata.car_class} onChange={(event) => setMetadata((current) => ({ ...current, car_class: event.target.value }))} placeholder="Search or auto-filled from car" /></label>
        <datalist id="lmu-class-options">{lmuCarClasses.map((carClass) => <option key={carClass} value={carClass} />)}</datalist>
        <label>Session type<select value={metadata.session_type} onChange={(event) => setMetadata((current) => ({ ...current, session_type: event.target.value }))}><option value="Practice">Practice</option><option value="Qualifying">Qualifying</option><option value="Race">Race</option><option value="Test Day">Test Day</option></select></label>
        <label>Finish position<input type="number" min="1" value={metadata.finish_position} onChange={(event) => setMetadata((current) => ({ ...current, finish_position: event.target.value }))} placeholder="Optional" /></label>
        <label>Finish status<select value={metadata.finish_status} onChange={(event) => setMetadata((current) => ({ ...current, finish_status: event.target.value }))}><option value="">Unknown</option><option value="finished">Finished</option><option value="dnf">DNF</option><option value="dns">DNS</option><option value="dq">DQ</option></select></label>
        {progress && <p className="subvalue">{progress}</p>}
        {error && <p className="motec-warning">{error}</p>}
        {file && <button className="primary" disabled={busy || !requiredReady} onClick={() => void importPreview()}>Import Session</button>}
        {file && !requiredReady && <p className="motec-warning">Session name, track, car, class, and session type are required for User Profile history.</p>}
        {preview && imported && <button onClick={() => onImported(preview, true)}>Open Analysis</button>}
      </section>
      <section className="card span-8">
        <SectionTitle title="Detected Session" help="Confirms samples, laps, and time range after import. Check these numbers before trusting any worksheet analysis." />
        {preview ? (
          <div className="motec-value-grid">
            <div><span className="label">Channels</span><strong>{preview.channels.length}</strong></div>
            <div><span className="label">Samples</span><strong>{preview.samples.length}</strong></div>
            <div><span className="label">Laps</span><strong>{preview.laps.length}</strong></div>
            <div><span className="label">Track</span><strong>{preview.trackName || "--"}</strong></div>
            <div><span className="label">Car</span><strong>{preview.carName || "--"}</strong></div>
            <div><span className="label">Class</span><strong>{preview.carClass || "--"}</strong></div>
            <div><span className="label">Type</span><strong>{preview.sessionType || "--"}</strong></div>
            <div><span className="label">Session time</span><strong>{timeValue(preview.minSessionTime)} - {timeValue(preview.maxSessionTime)}</strong></div>
          </div>
        ) : <Empty message="Choose a two-header-row telemetry CSV." />}
        {preview?.warnings.map((warning) => <p className="motec-warning" key={warning}>{warning}</p>)}
      </section>
      <section className="card span-12">
        <SectionTitle title="Channel Registry" help="Lists detected channels and units. Categories and types decide how channels appear in worksheets and plots." />
        {preview ? <ChannelRegistry channels={preview.channels} /> : <Empty message="Detected channels and units will appear here before import." />}
      </section>
    </div>
  );
}

function ChannelRegistry({ channels }: { channels: ChannelDefinition[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Unit</th><th>Category</th><th>Type</th><th>Wheel</th><th>Precision</th><th>Scale</th></tr></thead>
        <tbody>{channels.map((channel) => <tr key={channel.originalName}><td>{channel.originalName}</td><td>{channel.unit}</td><td>{channel.category}</td><td>{channel.type}</td><td>{channel.wheelPosition || "--"}</td><td>{channel.defaultPrecision}</td><td>{channel.defaultMin ?? "--"} / {channel.defaultMax ?? "--"}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function LapBrowser({ session, setLapA, setLapB }: { session: MotecSession | null; setLapA: (lap: string) => void; setLapB: (lap: string) => void }) {
  if (!session) return <div className="page"><section className="card"><Empty /></section></div>;
  return (
    <div className="page grid">
      <section className="card span-12"><SectionTitle title="Lap Browser" help="Lists laps detected from the CSV. Select a clean primary lap and a representative comparison lap before using the worksheets." /><div className="table-wrap"><table><thead><tr><th>Lap</th><th>Start</th><th>End</th><th>Duration</th><th>Max Speed</th><th>Min Corner</th><th>Max RPM</th><th>Fuel Start</th><th>Fuel End</th><th>Select</th></tr></thead><tbody>{session.laps.map((lap) => <tr key={lap.lapNumber}><td>{lap.lapNumber}</td><td>{timeValue(lap.startTime)}</td><td>{timeValue(lap.endTime)}</td><td>{timeValue(lap.duration)}</td><td>{fmt(lap.maxSpeed)}</td><td>{fmt(lap.minCornerSpeed)}</td><td>{fmt(lap.maxRpm, 0)}</td><td>{fmt(lap.fuelStart)}</td><td>{fmt(lap.fuelEnd)}</td><td><button onClick={() => setLapA(lap.lapNumber)}>Primary</button><button onClick={() => setLapB(lap.lapNumber)}>Compare</button></td></tr>)}</tbody></table></div></section>
      <section className="card span-12"><SectionTitle title="Registry" help="Shows the channels available for analysis. Missing or empty channels explain why some worksheets may show limited data." /><ChannelRegistry channels={session.channels} /></section>
    </div>
  );
}

type FuelLapRow = {
  lapNumber: string;
  stint: number;
  startTime: number | null;
  duration: number | null;
  fuelStart: number | null;
  fuelEnd: number | null;
  fuelUsed: number | null;
  pitStop: boolean;
  fuelAdded: number | null;
};

type EngineerHint = {
  title: string;
  severity: "info" | "warning" | "critical";
  confidence: "low" | "medium" | "high";
  affected: string;
  explanation: string;
  evidence: string[];
  action: string;
};

type StintSummary = {
  stint: number;
  startLap: string;
  endLap: string;
  lapCount: number;
  fastestLap: number | null;
  averageLap: number | null;
  medianLap: number | null;
  firstHalfAverage: number | null;
  secondHalfAverage: number | null;
  degradationPerLap: number | null;
  fuelUsed: number | null;
  averageFuelPerLap: number | null;
  fuelVariance: number | null;
  fuelAdded: number | null;
  tyreWearDelta: number | null;
};

const engineerChannels = [
  "Ground Speed", "Throttle Pos", "Brake Pos", "Steering", "Gear", "Engine RPM",
  "G Force Lat", "G Force Long", "Combined G", "Delta Best", "Realtime Loss",
  "Lap-relative time", "Brake/Throttle Overlap", "Fuel Level",
  "Tyre Pressure FL", "Tyre Pressure FR", "Tyre Pressure RL", "Tyre Pressure RR",
  "Tyre Wear FL", "Tyre Wear FR", "Tyre Wear RL", "Tyre Wear RR",
  "Tyre Temp FL Outer", "Tyre Temp FL Centre", "Tyre Temp FL Inner",
  "Tyre Temp FR Outer", "Tyre Temp FR Centre", "Tyre Temp FR Inner",
  "Tyre Temp RL Outer", "Tyre Temp RL Centre", "Tyre Temp RL Inner",
  "Tyre Temp RR Outer", "Tyre Temp RR Centre", "Tyre Temp RR Inner",
  "Brake Temp FL", "Brake Temp FR", "Brake Temp RL", "Brake Temp RR",
  "Ride Height FL", "Ride Height FR", "Ride Height RL", "Ride Height RR",
  "Front Ride Height Avg", "Rear Ride Height Avg", "Rake", "Front Ride Height Min", "Rear Ride Height Min",
  "Wheel Rot Speed FL", "Wheel Rot Speed FR", "Wheel Rot Speed RL", "Wheel Rot Speed RR",
];

const valuesFor = (samples: MotecSample[], channel: string) => samples.map((sample) => numeric(sample, channel)).filter((value): value is number => value != null);
const avgValue = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
const medianValue = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const varianceValue = (values: number[]) => {
  if (values.length < 2) return null;
  const avg = avgValue(values);
  return avgValue(values.map((value) => (value - avg) ** 2));
};
const minValue = (samples: MotecSample[], channel: string) => {
  const values = valuesFor(samples, channel);
  return values.length ? Math.min(...values) : null;
};
const maxValue = (samples: MotecSample[], channel: string) => {
  const values = valuesFor(samples, channel);
  return values.length ? Math.max(...values) : null;
};
const avgChannel = (samples: MotecSample[], channel: string) => {
  const values = valuesFor(samples, channel);
  return values.length ? avgValue(values) : null;
};

function hint(title: string, severity: EngineerHint["severity"], confidence: EngineerHint["confidence"], affected: string, explanation: string, evidence: string[], action: string): EngineerHint {
  return { title, severity, confidence, affected, explanation, evidence, action };
}

function buildFuelLapRows(session: MotecSession) {
  let stint = 1;
  let previousFuelEnd: number | null = null;
  return session.laps.map((lap) => {
    const refillFromPrevious = previousFuelEnd != null && lap.fuelStart != null ? lap.fuelStart - previousFuelEnd : null;
    const refillInsideLap = lap.fuelStart != null && lap.fuelEnd != null ? lap.fuelEnd - lap.fuelStart : null;
    const fuelAdded = Math.max(refillFromPrevious ?? 0, refillInsideLap ?? 0);
    const pitStop = fuelAdded > 2;
    if (pitStop) stint += 1;
    const fuelUsed = lap.fuelStart != null && lap.fuelEnd != null && lap.fuelEnd <= lap.fuelStart ? lap.fuelStart - lap.fuelEnd : null;
    previousFuelEnd = lap.fuelEnd ?? previousFuelEnd;
    return {
      lapNumber: lap.lapNumber,
      stint,
      startTime: lap.startTime,
      duration: lap.duration,
      fuelStart: lap.fuelStart,
      fuelEnd: lap.fuelEnd,
      fuelUsed,
      pitStop,
      fuelAdded: pitStop ? fuelAdded : null,
    };
  });
}

function buildStintSummaries(session: MotecSession, samples: MotecSample[] = []): StintSummary[] {
  const rows = buildFuelLapRows(session);
  const stintNumbers = Array.from(new Set(rows.map((row) => row.stint))).sort((a, b) => a - b);
  return stintNumbers.map((stint) => {
    const stintRows = rows.filter((row) => row.stint === stint);
    const lapTimes = stintRows.map((row) => row.duration).filter((value): value is number => value != null && value > 0);
    const fuelUsedValues = stintRows.map((row) => row.fuelUsed).filter((value): value is number => value != null && value >= 0);
    const split = Math.max(1, Math.ceil(lapTimes.length / 2));
    const firstHalf = lapTimes.slice(0, split);
    const secondHalf = lapTimes.slice(split);
    const firstHalfAverage = firstHalf.length ? avgValue(firstHalf) : null;
    const secondHalfAverage = secondHalf.length ? avgValue(secondHalf) : null;
    const startLapNumber = Number(stintRows[0]?.lapNumber);
    const endLapNumber = Number(stintRows[stintRows.length - 1]?.lapNumber);
    const stintSamples = samples.filter((sample) => {
      const lap = Number(sample["Lap Number"]);
      return Number.isFinite(lap) && Number.isFinite(startLapNumber) && Number.isFinite(endLapNumber) && lap >= startLapNumber && lap <= endLapNumber;
    });
    const wearStart = ["Tyre Wear FL", "Tyre Wear FR", "Tyre Wear RL", "Tyre Wear RR"].map((channel) => numeric(stintSamples[0] || {}, channel)).filter((value): value is number => value != null);
    const wearEnd = ["Tyre Wear FL", "Tyre Wear FR", "Tyre Wear RL", "Tyre Wear RR"].map((channel) => numeric(stintSamples[stintSamples.length - 1] || {}, channel)).filter((value): value is number => value != null);
    const tyreWearDelta = wearStart.length && wearEnd.length ? avgValue(wearEnd) - avgValue(wearStart) : null;
    return {
      stint,
      startLap: stintRows[0]?.lapNumber || "--",
      endLap: stintRows[stintRows.length - 1]?.lapNumber || "--",
      lapCount: stintRows.length,
      fastestLap: lapTimes.length ? Math.min(...lapTimes) : null,
      averageLap: lapTimes.length ? avgValue(lapTimes) : null,
      medianLap: medianValue(lapTimes),
      firstHalfAverage,
      secondHalfAverage,
      degradationPerLap: firstHalfAverage != null && secondHalfAverage != null && lapTimes.length > 1 ? (secondHalfAverage - firstHalfAverage) / Math.max(lapTimes.length / 2, 1) : null,
      fuelUsed: fuelUsedValues.length ? fuelUsedValues.reduce((sum, value) => sum + value, 0) : null,
      averageFuelPerLap: fuelUsedValues.length ? avgValue(fuelUsedValues) : null,
      fuelVariance: varianceValue(fuelUsedValues),
      fuelAdded: stintRows.find((row) => row.pitStop)?.fuelAdded ?? null,
      tyreWearDelta,
    };
  });
}

function analyzeDriving(session: MotecSession, lapA: string, referenceLap: string, selected: MotecSample[], reference: MotecSample[]) {
  const hints: EngineerHint[] = [];
  const currentLap = session.laps.find((lap) => lap.lapNumber === lapA);
  const refLap = session.laps.find((lap) => lap.lapNumber === referenceLap);
  if (!selected.length) {
    return [hint("Not enough selected lap data", "info", "high", `Lap ${lapA || "--"}`, "The selected lap has no loaded samples, so the engineer view cannot judge driving traces yet.", ["No samples returned for the selected lap."], "Select a lap with telemetry samples or re-import a CSV with lap data.")];
  }
  if (currentLap?.duration && refLap?.duration && currentLap.lapNumber !== refLap.lapNumber) {
    const loss = currentLap.duration - refLap.duration;
    if (loss > 0.15) {
      hints.push(hint(
        "Primary lap is slower than the reference",
        loss > 1 ? "critical" : "warning",
        "high",
        `Lap ${currentLap.lapNumber} vs lap ${refLap.lapNumber}`,
        `The selected lap is ${formatRaceTime(loss)} slower than the reference. Treat this as the main lap to dissect before chasing setup changes.`,
        [`Selected ${formatRaceTime(currentLap.duration)}`, `Reference ${formatRaceTime(refLap.duration)}`],
        "Start with speed, brake release, and throttle pickup differences before changing the car.",
      ));
    } else if (Math.abs(loss) <= 0.15) {
      hints.push(hint("Selected lap is close to reference pace", "info", "medium", `Lap ${currentLap.lapNumber}`, "The selected lap is within a small margin of the reference, so improvements are likely in details rather than one obvious mistake.", [`Difference ${formatRaceTime(loss)}`], "Use the smaller channel hints below to look for repeatable gains."));
    }
  }
  const deltaValues = valuesFor(selected, channelByName(session, "Delta Best") ? "Delta Best" : "Realtime Loss");
  if (deltaValues.length > 5) {
    const first = deltaValues[0];
    const worst = Math.max(...deltaValues);
    const gainLoss = worst - first;
    const worstIndex = deltaValues.indexOf(worst);
    const worstTime = numeric(selected[worstIndex], "Lap-relative time");
    if (gainLoss > 0.2) {
      hints.push(hint(
        "Largest time-loss zone detected",
        gainLoss > 0.7 ? "critical" : "warning",
        "medium",
        `Around ${timeValue(worstTime)}`,
        "The delta trace gets worse in this region. That usually points to a braking, minimum-speed, or exit phase problem near this part of the lap.",
        [`Delta worsens by ${formatRaceTime(gainLoss)}`, `Peak loss near ${timeValue(worstTime)}`],
        "Open Compare or Speed / Delta and inspect speed, brake, and throttle around this timestamp.",
      ));
    }
  }
  if (reference.length) {
    const selectedMinSpeed = minValue(selected, "Ground Speed");
    const referenceMinSpeed = minValue(reference, "Ground Speed");
    if (selectedMinSpeed != null && referenceMinSpeed != null && referenceMinSpeed - selectedMinSpeed > 4) {
      hints.push(hint("Minimum speed is low versus reference", "warning", "medium", `Lap ${lapA}`, "The selected lap carries less minimum speed than the reference. If this happens in the same corner repeatedly, the car is either over-slowed or the entry is forcing too much rotation/scrub.", [`Selected min ${fmt(selectedMinSpeed, 1)} km/h`, `Reference min ${fmt(referenceMinSpeed, 1)} km/h`], "Compare the braking phase: release the brake more progressively or avoid adding steering while still heavily braking."));
    }
    const selectedThrottle = avgChannel(selected, "Throttle Pos");
    const referenceThrottle = avgChannel(reference, "Throttle Pos");
    if (selectedThrottle != null && referenceThrottle != null && referenceThrottle - selectedThrottle > 4) {
      hints.push(hint("Throttle application is weaker than reference", "warning", "medium", `Lap ${lapA}`, "Average throttle is lower than the reference lap. This often means the car is not being opened up early enough on exits or there is hesitation after apex.", [`Selected avg throttle ${fmt(selectedThrottle, 1)}%`, `Reference avg throttle ${fmt(referenceThrottle, 1)}%`], "Check exits in Compare: look for places where reference throttle rises earlier without extra steering correction."));
    }
  }
  const overlap = valuesFor(selected, "Brake/Throttle Overlap").filter(Boolean).length / Math.max(selected.length, 1);
  if (overlap > 0.03) {
    hints.push(hint("Brake and throttle overlap is visible", overlap > 0.08 ? "critical" : "warning", "medium", `Lap ${lapA}`, "There is measurable overlap between brake and throttle. A little overlap can be normal in some cars, but too much costs fuel and can destabilize entries or exits.", [`Overlap in ${fmt(overlap * 100, 1)}% of samples`], "Review pedal traces and remove accidental overlap unless it is intentional for rotation or turbo/traction management."));
  }
  const steeringAbs = valuesFor(selected, "Steering").map(Math.abs);
  const steeringAvg = steeringAbs.length ? avgValue(steeringAbs) : null;
  if (steeringAvg != null && steeringAvg > 35) {
    hints.push(hint("High average steering demand", "warning", "low", `Lap ${lapA}`, "The steering trace suggests the car is spending a lot of time with significant steering angle. That can indicate understeer, late rotation, or over-driving the front tyres.", [`Average absolute steering ${fmt(steeringAvg, 1)}%/deg channel units`], "Check corners with low minimum speed and high steering: try earlier rotation, cleaner trail brake release, or setup changes that help front response."));
  }
  if (!hints.length) hints.push(hint("No major driving issue detected", "info", "medium", `Lap ${lapA}`, "The available driving channels do not show a large obvious weakness in this pass.", ["Speed, throttle, brake, and steering checks stayed within simple thresholds."], "Use Compare for detailed corner-by-corner work, or select a slower lap to expose clearer differences."));
  return hints;
}

function analyzeSetup(session: MotecSession, samples: MotecSample[]) {
  const hints: EngineerHint[] = [];
  if (!samples.length) return [hint("Not enough setup data", "info", "high", "Session", "No full-session setup samples are loaded yet.", ["No setup samples returned."], "Import a CSV with tyre, brake, and ride-height channels.")];
  const tyreTempHints = (["FL", "FR", "RL", "RR"] as const).flatMap((wheel) => {
    const inner = avgChannel(samples, `Tyre Temp ${wheel} Inner`);
    const centre = avgChannel(samples, `Tyre Temp ${wheel} Centre`);
    const outer = avgChannel(samples, `Tyre Temp ${wheel} Outer`);
    if (inner == null || centre == null || outer == null) return [];
    const shoulderDelta = inner - outer;
    const centreDelta = centre - ((inner + outer) / 2);
    const results: EngineerHint[] = [];
    if (Math.abs(shoulderDelta) > 8) {
      results.push(hint(`${wheel} tyre shoulder imbalance`, Math.abs(shoulderDelta) > 15 ? "critical" : "warning", "medium", "Session average", shoulderDelta > 0 ? "Inner shoulder is much hotter than outer. This can point to excess camber, too much entry energy, or sustained loaded cornering." : "Outer shoulder is much hotter than inner. This can point to insufficient camber, rolling onto the shoulder, or sliding.", [`Inner ${fmt(inner, 1)} C`, `Outer ${fmt(outer, 1)} C`, `Delta ${fmt(shoulderDelta, 1)} C`], "Use tyre page by lap/stint. For repeatable imbalance, consider camber/pressure changes after confirming driving is not causing the temperature split."));
    }
    if (Math.abs(centreDelta) > 6) {
      results.push(hint(`${wheel} centre temperature balance`, "warning", "medium", "Session average", centreDelta > 0 ? "Centre is hotter than the shoulders, which often suggests pressure is too high for the load/track condition." : "Centre is cooler than the shoulders, which often suggests pressure is too low or the tyre is working mostly on the shoulders.", [`Centre ${fmt(centre, 1)} C`, `Shoulder avg ${fmt((inner + outer) / 2, 1)} C`], "Check hot pressure targets and compare with wear. Adjust pressure only after the tyres are up to stable operating temperature."));
    }
    return results;
  });
  hints.push(...tyreTempHints.slice(0, 4));
  const pressures = ["Tyre Pressure FL", "Tyre Pressure FR", "Tyre Pressure RL", "Tyre Pressure RR"].map((channel) => avgChannel(samples, channel)).filter((value): value is number => value != null);
  if (pressures.length >= 2 && Math.max(...pressures) - Math.min(...pressures) > 8) {
    hints.push(hint("Tyre pressure spread is large", "warning", "medium", "Session average", "The tyre pressure spread is large enough to affect balance and tyre response.", [`Lowest avg ${fmt(Math.min(...pressures), 1)} kPa`, `Highest avg ${fmt(Math.max(...pressures), 1)} kPa`], "Compare left/right and front/rear pressure evolution, then adjust starting pressures for a tighter hot-pressure window."));
  }
  const brakeTemps = ["Brake Temp FL", "Brake Temp FR", "Brake Temp RL", "Brake Temp RR"].map((channel) => avgChannel(samples, channel)).filter((value): value is number => value != null);
  if (brakeTemps.length >= 2 && Math.max(...brakeTemps) - Math.min(...brakeTemps) > 80) {
    hints.push(hint("Brake temperature imbalance", "warning", "medium", "Session average", "Brake temperatures are not balanced across the car. This may come from lockups, brake bias, ducting, or track layout loading one side heavily.", [`Coolest avg ${fmt(Math.min(...brakeTemps), 0)} C`, `Hottest avg ${fmt(Math.max(...brakeTemps), 0)} C`], "Check brake traces and wheel-speed page for lockup signs before changing bias or duct settings."));
  }
  const frontMin = minValue(samples, "Front Ride Height Min");
  const rearMin = minValue(samples, "Rear Ride Height Min");
  if ((frontMin != null && frontMin < 15) || (rearMin != null && rearMin < 15)) {
    hints.push(hint("Bottoming risk detected", "critical", "medium", "Session", "Ride height gets very low in the imported data. If this happens at speed or under braking it can hurt platform consistency and aero balance.", [`Front min ${fmt(frontMin, 1)} mm`, `Rear min ${fmt(rearMin, 1)} mm`], "Inspect Ride Height / Platform around high-speed and heavy-braking zones. Consider ride height, spring, packer, or aero platform changes."));
  }
  const rake = avgChannel(samples, "Rake");
  if (rake != null && Math.abs(rake) > 25) {
    hints.push(hint("Large average rake value", "info", "low", "Session average", "The average rake is large. That may be intended, but it is worth checking against speed and braking stability.", [`Average rake ${fmt(rake, 1)} mm`], "Use Ride Height / Platform to see whether rake changes sharply with speed, braking, or throttle."));
  }
  if (!hints.length) hints.push(hint("Setup channels look broadly stable", "info", "medium", "Session", "The available tyre, brake, and ride-height channels did not trip the first-pass setup thresholds.", ["No large temperature, pressure, brake, or bottoming warnings detected."], "Use the detailed setup worksheets for deeper corner/stint analysis."));
  return hints;
}

function analyzeStrategy(session: MotecSession) {
  const hints: EngineerHint[] = [];
  const rows = buildFuelLapRows(session);
  const usage = rows.map((row) => row.fuelUsed).filter((value): value is number => value != null && value >= 0);
  const avgFuel = usage.length ? avgValue(usage) : null;
  const maxFuel = usage.length ? Math.max(...usage) : null;
  const minFuel = usage.length ? Math.min(...usage) : null;
  const currentFuel = [...rows].reverse().find((row) => row.fuelEnd != null)?.fuelEnd ?? null;
  const pitStops = rows.filter((row) => row.pitStop);
  if (avgFuel == null) {
    return [hint("Fuel strategy needs Fuel Level", "info", "high", "Session", "Fuel Level is missing or incomplete, so stint and fuel-per-lap advice cannot be generated.", ["No valid fuel-used laps found."], "Import CSV with Fuel Level and Lap Number to enable fuel analysis.")];
  }
  hints.push(hint("Fuel consumption baseline", "info", "high", "Session", "This is the current fuel model from the imported CSV. Use it as the baseline before making stint decisions.", [`Average ${fmt(avgFuel, 3)} L/lap`, `Range ${fmt(minFuel, 3)}-${fmt(maxFuel, 3)} L/lap`, `Current ${fmt(currentFuel, 2)} L`], "For race planning, add a safety margin and verify whether consumption changes in traffic or behind safety car."));
  if (maxFuel != null && minFuel != null && maxFuel - minFuel > avgFuel * 0.12) {
    hints.push(hint("Fuel use varies noticeably lap to lap", "warning", "medium", "Session", "Fuel consumption is not stable. That usually comes from traffic, push laps, lift-and-coast variation, or inconsistent throttle time.", [`Spread ${fmt(maxFuel - minFuel, 3)} L/lap`, `Average ${fmt(avgFuel, 3)} L/lap`], "Compare high-consumption laps against low-consumption laps and look at throttle trace plus top-speed sections."));
  }
  if (currentFuel != null && avgFuel > 0) {
    hints.push(hint("Estimated fuel range", "info", "medium", "End of imported data", "Based on the current average, this is the approximate range left at the end of the imported data.", [`Estimated ${fmt(currentFuel / avgFuel, 1)} laps remaining`], "Do not use this alone for final strategy; add reserve for formation, traffic, mistakes, and race-control phases."));
  }
  if (pitStops.length) {
    hints.push(hint("Pit stops detected from refuelling", "info", "high", "Session", "The importer detected pit stops from fuel increases. These stops define stint boundaries for later degradation and pace analysis.", pitStops.map((pit, index) => `Stop ${index + 1}: lap ${pit.lapNumber}, +${fmt(pit.fuelAdded, 2)} L`), "Review stint pace before and after each stop to judge tyre degradation and refuel strategy."));
  } else {
    hints.push(hint("No pit stop detected", "info", "medium", "Session", "No fuel increase above the pit detection threshold was found.", ["Pit threshold: fuel increase greater than 2 L"], "If the session includes stops without refuelling, pit detection will need pit-state or speed-based logic later."));
  }
  return hints;
}

function analyzeStints(session: MotecSession, samples: MotecSample[]) {
  const summaries = buildStintSummaries(session, samples);
  if (!summaries.length) {
    return [hint("No stint data available", "info", "high", "Session", "No lap rows are available to build stint summaries.", ["No laps returned for this session."], "Import a CSV with Lap Number and timing data.")];
  }
  const hints: EngineerHint[] = [];
  if (summaries.length === 1) {
    hints.push(hint("Single stint session", "info", "high", `Laps ${summaries[0].startLap}-${summaries[0].endLap}`, "No refuelling split was detected, so the whole imported run is treated as one stint.", [`${summaries[0].lapCount} laps in stint`], "Use this as a continuous-run analysis. If the session had pit stops without refuelling, add pit-state detection later."));
  } else {
    hints.push(hint("Multiple stints detected", "info", "high", "Session", "Fuel increases split the run into multiple stints. This lets the engineer compare pace, degradation, and fuel behavior stint by stint.", summaries.map((stint) => `Stint ${stint.stint}: laps ${stint.startLap}-${stint.endLap}`), "Compare stint averages and degradation before deciding whether the tyre or fuel strategy is working."));
  }
  summaries.forEach((summary) => {
    if (summary.degradationPerLap != null && summary.degradationPerLap > 0.12) {
      hints.push(hint("Stint pace degradation", summary.degradationPerLap > 0.25 ? "critical" : "warning", "medium", `Stint ${summary.stint}`, "The second half of this stint is noticeably slower than the first half. That can indicate tyre degradation, fuel-saving, traffic, or thermal drift.", [`First half avg ${timeValue(summary.firstHalfAverage)}`, `Second half avg ${timeValue(summary.secondHalfAverage)}`, `Drift ${formatRaceTime(summary.degradationPerLap)}/lap`], "Overlay early-stint and late-stint laps, then check tyres, brake temps, and minimum speed loss."));
    }
    if (summary.fuelVariance != null && summary.averageFuelPerLap != null && Math.sqrt(summary.fuelVariance) > summary.averageFuelPerLap * 0.08) {
      hints.push(hint("Fuel use is inconsistent within stint", "warning", "medium", `Stint ${summary.stint}`, "Fuel consumption varies enough inside this stint to matter for strategy. This usually comes from traffic, lift-and-coast inconsistency, or push laps.", [`Average ${fmt(summary.averageFuelPerLap, 3)} L/lap`, `Std dev ${fmt(Math.sqrt(summary.fuelVariance), 3)} L`], "Identify high-consumption laps and compare throttle time, top speed, and braking zones."));
    }
    if (summary.tyreWearDelta != null && summary.tyreWearDelta > 8) {
      hints.push(hint("High tyre wear across stint", summary.tyreWearDelta > 15 ? "critical" : "warning", "medium", `Stint ${summary.stint}`, "Average tyre wear rises significantly across this stint. If pace also degrades, the stint may be too long or the car is sliding too much.", [`Tyre wear delta ${fmt(summary.tyreWearDelta, 1)}%`, `${summary.lapCount} laps`], "Check tyre pressure/temperature balance and compare steering/minimum-speed traces late in the stint."));
    }
    if (summary.lapCount <= 2 && summaries.length > 1) {
      hints.push(hint("Very short stint detected", "info", "medium", `Stint ${summary.stint}`, "This stint is very short. It may be a real short run, an out/in lap sequence, or an artifact of fuel-based stint detection.", [`Lap count ${summary.lapCount}`, `Laps ${summary.startLap}-${summary.endLap}`], "Verify pit stop detection in Fuel Strategy before using this stint for degradation conclusions."));
    }
  });
  const paceComparable = summaries.filter((summary) => summary.averageLap != null);
  if (paceComparable.length >= 2) {
    const best = [...paceComparable].sort((a, b) => (a.averageLap ?? Infinity) - (b.averageLap ?? Infinity))[0];
    const worst = [...paceComparable].sort((a, b) => (b.averageLap ?? 0) - (a.averageLap ?? 0))[0];
    if (best.averageLap != null && worst.averageLap != null && worst.averageLap - best.averageLap > 0.5) {
      hints.push(hint("Stint pace spread", "warning", "medium", "Session", "Average pace differs meaningfully between stints. That may be fuel load, tyres, traffic, or track evolution.", [`Best stint ${best.stint}: ${timeValue(best.averageLap)}`, `Slowest stint ${worst.stint}: ${timeValue(worst.averageLap)}`], "Compare stint conditions and fuel load before attributing the difference to setup or driving."));
    }
  }
  if (!hints.length) hints.push(hint("Stint performance is stable", "info", "medium", "Session", "The detected stints do not show major pace, fuel, or tyre-wear warnings with the current thresholds.", ["Stint averages and degradation checks stayed within simple thresholds."], "Use the stint table for details and compare representative laps if you want to find smaller gains."));
  return hints;
}

function HintSection({ title, hints }: { title: string; hints: EngineerHint[] }) {
  return (
    <section className="card span-12">
      <SectionTitle title={title} help={worksheetHelp(title)} />
      <div className="grid">
        {hints.map((item, index) => (
          <div className="card span-4 compact" key={`${item.title}-${index}`}>
            <div className="row"><strong>{item.title}</strong><span className={`badge ${item.severity === "critical" ? "red" : item.severity === "warning" ? "amber" : "blue"}`}>{item.severity}</span></div>
            <p className="muted">{item.explanation}</p>
            <div className="row"><span className="subvalue">Confidence {item.confidence}</span><span className="subvalue">{item.affected}</span></div>
            <div className="metric"><span className="label">Evidence</span>{item.evidence.slice(0, 4).map((line) => <span className="subvalue" key={line}>{line}</span>)}</div>
            <div className="metric"><span className="label">Engineer action</span><span className="subvalue">{item.action}</span></div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StintSummaryPanel({ summaries }: { summaries: StintSummary[] }) {
  if (!summaries.length) return <section className="card span-12"><SectionTitle title="Stint Summary" help="Summarizes each detected fuel stint. Compare pace, fuel use, and degradation before changing strategy assumptions." /><Empty message="No stint summary can be built from the imported laps." /></section>;
  return (
    <section className="card span-12">
      <SectionTitle title="Stint Summary" help="Summarizes each detected fuel stint. Compare pace, fuel use, and degradation before changing strategy assumptions." />
      <div className="grid">
        {summaries.map((summary) => (
          <div className="card span-3 compact" key={summary.stint}>
            <SectionTitle title={`Stint ${summary.stint}`} help="Shows pace, degradation, and fuel for this stint. Treat very short stints as less reliable for trend conclusions." />
            <div className="metric"><span className="label">Laps</span><span className="value">{summary.startLap}-{summary.endLap}</span><span className="subvalue">{summary.lapCount} laps</span></div>
            <div className="metric"><span className="label">Average / fastest</span><span className="subvalue">{timeValue(summary.averageLap)} / {timeValue(summary.fastestLap)}</span></div>
            <div className="metric"><span className="label">Degradation</span><span className="subvalue">{summary.degradationPerLap != null ? `${formatRaceTime(summary.degradationPerLap)}/lap` : "--"}</span></div>
            <div className="metric"><span className="label">Fuel</span><span className="subvalue">{fmt(summary.fuelUsed, 2)} L total / {fmt(summary.averageFuelPerLap, 3)} L/lap</span></div>
          </div>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Stint</th><th>Laps</th><th>Count</th><th>Fastest</th><th>Average</th><th>Median</th><th>First half</th><th>Second half</th><th>Deg/lap</th><th>Fuel</th><th>Fuel/lap</th><th>Fuel variance</th><th>Fuel added</th><th>Tyre wear delta</th></tr></thead>
          <tbody>{summaries.map((summary) => <tr key={summary.stint}><td>{summary.stint}</td><td>{summary.startLap}-{summary.endLap}</td><td>{summary.lapCount}</td><td>{timeValue(summary.fastestLap)}</td><td>{timeValue(summary.averageLap)}</td><td>{timeValue(summary.medianLap)}</td><td>{timeValue(summary.firstHalfAverage)}</td><td>{timeValue(summary.secondHalfAverage)}</td><td>{summary.degradationPerLap != null ? `${formatRaceTime(summary.degradationPerLap)}/lap` : "--"}</td><td>{fmt(summary.fuelUsed, 2)} L</td><td>{fmt(summary.averageFuelPerLap, 3)} L</td><td>{summary.fuelVariance != null ? fmt(summary.fuelVariance, 4) : "--"}</td><td>{summary.fuelAdded != null ? `${fmt(summary.fuelAdded, 2)} L` : "--"}</td><td>{summary.tyreWearDelta != null ? `${fmt(summary.tyreWearDelta, 1)}%` : "--"}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

function RaceEngineerWorksheet({ session, lapA, lapB, setLapA, setLapB }: { session: MotecSession; lapA: string; lapB: string; setLapA: (lap: string) => void; setLapB: (lap: string) => void }) {
  const bestLap = session.laps.filter((lap) => lap.duration != null && lap.lapNumber !== lapA).sort((a, b) => (a.duration ?? Infinity) - (b.duration ?? Infinity))[0] || session.laps[0];
  const referenceLap = lapB || bestLap?.lapNumber || "";
  const selectedSamples = useMotecSamples(session, lapA, engineerChannels, 7000);
  const referenceSamples = useMotecSamples(session, referenceLap, engineerChannels, 7000);
  const sessionSamples = useMotecSamples(session, "__all__", engineerChannels, 10000);
  const drivingHints = useMemo(() => analyzeDriving(session, lapA, referenceLap, selectedSamples, referenceSamples), [session, lapA, referenceLap, selectedSamples, referenceSamples]);
  const setupHints = useMemo(() => analyzeSetup(session, sessionSamples), [session, sessionSamples]);
  const strategyHints = useMemo(() => analyzeStrategy(session), [session]);
  const stintSummaries = useMemo(() => buildStintSummaries(session, sessionSamples), [session, sessionSamples]);
  const stintHints = useMemo(() => analyzeStints(session, sessionSamples), [session, sessionSamples]);
  const allHints = [...drivingHints, ...setupHints, ...strategyHints, ...stintHints];
  const criticalCount = allHints.filter((item) => item.severity === "critical").length;
  const warningCount = allHints.filter((item) => item.severity === "warning").length;
  return (
    <div className="page grid">
      <LapSelectors session={session} lapA={lapA} lapB={lapB} setLapA={setLapA} setLapB={setLapB} />
      <section className="card span-12">
        <SectionTitle title="Race Engineer Overview" help="Combines driving, setup, and strategy hints. Each recommendation is deterministic and backed by computed telemetry evidence." />
        <p className="muted">Rules-first analysis. No LLM is used here: every hint is generated from imported CSV channels and lap metadata.</p>
        <div className="motec-value-grid">
          <div><span className="label">Primary lap</span><strong>{lapA || "--"}</strong></div>
          <div><span className="label">Reference lap</span><strong>{referenceLap || "--"}</strong><span className="subvalue">{lapB ? "manual compare lap" : "fastest available lap"}</span></div>
          <div><span className="label">Critical hints</span><strong>{criticalCount}</strong></div>
          <div><span className="label">Warnings</span><strong>{warningCount}</strong></div>
        </div>
      </section>
      <HintSection title="Lap Time And Driving" hints={drivingHints} />
      <HintSection title="Setup Health" hints={setupHints} />
      <HintSection title="Strategy" hints={strategyHints} />
      <StintSummaryPanel summaries={stintSummaries} />
      <HintSection title="Entire Stint Analysis" hints={stintHints} />
    </div>
  );
}

function FuelStrategyWorksheet({ session, lapA, lapB, setLapA, setLapB }: { session: MotecSession; lapA: string; lapB: string; setLapA: (lap: string) => void; setLapB: (lap: string) => void }) {
  const samples = useMotecSamples(session, "__all__", ["Fuel Level", "Session Elapsed Time", "Lap Number"], 8000);
  const rows = useMemo(() => buildFuelLapRows(session), [session]);
  const validUsage = rows.map((row) => row.fuelUsed).filter((value): value is number => value != null && value >= 0);
  const averageFuel = validUsage.reduce((sum, value) => sum + value, 0) / Math.max(validUsage.length, 1);
  const currentFuel = [...rows].reverse().find((row) => row.fuelEnd != null)?.fuelEnd ?? null;
  const pitStops = rows.filter((row) => row.pitStop);
  const chartRows = rows.map((row) => ({
    lap: row.lapNumber,
    fuelUsed: row.fuelUsed,
    fuelStart: row.fuelStart,
    fuelEnd: row.fuelEnd,
    fuelAdded: row.fuelAdded,
  }));
  const fuelTrace = samples.map((sample, index) => ({
    index,
    time: numeric(sample, "Session Elapsed Time") ?? index,
    fuel: numeric(sample, "Fuel Level"),
    lap: sample["Lap Number"],
  }));
  return (
    <div className="page grid">
      <LapSelectors session={session} lapA={lapA} lapB={lapB} setLapA={setLapA} setLapB={setLapB} />
      <section className="card span-12">
        <SectionTitle title="Fuel Consumption Summary" help="Summarizes fuel state and consumption. Average fuel per lap is the anchor for stint length and finish estimates." />
        {!channelByName(session, "Fuel Level") && <div className="motec-warning">Missing channel: Fuel Level</div>}
        <div className="motec-value-grid">
          <div><span className="label">Current fuel</span><strong>{fmt(currentFuel, 2)} L</strong></div>
          <div><span className="label">Average per lap</span><strong>{fmt(averageFuel, 3)} L/lap</strong></div>
          <div><span className="label">Total fuel used</span><strong>{fmt(validUsage.reduce((sum, value) => sum + value, 0), 2)} L</strong></div>
          <div><span className="label">Estimated laps remaining</span><strong>{currentFuel != null && averageFuel > 0 ? fmt(currentFuel / averageFuel, 1) : "--"}</strong></div>
          <div><span className="label">Pit stops detected</span><strong>{pitStops.length}</strong></div>
          <div><span className="label">Stints detected</span><strong>{Math.max(1, ...rows.map((row) => row.stint))}</strong></div>
        </div>
      </section>
      <section className="card span-8">
        <SectionTitle title="Fuel Level Timeline" help="Shows fuel level through the session. A steady downward line gives reliable consumption; upward jumps identify refuelling." />
        {fuelTrace.length ? (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={fuelTrace}>
              <CartesianGrid stroke="#27313a" />
              <XAxis dataKey="time" stroke="#8896a3" tickFormatter={(value) => timeValue(Number(value))} />
              <YAxis stroke="#8896a3" />
              <Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} labelFormatter={(value) => timeValue(Number(value))} />
              <Line dataKey="fuel" name="Fuel Level" stroke="#e6b450" dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        ) : <Empty message="Fuel Level samples are needed for the full-session fuel trace." />}
      </section>
      <section className="card span-4">
        <SectionTitle title="Pit Stop Strategy" help="Lists detected refuel stops. Use fuel added and lap timing to understand stint boundaries and pit-cycle behavior." />
        {pitStops.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Pit</th><th>Lap</th><th>Time</th><th>Fuel Added</th></tr></thead>
              <tbody>{pitStops.map((pit, index) => <tr key={`${pit.lapNumber}-${index}`}><td>{index + 1}</td><td>{pit.lapNumber}</td><td>{timeValue(pit.startTime)}</td><td>{fmt(pit.fuelAdded, 2)} L</td></tr>)}</tbody>
            </table>
          </div>
        ) : <Empty message="No pit stops detected. A stop is inferred when fuel increases by more than 2 L between or within laps." />}
      </section>
      <section className="card span-6">
        <SectionTitle title="Fuel Used Per Lap" help="Shows fuel burned on each lap. Consistent bars improve strategy confidence; outliers deserve a traffic or driving-style check." />
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartRows}>
            <CartesianGrid stroke="#27313a" />
            <XAxis dataKey="lap" stroke="#8896a3" />
            <YAxis stroke="#8896a3" />
            <Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} />
            <Bar dataKey="fuelUsed" name="Fuel Used" fill="#6dd6ff" />
            <Bar dataKey="fuelAdded" name="Fuel Added" fill="#91e48f" />
          </BarChart>
        </ResponsiveContainer>
      </section>
      <section className="card span-6">
        <SectionTitle title="Fuel By Lap" help="Compares fuel at lap start and end. Large increases mark refuelling, while changing slopes show consumption variation." />
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartRows}>
            <CartesianGrid stroke="#27313a" />
            <XAxis dataKey="lap" stroke="#8896a3" />
            <YAxis stroke="#8896a3" />
            <Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} />
            <Line dataKey="fuelStart" name="Fuel Start" stroke="#e6b450" dot={false} connectNulls />
            <Line dataKey="fuelEnd" name="Fuel End" stroke="#ff8c69" dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </section>
      <section className="card span-12">
        <SectionTitle title="Lap Fuel Table" help="Provides exact lap fuel numbers. Use it to validate pit detection and calculate race-finish margins." />
        <div className="table-wrap">
          <table>
            <thead><tr><th>Lap</th><th>Stint</th><th>Start Time</th><th>Duration</th><th>Fuel Start</th><th>Fuel End</th><th>Fuel Used</th><th>Pit Stop</th><th>Fuel Added</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.lapNumber}><td>{row.lapNumber}</td><td>{row.stint}</td><td>{timeValue(row.startTime)}</td><td>{timeValue(row.duration)}</td><td>{fmt(row.fuelStart, 2)} L</td><td>{fmt(row.fuelEnd, 2)} L</td><td>{fmt(row.fuelUsed, 3)} L</td><td>{row.pitStop ? "Yes" : "No"}</td><td>{row.fuelAdded != null ? `${fmt(row.fuelAdded, 2)} L` : "--"}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Worksheet({ session, worksheet, lapA, lapB, setLapA, setLapB }: { session: MotecSession | null; worksheet: WorksheetKey; lapA: string; lapB: string; setLapA: (lap: string) => void; setLapB: (lap: string) => void }) {
  const [cursor, setCursor] = useState(0);
  const [xyX, setXyX] = useState("Ground Speed");
  const [xyY, setXyY] = useState("Engine RPM");
  const [histChannel, setHistChannel] = useState("Ground Speed");
  const [mapColor, setMapColor] = useState("Ground Speed");
  const samples = useMotecSamples(session, lapA, ["Ground Speed", "Brake Pos", "Throttle Pos", "Steering", "Engine RPM", "G Force Lat", "G Force Long", "Fuel Level"]);
  const allNumeric = session?.channels.filter((channel) => channel.type !== "marker") || [];
  const stack = (title: string, groups: Array<[string, string[]]>, cards: string[] = []) => (
    <div className="page grid">
      <LapSelectors session={session} lapA={lapA} lapB={lapB} setLapA={setLapA} setLapB={setLapB} />
      {groups.map(([label, channels]) => <ChartBlock key={label} session={session} title={label} channels={channels} lapA={lapA} lapB={lapB} cursor={cursor} setCursor={setCursor} />)}
      <CursorValues session={session} lapA={lapA} cursor={cursor} channels={groups.flatMap(([, channels]) => channels).slice(0, 12)} />
      {cards.length > 0 && <AnalysisCards samples={samples} channels={cards} />}
      <section className="card span-12"><SectionTitle title={title} help={worksheetHelp(title)} /><p className="muted">Worksheet uses imported CSV channels only. Missing channels are reported above each graph.</p></section>
    </div>
  );
  if (!session) return <div className="page"><section className="card"><Empty /></section></div>;
  if (worksheet === "compare") return stack("Compare", [["Ground Speed", ["Ground Speed"]], ["Throttle / Brake", ["Throttle Pos", "Brake Pos"]], ["Gear", ["Gear"]], ["Delta", ["Delta Best", "Realtime Loss"]]]);
  if (worksheet === "driver") return stack("Driver", [["Ground Speed", ["Ground Speed"]], ["Throttle / Brake", ["Throttle Pos", "Brake Pos"]], ["Steering", ["Steering"]], ["FFB Output", ["FFB Output"]], ["Engine RPM", ["Engine RPM"]], ["Gear", ["Gear"]], ["G Force", ["G Force Lat", "G Force Long"]]], ["Ground Speed", "Brake Pos", "Throttle Pos", "Steering", "G Force Lat", "G Force Long"]);
  if (worksheet === "tyre-temp") return stack("Tyre Temperatures", [["FL", ["Tyre Temp FL Outer", "Tyre Temp FL Centre", "Tyre Temp FL Inner"]], ["FR", ["Tyre Temp FR Outer", "Tyre Temp FR Centre", "Tyre Temp FR Inner"]], ["RL", ["Tyre Temp RL Outer", "Tyre Temp RL Centre", "Tyre Temp RL Inner"]], ["RR", ["Tyre Temp RR Outer", "Tyre Temp RR Centre", "Tyre Temp RR Inner"]]], ["Tyre Temp Avg FL", "Tyre Temp Avg FR", "Tyre Temp Avg RL", "Tyre Temp Avg RR"]);
  if (worksheet === "tyre-pressure") return stack("Tyre Pressure / Wear", [["Pressure", ["Tyre Pressure FL", "Tyre Pressure FR", "Tyre Pressure RL", "Tyre Pressure RR"]], ["Wear", ["Tyre Wear FL", "Tyre Wear FR", "Tyre Wear RL", "Tyre Wear RR"]], ["Ground Speed", ["Ground Speed"]], ["G Force Lat", ["G Force Lat"]]], ["Front Tyre Pressure Avg", "Rear Tyre Pressure Avg", "Front Tyre Wear Avg", "Rear Tyre Wear Avg"]);
  if (worksheet === "brakes") return stack("Brakes", [["Brake Pos", ["Brake Pos"]], ["Front Temps", ["Brake Temp FL", "Brake Temp FR"]], ["Rear Temps", ["Brake Temp RL", "Brake Temp RR"]], ["Ground Speed", ["Ground Speed"]], ["G Force Long", ["G Force Long"]]], ["Brake Temp FL", "Brake Temp FR", "Brake Temp RL", "Brake Temp RR"]);
  if (worksheet === "ride-height") return stack("Ride Height / Platform", [["Front Ride Height", ["Ride Height FL", "Ride Height FR"]], ["Rear Ride Height", ["Ride Height RL", "Ride Height RR"]], ["Ground Speed", ["Ground Speed"]], ["Inputs", ["Brake Pos", "Throttle Pos"]], ["G Force Long", ["G Force Long"]]], ["Front Ride Height Avg", "Rear Ride Height Avg", "Rake", "Front Ride Height Min", "Rear Ride Height Min"]);
  if (worksheet === "g-force") return <GForceWorksheet session={session} lapA={lapA} lapB={lapB} setLapA={setLapA} setLapB={setLapB} cursor={cursor} setCursor={setCursor} />;
  if (worksheet === "map") return <MapWorksheet session={session} lapA={lapA} lapB={lapB} setLapA={setLapA} setLapB={setLapB} color={mapColor} setColor={setMapColor} />;
  if (worksheet === "histograms") return <HistogramWorksheet session={session} lapA={lapA} lapB={lapB} setLapA={setLapA} setLapB={setLapB} channel={histChannel} setChannel={setHistChannel} numericChannels={allNumeric} />;
  if (worksheet === "xy") return <XYWorksheet session={session} lapA={lapA} lapB={lapB} setLapA={setLapA} setLapB={setLapB} x={xyX} y={xyY} setX={setXyX} setY={setXyY} numericChannels={allNumeric} />;
  if (worksheet === "powertrain") return stack("Powertrain", [["Engine RPM", ["Engine RPM"]], ["Gear", ["Gear"]], ["Ground Speed", ["Ground Speed"]], ["Temperatures", ["Eng Water Temp", "Eng Oil Temp"]], ["Fuel / Battery", ["Fuel Level", "Battery Charge Level"]]], ["Engine RPM", "Fuel Level", "Battery Charge Level", "Eng Water Temp", "Eng Oil Temp"]);
  if (worksheet === "fuel-strategy") return <FuelStrategyWorksheet session={session} lapA={lapA} lapB={lapB} setLapA={setLapA} setLapB={setLapB} />;
  if (worksheet === "race-engineer") return <RaceEngineerWorksheet session={session} lapA={lapA} lapB={lapB} setLapA={setLapA} setLapB={setLapB} />;
  if (worksheet === "wheel-speeds") return stack("Wheel Speeds", [["Wheel Rotation", ["Wheel Rot Speed FL", "Wheel Rot Speed FR", "Wheel Rot Speed RL", "Wheel Rot Speed RR"]], ["Ground Speed", ["Ground Speed"]], ["Inputs", ["Brake Pos", "Throttle Pos"]], ["G Force Long", ["G Force Long"]]]);
  if (worksheet === "environment") return stack("Environment", [["Ambient / Track", ["Ambient Temperature", "Track Temperature"]], ["Ground Speed", ["Ground Speed"]], ["Tyre Pressure", ["Tyre Pressure FL", "Tyre Pressure FR", "Tyre Pressure RL", "Tyre Pressure RR"]], ["Tyre Temps", ["Tyre Temp Avg FL", "Tyre Temp Avg FR", "Tyre Temp Avg RL", "Tyre Temp Avg RR"]]], ["Ambient Temperature", "Track Temperature"]);
  if (worksheet === "speed-delta") return stack("Speed / Delta", [["Ground Speed", ["Ground Speed"]], ["Delta Best", ["Delta Best"]], ["Realtime Loss", ["Realtime Loss"]], ["Straight / Corner", ["Max Straight Speed", "Min Corner Speed"]]], ["Delta Best", "Realtime Loss", "Ground Speed"]);
  return stack("Inputs", [["Throttle", ["Throttle Pos"]], ["Brake", ["Brake Pos"]], ["Clutch", ["Clutch Pos"]], ["Steering", ["Steering"]], ["Wheel / Torque", ["Steering Wheel Position", "Steering Shaft Torque"]], ["Brake Bias", ["Brake Bias Rear"]]], ["Brake Pos", "Throttle Pos", "Steering", "Brake Bias Rear"]);
}

function GForceWorksheet(props: { session: MotecSession; lapA: string; lapB: string; setLapA: (lap: string) => void; setLapB: (lap: string) => void; cursor: number; setCursor: (value: number) => void }) {
  const samples = useMotecSamples(props.session, props.lapA, ["G Force Lat", "G Force Long", "G Force Vert", "Combined G"]);
  return (
    <div className="page grid">
      <LapSelectors session={props.session} lapA={props.lapA} lapB={props.lapB} setLapA={props.setLapA} setLapB={props.setLapB} />
      {["G Force Lat", "G Force Long", "G Force Vert", "Ground Speed", "Steering", "Brake Pos", "Throttle Pos"].map((channel) => <ChartBlock key={channel} session={props.session} title={channel} channels={[channel]} lapA={props.lapA} lapB={props.lapB} cursor={props.cursor} setCursor={props.setCursor} />)}
      <section className="card span-6"><SectionTitle title="G-G Diagram" help={worksheetHelp("G-G Diagram")} /><ResponsiveContainer width="100%" height={360}><ScatterChart><CartesianGrid stroke="#27313a" /><XAxis dataKey="x" stroke="#8896a3" /><YAxis dataKey="y" stroke="#8896a3" /><Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} /><Scatter fill="#e6b450" data={samples.map((sample) => ({ x: numeric(sample, "G Force Lat"), y: numeric(sample, "G Force Long") }))} /></ScatterChart></ResponsiveContainer></section>
      <AnalysisCards samples={samples} channels={["G Force Lat", "G Force Long", "G Force Vert", "Combined G"]} />
    </div>
  );
}

function MapWorksheet({ session, lapA, lapB, setLapA, setLapB, color, setColor }: { session: MotecSession; lapA: string; lapB: string; setLapA: (lap: string) => void; setLapB: (lap: string) => void; color: string; setColor: (channel: string) => void }) {
  const samples = useMotecSamples(session, lapA, ["GPS Latitude", "GPS Longitude", color], 6000).filter((sample) => numeric(sample, "GPS Latitude") != null && numeric(sample, "GPS Longitude") != null);
  const lats = samples.map((sample) => numeric(sample, "GPS Latitude")!);
  const lons = samples.map((sample) => numeric(sample, "GPS Longitude")!);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
  return (
    <div className="page grid">
      <LapSelectors session={session} lapA={lapA} lapB={lapB} setLapA={setLapA} setLapB={setLapB} />
      <section className="card span-12"><SectionTitle title="Map Controls" help="Chooses the channel used to color the GPS trace. Use speed, brake, or throttle coloring to understand corner behavior." /><select value={color} onChange={(event) => setColor(event.target.value)}>{["Ground Speed", "Brake Pos", "Throttle Pos", "Delta Best", "Tyre Wear FL", "Brake Temp FL"].map((name) => <option key={name}>{name}</option>)}</select></section>
      <section className="card span-12"><SectionTitle title="GPS Trace" help={worksheetHelp("GPS Trace")} />{samples.length ? <svg className="motec-map" viewBox="0 0 800 420">{samples.map((sample, index) => { const x = ((numeric(sample, "GPS Longitude")! - minLon) / Math.max(maxLon - minLon, 0.000001)) * 760 + 20; const y = 400 - ((numeric(sample, "GPS Latitude")! - minLat) / Math.max(maxLat - minLat, 0.000001)) * 380; const intensity = Math.min(1, Math.max(0, (numeric(sample, color) ?? 0) / 100)); return <circle key={index} cx={x} cy={y} r="2.5" fill={`rgb(${Math.round(230 * intensity)}, ${180}, ${Math.round(80 + 120 * (1 - intensity))})`} />; })}</svg> : <Empty message="GPS Latitude/GPS Longitude are missing or invalid. Time-based analysis still works." />}</section>
    </div>
  );
}

function HistogramWorksheet({ session, lapA, lapB, setLapA, setLapB, channel, setChannel, numericChannels }: { session: MotecSession; lapA: string; lapB: string; setLapA: (lap: string) => void; setLapB: (lap: string) => void; channel: string; setChannel: (channel: string) => void; numericChannels: ChannelDefinition[] }) {
  const samples = useMotecSamples(session, lapA, [channel], 10000);
  const values = samples.map((sample) => numeric(sample, channel)).filter((value): value is number => value != null);
  const min = Math.min(...values), max = Math.max(...values);
  const bins = Array.from({ length: 20 }, (_, index) => ({ bin: fmt(min + ((max - min) / 20) * index, 1), count: 0 }));
  values.forEach((value) => { const index = Math.min(19, Math.max(0, Math.floor(((value - min) / Math.max(max - min, 0.000001)) * 20))); bins[index].count += 1; });
  return (
    <div className="page grid">
      <LapSelectors session={session} lapA={lapA} lapB={lapB} setLapA={setLapA} setLapB={setLapB} />
      <section className="card span-12"><SectionTitle title="Histogram Channel" help="Chooses the numeric channel to distribute into bins. Histograms are useful for operating windows, not lap sequencing." /><select value={channel} onChange={(event) => setChannel(event.target.value)}>{numericChannels.map((item) => <option key={item.originalName}>{item.originalName}</option>)}</select></section>
      <section className="card span-8"><SectionTitle title={`${channel} Histogram`} help={worksheetHelp("Histogram")} /><ResponsiveContainer width="100%" height={360}><BarChart data={bins}><CartesianGrid stroke="#27313a" /><XAxis dataKey="bin" stroke="#8896a3" /><YAxis stroke="#8896a3" /><Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} /><Bar dataKey="count" fill="#e6b450" /></BarChart></ResponsiveContainer></section>
      <section className="card span-4"><SectionTitle title="Stats" help="Summarizes the selected histogram channel. Use min, max, and average to spot abnormal operating ranges." /><AnalysisCards samples={samples} channels={[channel]} /></section>
    </div>
  );
}

function XYWorksheet({ session, lapA, lapB, setLapA, setLapB, x, y, setX, setY, numericChannels }: { session: MotecSession; lapA: string; lapB: string; setLapA: (lap: string) => void; setLapB: (lap: string) => void; x: string; y: string; setX: (channel: string) => void; setY: (channel: string) => void; numericChannels: ChannelDefinition[] }) {
  const samples = useMotecSamples(session, lapA, [x, y], 6000);
  const presets: Array<[string, string, string]> = [["Ground Speed vs Time", "Time", "Ground Speed"], ["Throttle vs Time", "Time", "Throttle Pos"], ["Brake vs Speed", "Ground Speed", "Brake Pos"], ["G-G", "G Force Lat", "G Force Long"], ["RPM vs Speed", "Ground Speed", "Engine RPM"], ["Rake vs Speed", "Ground Speed", "Rake"]];
  return (
    <div className="page grid">
      <LapSelectors session={session} lapA={lapA} lapB={lapB} setLapA={setLapA} setLapB={setLapB} />
      <section className="card span-12"><SectionTitle title="X-Y Controls" help="Chooses channels for relationship plotting. Presets cover common driver, setup, and powertrain questions." /><div className="input-grid"><select value={x} onChange={(event) => setX(event.target.value)}>{numericChannels.map((item) => <option key={item.originalName}>{item.originalName}</option>)}</select><select value={y} onChange={(event) => setY(event.target.value)}>{numericChannels.map((item) => <option key={item.originalName}>{item.originalName}</option>)}</select></div><div className="control-row">{presets.map(([label, px, py]) => <button key={label} onClick={() => { setX(px); setY(py); }}>{label}</button>)}</div></section>
      <section className="card span-8"><SectionTitle title={`${y} vs ${x}`} help={worksheetHelp("X-Y Plot")} /><ResponsiveContainer width="100%" height={380}><ScatterChart><CartesianGrid stroke="#27313a" /><XAxis dataKey="x" stroke="#8896a3" /><YAxis dataKey="y" stroke="#8896a3" /><Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} /><Scatter fill="#e6b450" data={samples.map((sample) => ({ x: numeric(sample, x), y: numeric(sample, y) }))} /></ScatterChart></ResponsiveContainer></section>
      <section className="card span-4"><SectionTitle title="Stats" help="Summarizes the plotted channels. Check sample count and ranges before trusting a relationship." /><AnalysisCards samples={samples} channels={[x, y]} /></section>
    </div>
  );
}

export function MotecWorkspace() {
  const [sessions, setSessions] = useState<MotecSession[]>([]);
  const [sessionId, setSessionId] = useState("");
  const session = sessions.find((item) => item.id === sessionId) || sessions[0] || null;
  const [worksheet, setWorksheet] = useState<WorksheetKey>("import");
  const [lapA, setLapA] = useState("");
  const [lapB, setLapB] = useState("");
  const activeLapA = lapA || session?.laps[0]?.lapNumber || "";
  const activeLapB = lapB;
  const selectSession = (next: MotecSession) => {
    setSessions((current) => [next, ...current.filter((item) => item.id !== next.id)]);
    setSessionId(next.id);
  };
  const loadSession = (id: string) => {
    void api.motecSession(id).then((next) => {
      selectSession(next);
      setLapA((current) => current || next.laps[0]?.lapNumber || "");
    });
  };
  const setImported = (next: MotecSession, openAnalysis = true) => {
    selectSession(next);
    setLapA(next.laps[0]?.lapNumber || "");
    if (openAnalysis) setWorksheet("compare");
  };
  useEffect(() => {
    void api.motecSessions().then((loaded) => {
      setSessions(loaded);
      const firstId = loaded[0]?.id || "";
      setSessionId((current) => current || firstId);
      if (firstId) loadSession(firstId);
    });
  }, []);
  useEffect(() => {
    if (session && !lapA) setLapA(session.laps[0]?.lapNumber || "");
  }, [session, lapA]);
  return (
    <div className="motec-workspace">
      <aside className="motec-worksheets">
        <label>Session<select value={session?.id || ""} onChange={(event) => loadSession(event.target.value)}>{sessions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {worksheets.map(([key, label]) => <button key={key} className={worksheet === key ? "active" : ""} onClick={() => setWorksheet(key)}>{label}</button>)}
      </aside>
      <main className="motec-main">
        {worksheet === "import" ? <ImportPage onImported={setImported} /> : worksheet === "laps" ? <LapBrowser session={session} setLapA={setLapA} setLapB={setLapB} /> : <Worksheet session={session} worksheet={worksheet} lapA={activeLapA} lapB={activeLapB} setLapA={setLapA} setLapB={setLapB} />}
      </main>
    </div>
  );
}
