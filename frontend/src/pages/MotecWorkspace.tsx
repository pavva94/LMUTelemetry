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
import { channelByName, numeric } from "../lib/motecCsv";
import { formatRaceTime } from "../lib/timeFormat";
import type { ChannelDefinition, MotecSample, MotecSession } from "../types/motec";

type WorksheetKey =
  | "import" | "laps" | "compare" | "driver" | "tyre-temp" | "tyre-pressure" | "brakes" | "ride-height"
  | "g-force" | "map" | "histograms" | "xy" | "powertrain" | "fuel-strategy" | "wheel-speeds" | "environment" | "speed-delta" | "inputs";

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
  ["wheel-speeds", "Wheel Speeds"],
  ["environment", "Environment"],
  ["speed-delta", "Speed / Delta"],
  ["inputs", "Inputs"],
];

const colors = ["#e6b450", "#6dd6ff", "#ff6961", "#91e48f", "#c7a8ff", "#ff8c69", "#ff7da7"];
const fmt = (value: number | null | undefined, digits = 1) => value == null || Number.isNaN(value) ? "--" : value.toFixed(digits);
const timeValue = (value: number | null | undefined) => formatRaceTime(value);
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
  if (!session) return <section className="card span-12"><h2>{title}</h2><Empty /></section>;
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
      <div className="row"><h2>{title} {unit && <span className="muted">({unit})</span>}</h2><span className="muted">Cursor {cursor.toFixed(0)}%</span></div>
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
      <h2>Cursor Values</h2>
      <div className="motec-value-grid">
        {channels.map((channel) => <div key={channel}><span className="label">{channel}</span><strong>{displayChannelValue({ [channel]: valueAt(samples, channel, cursor) }, channel, session)}</strong></div>)}
      </div>
    </section>
  );
}

function AnalysisCards({ samples, channels }: { samples: MotecSample[]; channels: string[] }) {
  return (
    <section className="card span-12">
      <h2>Key Values</h2>
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
  };
  const importPreview = async () => {
    if (!file) return;
    try {
      setBusy(true);
      setError("");
      setProgress("Uploading and importing CSV in the backend. Large files can take a while...");
      const importedSession = await api.motecImport(file);
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
        <h2>CSV Import</h2>
        <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => void handleFile(event.target.files?.[0] || null)} />
        {progress && <p className="subvalue">{progress}</p>}
        {error && <p className="motec-warning">{error}</p>}
        {file && <button className="primary" disabled={busy} onClick={() => void importPreview()}>Import Session</button>}
        {preview && imported && <button onClick={() => onImported(preview, true)}>Open Analysis</button>}
      </section>
      <section className="card span-8">
        <h2>Detected Session</h2>
        {preview ? (
          <div className="motec-value-grid">
            <div><span className="label">Channels</span><strong>{preview.channels.length}</strong></div>
            <div><span className="label">Samples</span><strong>{preview.samples.length}</strong></div>
            <div><span className="label">Laps</span><strong>{preview.laps.length}</strong></div>
            <div><span className="label">Session time</span><strong>{timeValue(preview.minSessionTime)} - {timeValue(preview.maxSessionTime)}</strong></div>
          </div>
        ) : <Empty message="Choose a two-header-row telemetry CSV." />}
        {preview?.warnings.map((warning) => <p className="motec-warning" key={warning}>{warning}</p>)}
      </section>
      <section className="card span-12">
        <h2>Channel Registry</h2>
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
      <section className="card span-12"><h2>Lap Browser</h2><div className="table-wrap"><table><thead><tr><th>Lap</th><th>Start</th><th>End</th><th>Duration</th><th>Max Speed</th><th>Min Corner</th><th>Max RPM</th><th>Fuel Start</th><th>Fuel End</th><th>Select</th></tr></thead><tbody>{session.laps.map((lap) => <tr key={lap.lapNumber}><td>{lap.lapNumber}</td><td>{timeValue(lap.startTime)}</td><td>{timeValue(lap.endTime)}</td><td>{timeValue(lap.duration)}</td><td>{fmt(lap.maxSpeed)}</td><td>{fmt(lap.minCornerSpeed)}</td><td>{fmt(lap.maxRpm, 0)}</td><td>{fmt(lap.fuelStart)}</td><td>{fmt(lap.fuelEnd)}</td><td><button onClick={() => setLapA(lap.lapNumber)}>Primary</button><button onClick={() => setLapB(lap.lapNumber)}>Compare</button></td></tr>)}</tbody></table></div></section>
      <section className="card span-12"><h2>Registry</h2><ChannelRegistry channels={session.channels} /></section>
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
        <h2>Fuel Consumption Summary</h2>
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
        <h2>Fuel Level Timeline</h2>
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
        <h2>Pit Stop Strategy</h2>
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
        <h2>Fuel Used Per Lap</h2>
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
        <h2>Fuel By Lap</h2>
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
        <h2>Lap Fuel Table</h2>
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
      <section className="card span-12"><h2>{title}</h2><p className="muted">Worksheet uses imported CSV channels only. Missing channels are reported above each graph.</p></section>
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
      <section className="card span-6"><h2>G-G Diagram</h2><ResponsiveContainer width="100%" height={360}><ScatterChart><CartesianGrid stroke="#27313a" /><XAxis dataKey="x" stroke="#8896a3" /><YAxis dataKey="y" stroke="#8896a3" /><Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} /><Scatter fill="#e6b450" data={samples.map((sample) => ({ x: numeric(sample, "G Force Lat"), y: numeric(sample, "G Force Long") }))} /></ScatterChart></ResponsiveContainer></section>
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
      <section className="card span-12"><h2>Map Controls</h2><select value={color} onChange={(event) => setColor(event.target.value)}>{["Ground Speed", "Brake Pos", "Throttle Pos", "Delta Best", "Tyre Wear FL", "Brake Temp FL"].map((name) => <option key={name}>{name}</option>)}</select></section>
      <section className="card span-12"><h2>GPS Trace</h2>{samples.length ? <svg className="motec-map" viewBox="0 0 800 420">{samples.map((sample, index) => { const x = ((numeric(sample, "GPS Longitude")! - minLon) / Math.max(maxLon - minLon, 0.000001)) * 760 + 20; const y = 400 - ((numeric(sample, "GPS Latitude")! - minLat) / Math.max(maxLat - minLat, 0.000001)) * 380; const intensity = Math.min(1, Math.max(0, (numeric(sample, color) ?? 0) / 100)); return <circle key={index} cx={x} cy={y} r="2.5" fill={`rgb(${Math.round(230 * intensity)}, ${180}, ${Math.round(80 + 120 * (1 - intensity))})`} />; })}</svg> : <Empty message="GPS Latitude/GPS Longitude are missing or invalid. Time-based analysis still works." />}</section>
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
      <section className="card span-12"><h2>Histogram Channel</h2><select value={channel} onChange={(event) => setChannel(event.target.value)}>{numericChannels.map((item) => <option key={item.originalName}>{item.originalName}</option>)}</select></section>
      <section className="card span-8"><h2>{channel} Histogram</h2><ResponsiveContainer width="100%" height={360}><BarChart data={bins}><CartesianGrid stroke="#27313a" /><XAxis dataKey="bin" stroke="#8896a3" /><YAxis stroke="#8896a3" /><Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} /><Bar dataKey="count" fill="#e6b450" /></BarChart></ResponsiveContainer></section>
      <section className="card span-4"><h2>Stats</h2><AnalysisCards samples={samples} channels={[channel]} /></section>
    </div>
  );
}

