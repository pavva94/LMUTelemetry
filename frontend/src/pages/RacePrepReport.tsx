import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { PageSection } from "../components/PageSection";
import { SearchableSessionPicker } from "../components/SearchableSessionPicker";
import { useDuckdbJob } from "../hooks/useDuckdbJob";
import { SectionTitle } from "../components/SectionTitle";
import { PerformanceReportDialog } from "../components/PerformanceReportDialog";
import { useI18n } from "../i18n/I18nProvider";
import { translateLegacyText } from "../i18n/legacyText";
import { buildLapBoundaries } from "../lib/chartLapBoundaries";
import { chartLabelFormatter, chartValueFormatter, formatTelemetryValue, isRaceTimeField } from "../lib/telemetryFields";
import { buildRacePrepReport, type RacePrepReport as RacePrepReportModel, type Wheel } from "../lib/racePrepReport";
import { formatDuration, formatRaceTime } from "../lib/timeFormat";
import type { LmuDuckdbScanResponse, LmuDuckdbSession } from "../types/lmuDuckdb";
import type { SessionReview } from "../types/session";
import type { StrategyState } from "../types/strategy";

type Props = {
  strategy: StrategyState | null;
};

const wheels: Wheel[] = ["fl", "fr", "rl", "rr"];
const wheelLabels: Record<Wheel, string> = { fl: "Front-left", fr: "Front-right", rl: "Rear-left", rr: "Rear-right" };

const fmt = (value?: number | null, digits = 1, suffix = "") =>
  value == null || Number.isNaN(value) || !Number.isFinite(value) ? "--" : `${value.toFixed(digits)}${suffix}`;
const text = (value?: string | number | null) => (value == null || value === "" ? "--" : String(value));
const dateText = (value?: string | null) => value ? new Date(value).toLocaleString() : "--";
const trendText = (value?: string | null) => value ? value.replace(/_/g, " ") : "--";
const chartColors = ["#6dd6ff", "#e6b450", "#91e48f", "#ff8c69", "#c7a8ff", "#ff7da7"];

