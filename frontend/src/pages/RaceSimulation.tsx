import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { SectionTitle } from "../components/SectionTitle";
import { useDuckdbJob } from "../hooks/useDuckdbJob";
import { useT } from "../i18n/I18nProvider";
import { duckdbSessionLabel } from "../lib/lmuDuckdbSession";
import { formatRaceTime, formatTotalTime } from "../lib/timeFormat";
import type { LmuDuckdbScanResponse, LmuDuckdbSession } from "../types/lmuDuckdb";
import type { FullFieldResult, RaceSimulationResult } from "../types/raceSimulation";
import type { RaceSimulationSummary } from "../types/raceSimulation";

const fmt = (value: number | undefined, digits = 1, suffix = "") => value == null || !Number.isFinite(value) ? "--" : `${value.toFixed(digits)}${suffix}`;

export type MonteCarloAssumptions = {
  raceDurationMinutes: number;
  tankCapacityLiters: number;
  finishReserveLiters: number;
  pitLossSeconds: number;
  tyreWearLimit: number;
  tyreChangeSecondsPerTyre: number;
  refuelSecondsPer5Liters: number;
  serviceModel: "parallel" | "sequential";
  normalLapTime: number;
  fuelPerLapLiters: number | null;
  tyreWearRatePerLap: number | null;
};

function monteCarloRisk(summary: RaceSimulationSummary) {
  const risk = Math.max(summary.fuel_risk_probability, summary.tyre_risk_probability);
  return risk >= .2 ? "red" : risk >= .07 ? "amber" : "green";
}

function MonteCarloStrategyCard({ summary, selected, onSelect }: { summary: RaceSimulationSummary; selected: boolean; onSelect: () => void }) {
  return <section className={`card span-4 strategy-card${selected ? " selected" : ""}`}>
    <div className="row"><span className="badge blue">Monte Carlo · {summary.stops} stop{summary.stops === 1 ? "" : "s"}</span><span className={`badge ${monteCarloRisk(summary)}`}>{Math.max(summary.fuel_risk_probability, summary.tyre_risk_probability) * 100 < 7 ? "low" : "elevated"} risk</span></div>
    <h2>{summary.name}</h2>
    <div className="strategy-card-main"><strong>{formatTotalTime(summary.median_time)}</strong><span>Median race time · P90 {formatTotalTime(summary.p90)}</span></div>
    <div className="header-grid two">
      <div><span className="label">Mean</span><strong>{formatTotalTime(summary.mean_time)}</strong></div>
      <div><span className="label">Spread</span><strong>{fmt(summary.std_dev, 2, " s")}</strong></div>
      <div><span className="label">Pit time</span><strong>{fmt(summary.expected_pit_time, 1, " s")}</strong></div>
      <div><span className="label">Traffic loss</span><strong>{fmt(summary.expected_traffic_loss, 1, " s")}</strong></div>
      <div><span className="label">Traffic P90</span><strong>{fmt(summary.p90_traffic_loss, 1, " s")}</strong></div>
      <div><span className="label">Finish fuel</span><strong>{fmt(summary.expected_finish_fuel, 1, " L")}</strong></div>
      <div><span className="label">Max tyre wear</span><strong>{fmt(summary.expected_max_wear * 100, 0, "%")}</strong></div>
      <div><span className="label">Fastest probability</span><strong>{fmt(summary.fastest_probability * 100, 0, "%")}</strong></div>
    </div>
    <div className="metric compact"><span className="label">Estimated traffic</span><span className="subvalue">{fmt(summary.expected_traffic_events, 1)} encounters · {fmt(summary.expected_traffic_wear * 100, 1, "%")} additional wear</span></div>
    <div className="metric compact"><span className="label">Monte Carlo risk</span><span className="subvalue">Fuel {fmt(summary.fuel_risk_probability * 100, 1, "%")} · Tyres {fmt(summary.tyre_risk_probability * 100, 1, "%")}</span></div>
    <button className={`strategy-select${selected ? " active-control" : ""}`} type="button" onClick={onSelect}>{selected ? "Selected strategy" : "Select strategy"}</button>
  </section>;
}

