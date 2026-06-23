import type { FuelState } from "../types/strategy";
import type { PlayerState } from "../types/telemetry";
import { useT } from "../i18n/I18nProvider";
import { StatusBadge } from "./StatusBadge";

const n = (value?: number, digits = 1) => value == null ? "--" : value.toFixed(digits);
const pct = (value?: number) => value == null ? "--" : `${Math.round(value * 100)}%`;
const percent = (value?: number) => value == null ? "--" : `${Math.round(value)}%`;

export function FuelWidget({ fuel, player }: { fuel?: FuelState; player?: PlayerState }) {
  const t = useT();
  return (
    <section className="card span-4">
      <div className="row"><h2>{t("telemetry.fuel")}</h2><StatusBadge value={fuel?.confidence || t("common.low")} /></div>
      <div className="metric"><span className="label">{t("telemetry.tank")}</span><span className="value">{n(player?.fuel_liters)} L</span></div>
      <div className="row"><span className="subvalue">{t("telemetry.capacity")} {n(player?.fuel_capacity_liters)} L</span><span className="subvalue">VE {pct(player?.hybrid_state?.virtual_energy_fraction)}</span></div>
      <div className="row"><span className="subvalue">{t("telemetry.battery")} {percent(player?.hybrid_state?.battery_percent)}</span><span className="subvalue">{t("telemetry.regen")} {n(player?.hybrid_state?.regen_kw)} kW</span></div>
      <div className="row"><span className="subvalue">{t("telemetry.perLap")} {n(fuel?.fuel_per_lap_liters, 2)} L</span><span className="subvalue">{t("telemetry.range")} {fuel?.fuel_laps_remaining == null ? "--" : t("common.laps", { count: Math.round(fuel.fuel_laps_remaining) })}</span></div>
      <div className="metric"><span className="label">{t("telemetry.deltaToFinish")}</span><span className="value">{n(fuel?.fuel_delta_to_finish)} L</span></div>
    </section>
  );
}
