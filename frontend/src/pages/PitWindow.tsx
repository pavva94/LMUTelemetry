import { useMemo, useState } from "react";
import { SectionTitle } from "../components/SectionTitle";
import { StatusBadge } from "../components/StatusBadge";
import { useT } from "../i18n/I18nProvider";
import { simulateStrategies, type PaceEvidence, type StrategyCandidate, type StrategyRisk, type Wheel } from "../lib/strategySimulation";
import { formatDuration, formatRaceTime } from "../lib/timeFormat";
import type { StrategyState } from "../types/strategy";
import type { TelemetrySnapshot } from "../types/telemetry";

const fmt = (value: number | null | undefined, digits = 1, suffix = "") =>
  value == null || !Number.isFinite(value) ? "--" : `${value.toFixed(digits)}${suffix}`;
const pct = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "--" : `${Math.round(value * 100)}%`;
const text = (value?: string | number | boolean | null) => (value == null || value === "" ? "--" : String(value));
const wheels: Wheel[] = ["fl", "fr", "rl", "rr"];
const wheelLabels: Record<Wheel, string> = { fl: "FL", fr: "FR", rl: "RL", rr: "RR" };

function validLapTime(value?: number | null) {
  return value != null && Number.isFinite(value) && value >= 40 && value <= 900 ? value : null;
}

function liveNormalLapTime(telemetry?: TelemetrySnapshot | null, fallback?: number | null, pace?: StrategyState["pace"]) {
  if (validLapTime(pace?.weighted_recent_pace) != null) return { value: pace?.weighted_recent_pace ?? null, source: "weighted recent pace" };
  const playerCar = telemetry?.competitors.find((car) => car.is_player);
  const direct = validLapTime(playerCar?.last_lap_time) ?? validLapTime(playerCar?.estimated_lap_time) ?? validLapTime(playerCar?.best_lap_time);
  if (direct != null) return { value: direct, source: playerCar?.last_lap_time ? "player last lap" : playerCar?.estimated_lap_time ? "player estimate" : "player best lap" };
  return { value: fallback && fallback > 0 ? fallback : null, source: "strategy assumption" };
}

function paceEvidenceFromStrategy(strategy: StrategyState | null, fallback: number | null): PaceEvidence {
  const pace = strategy?.pace;
  return {
    lastLapTime: validLapTime(pace?.last_lap_time),
    last7LapAverage: validLapTime(pace?.last_7_lap_average),
    last10LapAverage: validLapTime(pace?.last_10_lap_average),
    weightedRecentPace: validLapTime(pace?.weighted_recent_pace) ?? validLapTime(fallback),
    paceTrendSecondsPerLap: Number.isFinite(pace?.pace_trend_seconds_per_lap) ? pace?.pace_trend_seconds_per_lap : null,
    paceDegradationPerLap: Number.isFinite(pace?.pace_degradation_per_lap) ? pace?.pace_degradation_per_lap : null,
    sampleLaps: pace?.sample_laps ?? 0,
    confidence: pace?.confidence || "low",
    source: pace?.weighted_recent_pace ? "live clean lap history" : "strategy assumption",
  };
}

function liveRemainingSeconds(telemetry: TelemetrySnapshot | null | undefined, lapTime: number | null, fallbackMinutes?: number) {
  const remaining = Number(telemetry?.session?.time_remaining);
  if (Number.isFinite(remaining) && remaining > 0) return { value: remaining, source: "session timer" };

  const current = Number(telemetry?.session?.current_time);
  const end = Number(telemetry?.session?.end_time);
  if (Number.isFinite(current) && Number.isFinite(end) && end > current) return { value: end - current, source: "session end time" };

  const currentLap = Number(telemetry?.player?.lap_number ?? telemetry?.session?.current_lap);
  const maxLaps = Number(telemetry?.session?.max_laps);
  if (lapTime != null && Number.isFinite(currentLap) && Number.isFinite(maxLaps) && maxLaps > currentLap) {
    return { value: (maxLaps - currentLap) * lapTime, source: "lap limit" };
  }

  return { value: fallbackMinutes && fallbackMinutes > 0 ? fallbackMinutes * 60 : null, source: "strategy assumption" };
}