function Metric({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return <div className="metric compact"><span className="label">{label}</span><span className="value">{value}</span>{sub && <span className="subvalue">{sub}</span>}</div>;
}

function EmptyState({ detail }: { detail: string }) {
  return <div className="empty-state"><strong>No report data</strong><span>{detail}</span></div>;
}

function hasLineData(data: Array<Record<string, unknown>>, lines: string[]) {
  return data.some((row) => lines.some((key) => Number.isFinite(Number(row[key]))));
}

function SessionChart({ data, xKey, lines, height = 260, showLapBoundaries = false }: { data: Array<Record<string, unknown>>; xKey: string; lines: Array<[string, string]>; height?: number; showLapBoundaries?: boolean }) {
  if (!data.length || !hasLineData(data, lines.map(([key]) => key))) return <EmptyState detail="This chart needs channels that are not available in the selected session." />;
  const yTimeAxis = lines.some(([key]) => isRaceTimeField(key));
  const xTimeAxis = isRaceTimeField(xKey);
  const lapBoundaries = showLapBoundaries ? buildLapBoundaries(data, xKey) : [];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <CartesianGrid stroke="#27313a" />
        <XAxis dataKey={xKey} stroke="#8896a3" tickFormatter={(value) => xTimeAxis ? chartLabelFormatter(value, xKey) : String(value)} />
        <YAxis stroke="#8896a3" tickFormatter={(value) => yTimeAxis ? formatTelemetryValue(value, lines[0]?.[0] || "") : String(value)} />
        <Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} labelFormatter={(value) => xTimeAxis ? chartLabelFormatter(value, xKey) : String(value)} formatter={chartValueFormatter} />
        <Legend />
        {lapBoundaries.map((boundary) => (
          <ReferenceLine
            key={`lap-${boundary.lap}-${boundary.x}`}
            x={boundary.x}
            stroke="#65737f"
            strokeDasharray="3 4"
            strokeOpacity={0.8}
            label={boundary.showLabel ? { value: `L${boundary.lap}`, position: "insideTopRight", fill: "#a9b5bf", fontSize: 10 } : undefined}
          />
        ))}
        {lines.map(([key, color]) => <Line key={key} dataKey={key} stroke={color} dot={key.includes("marker") ? { r: 4 } : false} connectNulls />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

function ChannelBadges({ labels }: { labels: string[] }) {
  return labels.length ? <div className="control-row">{labels.map((label) => <span className="badge blue" key={label}>{label}</span>)}</div> : <span className="muted">No channel groups detected.</span>;
}

export function RacePrepReport({ strategy }: Props) {
  const { run: runDuckdbJob, progress: duckdbProgress } = useDuckdbJob();
  const [sessions, setSessions] = useState<LmuDuckdbSession[]>([]);
  const [selected, setSelected] = useState("current");
  const [review, setReview] = useState<SessionReview | null>(null);
  const [status, setStatus] = useState("Loading sessions");
  const [sessionListLoading, setSessionListLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);

  useEffect(() => {
    setSessionListLoading(true);
    runDuckdbJob<LmuDuckdbScanResponse>(() => api.startDuckdbSessionsJob(250))
      .then((payload) => {
        setSessions(payload.sessions);
        setStatus(payload.total ? "Saved sessions loaded" : "No synced sessions");
      })
      .catch((exc) => setStatus(exc instanceof Error ? exc.message : "Could not load saved sessions"))
      .finally(() => setSessionListLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setReportLoading(true);
      const request = selected === "current" ? api.review() : runDuckdbJob<SessionReview>(() => api.startDuckdbReviewJob(selected));
      request
        .then((data) => {
          if (!cancelled) {
            setReview(data);
            setStatus(selected === "current" ? "Current live session report" : "Saved session report");
          }
        })
        .catch((exc) => !cancelled && setStatus(exc instanceof Error ? exc.message : "Could not load report data"))
        .finally(() => {
          if (!cancelled) setReportLoading(false);
        });
    };
    load();
    if (selected !== "current") {
      return () => {
        cancelled = true;
      };
    }
    const id = window.setInterval(load, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [selected]);

  const report = useMemo(() => {
    if (!review) return null;
    return buildRacePrepReport(review, {
      defaultRaceDurationMinutes: Number(strategy?.assumptions?.race_duration_minutes || 120),
    });
  }, [review, strategy]);

  return (
    <div className="page grid">
      <LoadingOverlay show={sessionListLoading || (reportLoading && (selected !== "current" || !review))} title={selected !== "current" && duckdbProgress?.phase ? duckdbProgress.phase : reportLoading ? "Loading session report" : "Loading session list"} detail={selected !== "current" && duckdbProgress?.message ? duckdbProgress.message : selected === "current" ? "Preparing the current live session report." : "Reading the selected saved session and building the report."} percentage={selected !== "current" || sessionListLoading ? duckdbProgress?.percentage : undefined} error={duckdbProgress?.error} />
      <section className="card span-12">
        <SectionTitle title="Session Report" help="Reviews the current live session or a synced saved session with pace, fuel, tyre, environment, and engineering evidence." />
        <div className="section-toolbar report-toolbar">
          <div className="report-session-picker-field">
            <span className="label">Session</span>
            <SearchableSessionPicker
              sessions={sessions}
              selectedId={selected}
              liveValue="current"
              liveLabel="Current live session"
              status={status}
              onSelect={setSelected}
              searchPlaceholder="Search type, track, car, date, file, or laps"
              searchAriaLabel="Search report sessions"
              listAriaLabel="Report sessions"
            />
            <span className="subvalue">{selected === "current" ? "Using the current live session" : "Using a saved session"}</span>
          </div>
          <div className="report-primary-actions"><span className="badge blue">{status}</span><button className="primary" onClick={() => setReportDialogOpen(true)} disabled={selected === "current" || !review?.session} title={selected === "current" ? "Select an imported historical session to generate a PDF" : undefined}>Generate Performance Report</button></div>
        </div>
      </section>

      {reportDialogOpen && selected !== "current" && review?.session && <PerformanceReportDialog session={review.session} onClose={() => setReportDialogOpen(false)} />}

      {!report ? (
        <section className="card span-12"><EmptyState detail="Report appears once a live or synced saved session can be loaded." /></section>
      ) : (
        <>
          <PageSection number="01" title="Overview" description="Session identity, coverage, headline pace, distance, and conditions."><SessionOverview report={report} /></PageSection>
          <PageSection number="02" title="Laps & Sectors" description="Lap progression, consistency, top speed, markers, and detailed lap data."><LapAnalysis report={report} /><LapDetailTable report={report} /><ThrottleBrakeComparison report={report} sessionId={selected === "current" ? review?.session?.id || null : selected} nativeSession={selected === "current"} /></PageSection>
          <PageSection number="03" title="Fuel & Stints" description="Fuel consumption, stint structure, race range, and observed stop requirements."><FuelAnalysis report={report} /></PageSection>
          <PageSection number="04" title="Driver & Vehicle" description="Driver inputs, acceleration loads, powertrain temperatures, speed, and surface contact."><DriverInputs report={report} /><PowertrainAndSurface report={report} /></PageSection>
          <PageSection number="05" title="Tyres" description="Wear, temperature, pressure, balance, and degradation evidence for all four tyres."><TyreWear report={report} /><TyreTempPressure report={report} /></PageSection>
          <PageSection number="06" title="Brakes & Platform" description="Brake temperatures and ride-height behavior across the session."><BrakePlatform report={report} /></PageSection>
          <PageSection number="07" title="Conditions & Events" description="Ambient and track conditions alongside pits and recommendation events."><EnvironmentEvents report={report} /></PageSection>
          <PageSection number="08" title="Engineering Summary" description="Evidence-backed findings and the recommended direction for the next session."><EngineeringSummary report={report} /></PageSection>
        </>
      )}
    </div>
  );
}

function SessionOverview({ report }: { report: RacePrepReportModel }) {
  return (
    <section className="card span-12">
      <SectionTitle title="Session Overview" help="Summarizes the selected telemetry session so the rest of the report has context." />
      <div className="header-grid">
        <Metric label="Track" value={text(report.session.track)} />
        <Metric label="Car" value={text(report.session.car)} />
        <Metric label="Session" value={text(report.session.sessionType)} />
        <Metric label="Date" value={dateText(report.session.dateTime)} />
        <Metric label="Laps completed" value={report.session.totalLaps} sub={`${report.session.validLaps} valid`} />
        <Metric label="Valid lap ratio" value={fmt(report.coverage.validLapRatio != null ? report.coverage.validLapRatio * 100 : null, 0, "%")} />
        <Metric label="Samples" value={report.coverage.sampleCount} />
        <Metric label="Best lap" value={formatRaceTime(report.pace.bestLap)} />
        <Metric label="Average lap" value={formatRaceTime(report.pace.averageLap)} />
        <Metric label="Median lap" value={formatRaceTime(report.pace.medianLap)} />
        <Metric label="Duration" value={formatDuration(report.session.duration)} />
        <Metric label="Distance" value={fmt(report.session.totalDistanceKm, 2, " km")} />
        <Metric label="Top speed" value={fmt(report.session.topSpeed, 0, " km/h")} />
        <Metric label="Pit laps" value={report.session.pitLaps} />
        <Metric label="Track temp" value={fmt(report.session.trackTemp, 1, " C")} />
        <Metric label="Ambient temp" value={fmt(report.session.ambientTemp, 1, " C")} />
      </div>
      <ChannelBadges labels={report.coverage.channelGroups} />
    </section>
  );
}

function LapAnalysis({ report }: { report: RacePrepReportModel }) {
  const five = report.pace.bestFiveContinuous;
  const ten = report.pace.bestTenContinuous;
  return (
    <>
      <section className="card span-5">
        <SectionTitle title="Lap Time Analysis" help="Uses valid completed laps to judge pace, consistency, and trend." />
        <Metric label="Best lap" value={formatRaceTime(report.pace.bestLap)} sub={report.pace.bestLapNumber ? `lap ${report.pace.bestLapNumber}` : undefined} />
        <Metric label="Worst valid lap" value={formatRaceTime(report.pace.worstLap)} />
        <Metric label="Average / median" value={`${formatRaceTime(report.pace.averageLap)} / ${formatRaceTime(report.pace.medianLap)}`} />
        <Metric label="Spread" value={fmt(report.pace.spread, 3, " s")} />
        <Metric label="Std dev" value={fmt(report.pace.standardDeviation, 3, " s")} />
        <Metric label="Trend" value={trendText(report.pace.trend)} sub={`Consistency ${report.pace.consistency}`} />
      </section>
      <section className="card span-7">
        <SectionTitle title="Lap Time And Markers" help="Compares each lap to the best lap and marks invalid or pit laps when the recording exposes them." />
        <SessionChart data={report.charts.laps} xKey="lap" lines={[["lap_time", "#6dd6ff"], ["delta", "#e6b450"], ["invalid_marker", "#ff6961"], ["pit_marker", "#c7a8ff"]]} />
      </section>
      <section className="card span-6">
        <SectionTitle title="Top Speed By Lap" help="Shows straight-line performance over the run. Drops can point to traffic, lift-and-coast, damage, or different deployment." />
        <SessionChart data={report.charts.laps} xKey="lap" lines={[["top_speed", "#91e48f"]]} height={220} />
      </section>
      <section className="card span-6">
        <SectionTitle title="Fuel And Wear Per Lap" help="Shows lap-level fuel use and tyre wear delta together to connect pace, consumption, and degradation." />
        <SessionChart data={report.charts.laps} xKey="lap" lines={[["fuel_used", "#6dd6ff"], ["tyre_wear_delta", "#ff8c69"]]} height={220} />
      </section>
      <section className="card span-12">
        <SectionTitle title="Continuous-Lap Pace" help="Finds the fastest average pace across uninterrupted valid laps. Invalid laps, pit laps, missing lap numbers, and timing outliers break the sequence." />
        <div className="header-grid">
          <Metric label="Best continuous 5" value={formatRaceTime(five?.average)} sub={five ? `Laps ${five.startLap}-${five.endLap}` : "Needs 5 consecutive valid laps"} />
          <Metric label="5-lap range" value={five ? `${formatRaceTime(five.fastestLap)} - ${formatRaceTime(five.slowestLap)}` : "--"} sub="Fastest to slowest lap" />
          <Metric label="Best continuous 10" value={formatRaceTime(ten?.average)} sub={ten ? `Laps ${ten.startLap}-${ten.endLap}` : "Needs 10 consecutive valid laps"} />
          <Metric label="10-lap range" value={ten ? `${formatRaceTime(ten.fastestLap)} - ${formatRaceTime(ten.slowestLap)}` : "--"} sub="Fastest to slowest lap" />
        </div>
      </section>
    </>
  );
}

type TracePayload = {
  session_id: string;
  laps: Array<string | number>;
  points: Array<Record<string, number | string | boolean | null>>;
  warnings: string[];
};

function inputPercent(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.abs(number) <= 1.0001 ? number * 100 : number));
}

function ThrottleBrakeComparison({ report, sessionId, nativeSession }: { report: RacePrepReportModel; sessionId: string | null; nativeSession: boolean }) {
  const lapOptions = useMemo(() => report.charts.laps
    .filter((lap) => Number.isFinite(Number(lap.lap)))
    .sort((a, b) => Number(a.lap) - Number(b.lap)), [report.charts.laps]);
  const fastestPair = useMemo(() => [...lapOptions]
    .filter((lap) => lap.valid_lap === true && Number.isFinite(Number(lap.lap_time)))
    .sort((a, b) => Number(a.lap_time) - Number(b.lap_time))
    .slice(0, 2)
    .map((lap) => String(lap.lap)), [lapOptions]);
  const [lapA, setLapA] = useState("");
  const [lapB, setLapB] = useState("");
  const [payload, setPayload] = useState<TracePayload | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    setLapA(fastestPair[0] || String(lapOptions[0]?.lap || ""));
    setLapB(fastestPair[1] || fastestPair[0] || String(lapOptions[1]?.lap || lapOptions[0]?.lap || ""));
  }, [fastestPair.join("|"), lapOptions.map((lap) => lap.lap).join("|")]);

  useEffect(() => {
    if (!lapA) {
      setPayload(null);
      setStatus("Select a lap to load its input trace.");
      return;
    }
    if (!sessionId) {
      setPayload(null);
      setStatus("The selected session is unavailable.");
      return;
    }
    let active = true;
    setStatus("Loading lap input traces");
    const request = nativeSession
      ? api.sessionLapInputs(sessionId, lapA, lapB, 2400)
      : api.lmuDuckdbTrajectory(sessionId, lapA, lapB, 2400);
    request
      .then((data) => {
        if (!active) return;
        setPayload(data);
        setStatus(data.warnings?.[0] || "");
      })
      .catch((error) => {
        if (!active) return;
        setPayload(null);
        setStatus(error instanceof Error ? error.message : "Could not load lap input traces.");
      });
    return () => { active = false; };
  }, [sessionId, nativeSession, lapA, lapB]);

  const chartData = useMemo(() => {
    const points = (payload?.points || []).filter((point) => [lapA, lapB].includes(String(point.lap_number ?? "")));
    const lapStarts = points.reduce<Record<string, number>>((starts, point) => {
      const lap = String(point.lap_number ?? "");
      const gameTime = Number(point.game_time);
      if (Number.isFinite(gameTime)) starts[lap] = starts[lap] == null ? gameTime : Math.min(starts[lap], gameTime);
      return starts;
    }, {});
    return points.map((point, index) => {
      const lap = String(point.lap_number ?? "");
      const gameTime = Number(point.game_time);
      const progress = Number(point.progress);
      const lapTime = Number(report.charts.laps.find((row) => String(row.lap) === lap)?.lap_time);
      return {
        elapsed: Number.isFinite(gameTime) && lapStarts[lap] != null
          ? Math.max(0, gameTime - lapStarts[lap])
          : Number.isFinite(progress) && Number.isFinite(lapTime)
            ? progress * lapTime
            : index,
        [`throttle_${lap}`]: inputPercent(point.throttle),
        [`brake_${lap}`]: inputPercent(point.brake),
      };
    })
      .sort((a, b) => Number(a.elapsed) - Number(b.elapsed));
  }, [payload, lapA, lapB, report.charts.laps]);
  const colors: Record<string, string> = { [lapA]: "#6dd6ff", [lapB]: "#e6b450" };
  const selectedLaps = Array.from(new Set([lapA, lapB].filter(Boolean)));
  const hasInputs = hasLineData(chartData, selectedLaps.flatMap((lap) => [`throttle_${lap}`, `brake_${lap}`]));

  return (
    <section className="card span-12">
      <div className="section-toolbar">
        <SectionTitle title="Throttle And Brake Over Lap Time" help="Overlays throttle and brake against elapsed time within each lap. The two fastest valid laps load automatically; choose either selector to inspect specific laps." />
        <div className="control-row">
          <label><span className="label">Lap A</span><select value={lapA} onChange={(event) => setLapA(event.target.value)}>{lapOptions.map((lap) => <option key={`a-${String(lap.lap)}`} value={String(lap.lap)}>Lap {String(lap.lap)} · {formatRaceTime(lap.lap_time as number)}</option>)}</select></label>
          <label><span className="label">Lap B</span><select value={lapB} onChange={(event) => setLapB(event.target.value)}>{lapOptions.map((lap) => <option key={`b-${String(lap.lap)}`} value={String(lap.lap)}>Lap {String(lap.lap)} · {formatRaceTime(lap.lap_time as number)}</option>)}</select></label>
        </div>
      </div>
      {hasInputs ? (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid stroke="#27313a" />
            <XAxis dataKey="elapsed" type="number" domain={[0, "dataMax"]} stroke="#8896a3" tickFormatter={(value) => `${Math.round(Number(value))}s`} label={{ value: "Elapsed lap time", position: "insideBottom", offset: -2 }} />
            <YAxis domain={[0, 100]} stroke="#8896a3" tickFormatter={(value) => `${value}%`} />
            <Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} labelFormatter={(value) => `Lap time ${formatRaceTime(Number(value))}`} formatter={(value, name) => [`${Number(value).toFixed(1)}%`, String(name)]} />
            <Legend />
            {selectedLaps.flatMap((lap) => [
              <Line key={`throttle-${lap}`} dataKey={`throttle_${lap}`} name={`Lap ${lap} throttle`} stroke={colors[lap]} strokeWidth={2.2} dot={false} connectNulls isAnimationActive={false} />,
              <Line key={`brake-${lap}`} dataKey={`brake_${lap}`} name={`Lap ${lap} brake`} stroke={colors[lap]} strokeWidth={1.8} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} />,
            ])}
          </LineChart>
        </ResponsiveContainer>
      ) : <EmptyState detail={status || "Throttle and brake samples are not available for the selected laps."} />}
      {status && hasInputs && <p className="muted">{status}</p>}
    </section>
  );
}

function lapNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function wheelReadings(row: Record<string, unknown>, prefix: string, formatter: (value: number | null) => string) {
  return wheels.map((wheel) => formatter(lapNumber(row, `${prefix}_${wheel}`))).join(" / ");
}

function LapDetailTable({ report }: { report: RacePrepReportModel }) {
  const rows = report.charts.laps;
  return (
    <section className="card span-12">
      <SectionTitle title="Lap And Sector Detail" help="Lists every detected lap with timing, fuel, tyre condition, temperatures, pressures, track conditions, and speed. Per-wheel readings are ordered FL / FR / RL / RR." />
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Lap</th><th>Status</th><th>Lap time</th><th>Delta</th><th>S1</th><th>S2</th><th>S3</th><th>Fuel used</th><th>Fuel start / end</th><th>Compound</th><th>Tyre wear used FL / FR / RL / RR</th><th>Tyre temp FL / FR / RL / RR</th><th>Pressure FL / FR / RL / RR</th><th>Track / ambient</th><th>Top speed</th></tr>
            </thead>
            <tbody>{rows.map((row, index) => (
              <tr key={`${String(row.lap)}-${index}`}>
                <td>{text(row.lap as number)}</td>
                <td>{row.in_pit === true ? "Pit" : row.valid_lap === true ? "Valid" : "Excluded"}</td>
                <td>{formatRaceTime(row.lap_time as number)}</td>
                <td>{fmt(row.delta as number, 3, " s")}</td>
                <td>{formatRaceTime(row.sector1 as number)}</td>
                <td>{formatRaceTime(row.sector2 as number)}</td>
                <td>{formatRaceTime(row.sector3 as number)}</td>
                <td>{fmt(row.fuel_used as number, 3, " L")}</td>
                <td>{fmt(row.fuel_start as number, 2, " L")} / {fmt(row.fuel_end as number, 2, " L")}</td>
                <td>{text(row.tyre_compound as string)}</td>
                <td>{wheelReadings(row, "tyre_wear", (value) => fmt(value == null ? null : value * 100, 2, "%"))}</td>
                <td>{wheelReadings(row, "tyre_temp", (value) => fmt(value, 1, " C"))}</td>
                <td>{wheelReadings(row, "tyre_pressure", (value) => fmt(value, 1, " kPa"))}</td>
                <td>{fmt(row.track_temp as number, 1, " C")} / {fmt(row.ambient_temp as number, 1, " C")}</td>
                <td>{fmt(row.top_speed as number, 0, " km/h")}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <EmptyState detail="Lap details appear once completed laps are available in the selected session." />}
    </section>
  );
}

function FuelAnalysis({ report }: { report: RacePrepReportModel }) {
  return (
    <>
    <section className="card span-12">
      <SectionTitle title="Fuel And Stints" help="Shows observed fuel behavior first, then race estimate context from valid session laps and tank capacity." />
      <div className="header-grid">
        <Metric label="Start fuel" value={fmt(report.fuel.startFuel, 2, " L")} />
        <Metric label="End fuel" value={fmt(report.fuel.endFuel, 2, " L")} />
        <Metric label="Total used" value={fmt(report.fuel.totalUsed, 2, " L")} />
        <Metric label="Fuel per lap" value={fmt(report.fuel.averagePerLap, 3, " L")} sub={`${fmt(report.fuel.minPerLap, 3)} min / ${fmt(report.fuel.maxPerLap, 3)} max`} />
        <Metric label="Consumption trend" value={trendText(report.fuel.trend)} />
        <Metric label="Full tank" value={fmt(report.fuel.tankCapacity, 1, " L")} sub={report.fuel.tankCapacitySource} />
        <Metric label="Stint estimate" value={fmt(report.fuel.fullTankLaps, 1, " laps")} />
        <Metric label="Race target" value={fmt(report.fuel.raceLaps, 1, " laps")} sub={report.fuel.raceDistanceSource} />
        <Metric label="Race fuel needed" value={fmt(report.fuel.estimatedRaceFuel, 2, " L")} />
        <Metric label={report.fuel.margin != null && report.fuel.margin < 0 ? "Fuel shortage" : "Fuel margin"} value={fmt(report.fuel.margin == null ? null : Math.abs(report.fuel.margin), 2, " L")} />
      </div>
    </section>
    <section className="card span-6">
      <SectionTitle title="Fuel Level Over Time" help="Shows live fuel level from raw samples when available." />
      <SessionChart data={report.charts.samples} xKey="game_time" lines={[["fuel_liters", "#6dd6ff"]]} showLapBoundaries />
    </section>
    <section className="card span-6">
      <SectionTitle title="Fuel Used Per Lap" help="Shows observed lap consumption. Large variation should be explained before setting a race fuel target." />
      <SessionChart data={report.charts.laps} xKey="lap" lines={[["fuel_used", "#e6b450"]]} />
    </section>
    <section className="card span-12">
      <SectionTitle title="Stint Comparison" help="Groups laps between pit laps and compares pace, fuel use, tyre wear, and top speed." />
      <SessionChart data={report.charts.stints} xKey="stint" lines={[["average_lap", "#6dd6ff"], ["fuel_per_lap", "#e6b450"], ["tyre_wear_delta", "#ff8c69"], ["top_speed", "#91e48f"]]} height={240} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Stint</th><th>Lap range</th><th>Laps</th><th>Average lap</th><th>Best lap</th><th>Fuel/lap</th><th>Tyre wear delta</th><th>Top speed</th></tr></thead>
          <tbody>{report.charts.stints.map((stint) => (
            <tr key={String(stint.stint)}><td>{text(stint.stint as number)}</td><td>{text(stint.start_lap as number)}-{text(stint.end_lap as number)}</td><td>{text(stint.lap_count as number)}</td><td>{formatRaceTime(stint.average_lap as number)}</td><td>{formatRaceTime(stint.best_lap as number)}</td><td>{fmt(stint.fuel_per_lap as number, 3, " L")}</td><td>{fmt(stint.tyre_wear_delta as number, 4)}</td><td>{fmt(stint.top_speed as number, 0, " km/h")}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </section>
    <PitStopReport report={report} />
    </>
  );
}

function DriverInputs({ report }: { report: RacePrepReportModel }) {
  return (
    <>
      <section className="card span-6">
        <SectionTitle title="Driver Inputs" help="Shows throttle, brake, and steering over time. This is the first place to look for consistency, coasting, and over-driving." />
        <SessionChart data={report.charts.samples} xKey="game_time" lines={[["throttle", "#69d28f"], ["brake", "#ff6961"], ["steering", "#c7a8ff"]]} showLapBoundaries />
      </section>
      <section className="card span-6">
        <SectionTitle title="Speed And RPM" help="Shows powertrain and speed behavior over the session." />
        <SessionChart data={report.charts.samples} xKey="game_time" lines={[["speed_kph", "#6dd6ff"], ["rpm", "#e6b450"]]} showLapBoundaries />
      </section>
      <section className="card span-12">
        <SectionTitle title="G-Force" help="Shows lateral and longitudinal acceleration if the selected recording includes those channels." />
        <SessionChart data={report.charts.samples} xKey="game_time" lines={[["g_force_lat", "#6dd6ff"], ["g_force_long", "#ff8c69"], ["g_force_vert", "#91e48f"]]} height={220} showLapBoundaries />
      </section>
    </>
  );
}

function PowertrainAndSurface({ report }: { report: RacePrepReportModel }) {
  const data = report.charts.samples.length ? report.charts.samples : report.charts.laps;
  const xKey = report.charts.samples.length ? "game_time" : "lap";
  return (
    <>
      <section className="card span-6">
        <SectionTitle title="Radiator Temperatures" help="Shows engine oil and water temperatures when the selected live or saved session exposes them." />
        <SessionChart data={data} xKey={xKey} lines={[["engine_oil_temp", "#e6b450"], ["engine_water_temp", "#6dd6ff"]]} height={220} showLapBoundaries={xKey === "game_time"} />
        <div className="header-grid">
          <Metric label="Oil avg / max" value={`${fmt(report.powertrain.oilTemp.average, 1, " C")} / ${fmt(report.powertrain.oilTemp.max, 1, " C")}`} />
          <Metric label="Water avg / max" value={`${fmt(report.powertrain.waterTemp.average, 1, " C")} / ${fmt(report.powertrain.waterTemp.max, 1, " C")}`} />
        </div>
      </section>
      <section className="card span-6">
        <SectionTitle title="Grass Contact" help="Counts wheel samples reported on grass. Only shown when the recording includes wheel surface-type channels." />
        {report.coverage.channelGroups.includes("Surface") ? (
          <div className="header-grid">
            {wheels.map((wheel) => <Metric key={wheel} label={`${wheelLabels[wheel]} grass`} value={report.surface.grassSamples[wheel]} />)}
            <Metric label="Total grass samples" value={report.surface.totalGrassSamples} />
          </div>
        ) : <EmptyState detail="This session does not include wheel surface-type channels." />}
      </section>
    </>
  );
}

function TyreWear({ report }: { report: RacePrepReportModel }) {
  return (
    <section className="card span-12">
      <SectionTitle title="Tyre Wear Summary" help="Compares wear by tyre and highlights axle or side bias without giving setup advice yet." />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Tyre</th><th>Start</th><th>End</th><th>Delta</th><th>Per valid lap</th></tr></thead>
          <tbody>
            {wheels.map((wheel) => (
              <tr key={wheel}><td>{wheelLabels[wheel]}</td><td>{fmt(report.tyres.wear[wheel].start, 3)}</td><td>{fmt(report.tyres.wear[wheel].end, 3)}</td><td>{fmt(report.tyres.wear[wheel].delta, 3)}</td><td>{fmt(report.tyres.wear[wheel].perLap, 4)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <SessionChart data={report.charts.samples.length ? report.charts.samples : report.charts.laps} xKey={report.charts.samples.length ? "game_time" : "lap"} lines={wheels.map((wheel, index) => [`tyre_wear_${wheel}`, chartColors[index]]) as Array<[string, string]>} height={240} showLapBoundaries={report.charts.samples.length > 0} />
      <div className="header-grid">
        <Metric label="Most worn" value={report.tyres.mostWorn ? wheelLabels[report.tyres.mostWorn] : "--"} />
        <Metric label="Rear-front balance" value={fmt(report.tyres.frontRearBalance, 4)} />
        <Metric label="Right-left balance" value={fmt(report.tyres.leftRightBalance, 4)} />
        <Metric label="Pattern" value={report.tyres.wearMessage} />
      </div>
    </section>
  );
}

function TyreTempPressure({ report }: { report: RacePrepReportModel }) {
  return (
    <>
      <section className="card span-12">
        <SectionTitle title="Tyre Temperature And Pressure Summary" help="Summarizes tyre heat and pressure behavior by tyre. MVP compares tyres against each other." />
        <div className="table-wrap">
          <table>
            <thead><tr><th>Tyre</th><th>Avg temp</th><th>Min temp</th><th>Max temp</th><th>Temp trend</th><th>Avg pressure</th><th>Min pressure</th><th>Max pressure</th><th>Pressure trend</th></tr></thead>
            <tbody>
              {wheels.map((wheel) => (
                <tr key={wheel}>
                  <td>{wheelLabels[wheel]}</td>
                  <td>{fmt(report.tyres.temperature[wheel].average, 1, " C")}</td>
                  <td>{fmt(report.tyres.temperature[wheel].min, 1, " C")}</td>
                  <td>{fmt(report.tyres.temperature[wheel].max, 1, " C")}</td>
                  <td>{trendText(report.tyres.temperature[wheel].trend)}</td>
                  <td>{fmt(report.tyres.pressure[wheel].average, 1)}</td>
                  <td>{fmt(report.tyres.pressure[wheel].min, 1)}</td>
                  <td>{fmt(report.tyres.pressure[wheel].max, 1)}</td>
                  <td>{trendText(report.tyres.pressure[wheel].trend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="header-grid">
          <Metric label="Hottest tyre" value={report.tyres.hottestTyre ? wheelLabels[report.tyres.hottestTyre] : "--"} />
          <Metric label="Coldest tyre" value={report.tyres.coldestTyre ? wheelLabels[report.tyres.coldestTyre] : "--"} />
          <Metric label="Highest pressure" value={report.tyres.highestPressureTyre ? wheelLabels[report.tyres.highestPressureTyre] : "--"} />
          <Metric label="Lowest pressure" value={report.tyres.lowestPressureTyre ? wheelLabels[report.tyres.lowestPressureTyre] : "--"} />
        </div>
      </section>
      <section className="card span-6">
        <SectionTitle title="Tyre Temperatures" help="Shows tyre temperature trend by wheel." />
        <SessionChart data={report.charts.samples.length ? report.charts.samples : report.charts.laps} xKey={report.charts.samples.length ? "game_time" : "lap"} lines={wheels.map((wheel, index) => [`tyre_temp_${wheel}`, chartColors[index]]) as Array<[string, string]>} height={220} showLapBoundaries={report.charts.samples.length > 0} />
      </section>
      <section className="card span-6">
        <SectionTitle title="Tyre Pressures" help="Shows tyre pressure trend by wheel." />
        <SessionChart data={report.charts.samples.length ? report.charts.samples : report.charts.laps} xKey={report.charts.samples.length ? "game_time" : "lap"} lines={wheels.map((wheel, index) => [`tyre_pressure_${wheel}`, chartColors[index]]) as Array<[string, string]>} height={220} showLapBoundaries={report.charts.samples.length > 0} />
      </section>
    </>
  );
}

function BrakePlatform({ report }: { report: RacePrepReportModel }) {
  return (
    <>
      <section className="card span-6">
        <SectionTitle title="Brake Temperatures" help="Shows brake temperature by wheel. Persistent corner spread can indicate bias, cooling, lockups, or track loading." />
        <SessionChart data={report.charts.samples.length ? report.charts.samples : report.charts.laps} xKey={report.charts.samples.length ? "game_time" : "lap"} lines={wheels.map((wheel, index) => [`brake_temp_${wheel}`, chartColors[index]]) as Array<[string, string]>} showLapBoundaries={report.charts.samples.length > 0} />
      </section>
      <section className="card span-6">
        <SectionTitle title="Ride Height And Platform" help="Shows ride height by wheel plus front/rear platform channels when available." />
        <SessionChart data={report.charts.samples.length ? report.charts.samples : report.charts.laps} xKey={report.charts.samples.length ? "game_time" : "lap"} lines={[...wheels.map((wheel, index) => [`ride_height_${wheel}`, chartColors[index]] as [string, string]), ["front_ride_height", "#ff7da7"], ["rear_ride_height", "#ffffff"]]} showLapBoundaries={report.charts.samples.length > 0} />
      </section>
    </>
  );
}

function EnvironmentEvents({ report }: { report: RacePrepReportModel }) {
  return (
    <>
      <section className="card span-6">
        <SectionTitle title="Environment Trend" help="Shows track and ambient conditions over time when available." />
        <SessionChart data={report.charts.samples.length ? report.charts.samples : report.charts.laps} xKey={report.charts.samples.length ? "game_time" : "lap"} lines={[["track_temp", "#ff8c69"], ["ambient_temp", "#6dd6ff"]]} showLapBoundaries={report.charts.samples.length > 0} />
      </section>
      <section className="card span-6">
        <SectionTitle title="Events Timeline" help="Lists pit and recommendation events in session order." />
        {report.charts.events.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Time/lap</th><th>Type</th><th>Message</th></tr></thead>
              <tbody>{report.charts.events.map((event) => (
                <tr key={String(event.event_index)}><td>{event.timestamp != null ? formatRaceTime(event.timestamp as number) : text(event.lap as number)}</td><td>{text(event.type as string)}</td><td>{text(event.message as string)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState detail="No pit or recommendation events are stored for this session." />}
      </section>
    </>
  );
}

function EngineeringSummary({ report }: { report: RacePrepReportModel }) {
  const { language } = useI18n();
  const tr = (value: string) => translateLegacyText(value, language);
  return (
    <section className="card span-12">
      <SectionTitle title="Engineering Summary" help="Turns the session evidence into next-session strategy and setup recommendations." />
      <div className="insight-list engineering-finding-list">
        {report.engineeringFindings.map((finding) => (
          <p key={finding.title}>
            <span className={`badge ${finding.severity === "critical" ? "red" : finding.severity === "warning" ? "amber" : "blue"}`}>{tr(finding.severity)}</span>
            <strong>{tr(finding.title)}:</strong> {tr(finding.evidence)}. {tr(finding.detail)}
          </p>
        ))}
      </div>
      <div className="header-grid">
        <Metric label="Representative pace" value={`${formatRaceTime(report.execution.paceTargetLow)} - ${formatRaceTime(report.execution.paceTargetHigh)}`} />
        <Metric label="Fuel stops" value={report.execution.fuelStops ?? "--"} sub={report.execution.totalStints != null ? tr(`${report.execution.totalStints} stints`) : undefined} />
        <Metric label="Model stint length" value={fmt(report.execution.averageRaceStintLaps, 1, " laps")} />
        <Metric label="Estimated stint length" value={fmt(report.execution.stintLength, 1, " laps")} />
        <Metric label="Save to remove a stop" value={fmt(report.execution.fuelSavingRequiredPercent, 1, "%")} />
        <Metric label="Tyre sets needed" value={report.execution.tyreSetsNeeded ?? "--"} sub={report.execution.tyreSetsShortage ? tr(`${report.execution.tyreSetsShortage} set shortage`) : tr("within budget")} />
        <Metric label="Tyre warning" value={report.execution.tyreWarning ? tr(report.execution.tyreWarning) : "--"} />
      </div>
      <p className="muted"><strong>Next-session recommendation:</strong> {tr(report.execution.finalRecommendation)}</p>
    </section>
  );
}

function PitStopReport({ report }: { report: RacePrepReportModel }) {
  const hasPitTime = report.charts.pitStops.some((stop) => Number.isFinite(Number(stop.pit_time)));
  return (
    <section className="card span-12 pit-stop-report">
      <SectionTitle title="Pit Stop Report" help="Reports detected stops, including pit entry-to-exit time when available, and infers fuel added and tyre changes from telemetry." />
      {report.charts.pitStops.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Stop</th><th>Lap/time</th>{hasPitTime && <th>Pit time</th>}<th>Event</th><th>Fuel before</th><th>Fuel after</th><th>Fuel added</th><th>Tyres changed</th><th>Wear before</th><th>Wear after</th></tr></thead>
            <tbody>
              {report.charts.pitStops.map((stop) => (
                <tr key={String(stop.stop)}>
                  <td>{text(stop.stop as number)}</td>
                  <td>{stop.timestamp != null ? formatRaceTime(stop.timestamp as number) : `Lap ${text(stop.lap as number)}`}</td>
                  {hasPitTime && <td>{fmt(stop.pit_time as number, 3, " s")}</td>}
                  <td>{text((stop.message || stop.type) as string)}</td>
                  <td>{fmt(stop.fuel_before as number, 2, " L")}</td>
                  <td>{fmt(stop.fuel_after as number, 2, " L")}</td>
                  <td>{fmt(stop.fuel_added as number, 2, " L")}</td>
                  <td>{text(stop.tyres_changed as string)}</td>
                  <td>{fmt(stop.tyre_wear_before as number, 3)}</td>
                  <td>{fmt(stop.tyre_wear_after as number, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted"><strong>No pit stop detected in this session.</strong> The report did not find pit events, pit laps, or fuel-added laps, so no stop-by-stop fuel or tyre-change audit is available.</p>
      )}
    </section>
  );
}