function MonteCarloTimeline({ summary, laps }: { summary?: RaceSimulationSummary; laps: Array<{ lap: number; lap_time: number; fuel: number; wear: number; stint: number; pit: boolean }> }) {
  if (!summary || !laps.length) return <div className="empty-state"><strong>No representative strategy run</strong><span>Select a Monte Carlo strategy to inspect its stints, pit points, fuel, and tyre evolution.</span></div>;
  const maxLap = laps[laps.length - 1]?.lap || 1;
  const stints = [...new Set(laps.map((lap) => lap.stint))].map((stint) => laps.filter((lap) => lap.stint === stint));
  return <div className="strategy-timeline live-style-strategy-timeline"><div className="strategy-visual-summary"><div><span className="label">Selected plan</span><strong>{formatTotalTime(summary.median_time)}</strong></div><div><span className="label">Stops planned</span><strong>{summary.stops}</strong></div><div><span className="label">Race plan</span><strong>{maxLap} laps</strong></div><div><span className="label">Fuel at finish</span><strong>{fmt(summary.expected_finish_fuel, 1, " L")}</strong></div></div><div className="strategy-track-rail"><div className="strategy-track">{stints.map((stint, index) => <span className="strategy-stint" key={index} style={{ width: `${stint.length / laps.length * 100}%` }}><strong>Stint {index + 1}</strong><small>{stint.length} laps</small></span>)}{laps.filter((lap) => lap.pit).map((lap) => <span className="strategy-marker" key={lap.lap} style={{ left: `${Math.min(98, Math.max(2, lap.lap / maxLap * 100))}%` }}><strong>Lap {lap.lap}</strong><small>Pit · {fmt(lap.fuel, 1, " L")} left</small></span>)}</div></div><div className="stint-service-list">{stints.map((stint, index) => { const last = stint[stint.length - 1]; return <article className="stint-service" key={index}><header><div><span className="label">Stint {index + 1} · {stint.length} laps</span><strong>{last.pit ? `Pit at lap ${last.lap}` : "Finish"}</strong></div>{last.pit && <span className="badge amber">Pit stop</span>}</header><div className="stint-service-body"><div><span className="label">Tyre wear</span><strong>{fmt(last.wear * 100, 0, "%")}</strong></div><div className="service-fuel"><span className="label">Fuel remaining</span><strong>{fmt(last.fuel, 1, " L")}</strong></div></div></article>; })}</div></div>;
}