function riskBadge(risk: StrategyRisk) {
  if (risk === "high") return "red";
  if (risk === "medium") return "amber";
  return "green";
}

function tyreWearText(values?: Record<Wheel, number> | null) {
  if (!values) return "--";
  return wheels.map((wheel) => `${wheelLabels[wheel]} ${pct(values[wheel])}`).join(" / ");
}

function tyreChangeWearText(stop: StrategyCandidate["stopsDetail"][number], t: (key: string, values?: Record<string, string | number>) => string) {
  if (!stop.tyresToChange.length) return t("pitWindow.none");
  return stop.tyresToChange
    .map((wheel) => {
      const wear = stop.tyreWearBeforeStop?.[wheel];
      return wear == null ? wheelLabels[wheel] : `${wheelLabels[wheel]} ${pct(wear)}`;
    })
    .join(" / ");
}

function absoluteStopLap(currentLap: number | null, stopLap: number) {
  return currentLap == null ? stopLap : Math.max(currentLap, Math.round(currentLap + stopLap));
}

function tyreLife(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? null : Math.max(0, Math.min(1, 1 - value));
}

function tyreLifeTone(value: number | null) {
  if (value == null) return "unknown";
  if (value <= 0.25) return "critical";
  if (value <= 0.5) return "warning";
  return "healthy";
}

function TyreLifeIndicator({ wheel, wear, change }: { wheel: Wheel; wear: number | null | undefined; change: boolean }) {
  const t = useT();
  const life = tyreLife(wear);
  const lifePercent = life == null ? 0 : Math.round(life * 100);
  return (
    <div className={`tyre-life ${tyreLifeTone(life)}${change ? " change" : ""}`}>
      <div className="tyre-life-heading">
        <strong>{wheelLabels[wheel]}</strong>
        <span>{life == null ? "--" : `${lifePercent}%`}</span>
      </div>
      <div className="tyre-life-shape" aria-hidden="true">
        <span style={{ height: `${lifePercent}%` }} />
      </div>
      <small>{change ? t("pitWindow.change") : t("pitWindow.keep")}</small>
    </div>
  );
}