function XYWorksheet({ session, lapA, lapB, setLapA, setLapB, x, y, setX, setY, numericChannels }: { session: MotecSession; lapA: string; lapB: string; setLapA: (lap: string) => void; setLapB: (lap: string) => void; x: string; y: string; setX: (channel: string) => void; setY: (channel: string) => void; numericChannels: ChannelDefinition[] }) {
  const samples = useMotecSamples(session, lapA, [x, y], 6000);
  const presets: Array<[string, string, string]> = [["Ground Speed vs Time", "Time", "Ground Speed"], ["Throttle vs Time", "Time", "Throttle Pos"], ["Brake vs Speed", "Ground Speed", "Brake Pos"], ["G-G", "G Force Lat", "G Force Long"], ["RPM vs Speed", "Ground Speed", "Engine RPM"], ["Rake vs Speed", "Ground Speed", "Rake"]];
  return (
    <div className="page grid">
      <LapSelectors session={session} lapA={lapA} lapB={lapB} setLapA={setLapA} setLapB={setLapB} />
      <section className="card span-12"><h2>X-Y Controls</h2><div className="input-grid"><select value={x} onChange={(event) => setX(event.target.value)}>{numericChannels.map((item) => <option key={item.originalName}>{item.originalName}</option>)}</select><select value={y} onChange={(event) => setY(event.target.value)}>{numericChannels.map((item) => <option key={item.originalName}>{item.originalName}</option>)}</select></div><div className="control-row">{presets.map(([label, px, py]) => <button key={label} onClick={() => { setX(px); setY(py); }}>{label}</button>)}</div></section>
      <section className="card span-8"><h2>{y} vs {x}</h2><ResponsiveContainer width="100%" height={380}><ScatterChart><CartesianGrid stroke="#27313a" /><XAxis dataKey="x" stroke="#8896a3" /><YAxis dataKey="y" stroke="#8896a3" /><Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} /><Scatter fill="#e6b450" data={samples.map((sample) => ({ x: numeric(sample, x), y: numeric(sample, y) }))} /></ScatterChart></ResponsiveContainer></section>
      <section className="card span-4"><h2>Stats</h2><AnalysisCards samples={samples} channels={[x, y]} /></section>
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
