import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";
import { SectionTitle } from "../components/SectionTitle";
import { chartValueFormatter } from "../lib/telemetryFields";
import { buildRacePrepReport, type RacePrepReport as RacePrepReportModel, type Wheel } from "../lib/racePrepReport";
import { formatRaceTime } from "../lib/timeFormat";
import type { SavedSession, SessionReview } from "../types/session";
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

function Metric({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return <div className="metric compact"><span className="label">{label}</span><span className="value">{value}</span>{sub && <span className="subvalue">{sub}</span>}</div>;
}

function EmptyState({ detail }: { detail: string }) {
  return <div className="empty-state"><strong>No report data</strong><span>{detail}</span></div>;
}

function ReportChart({ report }: { report: RacePrepReportModel }) {
  const data = report.pace.deltas.map((lap) => ({ lap: lap.lap ?? "--", lap_time: lap.lapTime, delta: lap.delta }));
  if (!data.length) return <EmptyState detail="Complete a few valid laps to build the lap-time trend." />;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data}>
        <CartesianGrid stroke="#27313a" />
        <XAxis dataKey="lap" stroke="#8896a3" />
        <YAxis stroke="#8896a3" />
        <Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} formatter={chartValueFormatter} />
        <Line dataKey="lap_time" stroke="#6dd6ff" dot={false} />
        <Line dataKey="delta" stroke="#e6b450" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function RacePrepReport({ strategy }: Props) {
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [selected, setSelected] = useState("current");
  const [review, setReview] = useState<SessionReview | null>(null);
  const [status, setStatus] = useState("Loading sessions");
  const [raceLaps, setRaceLaps] = useState("");
  const [raceMinutes, setRaceMinutes] = useState(String(Number(strategy?.assumptions?.race_duration_minutes || 120)));
  const [tankOverride, setTankOverride] = useState("");
  const [tyresAvailable, setTyresAvailable] = useState("16");

  useEffect(() => {
    api.sessions()
      .then((rows) => {
        setSessions(rows);
        setStatus("Sessions loaded");
      })
      .catch((exc) => setStatus(exc instanceof Error ? exc.message : "Could not load saved sessions"));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const request = selected === "current" ? api.review() : api.reviewSession(selected);
      request
        .then((data) => {
          if (!cancelled) {
            setReview(data);
            setStatus(selected === "current" ? "Current live session report" : "Saved session report");
          }
        })
        .catch((exc) => !cancelled && setStatus(exc instanceof Error ? exc.message : "Could not load report data"));
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

  useEffect(() => {
    setRaceMinutes((current) => current || String(Number(strategy?.assumptions?.race_duration_minutes || 120)));
  }, [strategy]);

  const report = useMemo(() => {
    if (!review) return null;
    return buildRacePrepReport(review, {
      raceLaps: Number(raceLaps) > 0 ? Number(raceLaps) : null,
      raceDurationMinutes: Number(raceMinutes) > 0 ? Number(raceMinutes) : null,
      tankCapacityOverride: Number(tankOverride) > 0 ? Number(tankOverride) : null,
      defaultRaceDurationMinutes: Number(strategy?.assumptions?.race_duration_minutes || 120),
      tyresAvailable: Number(tyresAvailable) > 0 ? Number(tyresAvailable) : 16,
    });
  }, [review, raceLaps, raceMinutes, tankOverride, tyresAvailable, strategy]);

  return (
    <div className="page grid">
      <section className="card span-12">
        <SectionTitle title="Race Preparation Report" help="Turns live session telemetry into a race-prep summary. Select the current practice run for live updates or a completed saved session for review." />
        <div className="input-grid">
          <select value={selected} onChange={(event) => setSelected(event.target.value)}>
            <option value="current">Current live session</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.session_type || "Session"} - {session.track_name || "Unknown track"} - {session.vehicle_name || "Unknown car"} - {session.created_at || session.id}
              </option>
            ))}
          </select>
          <input value={status} readOnly />
          <label><span className="label">Race laps</span><input type="number" min="0" step="1" placeholder="Auto/manual" value={raceLaps} onChange={(event) => setRaceLaps(event.target.value)} /></label>
          <label><span className="label">Race duration minutes</span><input type="number" min="0" step="1" value={raceMinutes} onChange={(event) => setRaceMinutes(event.target.value)} /></label>
          <label><span className="label">Tank override liters</span><input type="number" min="0" step="0.1" placeholder="Only if API missing" value={tankOverride} onChange={(event) => setTankOverride(event.target.value)} /></label>
          <label><span className="label">Tyres available</span><input type="number" min="4" step="1" value={tyresAvailable} onChange={(event) => setTyresAvailable(event.target.value)} /></label>
        </div>
      </section>

      {!report ? (
        <section className="card span-12"><EmptyState detail="Report appears once a live or saved session can be loaded." /></section>
      ) : (
        <>
          <SessionOverview report={report} />
          <LapAnalysis report={report} />
          <BestAndSector report={report} />
          <FuelAnalysis report={report} />
          <TyreWear report={report} />
          <TyreTempPressure report={report} />
          <RaceExecution report={report} />
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
        <Metric label="Best lap" value={formatRaceTime(report.pace.bestLap)} />
        <Metric label="Average lap" value={formatRaceTime(report.pace.averageLap)} />
        <Metric label="Median lap" value={formatRaceTime(report.pace.medianLap)} />
        <Metric label="Duration" value={formatRaceTime(report.session.duration)} />
        <Metric label="Track temp" value={fmt(report.session.trackTemp, 1, " C")} />
        <Metric label="Ambient temp" value={fmt(report.session.ambientTemp, 1, " C")} />
      </div>
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
        <SectionTitle title="Lap Time Delta" help="Compares each valid lap to the best lap. Rising deltas usually mean tyres, traffic, fuel saving, or consistency loss." />
        <ReportChart report={report} />
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
        <SectionTitle title="Sector Analysis" help="Identifies the largest sector-level loss when live sector splits are stored." />
        <Metric label="Sector 1 best" value={formatRaceTime(report.sectors.bestSectors.sector1)} />
        <Metric label="Sector 2 best" value={formatRaceTime(report.sectors.bestSectors.sector2)} />
        <Metric label="Sector 3 best" value={formatRaceTime(report.sectors.bestSectors.sector3)} />
        {!report.sectors.available && <p className="muted">Sector analysis is waiting for persisted sector split data.</p>}
      </section>
    </>
  );
}