function MonteCarloExecutionPlan({ summary }: { summary?: RaceSimulationSummary }) {
  if (!summary) return null;
  const plan = summary.plan;
  return <section className="card span-12">
    <SectionTitle title="Generated strategy instructions" help="Nominal pit-service targets are calculated from the selected strategy. Race traffic, fuel variation, and cautions can change the live recommendation." />
    <div className="header-grid">
      <Metric label="Initial fuel load" value={`${fmt(plan.initial_fuel_liters, 1)} L`} />
      <Metric label="Start tyres" value={plan.start_new_tyres ? "New" : "Used"} />
      <Metric label="Planned stops" value={plan.pits.length} />
      <Metric label="Stints" value={plan.stints} />
    </div>
    {!plan.pits.length ? <p className="muted">No pit stops are planned for this strategy.</p> : <div className="table-wrap"><table><thead><tr><th>Stop</th><th>Pit lap</th><th>Next stint</th><th>Tyres</th><th>Fuel to add</th><th>Fuel target</th><th>Pace</th></tr></thead><tbody>{plan.pits.map((pit, index) => <tr key={pit.pit_lap}><td>#{index + 1}</td><td>{pit.pit_lap}</td><td>{pit.next_stint_laps} laps</td><td>{pit.change_tyres ? "Change all tyres" : "No tyre change"}</td><td>{fmt(pit.fuel_to_add_liters, 1, " L")}</td><td>{fmt(pit.target_fuel_liters, 1, " L")}</td><td>{pit.pace_mode}</td></tr>)}</tbody></table></div>}
  </section>;
}

/** Shared Planner panel. The reference session and every race assumption are
 * owned by Strategy Planner so heuristic and Monte Carlo never drift apart. */
export function MonteCarloStrategyPanel({ sessionId, assumptions }: { sessionId: string; assumptions: MonteCarloAssumptions }) {
  const { run, progress } = useDuckdbJob();
  const [simulations, setSimulations] = useState(1000);
  const [seed, setSeed] = useState(42);
  const [fieldSize, setFieldSize] = useState(24);
  const [sameClassCars, setSameClassCars] = useState(12);
  const [fasterClassCars, setFasterClassCars] = useState(4);
  const [slowerClassCars, setSlowerClassCars] = useState(7);
  const [startingPosition, setStartingPosition] = useState(12);
  const [opponentPaceSpread, setOpponentPaceSpread] = useState(1.2);
  const [fasterClassDelta, setFasterClassDelta] = useState(5);
  const [slowerClassDelta, setSlowerClassDelta] = useState(5);
  const [trafficPreset, setTrafficPreset] = useState<"clear" | "light" | "typical" | "heavy">("typical");
  const [trafficAggression, setTrafficAggression] = useState<"conservative" | "normal" | "aggressive">("normal");
  const [trafficLoss, setTrafficLoss] = useState(1.2);
  const [trafficWear, setTrafficWear] = useState(.12);
  const [trafficFuel, setTrafficFuel] = useState(.01);
  const [tyreVariability, setTyreVariability] = useState(.12);
  const [paceVariability, setPaceVariability] = useState(1);
  const [pitVariability, setPitVariability] = useState(1);
  const [result, setResult] = useState<RaceSimulationResult | null>(null);
  const [selectedStrategyName, setSelectedStrategyName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const execute = () => {
    if (!sessionId) return;
    setError(null);
    run<RaceSimulationResult>(() => api.startRaceSimulationJob({
      session_id: sessionId,
      race_duration_minutes: assumptions.raceDurationMinutes,
      simulation_count: simulations,
      random_seed: seed,
      objective: "balanced",
      fuel_tank_capacity_liters: assumptions.tankCapacityLiters,
      finish_reserve_liters: assumptions.finishReserveLiters,
      pit_loss_seconds: assumptions.pitLossSeconds,
      tyre_wear_limit: assumptions.tyreWearLimit,
      tyre_change_seconds_per_tyre: assumptions.tyreChangeSecondsPerTyre,
      refuel_seconds_per_5_liters: assumptions.refuelSecondsPer5Liters,
      service_model: assumptions.serviceModel,
      normal_lap_time: assumptions.normalLapTime,
       fuel_per_lap_liters: assumptions.fuelPerLapLiters,
       tyre_wear_rate_per_lap: assumptions.tyreWearRatePerLap,
       field_size: fieldSize,
       same_class_cars: sameClassCars,
       faster_class_cars: fasterClassCars,
       slower_class_cars: slowerClassCars,
       starting_position: Math.min(startingPosition, fieldSize),
       opponent_pace_spread_seconds: opponentPaceSpread,
       faster_class_delta_seconds: fasterClassDelta,
       slower_class_delta_seconds: slowerClassDelta,
       traffic_preset: trafficPreset,
       traffic_aggression: trafficAggression,
       traffic_loss_seconds: trafficLoss,
       traffic_wear_multiplier: trafficWear,
       traffic_fuel_multiplier: trafficFuel,
       tyre_wear_variability: tyreVariability,
       pace_variability_multiplier: paceVariability,
       pit_variability_multiplier: pitVariability,
    })).then((next) => { setResult(next); setSelectedStrategyName(next.recommended); }).catch((exc) => setError(exc instanceof Error ? exc.message : String(exc)));
  };
  const selectedStrategy = result?.summaries.find((summary) => summary.name === selectedStrategyName) || result?.summaries.find((summary) => summary.name === result.recommended) || result?.summaries[0];
  const laps = selectedStrategy ? result?.representative_laps[selectedStrategy.name] || [] : [];
  return <>
    <LoadingOverlay show={!!progress && (progress.status === "queued" || progress.status === "running")} title={progress?.phase || "Preparing Monte Carlo simulation"} detail={progress?.message || "Sampling the selected session with the Planner assumptions."} percentage={progress?.percentage} error={progress?.error} />
    <section className="card span-12">
      <SectionTitle title="Monte Carlo strategy" help="Uses the Planner's selected saved session and current race assumptions to estimate strategy distributions." />
      <div className="section-toolbar report-toolbar">
        <span className="subvalue">{sessionId ? "Using the selected reference session and Planner assumptions." : "Select a saved reference session above to run Monte Carlo."}</span>
        <label><span className="label">Simulations</span><select value={simulations} onChange={(event) => setSimulations(Number(event.target.value))}><option value={1000}>1,000</option><option value={5000}>5,000</option><option value={10000}>10,000</option></select></label>
        <label><span className="label">Random seed</span><input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} /></label>
        <button className="primary" disabled={!sessionId} onClick={execute}>Run Monte Carlo</button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </section>
    <section className="card span-12">
      <SectionTitle title="Estimated opponent field" help="No opponent telemetry is available, so every run generates a seeded synthetic field around your measured pace. These assumptions control traffic, fuel use, and tyre impact." />
      <div className="section-toolbar report-toolbar">
        <label><span className="label">Total cars</span><input type="number" min="1" max="80" value={fieldSize} onChange={(event) => setFieldSize(Math.max(1, Number(event.target.value)))} /></label>
        <label><span className="label">Same class</span><input type="number" min="0" max="80" value={sameClassCars} onChange={(event) => setSameClassCars(Math.max(0, Number(event.target.value)))} /></label>
        <label><span className="label">Faster class</span><input type="number" min="0" max="80" value={fasterClassCars} onChange={(event) => setFasterClassCars(Math.max(0, Number(event.target.value)))} /></label>
        <label><span className="label">Slower class</span><input type="number" min="0" max="80" value={slowerClassCars} onChange={(event) => setSlowerClassCars(Math.max(0, Number(event.target.value)))} /></label>
        <label><span className="label">Starting position</span><input type="number" min="1" max={fieldSize} value={Math.min(startingPosition, fieldSize)} onChange={(event) => setStartingPosition(Math.max(1, Number(event.target.value)))} /></label>
        <label><span className="label">Traffic scenario</span><select value={trafficPreset} onChange={(event) => setTrafficPreset(event.target.value as typeof trafficPreset)}><option value="clear">Clear air</option><option value="light">Light</option><option value="typical">Typical</option><option value="heavy">Heavy</option></select></label>
        <label><span className="label">Overtake approach</span><select value={trafficAggression} onChange={(event) => setTrafficAggression(event.target.value as typeof trafficAggression)}><option value="conservative">Conservative</option><option value="normal">Normal</option><option value="aggressive">Aggressive</option></select></label>
      </div>
      <details><summary>Advanced traffic and tyre uncertainty</summary><div className="section-toolbar report-toolbar">
        <label><span className="label">Loss per encounter</span><input type="number" min="0" step=".1" value={trafficLoss} onChange={(event) => setTrafficLoss(Math.max(0, Number(event.target.value)))} /><span className="subvalue">seconds</span></label>
        <label><span className="label">Traffic tyre multiplier</span><input type="number" min="0" step=".01" value={trafficWear} onChange={(event) => setTrafficWear(Math.max(0, Number(event.target.value)))} /><span className="subvalue">extra wear</span></label>
        <label><span className="label">Traffic fuel multiplier</span><input type="number" min="0" step=".01" value={trafficFuel} onChange={(event) => setTrafficFuel(Math.max(0, Number(event.target.value)))} /><span className="subvalue">extra fuel</span></label>
        <label><span className="label">Tyre variability</span><input type="number" min="0" max=".75" step=".01" value={tyreVariability} onChange={(event) => setTyreVariability(Math.max(0, Number(event.target.value)))} /><span className="subvalue">run-to-run spread</span></label>
        <label><span className="label">Opponent pace spread</span><input type="number" min=".05" step=".1" value={opponentPaceSpread} onChange={(event) => setOpponentPaceSpread(Math.max(.05, Number(event.target.value)))} /><span className="subvalue">seconds/lap</span></label>
        <label><span className="label">Faster-class pace gap</span><input type="number" min=".1" step=".1" value={fasterClassDelta} onChange={(event) => setFasterClassDelta(Math.max(.1, Number(event.target.value)))} /><span className="subvalue">seconds/lap</span></label>
        <label><span className="label">Slower-class pace gap</span><input type="number" min=".1" step=".1" value={slowerClassDelta} onChange={(event) => setSlowerClassDelta(Math.max(.1, Number(event.target.value)))} /><span className="subvalue">seconds/lap</span></label>
        <label><span className="label">Pace variability</span><input type="number" min="0" step=".1" value={paceVariability} onChange={(event) => setPaceVariability(Math.max(0, Number(event.target.value)))} /><span className="subvalue">multiplier</span></label>
        <label><span className="label">Pit variability</span><input type="number" min="0" step=".1" value={pitVariability} onChange={(event) => setPitVariability(Math.max(0, Number(event.target.value)))} /><span className="subvalue">multiplier</span></label>
      </div></details>
    </section>
    {!result ? <section className="card span-12"><div className="empty-state"><strong>Ready to simulate</strong><span>Run the model to compare strategy outcomes and risk using the current Planner inputs.</span></div></section> : <>
      <section className="card span-12"><SectionTitle title="Monte Carlo recommendation" help="Distribution-aware recommendation from the same assumptions used by the Planner." /><div className="header-grid"><Metric label="Strategy" value={result.recommended} /><Metric label="Estimated laps" value={result.model.estimated_race_laps ?? "--"} /><Metric label="Clean laps" value={`${result.model.accepted}/${result.model.total}`} /><Metric label="Baseline pace" value={formatRaceTime(result.model.baseline)} /><Metric label="Fuel per lap" value={`${fmt(result.model.fuel_per_lap, 3)} L`} /><Metric label="Pit loss" value={`${fmt(result.model.pit_loss)} s`} /></div><p className="muted">{result.explanation}</p></section>
      {result.summaries.map((summary) => <MonteCarloStrategyCard key={summary.name} summary={summary} selected={summary.name === selectedStrategy?.name} onSelect={() => setSelectedStrategyName(summary.name)} />)}
      <MonteCarloExecutionPlan summary={selectedStrategy} />
      <section className="card span-12 pit-strategy-visualization"><SectionTitle title="Monte Carlo pit strategy visualization" help="The selected Monte Carlo candidate uses the same stint, pit, fuel, and tyre layout as the heuristic planner." /><MonteCarloTimeline summary={selectedStrategy} laps={laps} /></section>
      <section className="card span-12"><SectionTitle title="Strategy comparison" help="Mean, median, downside, and reliability are calculated from the Monte Carlo samples." /><div className="table-wrap"><table><thead><tr><th>Strategy</th><th>Stops</th><th>Mean</th><th>Median</th><th>P90</th><th>Fastest</th><th>Fuel risk</th><th>Tyre risk</th></tr></thead><tbody>{result.summaries.map((summary) => <tr key={summary.name}><td>{summary.name}</td><td>{summary.stops}</td><td>{formatTotalTime(summary.mean_time)}</td><td>{formatTotalTime(summary.median_time)}</td><td>{formatTotalTime(summary.p90)}</td><td>{fmt(summary.fastest_probability * 100, 0)}%</td><td>{fmt(summary.fuel_risk_probability * 100, 0)}%</td><td>{fmt(summary.tyre_risk_probability * 100, 0)}%</td></tr>)}</tbody></table></div></section>
      <section className="card span-6"><SectionTitle title="Outcome distribution" help="P5, median, and P90 expose both expected time and downside." /><ResponsiveContainer width="100%" height={260}><BarChart data={result.summaries.map((summary) => ({ name: summary.name, p5: summary.p5, median: summary.median_time, p90: summary.p90 }))}><CartesianGrid stroke="#27313a" /><XAxis dataKey="name" /><YAxis tickFormatter={(value) => formatTotalTime(value)} /><Tooltip formatter={(value) => formatTotalTime(Number(value))} /><Legend /><Bar dataKey="p5" fill="#6dd6ff" /><Bar dataKey="median" fill="#e6b450" /><Bar dataKey="p90" fill="#ff8c69" /></BarChart></ResponsiveContainer></section>
      <section className="card span-6"><SectionTitle title="Representative lap evolution" help="One deterministic representative run shows fuel and lap time through the recommended strategy." /><ResponsiveContainer width="100%" height={260}><LineChart data={laps}><CartesianGrid stroke="#27313a" /><XAxis dataKey="lap" /><YAxis yAxisId="time" tickFormatter={(value) => formatRaceTime(value)} /><YAxis yAxisId="fuel" orientation="right" /><Tooltip /><Legend /><Line yAxisId="time" dataKey="lap_time" stroke="#6dd6ff" dot={false} /><Line yAxisId="fuel" dataKey="fuel" stroke="#e6b450" dot={false} /></LineChart></ResponsiveContainer></section>
    </>}
  </>;
}

export function RaceSimulation() {
  const t = useT();
  const { run, progress } = useDuckdbJob();
  const [sessions, setSessions] = useState<LmuDuckdbSession[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [raceDurationMinutes, setRaceDurationMinutes] = useState(120);
  const [tankCapacity, setTankCapacity] = useState(90);
  const [finishReserve, setFinishReserve] = useState(2);
  const [pitLoss, setPitLoss] = useState(28);
  const [tyreWearLimit, setTyreWearLimit] = useState(.85);
  const [tyreChangeSeconds, setTyreChangeSeconds] = useState(3);
  const [refuelSeconds, setRefuelSeconds] = useState(1.2);
  const [serviceModel, setServiceModel] = useState<"parallel" | "sequential">("parallel");
  const [paceOverride, setPaceOverride] = useState("");
  const [simulations, setSimulations] = useState(1000);
  const [seed, setSeed] = useState(42);
  const [result, setResult] = useState<RaceSimulationResult | null>(null);
  const [event, setEvent] = useState<Record<string, any> | null>(null);
  const [fullField, setFullField] = useState<FullFieldResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);

  useEffect(() => {
    run<LmuDuckdbScanResponse>(() => api.startDuckdbSessionsJob(250)).then((response) => {
      setSessions(response.sessions); setSessionId(response.sessions[0]?.id || "");
    }).catch((exc) => setError(exc instanceof Error ? exc.message : t("raceSimulation.sessionLoadFailed"))).finally(() => setLoadingSessions(false));
  }, []);
  const selected = sessions.find((session) => session.id === sessionId);
  const selectedSummary = useMemo(() => selected ? duckdbSessionLabel(selected) : t("raceSimulation.noSession"), [selected, t]);
  const execute = () => {
    if (!sessionId) return;
    setError(null);
    run<RaceSimulationResult>(() => api.startRaceSimulationJob({ session_id: sessionId, race_duration_minutes: raceDurationMinutes, simulation_count: simulations, random_seed: seed, objective: "balanced", fuel_tank_capacity_liters: tankCapacity, finish_reserve_liters: finishReserve, pit_loss_seconds: pitLoss, tyre_wear_limit: tyreWearLimit, tyre_change_seconds_per_tyre: tyreChangeSeconds, refuel_seconds_per_5_liters: refuelSeconds, service_model: serviceModel, normal_lap_time: paceOverride ? Number(paceOverride) : null })).then(setResult).catch((exc) => setError(exc instanceof Error ? exc.message : t("raceSimulation.runFailed")));
  };
  const importEvent = () => { if (sessionId) api.importRaceEvent(sessionId).then(setEvent).catch((exc) => setError(exc instanceof Error ? exc.message : "Could not import event")); };
  const runFullField = () => {
    if (!event) return;
    run<FullFieldResult>(() => api.startFullFieldRaceJob({ session_id: sessionId, duration_minutes: raceDurationMinutes, simulation_count: simulations, random_seed: seed, entries: event.entries, weather: event.weather })).then(setFullField).catch((exc) => setError(exc instanceof Error ? exc.message : "Full-field simulation failed"));
  };
  const selectedStrategy = result?.summaries.find((summary) => summary.name === result.recommended) || result?.summaries[0];
  const laps = selectedStrategy ? result?.representative_laps[selectedStrategy.name] || [] : [];
  return <div className="page grid">
    <LoadingOverlay show={loadingSessions || !!progress && (progress.status === "queued" || progress.status === "running")} title={progress?.phase || t("raceSimulation.loading")} detail={progress?.message || t("raceSimulation.loadingDetail")} percentage={progress?.percentage} error={progress?.error} />
    <section className="card span-12">
      <SectionTitle title={t("raceSimulation.title")} help={t("raceSimulation.help")} />
      <div className="section-toolbar report-toolbar">
        <label><span className="label">{t("raceSimulation.session")}</span><select value={sessionId} onChange={(event) => setSessionId(event.target.value)}><option value="">{t("raceSimulation.selectSession")}</option>{sessions.map((session) => <option key={session.id} value={session.id}>{duckdbSessionLabel(session)}</option>)}</select><span className="subvalue">{selectedSummary}</span></label>
        <label><span className="label">{t("raceSimulation.raceDuration")}</span><input type="number" min="5" max="1440" value={raceDurationMinutes} onChange={(event) => setRaceDurationMinutes(Math.max(5, Number(event.target.value)))} /><span className="subvalue">{t("raceSimulation.durationHelp")}</span></label>
        <label><span className="label">{t("raceSimulation.simulations")}</span><select value={simulations} onChange={(event) => setSimulations(Number(event.target.value))}><option value={1000}>1,000</option><option value={5000}>5,000</option><option value={10000}>10,000</option></select></label>
        <label><span className="label">{t("raceSimulation.seed")}</span><input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value))} /></label>
        <button className="primary" disabled={!sessionId} onClick={execute}>{t("raceSimulation.run")}</button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </section>
    <section className="card span-12">
      <SectionTitle title="Endurance event setup" help="Imports the recorded target car, driver calibration and initial weather. Add calibrated field entries before a full-field prediction; unsupported opponent evidence stays explicitly limited." />
      <div className="section-toolbar"><button onClick={importEvent} disabled={!sessionId}>Import recorded event</button>{event && <><span className="badge blue">{event.entries?.length || 0} entries</span><button className="primary" onClick={runFullField}>Run full-field model</button></> }</div>
      {event?.warnings?.map((warning: string) => <p className="muted" key={warning}>{warning}</p>)}
      {event && <div className="table-wrap"><table><thead><tr><th>Target / team</th><th>Car</th><th>Class</th><th>Baseline pace</th><th>Driver</th></tr></thead><tbody>{event.entries?.map((entry: any) => <tr key={entry.id}><td>{entry.team_name}</td><td>{entry.car}</td><td>{entry.car_class}</td><td>{formatRaceTime(entry.baseline_lap_seconds)}</td><td>{entry.drivers?.map((driver: any) => driver.name).join(", ")}</td></tr>)}</tbody></table></div>}
      {fullField && <div className="header-grid"><Metric label="Expected overall position" value={fmt(fullField.expected_overall_position, 1)} /><Metric label="Expected class position" value={fmt(fullField.expected_class_position, 1)} /><Metric label="Class win probability" value={`${fmt(fullField.win_probability * 100, 1)}%`} /><Metric label="Class podium probability" value={`${fmt(fullField.podium_probability * 100, 1)}%`} /><Metric label="Traffic loss" value={`${fmt(fullField.expected_traffic_loss, 1)} s`} /></div>}
    </section>
    <section className="card span-12">
      <SectionTitle title="Race assumptions" help="The same planning inputs used by Strategy Planner; session-derived pace, fuel and tyre data remain the default unless you override them." />
      <div className="section-toolbar report-toolbar">
        <label><span className="label">Tank capacity</span><input type="number" min="1" step=".1" value={tankCapacity} onChange={(event) => setTankCapacity(Number(event.target.value))} /><span className="subvalue">litres</span></label>
        <label><span className="label">Finish reserve</span><input type="number" min="0" step=".1" value={finishReserve} onChange={(event) => setFinishReserve(Number(event.target.value))} /><span className="subvalue">litres</span></label>
        <label><span className="label">Pit lane loss</span><input type="number" min="0" step=".1" value={pitLoss} onChange={(event) => setPitLoss(Number(event.target.value))} /><span className="subvalue">seconds per stop</span></label>
        <label><span className="label">Tyre change</span><input type="number" min="0" step=".1" value={tyreChangeSeconds} onChange={(event) => setTyreChangeSeconds(Number(event.target.value))} /><span className="subvalue">seconds per tyre</span></label>
        <label><span className="label">Refuel 5 L</span><input type="number" min="0" step=".1" value={refuelSeconds} onChange={(event) => setRefuelSeconds(Number(event.target.value))} /><span className="subvalue">seconds</span></label>
        <label><span className="label">Maximum tyre wear</span><input type="number" min=".1" max="1" step=".01" value={tyreWearLimit} onChange={(event) => setTyreWearLimit(Number(event.target.value))} /><span className="subvalue">fraction</span></label>
        <label><span className="label">Service timing</span><select value={serviceModel} onChange={(event) => setServiceModel(event.target.value as "parallel" | "sequential")}><option value="parallel">Parallel</option><option value="sequential">Sequential</option></select></label>
        <label><span className="label">Pace override</span><input type="number" min="40" step=".001" value={paceOverride} onChange={(event) => setPaceOverride(event.target.value)} placeholder="session-derived" /><span className="subvalue">seconds per lap</span></label>
      </div>
    </section>
    {!result ? <section className="card span-12"><div className="empty-state"><strong>{t("raceSimulation.awaitingRun")}</strong><span>{t("raceSimulation.awaitingRunDetail")}</span></div></section> : <>
      <section className="card span-12"><SectionTitle title={t("raceSimulation.recommendation")} help={t("raceSimulation.recommendationHelp")} /><div className="header-grid"><Metric label={t("raceSimulation.strategy")} value={result.recommended} /><Metric label={t("raceSimulation.estimatedLaps")} value={result.model.estimated_race_laps ?? "--"} /><Metric label={t("raceSimulation.cleanLaps")} value={`${result.model.accepted}/${result.model.total}`} /><Metric label={t("raceSimulation.baselinePace")} value={formatRaceTime(result.model.baseline)} /><Metric label={t("raceSimulation.fuelPerLap")} value={`${fmt(result.model.fuel_per_lap, 3)} L`} /><Metric label={t("raceSimulation.pitLoss")} value={`${fmt(result.model.pit_loss)} s`} /></div><p className="muted">{result.explanation}</p></section>
      <section className="card span-12"><SectionTitle title={t("raceSimulation.comparison")} help={t("raceSimulation.comparisonHelp")} /><div className="table-wrap"><table><thead><tr><th>{t("raceSimulation.strategy")}</th><th>{t("raceSimulation.stops")}</th><th>{t("raceSimulation.mean")}</th><th>{t("raceSimulation.median")}</th><th>{t("raceSimulation.p90")}</th><th>{t("raceSimulation.fastest")}</th><th>{t("raceSimulation.fuelRisk")}</th><th>{t("raceSimulation.tyreRisk")}</th></tr></thead><tbody>{result.summaries.map((summary) => <tr key={summary.name}><td>{summary.name}</td><td>{summary.stops}</td><td>{formatTotalTime(summary.mean_time)}</td><td>{formatTotalTime(summary.median_time)}</td><td>{formatTotalTime(summary.p90)}</td><td>{fmt(summary.fastest_probability * 100, 0)}%</td><td>{fmt(summary.fuel_risk_probability * 100, 0)}%</td><td>{fmt(summary.tyre_risk_probability * 100, 0)}%</td></tr>)}</tbody></table></div></section>
      <section className="card span-6"><SectionTitle title={t("raceSimulation.distribution")} help={t("raceSimulation.distributionHelp")} /><ResponsiveContainer width="100%" height={260}><BarChart data={result.summaries.map((summary) => ({ name: summary.name, p5: summary.p5, median: summary.median_time, p90: summary.p90 }))}><CartesianGrid stroke="#27313a" /><XAxis dataKey="name" /><YAxis tickFormatter={(value) => formatTotalTime(value)} /><Tooltip formatter={(value) => formatTotalTime(Number(value))} /><Legend /><Bar dataKey="p5" fill="#6dd6ff" /><Bar dataKey="median" fill="#e6b450" /><Bar dataKey="p90" fill="#ff8c69" /></BarChart></ResponsiveContainer></section>
      <section className="card span-6"><SectionTitle title={t("raceSimulation.lapEvolution")} help={t("raceSimulation.lapEvolutionHelp")} /><ResponsiveContainer width="100%" height={260}><LineChart data={laps}><CartesianGrid stroke="#27313a" /><XAxis dataKey="lap" /><YAxis yAxisId="time" tickFormatter={(value) => formatRaceTime(value)} /><YAxis yAxisId="fuel" orientation="right" /><Tooltip /><Legend /><Line yAxisId="time" dataKey="lap_time" stroke="#6dd6ff" dot={false} /><Line yAxisId="fuel" dataKey="fuel" stroke="#e6b450" dot={false} /></LineChart></ResponsiveContainer></section>
      <section className="card span-12"><SectionTitle title="Stint, pit, fuel and tyre plan" help="The selected strategy is shown from start to finish. Dashed markers are generated pit points; fuel and tyre wear show why the next stop is required." /><ResponsiveContainer width="100%" height={280}><LineChart data={laps}><CartesianGrid stroke="#27313a" /><XAxis dataKey="lap" /><YAxis yAxisId="fuel" /><YAxis yAxisId="wear" orientation="right" tickFormatter={(value) => `${Math.round(value * 100)}%`} /><Tooltip /><Legend /><Line yAxisId="fuel" dataKey="fuel" name="Fuel remaining" stroke="#6dd6ff" dot={false} /><Line yAxisId="wear" dataKey="wear" name="Tyre wear" stroke="#ff8c69" dot={false} /><Line yAxisId="wear" dataKey={(row) => row.pit ? row.wear : null} name="Pit point" stroke="#e6b450" dot={{ r: 5 }} /></LineChart></ResponsiveContainer></section>
      <section className="card span-6"><SectionTitle title={t("raceSimulation.dataQuality")} help={t("raceSimulation.dataQualityHelp")} /><div className="insight-list">{Object.entries(result.model.reasons).map(([reason, count]) => <p key={reason}><span className="badge amber">{count}</span> {reason.replace(/_/g, " ")}</p>)} {!Object.keys(result.model.reasons).length && <p>{t("raceSimulation.noRejections")}</p>}</div></section>
      <section className="card span-6"><SectionTitle title={t("raceSimulation.provenance")} help={t("raceSimulation.provenanceHelp")} /><div className="table-wrap"><table><thead><tr><th>{t("raceSimulation.parameter")}</th><th>{t("raceSimulation.source")}</th></tr></thead><tbody>{Object.entries(result.model.provenance).map(([name, source]) => <tr key={name}><td>{name.replace(/_/g, " ")}</td><td><span className="badge blue">{source.replace(/_/g, " ")}</span></td></tr>)}</tbody></table></div><p className="muted">{result.limitations[0]}</p></section>
    </>}
  </div>;
}
function Metric({ label, value }: { label: string; value: string | number }) { return <div className="metric compact"><span className="label">{label}</span><span className="value">{value}</span></div>; }