function LivePlanOption({
  plan,
  index,
  currentLap,
  selected,
  onSelect,
}: {
  plan: StrategyCandidate;
  index: number;
  currentLap: number | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  const firstStop = plan.stopsDetail[0];
  return (
    <button
      className={`live-plan-option${selected ? " selected" : ""}`}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="live-plan-option-top">
        <b>{t("pitWindow.option", { number: index + 1 })}</b>
        <i className={`badge ${riskBadge(plan.risk)}`}>{plan.risk}</i>
      </span>
      <strong>{firstStop ? t("pitWindow.pitLap", { lap: absoluteStopLap(currentLap, firstStop.lap) }) : t("pitWindow.runToFinish")}</strong>
      <span className="live-plan-option-time">{formatDuration(plan.totalTimeSeconds)}</span>
      <span>{t("common.stops", { count: plan.stops })} · {firstStop ? t("pitWindow.addFuel", { fuel: fmt(firstStop.fuelAddedLiters, 1, " L") }) : t("pitWindow.finishFuel", { fuel: fmt(plan.finishFuelRemainingLiters, 1, " L") })}</span>
      <small>{firstStop?.tyresToChange.length ? t("pitWindow.tyres", { tyres: firstStop.tyresToChange.map((wheel) => wheelLabels[wheel]).join(" + ") }) : t("pitWindow.noTyreChangeNext")}</small>
    </button>
  );
}

function LiveStrategyTimeline({ plan, currentLap }: { plan?: StrategyCandidate; currentLap: number | null }) {
  const t = useT();
  if (!plan) {
    return <div className="empty-state"><strong>{t("pitWindow.noLiveStrategy")}</strong><span>{t("pitWindow.noLiveStrategyDetail")}</span></div>;
  }
  return (
    <div className="strategy-timeline">
      <div className="strategy-visual-summary">
        <div><span className="label">{t("pitWindow.selectedPlan")}</span><strong>{formatDuration(plan.totalTimeSeconds)}</strong></div>
        <div><span className="label">{t("pitWindow.stopsRemaining")}</span><strong>{plan.stops}</strong></div>
        <div><span className="label">{t("pitWindow.raceRemaining")}</span><strong>{t("common.laps", { count: Math.round(plan.raceLaps) })}</strong></div>
        <div><span className="label">{t("pitWindow.fuelAtFinish")}</span><strong>{fmt(plan.finishFuelRemainingLiters, 1, " L")}</strong></div>
        <div><span className="label">{t("pitWindow.energyAtFinish")}</span><strong>{pct(plan.finishVirtualEnergy)}</strong></div>
      </div>
      <div className="strategy-track">
        {Array.from({ length: plan.stops + 1 }, (_, index) => {
          const stint = plan.stintWear[index];
          const stintLaps = stint ? stint.endLap - stint.startLap + 1 : plan.raceLaps / (plan.stops + 1);
          return (
          <span className="strategy-stint" key={index} style={{ width: `${(stintLaps / plan.raceLaps) * 100}%` }}>
            <strong>{t("pitWindow.stint", { number: index + 1 })}</strong>
            <small>{t("common.laps", { count: Math.round(stintLaps) })}</small>
          </span>
          );
        })}
        {plan.stopsDetail.map((stop, index) => (
          <span
            className="strategy-marker"
            key={`${stop.lap}-${index}`}
            style={{ left: `${Math.min(98, Math.max(2, (stop.lap / plan.raceLaps) * 100))}%` }}
          >
            <strong>{t("telemetry.lap")} {absoluteStopLap(currentLap, stop.lap)}</strong>
            <small>{t("liveDashboard.pit")} {index + 1}</small>
          </span>
        ))}
      </div>
      {plan.stintWear.length > 0 && (
        <div className="stint-service-list">
          {plan.stintWear.map((stint, index) => {
            const stop = plan.stopsDetail[index];
            const stintLaps = stint.endLap - stint.startLap + 1;
            return (
              <article className="stint-service" key={stint.stint}>
                <header>
                  <div>
                    <span className="label">Stint {stint.stint} · {stintLaps} laps</span>
                    <strong>{stop ? `Pit stop ${index + 1} · Lap ${absoluteStopLap(currentLap, stop.lap)}` : "Finish"}</strong>
                  </div>
                  {stop && <span className="badge amber">{fmt(stop.stopTimeSeconds, 1, " s")} stop</span>}
                </header>
                <div className="stint-service-body">
                  <div>
                    <span className="label">Tyre life at {stop ? "pit entry" : "finish"}</span>
                    <div className="tyre-life-set">
                      {wheels.map((wheel) => (
                        <TyreLifeIndicator
                          wheel={wheel}
                          wear={stint.endWear[wheel]}
                          change={Boolean(stop?.tyresToChange.includes(wheel))}
                          key={wheel}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="service-fuel">
                    <span className="label">{t("pitWindow.fuelEnergyService")}</span>
                    {stop ? (
                      <>
                        <strong>{fmt(stop.fuelRemainingLiters, 1, " L")} remaining</strong>
                        <b>+ {fmt(stop.fuelAddedLiters, 1, " L")} to add</b>
                        <small>{pct(stop.virtualEnergyRemaining)} VE → {pct(stop.virtualEnergyOnExit)}</small>
                      </>
                    ) : (
                      <>
                        <strong>{fmt(plan.finishFuelRemainingLiters, 1, " L")} remaining</strong>
                        <b>{pct(plan.finishVirtualEnergy)} VE</b>
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PitWindow({ strategy, telemetry }: { strategy: StrategyState | null; telemetry?: TelemetrySnapshot | null }) {
  const t = useT();
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const pit = strategy?.pit_window;
  const assumptions = strategy?.assumptions || {};
  const player = telemetry?.player;
  const tyres = player?.tyre_state;
  const currentLap = Number(player?.lap_number ?? telemetry?.session?.current_lap);
  const absoluteCurrentLap = Number.isFinite(currentLap) ? currentLap : null;
  const lapTime = liveNormalLapTime(telemetry, Number(assumptions.normal_lap_time), strategy?.pace);
  const paceEvidence = paceEvidenceFromStrategy(strategy, lapTime.value);
  const remaining = liveRemainingSeconds(telemetry, lapTime.value, Number(assumptions.race_duration_minutes));
  const fuelPerLap = Number(strategy?.fuel.fuel_per_lap_liters);
  const currentWear = Number(strategy?.tyres.average_wear ?? tyres?.average_wear);
  const wearRate = Number(strategy?.tyres.wear_rate_per_lap);
  const tankCapacity = Number(player?.fuel_capacity_liters ?? strategy?.fuel.fuel_capacity_liters);
  const currentFuel = Number(player?.fuel_liters);
  const currentVirtualEnergy = Number(strategy?.energy?.current_virtual_energy_fraction ?? player?.hybrid_state?.virtual_energy_fraction);
  const virtualEnergyPerLap = Number(strategy?.energy?.virtual_energy_per_lap);
  const fuelEnergyRatio = Number(strategy?.energy?.fuel_to_virtual_energy_ratio);

  const plans = useMemo(() => simulateStrategies({
    raceDurationMinutes: remaining.value != null ? remaining.value / 60 : 0,
    normalLapTime: lapTime.value || Number(assumptions.normal_lap_time) || 0,
    paceEvidence,
    fuelPerLap: Number.isFinite(fuelPerLap) && fuelPerLap > 0 ? fuelPerLap : null,
    fuelObservedLaps: Number(strategy?.fuel.valid_laps_observed || 0),
    fuelRequiredLaps: Number(strategy?.fuel.valid_laps_required || 3),
    fuelConfidence: strategy?.fuel.confidence,
    tankCapacityLiters: Number.isFinite(tankCapacity) && tankCapacity > 0 ? tankCapacity : null,
    currentFuelLiters: Number.isFinite(currentFuel) && currentFuel >= 0 ? currentFuel : null,
    currentVirtualEnergyFraction: Number.isFinite(currentVirtualEnergy) ? currentVirtualEnergy : null,
    virtualEnergyPerLap: Number.isFinite(virtualEnergyPerLap) && virtualEnergyPerLap > 0 ? virtualEnergyPerLap : null,
    fuelToVirtualEnergyRatio: Number.isFinite(fuelEnergyRatio) && fuelEnergyRatio > 0 ? fuelEnergyRatio : null,
    raceStartFuelLiters: Number.isFinite(currentFuel) && currentFuel > 0 ? currentFuel : null,
    raceStartNewTyres: false,
    fuelSafetyMarginLiters: Number(assumptions.fuel_safety_margin_liters ?? 2),
    pitLaneLossSeconds: Number(assumptions.pit_loss_seconds ?? 28),
    tyreChangeSecondsPerTyre: Number(assumptions.tyre_change_seconds_per_tyre ?? 3),
    refuelSecondsPer5Liters: Number(assumptions.refuel_seconds_per_5_liters ?? 1.2),
    currentTyreWear: Number.isFinite(currentWear) ? currentWear : null,
    currentTyreWearByWheel: {
      fl: tyres?.wear_fl,
      fr: tyres?.wear_fr,
      rl: tyres?.wear_rl,
      rr: tyres?.wear_rr,
    },
    startingTyreWearByWheel: {
      fl: tyres?.wear_fl,
      fr: tyres?.wear_fr,
      rl: tyres?.wear_rl,
      rr: tyres?.wear_rr,
    },
    tyreWearRatePerLap: Number.isFinite(wearRate) && wearRate > 0 ? wearRate : null,
    tyrePaceDegradationPerLap: Number(strategy?.tyres.pace_degradation_per_lap) || paceEvidence.paceDegradationPerLap,
    tyreConfidence: strategy?.tyres.confidence,
    maxTyreWear: Number(assumptions.max_tyre_wear ?? 0.75),
    // Traffic risk is shown categorically; no uncalibrated seconds penalty is
    // injected into strategy ranking.
    trafficPenaltySeconds: 0,
    safetyCarActive: Boolean(pit?.safety_car_pit_recommendation),
    safetyCarPitLossSeconds: Number(assumptions.safety_car_pit_loss_seconds ?? 16),
  }), [
    assumptions.fuel_safety_margin_liters,
    assumptions.max_tyre_wear,
    assumptions.normal_lap_time,
    assumptions.pit_loss_seconds,
    assumptions.refuel_seconds_per_5_liters,
    assumptions.safety_car_pit_loss_seconds,
    assumptions.tyre_change_seconds_per_tyre,
    currentFuel,
    currentVirtualEnergy,
    virtualEnergyPerLap,
    fuelEnergyRatio,
    currentWear,
    fuelPerLap,
    lapTime.value,
    paceEvidence.lastLapTime,
    paceEvidence.last7LapAverage,
    paceEvidence.last10LapAverage,
    paceEvidence.weightedRecentPace,
    paceEvidence.paceTrendSecondsPerLap,
    paceEvidence.paceDegradationPerLap,
    paceEvidence.sampleLaps,
    paceEvidence.confidence,
    pit?.safety_car_pit_recommendation,
    pit?.traffic_risk_after_stop,
    remaining.value,
    strategy?.fuel.valid_laps_observed,
    strategy?.fuel.valid_laps_required,
    strategy?.fuel.confidence,
    strategy?.tyres.confidence,
    strategy?.tyres.pace_degradation_per_lap,
    tankCapacity,
    tyres?.wear_fl,
    tyres?.wear_fr,
    tyres?.wear_rl,
    tyres?.wear_rr,
    wearRate,
  ]);
  const bestPlan = plans[0];
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? bestPlan;
  const activePlanId = selectedPlan?.id ?? null;
  const firstStop = selectedPlan?.stopsDetail[0];

  return (
    <div className="page grid pit-window-page">
      <section className="card span-12 pit-strategy-visualization">
        <SectionTitle title={t("pitWindow.livePitStrategyVisualization")} help={t("pitWindow.livePitStrategyHelp")} />
        <LiveStrategyTimeline plan={selectedPlan} currentLap={absoluteCurrentLap} />
      </section>

      <section className="card span-12 live-options-section">
        <SectionTitle title={t("pitWindow.liveOptions")} help={t("pitWindow.liveOptionsHelp")} />
        {plans.length ? (
          <div className="live-option-rail">
            {plans.map((plan, index) => (
              <LivePlanOption
                plan={plan}
                index={index}
                currentLap={absoluteCurrentLap}
                selected={plan.id === activePlanId}
                onSelect={() => setSelectedPlanId(plan.id)}
                key={plan.id}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state"><strong>{t("pitWindow.noLiveStrategy")}</strong><span>{t("pitWindow.noLiveStrategyPitCallDetail")}</span></div>
        )}
      </section>

      <section className="card span-5">
        <SectionTitle title={t("pitWindow.livePitWindow")} help={t("pitWindow.livePitWindowHelp")} />
        <div className="metric"><span className="label">{t("pitWindow.earliest")}</span><span className="value">{t("telemetry.lap")} {pit?.earliest_viable_pit_lap ?? "--"}</span></div>
        <div className="metric"><span className="label">{t("pitWindow.latestSafe")}</span><span className="value">{t("telemetry.lap")} {pit?.latest_safe_pit_lap ?? "--"}</span></div>
        <div className="metric"><span className="label">{t("pitWindow.optimal")}</span><span className="value">{t("telemetry.lap")} {pit?.optimal_pit_lap ?? "--"}</span></div>
        <div className="row"><StatusBadge value={pit?.traffic_risk_after_stop} /><span className="subvalue">{t("pitWindow.rejoin", { position: pit?.projected_rejoin_position ?? "--" })}</span></div>
      </section>

      <section className="card span-7">
        <SectionTitle title={t("pitWindow.selectedLiveCall")} help={t("pitWindow.selectedLiveCallHelp")} />
        <div className="header-grid">
          <div><span className="label">{t("pitWindow.call")}</span><strong>{firstStop ? t("pitWindow.pitLap", { lap: absoluteStopLap(absoluteCurrentLap, firstStop.lap) }) : selectedPlan ? t("pitWindow.stayOut") : "--"}</strong><span className="subvalue">{firstStop ? t("pitWindow.inLaps", { count: firstStop.lap }) : t("pitWindow.selectedPlanReachesFinish")}</span></div>
          <div><span className="label">{t("pitWindow.fuelAtStop")}</span><strong>{firstStop ? fmt(firstStop.fuelRemainingLiters, 1, " L") : fmt(currentFuel, 1, " L")}</strong><span className="subvalue">{firstStop ? t("pitWindow.addFuel", { fuel: fmt(firstStop.fuelAddedLiters, 1, " L") }) : t("pitWindow.finishFuel", { fuel: fmt(selectedPlan?.finishFuelRemainingLiters, 1, " L") })}</span></div>
          <div><span className="label">{t("pitWindow.virtualEnergyAtStop")}</span><strong>{firstStop ? pct(firstStop.virtualEnergyRemaining) : pct(currentVirtualEnergy)}</strong><span className="subvalue">{firstStop ? t("pitWindow.restoreEnergy", { energy: pct(firstStop.virtualEnergyOnExit) }) : t("pitWindow.finishEnergy", { energy: pct(selectedPlan?.finishVirtualEnergy) })}</span></div>
          <div><span className="label">{t("pitWindow.tyresToChange")}</span><strong>{firstStop ? tyreChangeWearText(firstStop, t) : t("pitWindow.none")}</strong></div>
          <div><span className="label">{t("pitWindow.stopTimeLabel")}</span><strong>{firstStop ? fmt(firstStop.stopTimeSeconds, 1, " s") : "0 s"}</strong></div>
          <div><span className="label">{t("pitWindow.remaining")}</span><strong>{formatDuration(remaining.value)}</strong><span className="subvalue">{remaining.source}</span></div>
          <div><span className="label">{t("pitWindow.paceModelLabel")}</span><strong>{formatRaceTime(paceEvidence.weightedRecentPace)}</strong><span className="subvalue">{paceEvidence.source}</span></div>
        </div>
      </section>

      <section className="card span-12">
        <SectionTitle title={t("pitWindow.paceModel")} help={t("pitWindow.paceModelHelp")} />
        <div className="analysis-value-grid">
          <div><span className="label">{t("pitWindow.lastCleanLap")}</span><strong>{formatRaceTime(paceEvidence.lastLapTime)}</strong></div>
          <div><span className="label">{t("pitWindow.last7Average")}</span><strong>{formatRaceTime(paceEvidence.last7LapAverage)}</strong></div>
          <div><span className="label">{t("pitWindow.last10Average")}</span><strong>{formatRaceTime(paceEvidence.last10LapAverage)}</strong></div>
          <div><span className="label">{t("pitWindow.weightedPace")}</span><strong>{formatRaceTime(paceEvidence.weightedRecentPace)}</strong><span className="subvalue">{paceEvidence.source}</span></div>
          <div><span className="label">{t("pitWindow.trend")}</span><strong>{fmt(paceEvidence.paceTrendSecondsPerLap, 3, " s/lap")}</strong><span className="subvalue">{t("pitWindow.positiveMeansSlowing")}</span></div>
          <div><span className="label">{t("pitWindow.confidence")}</span><strong>{paceEvidence.confidence || t("common.low")}</strong><span className="subvalue">{t("pitWindow.cleanLaps", { count: paceEvidence.sampleLaps ?? 0 })}</span></div>
        </div>
      </section>

      <section className="card span-12">
        <SectionTitle title={t("pitWindow.liveModelInputs")} help={t("pitWindow.liveModelInputsHelp")} />
        <div className="analysis-value-grid">
          <div><span className="label">{t("pitWindow.currentLap")}</span><strong>{text(absoluteCurrentLap)}</strong><span className="subvalue">{t("pitWindow.absoluteRaceLap")}</span></div>
          <div><span className="label">{t("pitWindow.currentFuel")}</span><strong>{fmt(currentFuel, 1, " L")}</strong><span className="subvalue">{t("pitWindow.tank", { fuel: fmt(tankCapacity, 1, " L") })}</span></div>
          <div><span className="label">{t("pitWindow.currentVirtualEnergy")}</span><strong>{pct(currentVirtualEnergy)}</strong><span className="subvalue">{fmt(Number.isFinite(virtualEnergyPerLap) ? virtualEnergyPerLap * 100 : null, 2, "% / lap")}</span></div>
          <div><span className="label">{t("pitWindow.fuelEnergyRatio")}</span><strong>{fmt(Number.isFinite(fuelEnergyRatio) ? fuelEnergyRatio : null, 2)}</strong><span className="subvalue">{t("pitWindow.ratioDetail")}</span></div>
          <div><span className="label">{t("pitWindow.fuelUse")}</span><strong>{fmt(Number.isFinite(fuelPerLap) ? fuelPerLap : null, 3, " L/lap")}</strong><span className="subvalue">{t("pitWindow.validLaps", { observed: strategy?.fuel.valid_laps_observed ?? 0, required: strategy?.fuel.valid_laps_required ?? 3 })}</span></div>
          <div><span className="label">{t("pitWindow.tyreWear")}</span><strong>{pct(Number.isFinite(currentWear) ? currentWear : null)}</strong><span className="subvalue">{tyreWearText({ fl: tyres?.wear_fl ?? currentWear, fr: tyres?.wear_fr ?? currentWear, rl: tyres?.wear_rl ?? currentWear, rr: tyres?.wear_rr ?? currentWear })}</span></div>
          <div><span className="label">{t("pitWindow.wearRate")}</span><strong>{fmt(Number.isFinite(wearRate) ? wearRate * 100 : null, 2, "% / lap")}</strong><span className="subvalue">{t("pitWindow.maxWear", { value: pct(Number(assumptions.max_tyre_wear ?? 0.75)) })}</span></div>
          <div><span className="label">{t("pitWindow.pitModel")}</span><strong>{fmt(Number(assumptions.pit_loss_seconds ?? 28), 1, " s")}</strong><span className="subvalue">{t("pitWindow.pitModelDetail", { tyre: fmt(Number(assumptions.tyre_change_seconds_per_tyre ?? 3), 1, " s"), fuel: fmt(Number(assumptions.refuel_seconds_per_5_liters ?? 1.2), 1, " s per 5L") })}</span></div>
          <div><span className="label">{t("pitWindow.safetyCar")}</span><strong>{pit?.safety_car_pit_recommendation ? t("pitWindow.activePitGain") : t("pitWindow.notApplied")}</strong><span className="subvalue">{t("pitWindow.pitLossIfActive", { time: fmt(Number(assumptions.safety_car_pit_loss_seconds ?? 16), 1, " s") })}</span></div>
          <div><span className="label">{t("pitWindow.fuelMarginNow")}</span><strong>{fmt(strategy?.fuel.fuel_delta_to_finish, 1, " L")}</strong><span className="subvalue">{strategy?.fuel.confidence || t("common.low")} {t("pitWindow.confidence").toLowerCase()}</span></div>
          <div><span className="label">{t("pitWindow.energyMarginNow")}</span><strong>{pct(strategy?.energy?.virtual_energy_delta_to_finish)}</strong><span className="subvalue">{strategy?.energy?.confidence || t("common.low")} {t("pitWindow.confidence").toLowerCase()}</span></div>
          <div><span className="label">{t("pitWindow.trafficRisk")}</span><strong>{text(pit?.traffic_risk_after_stop)}</strong><span className="subvalue">{t("pitWindow.rejoin", { position: pit?.projected_rejoin_position ?? "--" })}</span></div>
        </div>
      </section>

      {selectedPlan && (
        <section className="card span-12">
          <SectionTitle title={t("pitWindow.liveCalculationBreakdown")} help={t("pitWindow.liveCalculationBreakdownHelp")} />
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t("pitWindow.input")}</th><th>{t("pitWindow.value")}</th><th>{t("pitWindow.usedFor")}</th></tr></thead>
              <tbody>
                <tr><td>{t("pitWindow.weightedPace")}</td><td>{formatRaceTime(selectedPlan.calculationBreakdown.simulationPaceSeconds)}</td><td>{t("pitWindow.weightedPaceUse")}</td></tr>
                <tr><td>{t("pitWindow.remainingRaceLaps")}</td><td>{fmt(selectedPlan.raceLaps, 2)}</td><td>{t("pitWindow.fuelAndStintProjection")}</td></tr>
                <tr><td>{t("pitWindow.baseDrivingTime")}</td><td>{formatDuration(selectedPlan.baseRaceTimeSeconds)}</td><td>{t("pitWindow.totalTimeBaseline")}</td></tr>
                <tr><td>{t("pitWindow.pitServiceTime")}</td><td>{fmt(selectedPlan.pitTimeSeconds, 1, " s")}</td><td>{t("pitWindow.pitServiceUse")}</td></tr>
                <tr><td>{t("pitWindow.recentPaceTrendLoss")}</td><td>{fmt(selectedPlan.projectedPaceLossSeconds, 1, " s")}</td><td>{t("pitWindow.recentPaceTrendUse")}</td></tr>
                <tr><td>{t("pitWindow.tyreDegradationLoss")}</td><td>{fmt(selectedPlan.tyreDegradationLossSeconds, 1, " s")}</td><td>{t("pitWindow.tyreDegradationUse")}</td></tr>
                <tr><td>{t("pitWindow.liftCoastLoss")}</td><td>{fmt(selectedPlan.liftCoastLossSeconds, 1, " s")}</td><td>{t("pitWindow.liftCoastUse")}</td></tr>
                <tr><td>{t("pitWindow.trafficLoss")}</td><td>{fmt(selectedPlan.trafficLossSeconds, 1, " s")}</td><td>{t("pitWindow.trafficLossUse")}</td></tr>
                <tr><td>{t("pitWindow.fuelModel")}</td><td>{fmt(selectedPlan.calculationBreakdown.fuelUseLitersPerLap, 3, " L/lap")}</td><td>{t("pitWindow.fuelModelUse")}</td></tr>
                <tr><td>{t("pitWindow.virtualEnergyModel")}</td><td>{fmt(Number.isFinite(virtualEnergyPerLap) ? virtualEnergyPerLap * 100 : null, 3, "% / lap")}</td><td>{t("pitWindow.virtualEnergyModelUse")}</td></tr>
                <tr><td>{t("pitWindow.fuelAtFinish")}</td><td>{fmt(selectedPlan.finishFuelRemainingLiters, 1, " L")}</td><td>{t("pitWindow.finishFuelUse")}</td></tr>
                <tr><td>{t("pitWindow.confidence")}</td><td>{selectedPlan.confidence}</td><td>{t("pitWindow.finishFuelUse")}</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

    </div>
  );
}