function FuelAnalysis({ report }: { report: RacePrepReportModel }) {
  return (
    <section className="card span-12">
      <SectionTitle title="Fuel Analysis" help="Builds race fuel estimates from valid session laps and available tank capacity." />
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
  );
}

function RaceExecution({ report }: { report: RacePrepReportModel }) {
  const needsStop = (report.execution.fuelStops ?? 0) > 0;
  return (
    <section className="card span-12">
      <SectionTitle title="Race Execution Suggestions" help="Turns practice data into race-running options for pace, fuel, tyres, and lift-and-coast." />
      <div className="header-grid">
        <Metric label="Suggested race pace" value={`${formatRaceTime(report.execution.paceTargetLow)} - ${formatRaceTime(report.execution.paceTargetHigh)}`} />
        <Metric label="Fuel stops" value={report.execution.fuelStops ?? "--"} sub={report.execution.totalStints != null ? `${report.execution.totalStints} stints` : undefined} />
        <Metric label="Avg race stint" value={fmt(report.execution.averageRaceStintLaps, 1, " laps")} />
        <Metric label="Estimated stint length" value={fmt(report.execution.stintLength, 1, " laps")} />
        <Metric label="Save to remove a stop" value={fmt(report.execution.fuelSavingRequiredPercent, 1, "%")} />
        <Metric label="Tyres available" value={report.execution.tyresAvailable} sub={`${report.execution.tyreSetsAvailable} full sets`} />
        <Metric label="Tyre sets needed" value={report.execution.tyreSetsNeeded ?? "--"} sub={report.execution.tyreSetsShortage ? `${report.execution.tyreSetsShortage} set shortage` : "within budget"} />
        <Metric label="Tyre warning" value={report.execution.tyreWarning || "--"} />
      </div>
      {!needsStop ? (
        <p className="muted"><strong>No pit stop required on the current model.</strong> Keep the tyre set unless wear or pressure behavior worsens, and use lift-and-coast only tactically in traffic or defending.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Stop</th><th>Approx lap</th><th>Tyres to change</th><th>Action</th><th>Reason</th></tr></thead>
              <tbody>
                {report.execution.tyreChangePlan.map((stop) => (
                  <tr key={stop.stop}><td>{stop.stop}</td><td>{stop.lap ?? "--"}</td><td>{stop.tyresToChange}</td><td>{stop.action}</td><td>{stop.reason}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Option</th><th>Target saving</th><th>Expected consumption</th><th>Pace loss</th><th>Risk</th><th>Use case</th></tr></thead>
              <tbody>
                {report.execution.liftCoastOptions.map((option) => (
                  <tr key={option.label}><td>{option.label}</td><td>{option.targetSaving}</td><td>{option.consumption}</td><td>{option.paceLoss}</td><td><span className={`badge ${option.risk === "high" ? "red" : option.risk === "medium" ? "amber" : "green"}`}>{option.risk}</span></td><td>{option.recommendation}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="muted"><strong>Recommended race approach:</strong> {report.execution.finalRecommendation}</p>
    </section>
  );
}
