import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { useDuckdbJob } from "../hooks/useDuckdbJob";
import { SectionTitle } from "../components/SectionTitle";
import { duckdbSessionLabel, filterDuckdbSessions } from "../lib/lmuDuckdbSession";
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

function SessionChart({ data, xKey, lines, height = 260 }: { data: Array<Record<string, unknown>>; xKey: string; lines: Array<[string, string]>; height?: number }) {
  if (!data.length || !hasLineData(data, lines.map(([key]) => key))) return <EmptyState detail="This chart needs channels that are not available in the selected session." />;
  const yTimeAxis = lines.some(([key]) => isRaceTimeField(key));
  const xTimeAxis = isRaceTimeField(xKey);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <CartesianGrid stroke="#27313a" />
        <XAxis dataKey={xKey} stroke="#8896a3" tickFormatter={(value) => xTimeAxis ? chartLabelFormatter(value, xKey) : String(value)} />
        <YAxis stroke="#8896a3" tickFormatter={(value) => yTimeAxis ? formatTelemetryValue(value, lines[0]?.[0] || "") : String(value)} />
        <Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} labelFormatter={(value) => xTimeAxis ? chartLabelFormatter(value, xKey) : String(value)} formatter={chartValueFormatter} />
        <Legend />
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
  const [sessionSearch, setSessionSearch] = useState("");
  const [review, setReview] = useState<SessionReview | null>(null);
  const [status, setStatus] = useState("Loading sessions");
  const [sessionListLoading, setSessionListLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);

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
  const visibleSessions = useMemo(() => filterDuckdbSessions(sessions, sessionSearch, selected === "current" ? undefined : selected), [sessionSearch, selected, sessions]);

  return (
    <div className="page grid">
      <LoadingOverlay show={sessionListLoading || (reportLoading && (selected !== "current" || !review))} title={selected !== "current" && duckdbProgress?.phase ? duckdbProgress.phase : reportLoading ? "Loading session report" : "Loading session list"} detail={selected !== "current" && duckdbProgress?.message ? duckdbProgress.message : selected === "current" ? "Preparing the current live session report." : "Reading the selected saved session and building the report."} percentage={selected !== "current" || sessionListLoading ? duckdbProgress?.percentage : undefined} error={duckdbProgress?.error} />
      <section className="card span-12">
        <SectionTitle title="Session Report" help="Reviews the current live session or a synced saved session with pace, fuel, tyre, environment, and engineering evidence." />
        <div className="section-toolbar report-toolbar">
          <label>
            <span className="label">Session</span>
            <input value={sessionSearch} onChange={(event) => setSessionSearch(event.target.value)} placeholder="Search live, type, track, car, file, laps" />
            <select value={selected} onChange={(event) => setSelected(event.target.value)}>
            <option value="current">Current live session</option>
            {visibleSessions.map((session) => (
              <option key={session.id} value={session.id}>
                {duckdbSessionLabel(session)}
              </option>
            ))}
          </select>
          <span className="subvalue">{sessionSearch.trim() ? `${visibleSessions.length}/${sessions.length} matches` : "Live/current remains available"}</span>
          </label>
          <span className="badge blue">{status}</span>
        </div>
      </section>

      {!report ? (
        <section className="card span-12"><EmptyState detail="Report appears once a live or synced saved session can be loaded." /></section>
      ) : (
        <>
          <SessionOverview report={report} />
          <LapAnalysis report={report} />
          <FuelAnalysis report={report} />
          <DriverInputs report={report} />
          <PowertrainAndSurface report={report} />
          <TyreWear report={report} />
          <TyreTempPressure report={report} />
          <BrakePlatform report={report} />
          <EnvironmentEvents report={report} />
          <BestAndSector report={report} />
          <EngineeringSummary report={report} />
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
    </>
  );
}

function BestAndSector({ report }: { report: RacePrepReportModel }) {
  return (
    <>
      <section className="card span-6">
        <SectionTitle title="Best Lap And Theoretical Best" help="Shows whether the best sectors were assembled into one lap when sector data is available." />
        <Metric label="Best lap" value={formatRaceTime(report.sectors.bestLap)} sub={report.sectors.bestLapNumber ? `lap ${report.sectors.bestLapNumber}` : undefined} />
        <Metric label="Theoretical best" value={formatRaceTime(report.sectors.theoreticalBest)} />
        <Metric label="Potential improvement" value={fmt(report.sectors.potential, 3, " s")} />
        {!report.sectors.available && <p className="muted">{report.sectors.message}</p>}
      </section>
      <section className="card span-6">
        <SectionTitle title="Sector Analysis" help="Identifies the largest sector-level loss when sector splits are available in the stored session." />
        <Metric label="Sector 1 best" value={formatRaceTime(report.sectors.bestSectors.sector1)} />
        <Metric label="Sector 2 best" value={formatRaceTime(report.sectors.bestSectors.sector2)} />
        <Metric label="Sector 3 best" value={formatRaceTime(report.sectors.bestSectors.sector3)} />
        {!report.sectors.available && <p className="muted">Sector split channels are not stored for this session yet, so sector analysis cannot be calculated from this recording.</p>}
      </section>
    </>
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
      <SessionChart data={report.charts.samples} xKey="game_time" lines={[["fuel_liters", "#6dd6ff"]]} />
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
    </>
  );
}

function DriverInputs({ report }: { report: RacePrepReportModel }) {
  return (
    <>
      <section className="card span-6">
        <SectionTitle title="Driver Inputs" help="Shows throttle, brake, and steering over time. This is the first place to look for consistency, coasting, and over-driving." />
        <SessionChart data={report.charts.samples} xKey="game_time" lines={[["throttle", "#69d28f"], ["brake", "#ff6961"], ["steering", "#c7a8ff"]]} />
      </section>
      <section className="card span-6">
        <SectionTitle title="Speed And RPM" help="Shows powertrain and speed behavior over the session." />
        <SessionChart data={report.charts.samples} xKey="game_time" lines={[["speed_kph", "#6dd6ff"], ["rpm", "#e6b450"]]} />
      </section>
      <section className="card span-12">
        <SectionTitle title="G-Force" help="Shows lateral and longitudinal acceleration if the selected recording includes those channels." />
        <SessionChart data={report.charts.samples} xKey="game_time" lines={[["g_force_lat", "#6dd6ff"], ["g_force_long", "#ff8c69"], ["g_force_vert", "#91e48f"]]} height={220} />
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
        <SessionChart data={data} xKey={xKey} lines={[["engine_oil_temp", "#e6b450"], ["engine_water_temp", "#6dd6ff"]]} height={220} />
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
      <SessionChart data={report.charts.samples.length ? report.charts.samples : report.charts.laps} xKey={report.charts.samples.length ? "game_time" : "lap"} lines={wheels.map((wheel, index) => [`tyre_wear_${wheel}`, chartColors[index]]) as Array<[string, string]>} height={240} />
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
        <SessionChart data={report.charts.samples.length ? report.charts.samples : report.charts.laps} xKey={report.charts.samples.length ? "game_time" : "lap"} lines={wheels.map((wheel, index) => [`tyre_temp_${wheel}`, chartColors[index]]) as Array<[string, string]>} height={220} />
      </section>
      <section className="card span-6">
        <SectionTitle title="Tyre Pressures" help="Shows tyre pressure trend by wheel." />
        <SessionChart data={report.charts.samples.length ? report.charts.samples : report.charts.laps} xKey={report.charts.samples.length ? "game_time" : "lap"} lines={wheels.map((wheel, index) => [`tyre_pressure_${wheel}`, chartColors[index]]) as Array<[string, string]>} height={220} />
      </section>
    </>
  );
}

function BrakePlatform({ report }: { report: RacePrepReportModel }) {
  return (
    <>
      <section className="card span-6">
        <SectionTitle title="Brake Temperatures" help="Shows brake temperature by wheel. Persistent corner spread can indicate bias, cooling, lockups, or track loading." />
        <SessionChart data={report.charts.samples.length ? report.charts.samples : report.charts.laps} xKey={report.charts.samples.length ? "game_time" : "lap"} lines={wheels.map((wheel, index) => [`brake_temp_${wheel}`, chartColors[index]]) as Array<[string, string]>} />
      </section>
      <section className="card span-6">
        <SectionTitle title="Ride Height And Platform" help="Shows ride height by wheel plus front/rear platform channels when available." />
        <SessionChart data={report.charts.samples.length ? report.charts.samples : report.charts.laps} xKey={report.charts.samples.length ? "game_time" : "lap"} lines={[...wheels.map((wheel, index) => [`ride_height_${wheel}`, chartColors[index]] as [string, string]), ["front_ride_height", "#ff7da7"], ["rear_ride_height", "#ffffff"]]} />
      </section>
    </>
  );
}

function EnvironmentEvents({ report }: { report: RacePrepReportModel }) {
  return (
    <>
      <section className="card span-6">
        <SectionTitle title="Environment Trend" help="Shows track and ambient conditions over time when available." />
        <SessionChart data={report.charts.samples.length ? report.charts.samples : report.charts.laps} xKey={report.charts.samples.length ? "game_time" : "lap"} lines={[["track_temp", "#ff8c69"], ["ambient_temp", "#6dd6ff"]]} />
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
  return (
    <section className="card span-12">
      <SectionTitle title="Engineering Summary" help="Turns the session evidence into next-session strategy and setup recommendations." />
      <div className="insight-list engineering-finding-list">
        {report.engineeringFindings.map((finding) => (
          <p key={finding.title}>
            <span className={`badge ${finding.severity === "critical" ? "red" : finding.severity === "warning" ? "amber" : "blue"}`}>{finding.severity}</span>
            <strong>{finding.title}:</strong> {finding.evidence}. {finding.detail}
          </p>
        ))}
      </div>
      <div className="header-grid">
        <Metric label="Representative pace" value={`${formatRaceTime(report.execution.paceTargetLow)} - ${formatRaceTime(report.execution.paceTargetHigh)}`} />
        <Metric label="Fuel stops" value={report.execution.fuelStops ?? "--"} sub={report.execution.totalStints != null ? `${report.execution.totalStints} stints` : undefined} />
        <Metric label="Model stint length" value={fmt(report.execution.averageRaceStintLaps, 1, " laps")} />
        <Metric label="Estimated stint length" value={fmt(report.execution.stintLength, 1, " laps")} />
        <Metric label="Save to remove a stop" value={fmt(report.execution.fuelSavingRequiredPercent, 1, "%")} />
        <Metric label="Tyre sets needed" value={report.execution.tyreSetsNeeded ?? "--"} sub={report.execution.tyreSetsShortage ? `${report.execution.tyreSetsShortage} set shortage` : "within budget"} />
        <Metric label="Tyre warning" value={report.execution.tyreWarning || "--"} />
      </div>
      <PitStopReport report={report} />
      <p className="muted"><strong>Next-session recommendation:</strong> {report.execution.finalRecommendation}</p>
    </section>
  );
}

function PitStopReport({ report }: { report: RacePrepReportModel }) {
  return (
    <div className="pit-stop-report">
      <SectionTitle title="Pit Stop Report" help="Reports the stops detected in the session and infers fuel added and tyre changes from the telemetry around each stop." />
      {report.charts.pitStops.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Stop</th><th>Lap/time</th><th>Event</th><th>Fuel before</th><th>Fuel after</th><th>Fuel added</th><th>Tyres changed</th><th>Wear before</th><th>Wear after</th></tr></thead>
            <tbody>
              {report.charts.pitStops.map((stop) => (
                <tr key={String(stop.stop)}>
                  <td>{text(stop.stop as number)}</td>
                  <td>{stop.timestamp != null ? formatRaceTime(stop.timestamp as number) : `Lap ${text(stop.lap as number)}`}</td>
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
    </div>
  );
}
